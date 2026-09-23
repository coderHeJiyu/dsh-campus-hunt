/**
 * dsh-campus-hunt · 校招岗位三 tab 卡片（v0.1，client 半场）。
 *
 * 一个组件服务 4 个工具（会话节点注册，见 index.tsx，v0.1.1）：
 * campus_job_search / campus_job_detail / campus_schedule / job_track。
 * 分支依据 host 侧 presentationMeta 投影（block.meta.card:
 * 'jobs' | 'job' | 'schedule' | 'tracks'）；meta 缺失/畸形时回退解析
 * content[0].text 的规范值 JSON；再失败则渲染自绘 generic 行——
 * 永不白屏、不抛到宿主。
 *
 * 数据形态对齐工具规范值（src/nowcoder/types.ts）：
 * - jobs:     { jobs, merged, duplicates }
 * - job:      { jobId, job（含 jd 的完整 Job） }
 * - schedule: { items, source }
 * - tracks:   { tracks, summary }
 * 逐条校验（job: id+company+title；track: id+company+title+status；
 * item: company+type+source），坏元素跳过，全坏 → generic。
 *
 * 交互 local-first：activeTab / 选中行 / localStatus（本地状态标记）全部是
 * 组件本地 state（零往返）；只有三个 [campus-hunt-action] 提示词走会话面
 * （写入追踪 / 重新采集 JD / 追踪该岗位），mode 固定 'queue'。
 *
 * 会话面 = inject 面产物 `sendPrompt?: (text) => void`（见 index.tsx）：
 * 框架解析的 sessionId 被 inject 工厂闭包捕获，内部经 sessions 服务的
 * prompt 通道入队；组件不接触任何会话 hook。sendPrompt 缺失（非框架
 * 渲染 / sessions 面不可用）时三个动作按钮统一禁用。
 *
 * 类型自写口径：本插件 node_modules 不装 @deepseek-ai/dsh-client-ui-chat /
 * dsh-api-session-controller（import type 也解析失败），故按 wire 形态自写
 * 最小结构接口（与 records.ts / session.ts 对齐）。
 *
 * 样式遵循 DSH 外部插件惯例：内联样式、内联中文、透明底、无 locale。
 *
 * v0.1.3：PTC 文件分支——PTC 工具呈现下 host 不对子调用投影
 * presentationMeta（block.meta 缺席），且 content 是人类可读文本而非规范值
 * JSON，parseCard 必落 generic 行。规范值的唯一无损来源 = 会话 workspace
 * 文件：meta 缺席且 loader 可用（inject 面 loadWorkspaceFile，见 index.tsx）
 * 时，活读 jobs.json / track.json / schedule.json，构造规范值，复用同一卡片
 * 体（CardBody）；任何失败回退 generic 行，native 呈现（meta 在）不受影响。
 */
