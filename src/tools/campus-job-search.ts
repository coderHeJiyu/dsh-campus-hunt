/**
 * dsh-campus-hunt — campus_job_search 工具（v0.1）。
 *
 * 校招岗位入库：把 agent 按 campus-hunt skill 从牛客秋招专场页提取的岗位数组
 * （ego_js 的返回，JSON 字符串或数组两种形态都接受）合并进会话
 * workspace 下 jobs.json。**不碰网络**——raw 由 skill 工作流提供。
 *
 * 合并规则（v0.1 口径）：
 *   - 规范化：所有文本 trim；缺 id/title/company（或非对象元素）的条目
 *     跳过并计入 skipped
 *   - filter（入库前）：query 忽略大小写匹配 company/title 任一；
 *     city 对 city 字段包含匹配；两者同时给 = AND；空串视为无约束。
 *     被过滤掉的条目不入库、不计入 skipped。
 *   - 按 id 去重：新 id 追加（计入 merged）；已存在 id 用新值覆盖可变字段
 *     （company/title/city/salary/degree/url——新值缺失即清除该字段）
 *     并刷新 fetchedAt（计入 duplicates）。
 *   - deadline 不由本工具写入（Job schema 保留该字段，留给后续
 *     详情采集工具；raw 中的 deadline 忽略）。
 *   - fetchedAt = 每次合并时 new Date().toISOString()。
 *   - v0.1（采集红线，settings 配置 collection）：raw 超过
 *     maxItemsPerRun → 截断，返回可选 truncated（>0 才出现）；job.url
 *     域名不在 allowedDomains（host 后缀匹配；无 url 的条目放行）→
 *     跳过并计入可选 rejectedDomains（>0 才出现）。
 *   - v0.1.1（画像直供，free-search 模式）：结果恒带 profile
 *     （directions/cities/targetCompanies 三字符串数组，不含 resumePath）——
 *     host 侧每次 execute 活读 currentConfig()，无 workspace 副本，设置页
 *     改动下次运行即生效；render 追加一行画像（任一类目非空 →
 *     「当前画像：方向 a/b · 城市 c · 目标公司 d」，全空 →
 *     「画像未设置（要个性化推荐请在设置页填写）」），供 agent 推荐流程
 *     直接消费（raw=[] 查询调用 = 全量 jobs + 当前画像，零副作用）。
 *   - v0.1.1（skip-write 守卫）：merged===0 && duplicates===0 →
 *     跳过 writeJobs（jobs.json 内容与 mtime 稳定；raw=[] 查询调用真正
 *     零副作用）。
 *
 * workspace 归属：exec.agent.session.header.cwd（与 job_track 同一契约，
 * v0.1 口径）；非 agent 调用无会话 workspace → execute 抛错（isError）。
 */

import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { type Job } from '../nowcoder/types.ts'
import {
  assertWorkspaceRoot,
  readJobs,
  resolveWorkspaceRoot,
  writeJobs,
} from '../data/store.ts'
import { currentConfig, isDomainAllowed } from '../config.ts'

/** 规范化后的单条岗位（raw 元素经 trim + 必备字段检查后的形态）。 */
export interface NormalizedJob {
  id: string
  company: string
  title: string
  city?: string
  salary?: string
  degree?: string
  url?: string
}

/** 规范返回值（output.schema 的推断类型在此显式写出，供 render/presentationMeta 共享）。 */
export interface CampusJobSearchResult {
  /** 合并后 jobs.json 的全量岗位。 */
  jobs: Job[]
  /** 本次新追加的条目数（新 id）。 */
  merged: number
  /** 本次覆盖既有记录的条目数（已存在 id）。 */
  duplicates: number
  /** 因缺 id/title/company（或非对象）而跳过的条目数。 */
  skipped: number
  /** 被单轮上限截断丢弃的条目数（v0.1；>0 才出现）。 */
  truncated?: number
  /** job.url 域名不在白名单而被跳过的条目数（v0.1；>0 才出现）。 */
  rejectedDomains?: number
  /**
   * 当前求职画像（v0.1.1：画像直供，free-search 模式——host 侧每次
   * execute 活读 currentConfig()，无 workspace 副本，设置页改动下次运行即
   * 生效）。三字符串数组，不含 resumePath；execute 恒返回，直接调用可达缺键。
   */
  profile?: {
    directions: string[]
    cities: string[]
    targetCompanies: string[]
  }
}

