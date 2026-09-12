/**
 * dsh-campus-hunt — job_track 工具（v0.1）。
 *
 * 本地投递流水线：纯 JSON 读写会话 workspace 下的 track.json，**无任何网络 I/O**。
 * 四个 action：
 *   list   列出全部追踪记录 + 按状态汇总（GUI「投递追踪」tab 数据源）
 *   add    新增（或就地位更新）一条追踪记录；jobId 或 公司+岗位名 定位
 *   update 更新既有记录的 status/note/deadline（至少一项）
 *   status 更新既有记录的状态（update 的快捷形式）
 *
 * workspace 归属：exec.agent.session.header.cwd（官方 tool-fs session-cwd 机制，
 * v0.1 口径）；非 agent 调用无会话 workspace → execute 抛错（isError）。
 *
 * v0.1.1（无变化分支）：update / status 所给字段与当前值全等（含 status 快捷
 * 形式）→ 不抛错、不推进 updatedAt、跳过 writeTrack，返回 tracks/summary 原样 +
 * changed: false（render 首行前置「已是目标状态，本次无变更」）；真实变更返回
 * changed: true；list / add 结果不含 changed 键。
 */

import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { TRACK_STATUSES, type Track, type TrackStatus } from '../nowcoder/types.ts'
import {
  assertWorkspaceRoot,
  readTrack,
  resolveWorkspaceRoot,
  writeTrack,
  type TrackData,
} from '../data/store.ts'

/** 规范返回值（output.schema 的推断类型在此显式写出，供 render/presentationMeta 共享）。 */
export interface JobTrackResult {
  tracks: Track[]
  summary: {
    byStatus: Record<TrackStatus, number>
    total: number
  }
  /** v0.1.1：真实变更 true / 无变化分支 false；list / add 结果不含本键。 */
  changed?: boolean
}

/** 各状态计数（六个枚举全列，缺省 0 —— GUI stat 单元格稳定）。 */
export function summarize(data: TrackData): JobTrackResult['summary'] {
  const byStatus = Object.fromEntries(TRACK_STATUSES.map(s => [s, 0])) as Record<TrackStatus, number>
  for (const track of data.tracks) byStatus[track.status] += 1
  return { byStatus, total: data.tracks.length }
}

/** 未采集岗位（无牛客 jobId）时的稳定 id：公司+岗位名 直连。 */
export function deriveJobId(company: string, title: string): string {
  return `${company.trim()}-${title.trim()}`
}

/** 模型可见的紧凑渲染（中文直值，与存储一致）。 */
export function renderTrackResult(value: JobTrackResult): string {
  if (value.summary.total === 0) return '投递追踪为空：还没有跟踪任何岗位（用 job_track action=add 新增）。'
  const counts = TRACK_STATUSES
    .filter(s => value.summary.byStatus[s] > 0)
    .map(s => `${s} ${value.summary.byStatus[s]}`)
    .join('，')
  const lines = value.tracks.map((t) => {
    const extras: string[] = []
    if (t.deadline !== undefined) extras.push(`截止 ${t.deadline}`)
    if (t.note !== undefined) extras.push(`备注 ${t.note}`)
    return `- [${t.status}] ${t.company} · ${t.title}${extras.length > 0 ? `（${extras.join('，')}）` : ''}`
  })
  // v0.1.1：无变化分支（changed === false）→ 首行前置不误导句，其余（追踪 N 个岗位…列表）不变。
  const head = value.changed === false ? '已是目标状态，本次无变更。' : ''
  return `${head}追踪 ${value.summary.total} 个岗位（${counts}）：\n${lines.join('\n')}`
}

/**
 * 卡片投影（v0.1）：规范值 → 可回放 JSON（card:'tracks'）。纯投影：
 * tracks/summary 原样透传（registry 边界已按 output schema 校验，client 侧
 * 逐条再校验）；value 非对象（脏值，仅直接调用可达）→ `{ card: null }`，
 * client 回退 generic 行。
 */
