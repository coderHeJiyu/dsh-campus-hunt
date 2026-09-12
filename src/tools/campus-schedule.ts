/**
 * dsh-campus-hunt — campus_schedule 工具（v0.1）。
 *
 * 校招日程入库：把 agent 按 campus-hunt skill 从牛客校招日程页
 * （/jobs/school/schedule）提取的公司卡数组（ego_js 的返回，JSON 字符串
 * 或数组两种形态都接受）合并进会话 workspace 下 schedule.json。
 * **不碰网络**——raw 由 skill 工作流提供。
 *
 * 映射规则（v0.1 口径，ScheduleItem 适配真实页面）：
 *   company    = raw 元素 company 原样（必填，空则抛错）
 *   type       = batch 原文（站点批次标签原样，如「网申中」）；
 *                无 batch 的卡 → type = '未知'
 *   openDate   = recordedDate（MM.dd 原文）补**当年** → ISO YYYY-MM-DD
 *                （当年 = new Date().getFullYear()；如 07.28 → 2026-07-28）；
 *                无 recordedDate（「正在收集中」形态）→ 省略
 *   source     = 固定日程页 URL https://www.nowcoder.com/jobs/school/schedule
 *   cities     = 「地点：」后的城市串原文（如「杭州、深圳、北京」）
 *                → ScheduleItem.cities；无 cities 的卡 → 省略
 *                （v0.1 字段扩展修正）
 *
 * 合并规则（协调者决策 4）：
 *   - 按 company 去重：新 company 追加；已存在 → 覆盖 type/openDate/cities
 *     （raw 无 recordedDate/cities 时清除对应既有值——与 campus_job_search
 *     「新值缺失即清除」的覆盖语义一致），source 保持既有值。
 *   - 返回 { items: 合并后全量, source }。
 *
 * 校验：非对象元素或 company 为空的元素、recordedDate 非 MM.dd 形态、
 * cities 非字符串或空串 → 抛错（不静默跳过——raw 来自受控表达式，
 * 脏输入应大声暴露）。
 *
 * workspace 归属：exec.agent.session.header.cwd（与 campus_job_search 同一
 * 契约）；非 agent 调用无会话 workspace → execute 抛错（isError）。
 *
 * v0.1（采集红线，settings 配置 collection）：raw 元素携带 url 则校验
 * allowedDomains 白名单（host 后缀匹配）；任一不在白名单 → 错误返回（提示
 * 模型，数据不入库）；元素无 url → 放行。
 */

import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { currentConfig, isDomainAllowed } from '../config.ts'
import { type ScheduleItem } from '../nowcoder/types.ts'
import {
  assertWorkspaceRoot,
  readSchedule,
  resolveWorkspaceRoot,
  writeSchedule,
} from '../data/store.ts'

/** 日程来源（固定）：牛客校招日程页。 */
export const SCHEDULE_SOURCE = 'https://www.nowcoder.com/jobs/school/schedule'

/** 无 batch 标签的公司卡的 type 值（v0.1 口径）。 */
export const UNKNOWN_BATCH = '未知'

/** raw 元素（EXTRACT_SCHEDULE_EXPRESSION 输出形态；batch/recordedDate/cities 缺失省略）。 */
export interface RawScheduleItem {
  company: string
  batch?: string
  recordedDate?: string
  cities?: string
}

/** 规范返回值（output.schema 的推断类型在此显式写出，供 render/presentationMeta 共享）。 */
export interface CampusScheduleResult {
  /** 合并后 schedule.json 的全量条目。 */
  items: ScheduleItem[]
  /** 来源 URL（固定日程页）。 */
  source: string
}

/** 模型可见的紧凑渲染（与存储一致）。 */
export function renderScheduleResult(value: CampusScheduleResult): string {
  if (value.items.length === 0) return '校招日程为空：还没有收录任何公司。'
  const lines = value.items.map((it) => {
    const date = it.openDate !== undefined ? `，${it.openDate} 开放` : ''
    return `- ${it.company}（${it.type}${date}）`
  })
  return `校招日程共 ${value.items.length} 家：\n${lines.join('\n')}`
}