/**
 * 画像行（v0.1.1）：任一类目非空 →「当前画像：方向 a/b · 城市 c ·
 * 目标公司 d」（同类目多 tag 以 `/` 连接、空类目整段省略、类目间 ` · `）；
 * 三类目全空 →「画像未设置（要个性化推荐请在设置页填写）」（逐字口径）。
 */
function renderProfileLine(profile: NonNullable<CampusJobSearchResult['profile']>): string {
  const segments: string[] = []
  if (profile.directions.length > 0) segments.push(`方向 ${profile.directions.join('/')}`)
  if (profile.cities.length > 0) segments.push(`城市 ${profile.cities.join('/')}`)
  if (profile.targetCompanies.length > 0) segments.push(`目标公司 ${profile.targetCompanies.join('/')}`)
  if (segments.length === 0) return '画像未设置（要个性化推荐请在设置页填写）'
  return `当前画像：${segments.join(' · ')}`
}

/** 模型可见的紧凑渲染（与存储一致）。 */
export function renderJobSearchResult(value: CampusJobSearchResult): string {
  const extras: string[] = []
  if (value.truncated !== undefined && value.truncated > 0) {
    extras.push(`按单轮上限截断 ${value.truncated} 条未入库`)
  }
  if (value.rejectedDomains !== undefined && value.rejectedDomains > 0) {
    extras.push(`${value.rejectedDomains} 条域名不在白名单被跳过`)
  }
  const head = `岗位库现有 ${value.jobs.length} 条（本次新增 ${value.merged}，覆盖 ${value.duplicates}，跳过 ${value.skipped}${extras.length > 0 ? `，${extras.join('，')}` : ''}）`
  let base: string
  if (value.jobs.length === 0) {
    base = head + '。'
  } else {
    const lines = value.jobs.map((j) => {
      const extras: string[] = []
      if (j.city !== undefined) extras.push(j.city)
      if (j.salary !== undefined) extras.push(j.salary)
      if (j.degree !== undefined) extras.push(j.degree)
      return `- ${j.company} · ${j.title}${extras.length > 0 ? `（${extras.join(' / ')}）` : ''}`
    })
    base = `${head}：\n${lines.join('\n')}`
  }
  // v0.1.1：画像行（profile 缺键——仅直接调用可达——不追加）。
  if (value.profile === undefined) return base
  return `${base}\n${renderProfileLine(value.profile)}`
}

/**
 * 卡片投影（v0.1）：规范值 → 可回放 JSON（client 回答区三 tab 卡片的
 * 分支依据）。纯投影：只含规范值字段，不含 UI 状态（activeTab/selected 等）
 * 与 React props；jobs 元素原样透传（registry 边界已按 output schema 校验，
 * client 侧逐条再校验容忍 partial/坏元素）。
 *
 * value 非对象（脏值，仅直接调用可达；registry 路径先过 schema）→
 * `{ card: null }` 等价"不支持"投影，client 回退 generic 行。
 */
export function projectJobsCard(value: unknown): {
  card: 'jobs' | null
  tool: 'campus_job_search'
  jobs: Job[]
  merged: number
  duplicates: number
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { card: null, tool: 'campus_job_search', jobs: [], merged: 0, duplicates: 0 }
  }
  const v = value as Partial<CampusJobSearchResult>
  return {
    card: 'jobs',
    tool: 'campus_job_search',
    jobs: Array.isArray(v.jobs) ? (v.jobs as Job[]) : [],
    merged: typeof v.merged === 'number' ? v.merged : 0,
    duplicates: typeof v.duplicates === 'number' ? v.duplicates : 0,
  }
}

/** 文本规范化：非字符串/空串 → undefined，否则 trim 后返回。 */
function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * 规范化单条 raw 元素。
 * @returns 规范化岗位；非对象或缺 id/title/company 时返回 null（调用方计入 skipped）。
 */
export function normalizeRecord(record: unknown): NormalizedJob | null {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return null
  const obj = record as Record<string, unknown>
  const id = cleanText(obj.id)
  const company = cleanText(obj.company)
  const title = cleanText(obj.title)
  if (id === undefined || company === undefined || title === undefined) return null
  const job: NormalizedJob = { id, company, title }
  const city = cleanText(obj.city)
  if (city !== undefined) job.city = city
  const salary = cleanText(obj.salary)
  if (salary !== undefined) job.salary = salary
  const degree = cleanText(obj.degree)
  if (degree !== undefined) job.degree = degree
  const url = cleanText(obj.url)
  if (url !== undefined) job.url = url
  return job
}

