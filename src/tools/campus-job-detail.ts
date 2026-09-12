/**
 * dsh-campus-hunt — campus_job_detail 工具（v0.1）。
 *
 * 岗位 JD 详情入库：把 agent 按 campus-hunt skill 从牛客岗位详情页
 * （/jobs/detail/<id>）提取的 JD 对象（ego_js 的返回，JSON 字符串或对象
 * 两种形态都接受）合并进会话 workspace 下 jobs.json 的既有岗位记录。
 * **不碰网络**——raw 由 skill 工作流提供。
 *
 * 合并规则（v0.1 口径，协调者决策 3）：
 *   - jobId 必须已在 jobs.json 中：不存在 → 抛错（提示先用
 *     campus_job_search 采集该岗位）。
 *   - job.jd = 解析结果 { description, requirements, bonus? }（bonus 为空
 *     时省略）；覆盖既有 jd（本次 raw 是最新来源）。
 *   - raw 若带 deadline（ISO YYYY-MM-DD）→ 覆盖 job.deadline；未带则
 *     保留既有值。
 *   - 刷新 job.fetchedAt = new Date().toISOString()，写回 jobs.json。
 *   - raw 若带 graduationYear（非空原文）→ 覆盖
 *     job.graduationYear；未带则保留既有值（与 deadline 同「有则覆盖、
 *     无则保留」语义，v0.1 字段扩展修正）。
 *   - 返回 { job: 更新后的完整 Job 记录, jd: 解析结果 }。
 *
 * 校验：
 *   - raw 须含非空 description[] 或 requirements[]（否则抛错——提取结果
 *     无效，多半是页面结构变化）。
 *   - raw 为字符串时必须是合法 JSON 对象；非对象形态抛错（不静默回退）。
 *   - deadline 若给必须是 ISO YYYY-MM-DD 字符串（表达式内已换算；
 *     给非 ISO 值大声报错，不写入脏数据）。
 *   - graduationYear 若给必须是非空字符串（毕业要求原文；
 *     给非字符串/空串大声报错，不写入脏数据）。
 *
 * workspace 归属：exec.agent.session.header.cwd（与 campus_job_search 同一
 * 契约）；非 agent 调用无会话 workspace → execute 抛错（isError）。
 *
 * v0.1（采集红线，settings 配置 collection）：raw.url 存在则校验
 * allowedDomains 白名单（host 后缀匹配）；不在白名单 → 错误返回（提示模型，
 * 数据不入库）；raw.url 不存在 → 放行。
 */

import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { currentConfig, isDomainAllowed } from '../config.ts'
import { type Job } from '../nowcoder/types.ts'
import {
  assertWorkspaceRoot,
  readJobs,
  resolveWorkspaceRoot,
  writeJobs,
} from '../data/store.ts'

/** 解析后的 JD（bonus 为空时省略键；description/requirements 至少一者非空）。 */
export interface ParsedJd {
  description: string[]
  requirements: string[]
  bonus?: string[]
}

/** 规范返回值（output.schema 的推断类型在此显式写出，供 render/presentationMeta 共享）。 */
export interface CampusJobDetailResult {
  /**
   * 更新后的完整 Job 记录（jd 已写入，fetchedAt 已刷新）。
   * 收窄为 Job & { jd }：本工具返回的 job 必然带 jd（output schema 声明必填）。
   */
  job: Job & { jd: ParsedJd }
  /** 本次解析出的 JD（与 job.jd 同值）。 */
  jd: ParsedJd
}

/** 模型可见的紧凑渲染（与存储一致）。 */
export function renderJobDetailResult(value: CampusJobDetailResult): string {
  const j = value.job
  const parts: string[] = [`${value.jd.description.length} 条职责`, `${value.jd.requirements.length} 条要求`]
  if (value.jd.bonus !== undefined) parts.push(`${value.jd.bonus.length} 条加分项`)
  const deadline = j.deadline !== undefined ? `，截止 ${j.deadline}` : ''
  return `JD 已入库：${j.company} · ${j.title}（${parts.join('，')}${deadline}）`
}

/**
 * 卡片投影（v0.1）：规范值 + args.jobId → 可回放 JSON（card:'job'）。
 * job 为含 jd 的完整 Job，原样透传（registry 边界已按 output schema 校验，
 * client 侧再校验）。value 非对象（脏值，仅直接调用可达）→ `{ card: null }`
 * 等价"不支持"投影，client 回退 generic 行。
 */