export function projectTracksCard(value: unknown): {
  card: 'tracks' | null
  tool: 'job_track'
  tracks: Track[]
  summary: JobTrackResult['summary'] | null
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { card: null, tool: 'job_track', tracks: [], summary: null }
  }
  const v = value as Partial<JobTrackResult>
  const s = v.summary
  const byStatus = s !== null && typeof s === 'object' && !Array.isArray(s)
    ? (s as { byStatus?: unknown }).byStatus
    : undefined
  const summary = byStatus !== null && typeof byStatus === 'object' && !Array.isArray(byStatus)
    ? (s as JobTrackResult['summary'])
    : null
  return {
    card: 'tracks',
    tool: 'job_track',
    tracks: Array.isArray(v.tracks) ? (v.tracks as Track[]) : [],
    summary,
  }
}

function sessionCwd(exec: ToolRunContext): string | undefined {
  // 与 tool-fs session-cwd 相同的访问路径；exec.agent 为只读运行时面。
  return exec.agent?.session?.header?.cwd
}

interface JobTrackArgs {
  action: 'list' | 'add' | 'update' | 'status'
  jobId?: string
  company?: string
  title?: string
  status?: TrackStatus
  note?: string
  deadline?: string
}

function findTrack(data: TrackData, args: JobTrackArgs): Track | undefined {
  if (args.jobId !== undefined) return data.tracks.find(t => t.id === args.jobId)
  return data.tracks.find(t => t.company === args.company && t.title === args.title)
}

/** 定位 add 的记录键：jobId 优先；否则 company+title（派生 id）。 */
function addKey(args: JobTrackArgs): { id: string; company: string; title: string } {
  if (args.jobId !== undefined) {
    if (args.company !== undefined && args.title !== undefined) return { id: args.jobId, company: args.company, title: args.title }
    throw new Error('job_track add：给了 jobId 时必须同时给 company 和 title（用于记录展示）')
  }
  if (args.company === undefined || args.title === undefined) {
    throw new Error('job_track add：需要 jobId，或 company + title 定位岗位')
  }
  return { id: deriveJobId(args.company, args.title), company: args.company, title: args.title }
}

