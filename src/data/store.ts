/**
 * dsh-campus-hunt — 本地数据层（v0.1；错误前缀中立化 v0.1）。
 *
 * v0.1：本层是 job_track 与 campus_job_search（及 M2/M4）共用的共享数据
 * 层，错误文案前缀统一为 `dsh-campus-hunt:`，不再挂 `job_track:`（v0.1 遗留），
 * 避免其他工具走同一解析路径时误导 agent 归因。
 *
 * local-first：所有数据写**当前会话 workspace**（exec.agent.session.header.cwd，
 * 与 tool-fs 的 session-cwd 机制一致），不写固定个人目录。三个文件：
 *
 *   <workspace>/jobs.json     岗位库（M2 写入；本层备通道）
 *   <workspace>/track.json    投递状态台账（job_track 主数据源）
 *   <workspace>/schedule.json 校招日程（M2 写入；本层备通道）
 *
 * 求职画像不在此层（v0.1.1：画像只存 settings 的 campus-hunt 分节，无
 * workspace 副本；free-search 模式经 campus_job_search 返回行直供模型）。
 *
 * 统一信封 { schema: 0, data: ... }。schema 版本不符（未来版本写、旧插件读）时
 * 按 dsh-job-hunting 做法备份为 <file>.pre-schema-<新版本>.bak 并以空数据继续
 * （v0 口径：拒绝迁移、备份、不崩溃）。写入走 tmp+rename 原子替换。
 *
 * 纯 node:fs 实现（spec §4.3 允许的"dsh-fs seam 或 node:fs + workspace 路径"）：
 * 文件全部落在会话 workspace 根内，DSH 文件沙箱对 workspace 内读写放行。
 */

import { rename, stat, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { Job, ScheduleItem, Track } from '../nowcoder/types.ts'

/** 当前 schema 版本（v0.1 口径：v0）。 */
export const SCHEMA_VERSION = 0

/** 三个数据文件的文件名。 */
export const STORE_FILES = {
  jobs: 'jobs.json',
  track: 'track.json',
  // M2 的 campus_schedule 落盘文件（spec §4.2 明确 schedule.json；本层提前备通道）。
  schedule: 'schedule.json',
} as const

export type StoreFile = (typeof STORE_FILES)[keyof typeof STORE_FILES]

/** track.json 的 data 载荷。 */
export interface TrackData {
  tracks: Track[]
}

/** jobs.json 的 data 载荷。 */
export interface JobsData {
  jobs: Job[]
}

/** schedule.json 的 data 载荷。 */
export interface ScheduleData {
  items: ScheduleItem[]
}

/** 统一信封。 */
interface Envelope<T> {
  schema: number
  data: T
}

/** 各文件空数据（文件缺失时 read 的返回值）。 */
export interface EmptyData {
  track: TrackData
  jobs: JobsData
  schedule: ScheduleData
}

export const EMPTY_DATA: EmptyData = {
  track: { tracks: [] },
  jobs: { jobs: [] },
  schedule: { items: [] },
}

export type DataFile = 'track' | 'jobs' | 'schedule'

/** 数据文件路径。 */
export function storePath(workspaceRoot: string, file: DataFile): string {
  return join(workspaceRoot, STORE_FILES[file])
}

/** 读一个数据文件；文件不存在返回 empty（空数据），不做备份/写入。 */
async function readEnvelope<T>(
  workspaceRoot: string,
  file: DataFile,
  empty: T,
): Promise<T> {
  const path = storePath(workspaceRoot, file)
  let raw: string
  try {
    const { readFile } = await import('node:fs/promises')
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty
    throw new Error(`dsh-campus-hunt: cannot read ${file}: ${String(error)}`, { cause: error }) // v0.1：前缀中立化
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`dsh-campus-hunt: ${file} is not valid JSON: ${String(error)}`, { cause: error }) // v0.1：前缀中立化
  }
  const envelope = parsed as Partial<Envelope<unknown>> | null
  // v0 口径：根不是对象、或 schema 版本不符（未来版本写、旧插件读）→
  // 备份原文件为 <file>.pre-schema-<新版本>.bak，以空数据继续（拒绝迁移、不崩溃；
  // 损坏 JSON 在上方已大声报错——无法解析的字节流不是"旧版本数据"）。
  if (typeof envelope !== 'object' || envelope === null || envelope.schema !== SCHEMA_VERSION) {
    const backupPath = `${path}.pre-schema-${SCHEMA_VERSION}.bak`
    await writeFile(backupPath, raw, 'utf8')
    return empty
  }
  return (envelope.data ?? empty) as T
}