export function projectJobCard(args: unknown, value: unknown): {
  card: 'job' | null
  tool: 'campus_job_detail'
  jobId: string | null
  job: Job | null
} {
  const a = typeof args === 'object' && args !== null ? (args as { jobId?: unknown }) : {}
  const jobId = typeof a.jobId === 'string' ? a.jobId : null
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { card: null, tool: 'campus_job_detail', jobId, job: null }
  }
  const v = value as { job?: unknown }
  const job = v.job !== null && typeof v.job === 'object' && !Array.isArray(v.job) ? (v.job as Job) : null
  return { card: 'job', tool: 'campus_job_detail', jobId, job }
}

/** 文本行数组规范化：非数组 → undefined；逐元素 trim、去空后为空 → undefined。 */
function cleanLines(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const lines = value
    .map(v => (typeof v === 'string' ? v.trim() : ''))
    .filter(l => l !== '')
  return lines.length > 0 ? lines : undefined
}

/**
 * raw 双形态：JSON 字符串（ego_js 原样返回）或对象，统一为对象。
 * 入参在 defineTool 层按 oneOf（object | string）校验；此处收窄并拒绝非法形态。
 */
function parseRaw(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new Error(`campus_job_detail: raw 是 JSON 字符串但解析失败：${String(error)}`)
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('campus_job_detail: raw 的 JSON 字符串解析结果必须是对象（JD 字段）')
    }
    return parsed as Record<string, unknown>
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('campus_job_detail: raw 必须是对象或 JSON 字符串')
  }
  return raw as Record<string, unknown>
}

/**
 * 解析/校验 raw → 规范 JD + 可选 deadline + 可选 graduationYear。
 * @returns { jd, deadline?, graduationYear? }；description 与 requirements 全空时抛错。
 */
export function normalizeJd(raw: Record<string, unknown>): { jd: ParsedJd; deadline?: string; graduationYear?: string } {
  const description = cleanLines(raw.description)
  const requirements = cleanLines(raw.requirements)
  if (description === undefined && requirements === undefined) {
    throw new Error('campus_job_detail: raw 必须含非空 description[] 或 requirements[]（提取结果无效，页面结构可能已变化）')
  }
  const jd: ParsedJd = { description: description ?? [], requirements: requirements ?? [] }
  const bonus = cleanLines(raw.bonus)
  if (bonus !== undefined) jd.bonus = bonus
  let deadline: string | undefined
  if (raw.deadline !== undefined) {
    if (typeof raw.deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.deadline.trim())) {
      throw new Error(`campus_job_detail: raw.deadline 必须是 ISO YYYY-MM-DD 字符串，收到 ${JSON.stringify(raw.deadline)}`)
    }
    deadline = raw.deadline.trim()
  }
  let graduationYear: string | undefined
  if (raw.graduationYear !== undefined) {
    if (typeof raw.graduationYear !== 'string' || raw.graduationYear.trim() === '') {
      throw new Error(`campus_job_detail: raw.graduationYear 必须是非空字符串（毕业要求原文），收到 ${JSON.stringify(raw.graduationYear)}`)
    }
    graduationYear = raw.graduationYear.trim()
  }
  return { jd, deadline, graduationYear }
}