import { useEffect, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// 自写最小 wire 类型
// ─────────────────────────────────────────────────────────────────────────────

/** JD 解析行（nowcoder types.Job.jd 子集）。 */
interface JdLike {
  description?: unknown
  requirements?: unknown
  bonus?: unknown
}

/** 岗位（nowcoder types.Job 子集）。 */
export interface JobLike {
  id: string
  company: string
  title: string
  city?: string
  salary?: string
  degree?: string
  deadline?: string
  graduationYear?: string
  url?: string
  fetchedAt?: string
  jd?: JdLike
}

/** 追踪条目（nowcoder types.Track 子集）。 */
export interface TrackLike {
  id: string
  company: string
  title: string
  status: string
  note?: string
  deadline?: string
  createdAt?: string
  updatedAt?: string
}

/** 校招日程条目（nowcoder types.ScheduleItem 子集）。 */
export interface ScheduleItemLike {
  company: string
  type: string
  openDate?: string
  cities?: string
  source: string
}

interface ContentBlockLike {
  type: string
  text?: string
}

/** 运行中形态（wire RunningToolCall 结构子集；无 kind 字段）。 */
export interface RunningToolCallLike {
  callId: string
  name: string
  argsRaw: string
  subCalls: readonly unknown[]
}

/** 已落定形态（wire ToolResultNode 结构子集；有 kind 字段）。 */
export interface ToolResultNodeLike {
  kind: 'tool-result'
  seq?: number
  time?: number
  callId: string
  call: { name: string; argsRaw: string } | null
  callTime?: number
  content: readonly ContentBlockLike[]
  isError: boolean
  error?: { name: string; code: string }
  meta?: unknown
  subCalls?: readonly unknown[]
}

export type ToolCallBlockLike = RunningToolCallLike | ToolResultNodeLike

export interface JobCardsProps {
  callId: string
  toolName: string
  block: ToolCallBlockLike
  cwd?: string
  home?: string
  /** 框架必传；本卡片不用（无打开文件动作）。 */
  openFile: (path: string) => void
  /** 框架可传；本卡片不用。 */
  inspect?: () => void
  /** 动作 prompt 通道（inject 面产物，见 index.tsx）；缺失时动作按钮禁用。 */
  sendPrompt?: (text: string) => void
  /** v0.1.3 PTC 文件分支：会话 workspace 文件加载器（inject 面产物，见 index.tsx）；缺席不进文件分支。 */
  loadWorkspaceFile?: (path: string) => Promise<string | null>
}

// ─────────────────────────────────────────────────────────────────────────────
// 解析与校验（纯函数，可直接单测）
// ─────────────────────────────────────────────────────────────────────────────

type CardKind = 'jobs' | 'job' | 'schedule' | 'tracks'

const KIND_BY_TOOL: Record<string, CardKind> = {
  campus_job_search: 'jobs',
  campus_job_detail: 'job',
  campus_schedule: 'schedule',
  job_track: 'tracks',
}

export interface ParsedCard {
  kind: CardKind
  tool: string
  jobs: JobLike[]
  job: JobLike | null
  items: ScheduleItemLike[]
  tracks: TrackLike[]
  summary: { byStatus: Record<string, number>; total?: number } | null
  merged: number | null
  duplicates: number | null
  source: string
  jobId: string
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** 非空字符串；否则 null。 */
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** 行数组：保留字符串元素；非数组 → null。 */
function strLines(v: unknown): string[] | null {
  return Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === 'string') : null
}

export function isJobLike(v: unknown): v is JobLike {
  const r = asRecord(v)
  return r !== null && str(r.id) !== null && str(r.company) !== null && str(r.title) !== null
}

export function isTrackLike(v: unknown): v is TrackLike {
  const r = asRecord(v)
  return r !== null && str(r.id) !== null && str(r.company) !== null && str(r.title) !== null && str(r.status) !== null
}

export function isItemLike(v: unknown): v is ScheduleItemLike {
  const r = asRecord(v)
  return r !== null && str(r.company) !== null && str(r.type) !== null && str(r.source) !== null
}

function firstContentText(content: readonly ContentBlockLike[] | undefined): string | null {
  if (!Array.isArray(content)) return null
  for (const b of content) {
    const r = asRecord(b)
    if (r !== null && r.type === 'text' && typeof r.text === 'string') return r.text
  }
  return null
}

/**
 * 把已落定 block 解析为卡片数据；null → 调用方渲染 generic 行
 * （isError / 未知工具 / meta 与 content 都畸形）。
 * 分支优先级：block.meta（host 投影）→ content[0].text（规范值 JSON 回退）。
 */
export function parseCard(tool: string, block: ToolCallBlockLike): ParsedCard | null {
  if (!('kind' in block)) return null // 运行中：由调用方处理
  const settled = block as ToolResultNodeLike
  if (settled.isError) return null

  const meta = asRecord(settled.meta)
  if (meta !== null) {
    const card = meta.card
    if (card === 'jobs' || card === 'job' || card === 'schedule' || card === 'tracks') {
      const parsed = parseCanonical(tool, card, meta)
      if (parsed !== null) return parsed
      // meta card 畸形 → 落到 content 回退
    }
  }

  const text = firstContentText(settled.content)
  if (text !== null) {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      return null // 非 JSON → generic
    }
    const r = asRecord(value)
    if (r !== null) {
      const kind = KIND_BY_TOOL[tool]
      if (kind !== undefined) {
        const parsed = parseCanonical(tool, kind, r)
        if (parsed !== null) return parsed
      }
    }
  }
  return null
}

function parseCanonical(tool: string, kind: CardKind, v: Record<string, unknown>): ParsedCard | null {
  const base: ParsedCard = {
    kind,
    tool,
    jobs: [],
    job: null,
    items: [],
    tracks: [],
    summary: null,
    merged: null,
    duplicates: null,
    source: '',
    jobId: '',
  }
  switch (kind) {
    case 'jobs': {
      if (!Array.isArray(v.jobs)) return null
      const arr = v.jobs as unknown[]
      if (arr.length > 0 && !arr.some(isJobLike)) return null // 全坏 → generic
      base.jobs = arr.filter(isJobLike)
      base.merged = num(v.merged)
      base.duplicates = num(v.duplicates)
      break
    }
    case 'job': {
      if (!isJobLike(v.job)) return null
      const job = v.job as JobLike
      base.job = job
      base.jobId = str(v.jobId) ?? job.id
      break
    }
    case 'schedule': {
      if (!Array.isArray(v.items)) return null
      const arr = v.items as unknown[]
      if (arr.length > 0 && !arr.some(isItemLike)) return null // 全坏 → generic
      base.items = arr.filter(isItemLike)
      base.source = str(v.source) ?? ''
      break
    }
    case 'tracks': {
      if (!Array.isArray(v.tracks)) return null
      const arr = v.tracks as unknown[]
      if (arr.length > 0 && !arr.some(isTrackLike)) return null // 全坏 → generic
      base.tracks = arr.filter(isTrackLike)
      const s = asRecord(v.summary)
      const byStatus = s !== null ? asRecord(s.byStatus) : null
      if (s !== null && byStatus !== null) {
        const total = num(s.total)
        base.summary = { byStatus: byStatus as Record<string, number>, total: total ?? undefined }
      }
      break
    }
  }
  return base
}

// ─────────────────────────────────────────────────────────────────────────────
// PTC 文件分支（v0.1.3；纯函数，可直接单测）
// ─────────────────────────────────────────────────────────────────────────────

/** kind → 会话 workspace 文件名（store 层三个数据文件，见 src/data/store.ts）。 */
export function ptcFileForKind(kind: CardKind): string {
  if (kind === 'tracks') return 'track.json'
  if (kind === 'schedule') return 'schedule.json'
  return 'jobs.json' // jobs / job 共用岗位库
}