/**
 * raw 双形态：JSON 字符串（ego_js 原样返回）或数组，统一为元素数组。
 * 入参在 defineTool 层按 oneOf（array | string）校验；此处收窄并拒绝非法形态。
 */
function normalizeRaw(raw: unknown): unknown[] {
  if (typeof raw === 'string') {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new Error(`campus_job_search: raw 是 JSON 字符串但解析失败：${String(error)}`)
    }
    if (!Array.isArray(parsed)) {
      throw new Error('campus_job_search: raw 的 JSON 字符串解析结果必须是数组')
    }
    return parsed
  }
  // 工具 JSON 边界：schema（oneOf array | string）保证不了数组分支的元素形态，
  // 此处收窄数组；非数组形态直接大声报错（不静默回退）。
  if (!Array.isArray(raw)) {
    throw new Error('campus_job_search: raw 必须是数组或 JSON 字符串')
  }
  return raw
}

interface JobSearchFilter {
  query?: string
  city?: string
}

/** 入库前过滤：query 忽略大小写匹配 company/title 任一；city 包含匹配；两者 AND；空串无约束。 */
export function passesFilter(job: NormalizedJob, filter: JobSearchFilter | undefined): boolean {
  if (filter === undefined) return true
  const query = filter.query?.trim().toLowerCase()
  if (query !== undefined && query.length > 0) {
    if (!job.company.toLowerCase().includes(query) && !job.title.toLowerCase().includes(query)) return false
  }
  const city = filter.city?.trim()
  if (city !== undefined && city.length > 0) {
    if (job.city === undefined || !job.city.includes(city)) return false
  }
  return true
}