/** 写一个数据文件（信封 { schema, data }，2 空格缩进 + 尾换行；tmp+rename 原子替换）。 */
async function writeEnvelope<T>(
  workspaceRoot: string,
  file: DataFile,
  data: T,
): Promise<void> {
  const path = storePath(workspaceRoot, file)
  const tmpPath = `${path}.tmp`
  const envelope: Envelope<T> = { schema: SCHEMA_VERSION, data }
  await writeFile(tmpPath, JSON.stringify(envelope, null, 2) + '\n', 'utf8')
  try {
    await rename(tmpPath, path)
  } catch (error) {
    await unlink(tmpPath).catch(() => {})
    throw new Error(`dsh-campus-hunt: cannot write ${file}: ${String(error)}`, { cause: error }) // v0.1：前缀中立化
  }
}

// ---- 三文件读写 API（job_track 与 M2 工具共用；M4 画像不在此层，v0.1.1） ----
//
// 注意（v0.1 修复）：empty 参数必须传**每次调用新建的字面量**，不得复用
// EMPTY_DATA 的共享对象——readEnvelope 的 ENOENT / schema 不符路径直接返回该
// 对象，调用方（工具 execute）会在其上 push/改写；共享对象会把第一个根目录的
// 写入泄漏进后续所有"文件不存在"的读取（跨 workspace 内存污染）。
// EMPTY_DATA 保留为结构参考（测试用 toEqual 比对）。

/** 读 track.json（缺失 → 空台账）。 */
export function readTrack(workspaceRoot: string): Promise<TrackData> {
  return readEnvelope<TrackData>(workspaceRoot, 'track', { tracks: [] })
}

/** 写 track.json。 */
export function writeTrack(workspaceRoot: string, data: TrackData): Promise<void> {
  return writeEnvelope<TrackData>(workspaceRoot, 'track', data)
}

/** 读 jobs.json（缺失 → 空岗位库）。 */
export function readJobs(workspaceRoot: string): Promise<JobsData> {
  return readEnvelope<JobsData>(workspaceRoot, 'jobs', { jobs: [] })
}

/** 写 jobs.json。 */
export function writeJobs(workspaceRoot: string, data: JobsData): Promise<void> {
  return writeEnvelope<JobsData>(workspaceRoot, 'jobs', data)
}

/** 读 schedule.json（缺失 → 空日程；M2 用）。 */
export function readSchedule(workspaceRoot: string): Promise<ScheduleData> {
  return readEnvelope<ScheduleData>(workspaceRoot, 'schedule', { items: [] })
}

/** 写 schedule.json（M2 用）。 */
export function writeSchedule(workspaceRoot: string, data: ScheduleData): Promise<void> {
  return writeEnvelope<ScheduleData>(workspaceRoot, 'schedule', data)
}

// ---- workspace 根解析 ----

/**
 * 会话 workspace 根（当前活跃 workspace，local-first 口径）。
 *
 * 与官方 tool-fs 的 session-cwd 机制一致：取调用 agent 的会话头 cwd
 * （exec.agent.session.header.cwd，绝对路径）。非 agent 调用（无 exec.agent
 * 或无 cwd）没有可归属的 workspace → 抛错（工具 isError），绝不回退
 * process.cwd()（那是宿主启动目录，不是会话 workspace）。
 *
 * @param agentCwd - exec.agent?.session?.header?.cwd 的只读快照。
 * @returns 绝对 workspace 根路径。
 */
export function resolveWorkspaceRoot(agentCwd: string | undefined): string {
  if (typeof agentCwd !== 'string' || agentCwd.length === 0) {
    throw new Error(
      'dsh-campus-hunt: 需要 agent 会话的 workspace 路径（session header cwd）；' // v0.1：前缀中立化
      + '本调用没有可用的会话 workspace，无法定位 jobs.json / track.json',
    )
  }
  if (!isAbsolute(agentCwd)) {
    throw new Error(`dsh-campus-hunt: session workspace 必须是绝对路径，收到 "${agentCwd}"`) // v0.1：前缀中立化
  }
  return agentCwd
}

/** workspace 根必须存在且是目录（写前检查，错误信息可定位）。 */
export async function assertWorkspaceRoot(root: string): Promise<void> {
  try {
    const s = await stat(root)
    if (!s.isDirectory()) throw new Error('not a directory')
  } catch (error) {
    throw new Error(`dsh-campus-hunt: workspace 目录不可用（${root}）：${String(error)}`) // v0.1：前缀中立化
  }
}