/**
 * PTC 文件分支门禁（全部满足才进）：block 已落定、isError false、meta 缺席
 * （= PTC 呈现；native 恒有 meta）、工具为 4 个 campus 卡之一、loader 可用。
 */
export function ptcFileGate(tool: string, block: ToolCallBlockLike, hasLoader: boolean): boolean {
  if (!('kind' in block)) return false
  const settled = block as ToolResultNodeLike
  if (settled.isError) return false
  if (asRecord(settled.meta) !== null) return false
  const kind = KIND_BY_TOOL[tool]
  if (kind === undefined) return false
  return hasLoader
}

/** 从 PTC dispatch 的 argsRaw 提取非空 jobId 字符串；缺席 / 畸形 / 非 JSON → null。 */
function ptcJobIdFromArgs(argsRaw: string | undefined): string | null {
  if (argsRaw === undefined || argsRaw.length === 0) return null
  try {
    const r = asRecord(JSON.parse(argsRaw))
    return r === null ? null : str(r.jobId)
  } catch {
    return null
  }
}

/**
 * 会话 workspace 文件文本 → 规范值（字段名对齐 parseCanonical 期望）：先解
 * store 信封（{ schema, data } → data，容忍裸对象），再按 kind 构造：
 * - jobs:     { jobs }（数组，缺失 → null）
 * - tracks:   { tracks, summary: { byStatus: 按 track.status 计数, total: tracks.length } }
 * - schedule: { items, source: 首项 source（string，缺失 → ''）}（文件无顶层 source）
 * - job:      需 argsRaw（jobId），jobs 中按 id 找 → { job, jobId }；未找到 → null
 * JSON 解析失败 / 根非对象 / data 非对象 → null；逐元素校验由 parseCanonical
 * 既有检查兜底（本函数只做构造）。
 */