/**
 * 卡片投影（v0.1）：规范值 → 可回放 JSON（card:'schedule'）。纯投影：
 * items 原样透传（registry 边界已按 output schema 校验，client 侧逐条再校验）；
 * value 非对象（脏值，仅直接调用可达）→ `{ card: null }`，client 回退 generic 行。
 */
export function projectScheduleCard(value: unknown): {
  card: 'schedule' | null
  tool: 'campus_schedule'
  items: ScheduleItem[]
  source: string
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { card: null, tool: 'campus_schedule', items: [], source: '' }
  }
  const v = value as Partial<CampusScheduleResult>
  return {
    card: 'schedule',
    tool: 'campus_schedule',
    items: Array.isArray(v.items) ? (v.items as ScheduleItem[]) : [],
    source: typeof v.source === 'string' ? v.source : '',
  }
}

/**
 * raw 双形态：JSON 字符串（ego_js 原样返回）或数组，统一为元素数组。
 * 入参在 defineTool 层按 oneOf（array | string）校验；此处收窄并拒绝非法形态。
 */
function normalizeRaw(raw: unknown): RawScheduleItem[] {
  let list: unknown[]
  if (typeof raw === 'string') {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new Error(`campus_schedule: raw 是 JSON 字符串但解析失败：${String(error)}`)
    }
    if (!Array.isArray(parsed)) {
      throw new Error('campus_schedule: raw 的 JSON 字符串解析结果必须是数组')
    }
    list = parsed
  } else if (Array.isArray(raw)) {
    list = raw
  } else {
    throw new Error('campus_schedule: raw 必须是数组或 JSON 字符串')
  }
  return list as RawScheduleItem[]
}

/** MM.dd（如 07.28）补当年 → ISO YYYY-MM-DD（当年 = new Date().getFullYear()）。 */
export function recordedDateToIso(recordedDate: string): string {
  const m = recordedDate.match(/^(\d{2})\.(\d{2})$/)
  if (m === null) {
    throw new Error(`campus_schedule: recordedDate 必须是 MM.dd 原文（如 07.28），收到 ${JSON.stringify(recordedDate)}`)
  }
  return `${new Date().getFullYear()}-${m[1]}-${m[2]}`
}

/**
 * 规范化单条 raw 元素 → ScheduleItem（openDate 无 recordedDate 时省略，
 * cities 无该键时省略）。
 * @throws 非对象元素 / company 为空 / recordedDate 非 MM.dd 形态 /
 * cities 非字符串或空串。
 */
export function normalizeItem(item: unknown): ScheduleItem {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    throw new Error(`campus_schedule: raw 元素必须是对象，收到 ${JSON.stringify(item)}`)
  }
  const obj = item as Record<string, unknown>
  const company = typeof obj.company === 'string' ? obj.company.trim() : ''
  if (company === '') {
    throw new Error('campus_schedule: raw 元素缺 company（无公司名的卡应在提取表达式侧跳过）')
  }
  const batch = typeof obj.batch === 'string' ? obj.batch.trim() : ''
  const result: ScheduleItem = {
    company,
    type: batch !== '' ? batch : UNKNOWN_BATCH,
    source: SCHEDULE_SOURCE,
  }
  if (obj.recordedDate !== undefined) {
    result.openDate = recordedDateToIso(String(obj.recordedDate))
  }
  if (obj.cities !== undefined) {
    if (typeof obj.cities !== 'string' || obj.cities.trim() === '') {
      throw new Error(`campus_schedule: raw 元素 cities 必须是非空字符串（地点城市串原文），收到 ${JSON.stringify(obj.cities)}`)
    }
    result.cities = obj.cities.trim()
  }
  return result
}