export const campusJobSearchTool = defineTool({
  name: 'campus_job_search',
  description:
    '校招岗位入库（纯本地，无网络）。把从牛客秋招专场页提取的岗位数组（ego_js 返回的 JSON 字符串，'
    + '或岗位对象数组）合并进会话 workspace 的 jobs.json：按 id 去重（新 id 追加，已存在 id 覆盖可变字段并刷新 fetchedAt）。'
    + '可选 filter 在入库前过滤：query 忽略大小写匹配公司/岗位名任一，city 对城市字段包含匹配，两者同时给为 AND。'
    + 'raw 超过单轮上限时截断（返回 truncated 计数）；job.url 域名不在白名单时跳过（返回 rejectedDomains 计数）。'
    + '返回合并后全量 jobs 与 merged/duplicates/skipped 计数，以及当前求职画像 profile'
    + '（v0.1.1：settings 直供、不含 resumePath；raw=[] 的查询调用零副作用）。',
  parameters: {
    raw: {
      oneOf: [
        {
          type: 'array',
          items: { type: 'json' },
          description: '岗位对象数组，元素字段 id/company/title/city/salary/degree/url（缺失字段省略）。',
        },
        {
          type: 'string',
          description: '上述数组的 JSON 字符串（ego_js 的返回原样传入即可）。',
        },
      ],
      required: true,
      description: '待入库的岗位数据：数组或 JSON 字符串两种形态都接受。',
    },
    filter: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: '关键词：忽略大小写匹配公司名或岗位名任一（空串视为无约束）。',
        },
        city: {
          type: 'string',
          description: '城市：对岗位 city 字段做包含匹配（空串视为无约束）。',
        },
      },
      description: '可选入库前过滤；query 与 city 同时给时为 AND。',
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        jobs: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              company: { type: 'string', required: true },
              title: { type: 'string', required: true },
              city: { type: 'string' },
              salary: { type: 'string' },
              degree: { type: 'string' },
              deadline: { type: 'string' },
              // v0.1（字段扩展修正）：campus_job_detail 写入 job.graduationYear
              // （毕业要求原文）后，本工具返回的全量 jobs 可能携带该字段（增量可选）
              // ——output 声明同步补齐（PTC 声明面诚实；运行时零改动）。
              graduationYear: { type: 'string' },
              url: { type: 'string' },
              fetchedAt: { type: 'string', required: true },
              // v0.1：campus_job_detail 写入 job.jd 后，本工具返回的全量
              // jobs 可能携带 jd（增量可选字段）——output 声明同步补齐。
              jd: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  description: { type: 'array', required: true, items: { type: 'string' } },
                  requirements: { type: 'array', required: true, items: { type: 'string' } },
                  bonus: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        merged: { type: 'integer', required: true },
        duplicates: { type: 'integer', required: true },
        skipped: { type: 'integer', required: true },
        // v0.1：采集红线计数（正常情形省略，optional 不标 required）。
        truncated: {
          type: 'integer',
          description: '被单轮上限截断丢弃的条目数（>0 才出现）。',
        },
        rejectedDomains: {
          type: 'integer',
          description: 'job.url 域名不在白名单而被跳过的条目数（>0 才出现）。',
        },
        // v0.1.1：画像直供（可选，不进 required；free-search 模式——host 侧
        // 每次 execute 活读 settings，无 workspace 副本，设置页改动下次运行即生效）。
        profile: {
          type: 'object',
          additionalProperties: false,
          properties: {
            directions: { type: 'array', required: true, items: { type: 'string' } },
            cities: { type: 'array', required: true, items: { type: 'string' } },
            targetCompanies: { type: 'array', required: true, items: { type: 'string' } },
          },
        },
      },
    },
    render: (_args, value) => [{ type: 'text', text: renderJobSearchResult(value) }],
    // v0.1 口径：可回放卡片投影（规范值纯 JSON；client 依赖 card 字段分支）。
    presentationMeta: (_args, value) => projectJobsCard(value),
  },
  // raw 标注为 unknown：defineTool 的参数 schema（oneOf array | string）已在
  // 注册表边界校验模型输入，execute 内 normalizeRaw 再做形态收窄。
  async execute(args: { raw: unknown; filter?: JobSearchFilter }, exec: ToolRunContext): Promise<CampusJobSearchResult> {
    const root = resolveWorkspaceRoot(exec.agent?.session?.header?.cwd)
    await assertWorkspaceRoot(root)
    exec.signal.throwIfAborted()

    // v0.1.1（free-search 模式）：每次 execute 活读当前配置——无 workspace
    // 副本，设置页改动下次运行即生效；画像经结果 profile 直供模型。
    const cfg = currentConfig()
    const records = normalizeRaw(args.raw)
    // v0.1：单轮上限截断（红线只收紧不放松，maxItemsPerRun ≤50）。
    let truncated = 0
    const limit = cfg.collection.maxItemsPerRun
    const limited = records.length > limit
      ? (truncated = records.length - limit, records.slice(0, limit))
      : records
    const data = await readJobs(root)
    const now = new Date().toISOString()
    let merged = 0
    let duplicates = 0
    let skipped = 0
    let rejectedDomains = 0

    for (const record of limited) {
      const norm = normalizeRecord(record)
      if (norm === null) {
        skipped += 1
        continue
      }
      // v0.1：域名白名单（host 后缀匹配）；无 url 的条目放行。
      if (norm.url !== undefined && !isDomainAllowed(norm.url, cfg.collection.allowedDomains)) {
        rejectedDomains += 1
        continue
      }
      if (!passesFilter(norm, args.filter)) continue
      const existing = data.jobs.find(j => j.id === norm.id)
      if (existing === undefined) {
        data.jobs.push({ ...norm, fetchedAt: now })
        merged += 1
      } else {
        // 覆盖可变字段：新值缺失即清除该字段（本次 raw 是记录的最新来源）。
        existing.company = norm.company
        existing.title = norm.title
        for (const key of ['city', 'salary', 'degree', 'url'] as const) {
          const value = norm[key]
          if (value === undefined) delete existing[key]
          else existing[key] = value
        }
        existing.fetchedAt = now
        duplicates += 1
      }
    }

    // v0.1.1（skip-write 守卫）：无合并且无覆盖 → jobs.json 未变化，跳过
    // 重写（内容与 mtime 稳定；raw=[] 查询调用真正零副作用）。
    if (merged > 0 || duplicates > 0) await writeJobs(root, data)
    exec.signal.throwIfAborted()
    // v0.1：红线计数 >0 才出现（正常情形返回与 v0.1 规范值同形）；
    // v0.1.1：profile 恒返回（settings 活读，不含 resumePath）。
    const result: CampusJobSearchResult = { jobs: data.jobs, merged, duplicates, skipped }
    if (truncated > 0) result.truncated = truncated
    if (rejectedDomains > 0) result.rejectedDomains = rejectedDomains
    result.profile = {
      directions: [...cfg.profile.directions],
      cities: [...cfg.profile.cities],
      targetCompanies: [...cfg.profile.targetCompanies],
    }
    return result
  },
})