export function ptcCanonicalFromFile(
  kind: CardKind,
  fileText: string,
  argsRaw?: string,
): Record<string, unknown> | null {
  let root: unknown
  try {
    root = JSON.parse(fileText)
  } catch {
    return null
  }
  const obj = asRecord(root)
  if (obj === null) return null
  const data = asRecord(obj.data) ?? obj
  switch (kind) {
    case 'jobs': {
      if (!Array.isArray(data.jobs)) return null
      return { jobs: data.jobs }
    }
    case 'tracks': {
      if (!Array.isArray(data.tracks)) return null
      const tracks = data.tracks as unknown[]
      const byStatus: Record<string, number> = {}
      for (const t of tracks) {
        const s = str(asRecord(t)?.status)
        if (s !== null) byStatus[s] = (byStatus[s] ?? 0) + 1
      }
      return { tracks, summary: { byStatus, total: tracks.length } }
    }
    case 'schedule': {
      if (!Array.isArray(data.items)) return null
      const items = data.items as unknown[]
      const source = str(asRecord(items[0])?.source) ?? ''
      return { items, source }
    }
    case 'job': {
      const jobId = ptcJobIdFromArgs(argsRaw)
      if (jobId === null) return null
      if (!Array.isArray(data.jobs)) return null
      const found = (data.jobs as unknown[]).find(x => asRecord(x)?.id === jobId)
      if (found === undefined) return null
      return { job: found, jobId }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 常量与样式（内联，DSH 插件惯例）
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_ORDER = ['未处理', '已投递', '笔试', '面试', '已拒', 'offer'] as const

const STATUS_COLORS: Record<string, string> = {
  未处理: '#6b7484',
  已投递: '#4d8fd1',
  笔试: '#c9974b',
  面试: '#9a6fd1',
  已拒: '#d15454',
  offer: '#4dbd74',
}
const STATUS_FALLBACK_COLOR = '#5a6472'

const TITLE_BY_KIND: Record<CardKind, string> = {
  jobs: '校招岗位搜索',
  job: '岗位详情',
  schedule: '校招日程',
  tracks: '投递追踪',
}

const JD_LINE_LIMIT = 8

const cardStyle: CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 8,
  padding: 10,
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  fontSize: 12,
  color: '#e8eaf0',
  lineHeight: 1.55,
  maxWidth: 720,
  boxSizing: 'border-box',
}
const headerStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }
const iconStyle: CSSProperties = { color: '#8a93a6', fontSize: 13 }
const titleStyle: CSSProperties = { fontSize: 13, fontWeight: 600 }
const mutedStyle: CSSProperties = { color: '#8a93a6', fontSize: 11 }
const dotStyle = (color: string): CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: color,
  display: 'inline-block',
  flexShrink: 0,
})
const tabBarStyle: CSSProperties = { display: 'flex', gap: 6, marginBottom: 8 }
const tabBtnStyle = (active: boolean): CSSProperties => ({
  padding: '3px 10px',
  fontSize: 12,
  borderRadius: 6,
  cursor: 'pointer',
  background: active ? 'rgba(91,155,213,0.22)' : 'transparent',
  border: active ? '1px solid rgba(91,155,213,0.55)' : '1px solid rgba(255,255,255,0.14)',
  color: active ? '#cfe4f7' : '#a8b0c0',
})
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 }
const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '4px 8px',
  color: '#8a93a6',
  fontWeight: 500,
  borderBottom: '1px solid rgba(255,255,255,0.14)',
}
const tdStyle: CSSProperties = {
  padding: '5px 8px',
  borderBottom: '1px solid rgba(255,255,255,0.07)',
  verticalAlign: 'top',
}
const rowStyle = (selected: boolean): CSSProperties => ({
  cursor: 'pointer',
  background: selected ? 'rgba(91,155,213,0.12)' : 'transparent',
})
const badgeStyle = (status: string): CSSProperties => ({
  display: 'inline-block',
  padding: '1px 8px',
  borderRadius: 10,
  fontSize: 11,
  color: '#ffffff',
  background: STATUS_COLORS[status] ?? STATUS_FALLBACK_COLOR,
})
const smallBtnStyle: CSSProperties = {
  marginTop: 6,
  padding: '3px 10px',
  fontSize: 11,
  borderRadius: 6,
  cursor: 'pointer',
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.25)',
  color: '#c9d1e0',
}
const actionBtnStyle = (enabled: boolean): CSSProperties => ({
  ...smallBtnStyle,
  cursor: enabled ? 'pointer' : 'not-allowed',
  opacity: enabled ? 1 : 0.45,
  borderColor: enabled ? 'rgba(91,155,213,0.6)' : 'rgba(255,255,255,0.18)',
  color: enabled ? '#cfe4f7' : '#77808f',
})
const preStyle: CSSProperties = {
  marginTop: 6,
  padding: 8,
  borderRadius: 6,
  background: 'rgba(0,0,0,0.3)',
  border: '1px solid rgba(255,255,255,0.1)',
  fontSize: 11,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  maxHeight: 240,
  overflow: 'auto',
  color: '#a8b0c0',
}
const sectionTitleStyle: CSSProperties = { fontWeight: 600, fontSize: 12, margin: '8px 0 4px', color: '#c9d1e0' }
const sectionWrapStyle: CSSProperties = { marginBottom: 4 }
const jdLineStyle: CSSProperties = { padding: '1px 0', color: '#d6dae4' }
const detailTitleStyle: CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 4 }
const hintStyle: CSSProperties = { color: '#8a93a6', fontSize: 12, padding: '8px 0' }
const kvRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  padding: '3px 0',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
}
const kvLabelStyle: CSSProperties = { color: '#8a93a6', width: 64, flexShrink: 0 }
const linkStyle: CSSProperties = { color: '#7fb3e0', textDecoration: 'none', wordBreak: 'break-all' }
const statusBtnRowStyle: CSSProperties = { display: 'flex', gap: 5, flexWrap: 'wrap', margin: '4px 0 8px' }
const statusBtnStyle = (active: boolean, status: string): CSSProperties => ({
  padding: '2px 9px',
  fontSize: 11,
  borderRadius: 10,
  cursor: 'pointer',
  color: active ? '#ffffff' : '#a8b0c0',
  background: active ? (STATUS_COLORS[status] ?? 'rgba(255,255,255,0.2)') : 'transparent',
  border: '1px solid rgba(255,255,255,0.22)',
})
const statGridStyle: CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }
const statCellStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 72,
  textAlign: 'center',
  padding: '6px 4px',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6,
  background: 'rgba(255,255,255,0.03)',
}
const statNumStyle: CSSProperties = { fontSize: 15, fontWeight: 600 }
const statLabelStyle = (status: string): CSSProperties => ({
  fontSize: 11,
  color: STATUS_COLORS[status] ?? STATUS_FALLBACK_COLOR,
})
const timelineRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 0',
  borderBottom: '1px solid rgba(255,255,255,0.07)',
}
const noteStyle: CSSProperties = { color: '#a8b0c0', fontSize: 11, padding: '2px 0 0 24px' }

// ─────────────────────────────────────────────────────────────────────────────
// 组件
// ─────────────────────────────────────────────────────────────────────────────

export function JobCards(props: JobCardsProps): ReactElement {
  try {
    return <JobCardsInner {...props} />
  } catch (error) {
    return <CrashRow toolName={props.toolName} error={error} />
  }
}

interface RowData {
  key: string
  company: string
  title: string
  city?: string
  salary?: string
  deadline: string
  baseStatus: string
}

function rowsOf(parsed: ParsedCard): RowData[] {
  if (parsed.kind === 'schedule') {
    return parsed.items.map(it => ({
      key: it.company,
      company: it.company,
      title: it.type,
      deadline: it.openDate ?? '',
      baseStatus: '',
    }))
  }
  if (parsed.kind === 'job' && parsed.job !== null) {
    const j = parsed.job
    return [{ key: j.id, company: j.company, title: j.title, city: j.city, salary: j.salary, deadline: j.deadline ?? '', baseStatus: '未处理' }]
  }
  if (parsed.kind === 'jobs') {
    return parsed.jobs.map(j => ({
      key: j.id,
      company: j.company,
      title: j.title,
      city: j.city,
      salary: j.salary,
      deadline: j.deadline ?? '',
      baseStatus: '未处理',
    }))
  }
  return parsed.tracks.map(t => ({
    key: t.id,
    company: t.company,
    title: t.title,
    deadline: t.deadline ?? '',
    baseStatus: t.status,
  }))
}