export const campusScheduleTool = defineTool({
  name: 'campus_schedule',
  description:
    '校招日程入库（纯本地，无网络）。把从牛客校招日程页提取的公司卡数组（ego_js 返回的 JSON 字符串，'
    + '或 { company/batch?/recordedDate?/cities? } 对象数组）合并进会话 workspace 的 schedule.json：'
    + '按 company 去重（新 company 追加，已存在覆盖 type/openDate/cities、保持 source）；'
    + 'batch 原文作 type（无 batch 记「未知」），recordedDate（MM.dd）补当年换算 ISO 作 openDate（无则省略），'
    + 'cities 地点城市串原文入库（无则省略，既有值随之清除）。'
    + '返回 { items: 合并后全量, source }。',
  parameters: {
    raw: {
      oneOf: [
        {
          type: 'array',
          items: { type: 'json' },
          description:
            '公司卡对象数组，元素字段 company（必填）/ batch?（批次标签原文）/ recordedDate?（MM.dd 原文）/ cities?（地点城市串原文）。',
        },
        {
          type: 'string',
          description: '上述数组的 JSON 字符串（ego_js 的返回原样传入即可）。',
        },
      ],
      required: true,
      description: '待入库的日程数据：数组或 JSON 字符串两种形态都接受。',
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        items: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              company: { type: 'string', required: true },
              openDate: { type: 'string' },
              type: { type: 'string', required: true },
              // v0.1（字段扩展修正）：raw 带 cities 时写入；无则省略。
              cities: { type: 'string' },
              source: { type: 'string', required: true },
            },
          },
        },
        source: { type: 'string', required: true },
      },
    },
    render: (_args, value) => [{ type: 'text', text: renderScheduleResult(value) }],
    // v0.1 口径：可回放卡片投影（规范值纯 JSON；client 依赖 card 字段分支）。
    presentationMeta: (_args, value) => projectScheduleCard(value),
  },
  // raw 标注为 unknown：defineTool 的参数 schema（oneOf array | string）已在
  // 注册表边界校验模型输入，execute 内 normalizeRaw/normalizeItem 再做形态收窄。
  async execute(args: { raw: unknown }, exec: ToolRunContext): Promise<CampusScheduleResult> {
    const root = resolveWorkspaceRoot(exec.agent?.session?.header?.cwd)
    await assertWorkspaceRoot(root)
    exec.signal.throwIfAborted()

    const list = normalizeRaw(args.raw)
    // v0.1：raw 元素携带 url 则校验采集白名单（host 后缀匹配）；任一不在
    // 白名单 → 错误返回（提示模型，数据不入库）；元素无 url → 放行。
    const cfg = currentConfig()
    for (const element of list) {
      if (typeof element !== 'object' || element === null || Array.isArray(element)) continue
      // 经 unknown 收窄：RawScheduleItem 未声明 url（提取表达式可附带的可选字段），
      // 且接口无索引签名，直接 as Record 会被 TS2352 拒绝。
      const obj = element as unknown as Record<string, unknown>
      const url = typeof obj.url === 'string' ? obj.url.trim() : ''
      if (url !== '' && !isDomainAllowed(url, cfg.collection.allowedDomains)) {
        const who = typeof obj.company === 'string' && obj.company.trim() !== '' ? `（${obj.company.trim()}）` : ''
        throw new Error(
          `campus_schedule: raw 元素${who}携带 url ${url} 不在采集白名单（当前允许：${cfg.collection.allowedDomains.join(' / ')}）；`
          + '本次数据不入库。请改从白名单内的页面重新提取，或在设置页检查 campus-hunt 的 collection.allowedDomains 配置。',
        )
      }
    }
    const items = list.map(normalizeItem)
    const data = await readSchedule(root)
    for (const item of items) {
      const existing = data.items.find(it => it.company === item.company)
      if (existing === undefined) {
        data.items.push(item)
      } else {
        // 覆盖 type/openDate/cities（raw 无 recordedDate/cities → 清除对应既有值）；
        // source 保持。
        existing.type = item.type
        if (item.openDate !== undefined) existing.openDate = item.openDate
        else delete existing.openDate
        if (item.cities !== undefined) existing.cities = item.cities
        else delete existing.cities
      }
    }

    await writeSchedule(root, data)
    exec.signal.throwIfAborted()
    return { items: data.items, source: SCHEDULE_SOURCE }
  },
})