export const campusJobDetailTool = defineTool({
  name: 'campus_job_detail',
  description:
    '岗位 JD 详情入库（纯本地，无网络）。把从牛客岗位详情页提取的 JD 对象（ego_js 返回的 JSON 字符串，'
    + '或 { description/requirements/bonus?/deadline?/graduationYear? } 对象）合并进会话 workspace 的 jobs.json：'
    + 'jobId 必须已存在（不存在时报错，提示先用 campus_job_search 采集该岗位），'
    + '写入 job.jd、覆盖 deadline（若 raw 带 ISO 截止日）、覆盖 graduationYear'
    + '（若 raw 带毕业要求原文；raw 未带则保留既有值）、刷新 fetchedAt。'
    + '返回 { job: 更新后的完整记录, jd: 解析结果 }。',
  parameters: {
    raw: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: true,
          description:
            'JD 对象：description[]/requirements[]（至少一者非空）、bonus?[]、deadline?（ISO YYYY-MM-DD）、'
+ 'graduationYear?（毕业要求原文）。',
        },
        {
          type: 'string',
          description: '上述对象的 JSON 字符串（ego_js 的返回原样传入即可）。',
        },
      ],
      required: true,
      description: '待入库的 JD 数据：对象或 JSON 字符串两种形态都接受。',
    },
    jobId: {
      type: 'string',
      required: true,
      description: '牛客岗位 id（jobs.json 主键，即列表页 href 的 jobId= 参数）。',
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        job: {
          type: 'object',
          additionalProperties: false,
          required: true,
          properties: {
            id: { type: 'string', required: true },
            company: { type: 'string', required: true },
            title: { type: 'string', required: true },
            city: { type: 'string' },
            salary: { type: 'string' },
            degree: { type: 'string' },
            deadline: { type: 'string' },
            // v0.1（字段扩展修正）：raw 带 graduationYear（毕业要求原文）时写入。
            graduationYear: { type: 'string' },
            url: { type: 'string' },
            fetchedAt: { type: 'string', required: true },
            // v0.1：本工具返回的 job 必然带 jd。
            jd: {
              type: 'object',
              additionalProperties: false,
              required: true,
              properties: {
                description: { type: 'array', required: true, items: { type: 'string' } },
                requirements: { type: 'array', required: true, items: { type: 'string' } },
                bonus: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
        jd: {
          type: 'object',
          additionalProperties: false,
          required: true,
          properties: {
            description: { type: 'array', required: true, items: { type: 'string' } },
            requirements: { type: 'array', required: true, items: { type: 'string' } },
            bonus: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    render: (_args, value) => [{ type: 'text', text: renderJobDetailResult(value) }],
    // v0.1 口径：可回放卡片投影（规范值纯 JSON；client 依赖 card 字段分支）。
    presentationMeta: (args, value) => projectJobCard(args, value),
  },
  // raw 标注为 unknown：defineTool 的参数 schema（oneOf object | string）已在
  // 注册表边界校验模型输入，execute 内 parseRaw/normalizeJd 再做形态收窄。
  async execute(args: { raw: unknown; jobId: string }, exec: ToolRunContext): Promise<CampusJobDetailResult> {
    const root = resolveWorkspaceRoot(exec.agent?.session?.header?.cwd)
    await assertWorkspaceRoot(root)
    exec.signal.throwIfAborted()

    const parsed = parseRaw(args.raw)
    // v0.1：raw.url 白名单校验（host 后缀匹配）；不在采集白名单 → 错误
    // 返回（提示模型，数据不入库）；url 不存在 → 放行。
    const rawUrl = typeof parsed.url === 'string' ? parsed.url.trim() : ''
    if (rawUrl !== '') {
      const cfg = currentConfig()
      if (!isDomainAllowed(rawUrl, cfg.collection.allowedDomains)) {
        throw new Error(
          `campus_job_detail: 岗位 url ${rawUrl} 不在采集白名单（当前允许：${cfg.collection.allowedDomains.join(' / ')}）；`
          + '本次数据不入库。请改从白名单内的页面重新采集，或在设置页检查 campus-hunt 的 collection.allowedDomains 配置。',
        )
      }
    }
    const { jd, deadline, graduationYear } = normalizeJd(parsed)

    const data = await readJobs(root)
    const jobId = args.jobId.trim()
    const job = data.jobs.find(j => j.id === jobId)
    if (job === undefined) {
      throw new Error(
        `campus_job_detail: jobs.json 中没有岗位 id ${jobId}；`
        + '请先用 campus_job_search 采集该岗位（列表入库后）再取 JD 详情',
      )
    }
    job.jd = jd
    if (deadline !== undefined) job.deadline = deadline
    // v0.1（字段扩展修正）：有则覆盖、无则保留（与 deadline 同语义）。
    if (graduationYear !== undefined) job.graduationYear = graduationYear
    job.fetchedAt = new Date().toISOString()
    await writeJobs(root, data)
    exec.signal.throwIfAborted()
    // { ...job, jd }：spread 后显式补齐 jd，收窄出 Job & { jd: ParsedJd }。
    return { job: { ...job, jd }, jd }
  },
})