function jobOf(parsed: ParsedCard, key: string | null): JobLike | null {
  if (key === null) return null
  if (parsed.kind === 'job') return parsed.job
  if (parsed.kind === 'jobs') return parsed.jobs.find(j => j.id === key) ?? null
  if (parsed.kind === 'tracks') {
    const t = parsed.tracks.find(x => x.id === key)
    if (t === undefined) return null
    return { id: t.id, company: t.company, title: t.title, deadline: t.deadline }
  }
  return null
}

function itemOf(parsed: ParsedCard, key: string | null): ScheduleItemLike | null {
  if (key === null || parsed.kind !== 'schedule') return null
  return parsed.items.find(it => it.company === key) ?? null
}

function statusCounts(parsed: ParsedCard, localStatus: Record<string, string>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const s of STATUS_ORDER) counts[s] = 0
  if (Object.keys(localStatus).length === 0) {
    if (parsed.summary !== null) {
      for (const s of STATUS_ORDER) {
        const v = parsed.summary.byStatus[s]
        counts[s] = typeof v === 'number' ? v : 0
      }
    } else {
      for (const t of parsed.tracks) counts[t.status] = (counts[t.status] ?? 0) + 1
    }
    return counts
  }
  // 叠加本地标记：每条 track 按有效状态计；仅有本地标记（未写入台账）的 id 单独计。
  const known = new Set<string>()
  for (const t of parsed.tracks) {
    const eff = localStatus[t.id] ?? t.status
    counts[eff] = (counts[eff] ?? 0) + 1
    known.add(t.id)
  }
  for (const [id, s] of Object.entries(localStatus)) {
    if (!known.has(id)) counts[s] = (counts[s] ?? 0) + 1
  }
  return counts
}

function countText(parsed: ParsedCard): string {
  if (parsed.kind === 'jobs') {
    let t = `${parsed.jobs.length} 个岗位`
    if (parsed.merged !== null && parsed.merged > 0) t += ` · 新增 ${parsed.merged}`
    if (parsed.duplicates !== null && parsed.duplicates > 0) t += ` · 去重 ${parsed.duplicates}`
    return t
  }
  if (parsed.kind === 'job') return '岗位详情'
  if (parsed.kind === 'schedule') return `${parsed.items.length} 家公司`
  const total = parsed.summary !== null && typeof parsed.summary.total === 'number' ? parsed.summary.total : parsed.tracks.length
  return `${total} 条追踪`
}

function JobCardsInner(props: JobCardsProps): ReactElement {
  const { toolName, block } = props

  // 动作通道（inject 面产物）：undefined → 三个动作按钮禁用。
  const send = props.sendPrompt ?? null
  // v0.1.3 PTC 文件分支 loader（inject 面产物）：缺席 → 不进文件分支。
  const loader = props.loadWorkspaceFile
  const hasLoader = loader !== undefined

  const parsed = parseCard(toolName, block)
  if (parsed === null) {
    if (!('kind' in block)) return <RunningRow toolName={toolName} block={block as RunningToolCallLike} />
    // meta 缺席（= PTC 呈现）+ loader 可用 → 活读会话 workspace 文件、
    // 构造规范值、复用卡片体；任何失败回退 generic 行；native（meta 在）
    // 不进此分支。
    if (hasLoader && ptcFileGate(toolName, block, hasLoader)) {
      return <PtcFileCard toolName={toolName} block={block as ToolResultNodeLike} loadWorkspaceFile={loader} send={send} />
    }
    return <GenericRow toolName={toolName} block={block as ToolResultNodeLike} />
  }
  return <CardBody parsed={parsed} send={send} />
}

/**
 * 卡片体（v0.1.3 提取；native meta / content 规范值 / PTC 文件分支三路共享）：
 * 四个 state hooks 随体走；渲染 JSX 为原 JobCardsInner 卡片体原样搬移。
 */