export const jobTrackTool = defineTool({
  name: 'job_track',
  description:
    '校招投递流水线（纯本地，无网络）。管理会话 workspace 下 track.json 的投递状态台账：'
    + 'list 列出全部记录与按状态汇总；add 新增一条（jobId 或 company+title 定位，重复即就地位更新）；'
    + 'update 修改既有记录的 status/note/deadline；status 修改既有记录的状态。'
    + 'status 取值：未处理 / 已投递 / 笔试 / 面试 / 已拒 / offer。',
  parameters: {
    action: {
      type: 'string',
      required: true,
      enum: ['list', 'add', 'update', 'status'],
      description: '操作：list=列出全部；add=新增/更新一条；update=改既有记录的字段；status=改既有记录的状态。',
    },
    jobId: {
      type: 'string',
      description: '岗位 id（与 jobs.json 的牛客岗位 id 一致；未采集岗位可省略，改用 company+title）。',
    },
    company: {
      type: 'string',
      description: '公司名（无 jobId 时与 title 一起定位岗位；add 带 jobId 时也必填用于展示）。',
    },
    title: {
      type: 'string',
      description: '岗位名（无 jobId 时与 company 一起定位岗位）。',
    },
    status: {
      type: 'string',
      enum: [...TRACK_STATUSES],
      description: '投递状态（add 省略时默认 未处理；status 必填；update 可选）。',
    },
    note: {
      type: 'string',
      description: '可选备注（面试轮次、笔试提示等人工信息）。',
    },
    deadline: {
      type: 'string',
      description: '可选截止时间，建议 ISO YYYY-MM-DD（把"12.31"换算成完整日期后传入）。',
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tracks: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              company: { type: 'string', required: true },
              title: { type: 'string', required: true },
              status: { type: 'string', required: true, enum: [...TRACK_STATUSES] },
              note: { type: 'string' },
              deadline: { type: 'string' },
              createdAt: { type: 'string', required: true },
              updatedAt: { type: 'string', required: true },
            },
          },
        },
        summary: {
          type: 'object',
          additionalProperties: false,
          required: true,
          properties: {
            byStatus: {
              type: 'object',
              additionalProperties: true,
              required: true,
              // 显式列出六个状态键（保持推断的具体性；勿用 Object.fromEntries——键会退化为 string）。
              properties: {
                未处理: { type: 'integer', required: true },
                已投递: { type: 'integer', required: true },
                笔试: { type: 'integer', required: true },
                面试: { type: 'integer', required: true },
                已拒: { type: 'integer', required: true },
                offer: { type: 'integer', required: true },
              },
            },
            total: { type: 'integer', required: true },
          },
        },
        // v0.1.1：真实变更 true / 无变化分支 false；list / add 不含本键（可选，不进 required）。
        changed: { type: 'boolean' },
      },
    },
    render: (_args, value) => [{ type: 'text', text: renderTrackResult(value) }],
    // v0.1 口径：可回放卡片投影（规范值纯 JSON；M3 GUI「投递追踪」tab 从 card 派生）。
    presentationMeta: (_args, value) => projectTracksCard(value),
  },
  async execute(args: JobTrackArgs, exec: ToolRunContext): Promise<JobTrackResult> {
    const root = resolveWorkspaceRoot(sessionCwd(exec))
    await assertWorkspaceRoot(root)
    exec.signal.throwIfAborted()

    const data = await readTrack(root)

    if (args.action === 'list') {
      return { tracks: data.tracks, summary: summarize(data) }
    }

    if (args.action === 'add') {
      const key = addKey(args)
      const now = new Date().toISOString()
      const existing = data.tracks.find(t => t.id === key.id)
      const track: Track = existing ?? {
        id: key.id,
        company: key.company,
        title: key.title,
        status: '未处理',
        createdAt: now,
        updatedAt: now,
      }
      // add 就地位更新：status/note/deadline 给到才覆盖（重复 add 幂等收敛）。
      if (args.status !== undefined) track.status = args.status
      if (args.note !== undefined) track.note = args.note
      if (args.deadline !== undefined) track.deadline = args.deadline
      if (existing === undefined) data.tracks.push(track)
      await writeTrack(root, data)
      return { tracks: data.tracks, summary: summarize(data) }
    }

    // update / status：目标必须已存在。
    const target = findTrack(data, args)
    if (target === undefined) {
      const where = args.jobId !== undefined ? `jobId=${args.jobId}` : `company=${args.company} title=${args.title}`
      throw new Error(`job_track ${args.action}：track.json 中找不到 ${where} 的记录；请先用 action=add 新增`)
    }
    if (args.action === 'status') {
      if (args.status === undefined) throw new Error('job_track status：必须给 status')
      if (args.status === target.status) {
        // v0.1.1：status 与当前相等 → 无变化分支（不抛错、不推进 updatedAt、跳过 writeTrack）。
        return { tracks: data.tracks, summary: summarize(data), changed: false }
      }
      target.status = args.status
    } else {
      const given =
        args.status !== undefined || args.note !== undefined || args.deadline !== undefined
      if (!given) throw new Error('job_track update：status / note / deadline 至少给一项')
      const real =
        (args.status !== undefined && args.status !== target.status)
        || (args.note !== undefined && args.note !== target.note)
        || (args.deadline !== undefined && args.deadline !== target.deadline)
      if (!real) {
        // v0.1.1：所给字段与当前全等 → 无变化分支（不抛错、不推进 updatedAt、跳过 writeTrack）。
        return { tracks: data.tracks, summary: summarize(data), changed: false }
      }
      if (args.status !== undefined) target.status = args.status
      if (args.note !== undefined) target.note = args.note
      if (args.deadline !== undefined) target.deadline = args.deadline
    }
    target.updatedAt = new Date().toISOString()
    await writeTrack(root, data)
    return { tracks: data.tracks, summary: summarize(data), changed: true }
  },
})