function CardBody(props: { parsed: ParsedCard; send: ((text: string) => void) | null }): ReactElement {
  const { parsed, send } = props

  const [activeTab, setActiveTab] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [localStatus, setLocalStatus] = useState<Record<string, string>>({})
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})

  const rows = rowsOf(parsed)
  const selectRow = (key: string): void => {
    setSelectedId(key)
    setActiveTab(1)
  }
  const selectedJob = jobOf(parsed, selectedId)
  const selectedRow = selectedId === null ? null : (rows.find(r => r.key === selectedId) ?? null)
  const currentStatus = selectedJob === null
    ? ''
    : (localStatus[selectedJob.id] ?? (selectedRow?.baseStatus || '未处理'))
  const selectedItem = itemOf(parsed, selectedId)

  const openDetailTab = (): void => {
    setActiveTab(1)
    if (selectedId === null && rows.length > 0) setSelectedId(rows[0].key)
  }

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <span style={iconStyle}>✦</span>
        <span style={titleStyle}>{TITLE_BY_KIND[parsed.kind]}</span>
        <span style={dotStyle('#4dbd74')} />
        <span style={mutedStyle}>{countText(parsed)}</span>
      </div>

      <div style={tabBarStyle}>
        <button style={tabBtnStyle(activeTab === 0)} onClick={() => setActiveTab(0)}>岗位列表</button>
        <button style={tabBtnStyle(activeTab === 1)} onClick={openDetailTab}>岗位详情</button>
        <button style={tabBtnStyle(activeTab === 2)} onClick={() => setActiveTab(2)}>投递追踪</button>
      </div>

      {activeTab === 0 && (parsed.kind === 'schedule' ? (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>公司</th>
              <th style={thStyle}>批次</th>
              <th style={thStyle}>收录</th>
              <th style={thStyle}>地点</th>
            </tr>
          </thead>
          <tbody>
            {parsed.items.map(it => (
              <tr key={it.company} style={rowStyle(it.company === selectedId)} onClick={() => selectRow(it.company)}>
                <td style={tdStyle}>{it.company}</td>
                <td style={tdStyle}>{it.type}</td>
                <td style={tdStyle}>{it.openDate ?? '—'}</td>
                <td style={tdStyle}>{it.cities ?? '—'}</td>
              </tr>
            ))}
            {parsed.items.length === 0 && (
              <tr>
                <td style={tdStyle} colSpan={4}>暂无日程数据</td>
              </tr>
            )}
          </tbody>
        </table>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>公司</th>
              <th style={thStyle}>岗位</th>
              <th style={thStyle}>城市</th>
              <th style={thStyle}>薪资</th>
              <th style={thStyle}>截止</th>
              <th style={thStyle}>状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const eff = localStatus[r.key] ?? (r.baseStatus || '未处理')
              return (
                <tr key={r.key} style={rowStyle(r.key === selectedId)} onClick={() => selectRow(r.key)}>
                  <td style={tdStyle}>{r.company}</td>
                  <td style={tdStyle}>{r.title}</td>
                  <td style={tdStyle}>{r.city || '—'}</td>
                  <td style={tdStyle}>{r.salary || '—'}</td>
                  <td style={tdStyle}>{r.deadline || '—'}</td>
                  <td style={tdStyle}>
                    <span style={badgeStyle(eff)}>{eff}</span>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td style={tdStyle} colSpan={6}>暂无岗位</td>
              </tr>
            )}
          </tbody>
        </table>
      ))}

      {activeTab === 1 && (parsed.kind === 'schedule'
        ? <ScheduleDetail item={selectedItem} />
        : selectedJob === null
          ? <div style={hintStyle}>请选择一行查看岗位详情</div>
          : <JobDetail job={selectedJob} currentStatus={currentStatus} send={send} expandedSections={expandedSections} onToggleSection={(k) => setExpandedSections(p => ({ ...p, [k]: p[k] !== true }))} onStatus={(s) => { setLocalStatus(prev => ({ ...prev, [selectedJob.id]: s })) }} />)}

      {activeTab === 2 && (
        <TracksTab parsed={parsed} localStatus={localStatus} selectedJob={selectedJob} send={send} />
      )}
    </div>
  )
}

/**
 * v0.1.3 PTC 文件分支：活读会话 workspace 文件（loader = inject 面产物）→
 * 构造规范值 → 复用 CardBody。加载态 = 最小行（无 tab）；任何失败（loader
 * throw / 文件缺席 / 非 JSON / 构造或校验失败）→ GenericRow 兜底，永不白屏。
 */
function PtcFileCard(props: {
  toolName: string
  block: ToolResultNodeLike
  loadWorkspaceFile: (path: string) => Promise<string | null>
  send: ((text: string) => void) | null
}): ReactElement {
  const { toolName, block, loadWorkspaceFile, send } = props
  // 门禁已验证 toolName 为 4 个 campus 工具之一。
  const kind = KIND_BY_TOOL[toolName]
  const argsRaw = block.call !== null ? block.call.argsRaw : undefined
  // job 时 jobId 必须先从 argsRaw 同步解析：不可用 → 直接 generic 行，不发请求。
  const jobId = ptcJobIdFromArgs(argsRaw)
  const immediateGeneric = kind === 'job' && jobId === null

  const [state, setState] = useState<'loading' | ParsedCard | null>('loading')

  // 已落定 block 不可变：挂载时读一次文件（cancelled 标志防卸载竞态）。
  useEffect(() => {
    if (immediateGeneric) return
    let cancelled = false
    loadWorkspaceFile(ptcFileForKind(kind))
      .then(fileText => {
        if (cancelled) return
        if (fileText === null) { setState(null); return }
        const canonical = ptcCanonicalFromFile(kind, fileText, argsRaw)
        if (canonical === null) { setState(null); return }
        setState(parseCanonical(toolName, kind, canonical))
      })
      .catch(() => {
        if (!cancelled) setState(null) // loader throw / reject → generic 行兜底
      })
    return () => { cancelled = true }
  }, [])

  if (immediateGeneric) return <GenericRow toolName={toolName} block={block} />
  if (state === 'loading') {
    return (
      <div style={cardStyle}>
        <div style={headerStyle}>
          <span style={iconStyle}>✦</span>
          <span style={titleStyle}>{TITLE_BY_KIND[kind]}</span>
          <span style={dotStyle('#4dbd74')} />
          <span style={mutedStyle}>卡片加载…</span>
        </div>
      </div>
    )
  }
  if (state === null) return <GenericRow toolName={toolName} block={block} />
  return <CardBody parsed={state} send={send} />
}

function JdSection(props: {
  title: string
  lines: string[]
  expanded: boolean
  onToggle: () => void
}): ReactElement {
  const { title, lines, expanded, onToggle } = props
  const overflow = lines.length > JD_LINE_LIMIT
  const visible = overflow && !expanded ? lines.slice(0, JD_LINE_LIMIT) : lines
  return (
    <div style={sectionWrapStyle}>
      <div style={sectionTitleStyle}>{title}（{lines.length} 行）</div>
      {visible.map((line, i) => (
        <div key={i} data-jd-line="1" style={jdLineStyle}>{line}</div>
      ))}
      {overflow && (
        <button style={smallBtnStyle} onClick={onToggle}>
          {expanded ? '收起' : `展开（${lines.length - JD_LINE_LIMIT} 行）`}
        </button>
      )}
    </div>
  )
}

function JobDetail(props: {
  job: JobLike
  currentStatus: string
  send: ((text: string) => void) | null
  expandedSections: Record<string, boolean>
  onToggleSection: (key: string) => void
  onStatus: (status: string) => void
}): ReactElement {
  const { job, currentStatus, send, expandedSections, onToggleSection, onStatus } = props
  const desc = strLines(job.jd?.description)
  const req = strLines(job.jd?.requirements)
  const bonus = strLines(job.jd?.bonus)
  const hasJd = (desc !== null && desc.length > 0) || (req !== null && req.length > 0)

  const recollectObj: Record<string, string> = { jobId: job.id }
  if (job.url !== undefined && job.url !== '') recollectObj.url = job.url
  const trackObj: Record<string, string> = { jobId: job.id, company: job.company, title: job.title, status: currentStatus }

  return (
    <div>
      <div style={detailTitleStyle}>{job.company} · {job.title}</div>

      {hasJd ? (
        <>
          {desc !== null && desc.length > 0 && (
            <JdSection title="岗位职责" lines={desc} expanded={expandedSections.desc === true} onToggle={() => onToggleSection('desc')} />
          )}
          {req !== null && req.length > 0 && (
            <JdSection title="岗位要求" lines={req} expanded={expandedSections.req === true} onToggle={() => onToggleSection('req')} />
          )}
          {bonus !== null && bonus.length > 0 && (
            <JdSection title="加分项" lines={bonus} expanded={expandedSections.bonus === true} onToggle={() => onToggleSection('bonus')} />
          )}
        </>
      ) : (
        <div style={sectionWrapStyle}>
          <div style={sectionTitleStyle}>JD</div>
          <div style={mutedStyle}>暂无 JD 详情</div>
          <button
            style={actionBtnStyle(send !== null)}
            disabled={send === null}
            onClick={() => send?.(`[campus-hunt-action] campus_hunt.recollect_jd ${JSON.stringify(recollectObj)}\n请按 campus-hunt skill 重新采集该岗位 JD 并调用 campus_job_detail。`)}
          >
            重新采集 JD
          </button>
        </div>
      )}

      <div style={sectionTitleStyle}>投递窗口</div>
      <div style={kvRowStyle}>
        <span style={kvLabelStyle}>截止日期</span>
        <span>{job.deadline ?? '未标注'}</span>
      </div>
      <div style={kvRowStyle}>
        <span style={kvLabelStyle}>届别</span>
        <span>{job.graduationYear ?? '未标注'}</span>
      </div>
      {job.city !== undefined && job.city !== '' && (
        <div style={kvRowStyle}>
          <span style={kvLabelStyle}>城市</span>
          <span>{job.city}</span>
        </div>
      )}
      {job.salary !== undefined && job.salary !== '' && (
        <div style={kvRowStyle}>
          <span style={kvLabelStyle}>薪资</span>
          <span>{job.salary}</span>
        </div>
      )}
      <div style={kvRowStyle}>
        <span style={kvLabelStyle}>牛客页面</span>
        {job.url !== undefined && job.url !== ''
          ? <a href={job.url} target="_blank" rel="noreferrer" style={linkStyle}>{job.url}</a>
          : <span style={mutedStyle}>未标注</span>}
      </div>

      <div style={sectionTitleStyle}>
        状态标记 <span style={badgeStyle(currentStatus)} data-status-badge>{currentStatus}</span>
      </div>
      <div style={statusBtnRowStyle}>
        {STATUS_ORDER.map(s => (
          <button key={s} style={statusBtnStyle(s === currentStatus, s)} onClick={() => onStatus(s)}>{s}</button>
        ))}
      </div>

      <button
        style={actionBtnStyle(send !== null)}
        disabled={send === null}
        onClick={() => send?.(`[campus-hunt-action] campus_hunt.track_status ${JSON.stringify(trackObj)}\n请用 job_track 将该岗位状态更新为 ${currentStatus}。`)}
      >
        写入追踪
      </button>
    </div>
  )
}

function ScheduleDetail(props: { item: ScheduleItemLike | null }): ReactElement {
  const item = props.item
  if (item === null) return <div style={hintStyle}>请选择一行查看日程详情</div>
  return (
    <div>
      <div style={detailTitleStyle}>{item.company}</div>
      <div style={kvRowStyle}>
        <span style={kvLabelStyle}>批次</span>
        <span>{item.type}</span>
      </div>
      <div style={kvRowStyle}>
        <span style={kvLabelStyle}>收录日期</span>
        <span>{item.openDate ?? '未标注'}</span>
      </div>
      <div style={kvRowStyle}>
        <span style={kvLabelStyle}>地点</span>
        <span>{item.cities ?? '未标注'}</span>
      </div>
      <div style={kvRowStyle}>
        <span style={kvLabelStyle}>来源</span>
        {item.source !== ''
          ? <a href={item.source} target="_blank" rel="noreferrer" style={linkStyle}>{item.source}</a>
          : <span style={mutedStyle}>未标注</span>}
      </div>
    </div>
  )
}

function TracksTab(props: {
  parsed: ParsedCard
  localStatus: Record<string, string>
  selectedJob: JobLike | null
  send: ((text: string) => void) | null
}): ReactElement {
  const { parsed, localStatus, selectedJob, send } = props
  const counts = statusCounts(parsed, localStatus)
  const timeline = [...parsed.tracks].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
  const empty = timeline.length === 0 && Object.keys(localStatus).length === 0

  return (
    <div>
      <div style={statGridStyle}>
        {STATUS_ORDER.map(s => (
          <div key={s} style={statCellStyle}>
            <div style={statNumStyle} data-status-count={s}>{counts[s] ?? 0}</div>
            <div style={statLabelStyle(s)}>{s}</div>
          </div>
        ))}
      </div>

      {empty ? (
        <div>
          <div style={mutedStyle}>暂无投递追踪</div>
          {selectedJob !== null && (
            <button
              style={actionBtnStyle(send !== null)}
              disabled={send === null}
              onClick={() => send?.(`[campus-hunt-action] campus_hunt.track_add ${JSON.stringify({ jobId: selectedJob.id, company: selectedJob.company, title: selectedJob.title })}\n请用 job_track 新增该岗位（状态 未处理）。`)}
            >
              追踪该岗位
            </button>
          )}
        </div>
      ) : (
        <div>
          {timeline.map(t => {
            const eff = localStatus[t.id] ?? t.status
            return (
              <div key={t.id}>
                <div style={timelineRowStyle}>
                  <span style={badgeStyle(eff)}>{eff}</span>
                  <span style={{ flex: 1 }}>{t.company} · {t.title}</span>
                  <span style={mutedStyle}>{t.updatedAt ?? ''}</span>
                </div>
                {t.note !== undefined && t.note !== '' && <div style={noteStyle}>{t.note}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** 已落定但解析失败（isError / 未知工具 / meta 与 content 都畸形）：自绘 generic 行。 */
function GenericRow(props: { toolName: string; block: ToolResultNodeLike }): ReactElement {
  const { toolName, block } = props
  const [expanded, setExpanded] = useState(false)
  const text = firstContentText(block.content) ?? ''
  const summary = block.isError
    ? `调用失败${block.error !== undefined ? ` · ${block.error.name} · ${block.error.code}` : ''}`
    : text.slice(0, 200)
  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <span style={iconStyle}>✦</span>
        <span style={titleStyle}>{toolName}</span>
        <span style={dotStyle(block.isError ? '#d15454' : '#4dbd74')} />
        <span style={{ ...mutedStyle, color: block.isError ? '#d15454' : '#8a93a6', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {summary}
        </span>
      </div>
      <button style={smallBtnStyle} onClick={() => setExpanded(v => !v)}>{expanded ? '收起' : '展开'}</button>
      {expanded && (
        <pre style={preStyle}>
          {block.call !== null ? `args: ${block.call.argsRaw}\n` : ''}
          {block.content.map(describeBlock).join('\n')}
        </pre>
      )}
    </div>
  )
}

function describeBlock(b: unknown): string {
  const r = asRecord(b)
  if (r !== null && r.type === 'text' && typeof r.text === 'string') return r.text
  const type = r !== null && typeof r.type === 'string' ? r.type : 'block'
  return `[${type}]`
}

/** 运行中：等待行（argsRaw 截断）。 */
function RunningRow(props: { toolName: string; block: RunningToolCallLike }): ReactElement {
  const { toolName, block } = props
  const [expanded, setExpanded] = useState(false)
  const args = block.argsRaw.length > 120 ? `${block.argsRaw.slice(0, 120)}…` : block.argsRaw
  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <span style={iconStyle}>✦</span>
        <span style={titleStyle}>{toolName}</span>
        <span style={dotStyle('#4d8fd1')} />
        <span style={{ ...mutedStyle, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {expanded ? args : `正在调用 ${toolName}…`}
        </span>
      </div>
      <button style={smallBtnStyle} onClick={() => setExpanded(v => !v)}>{expanded ? '收起' : '展开'}</button>
      {expanded && <pre style={preStyle}>{block.argsRaw}</pre>}
    </div>
  )
}

/** 渲染崩溃兜底：最小 generic 行，永不白屏。 */
function CrashRow(props: { toolName: string; error: unknown }): ReactElement {
  const msg = props.error instanceof Error ? props.error.message : String(props.error)
  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <span style={iconStyle}>✦</span>
        <span style={titleStyle}>{props.toolName}</span>
        <span style={dotStyle('#d15454')} />
        <span style={{ ...mutedStyle, color: '#d15454' }}>卡片渲染失败：{msg}</span>
      </div>
    </div>
  )
}
