/**
 * dsh-campus-hunt — 配置层（v0.1）。
 *
 * settings namespace `campus-hunt` 的 schemastery 校验模式（Config）、默认配置
 * （defaultConfig）、当前配置源线（currentConfig / setSource）、域名白名单校验
 * （isDomainAllowed）。
 *
 * v0.1.1（画像直供）：profile.json 物化（syncProfile）废弃——求职画像只存
 * settings 的 campus-hunt 分节、无 workspace 副本；free-search 模式（host 侧
 * 每次 execute 活读 currentConfig()）下由 campus_job_search 返回行直供模型。
 *
 * Config 双重身份：同名导出既是 settings namespace 的校验模式，也是 cordis
 * entry `config:` 的校验模式（cordis loader 以 StandardSchema v1 校验 entry
 * 值并把解析结果作为 apply 第二参）；installSection 以同一 entry 值作
 * settings 组合 base 层。用户改动落 $DSH_HOME/settings.yaml 的 campus-hunt
 * 分节（settings 服务机制），每次解析 = 模式默认 → base → 用户层，经
 * setSource 接通 currentConfig()。
 *
 * 红线 clamp（规格 §4.1）：maxItemsPerRun 只允许 ≤50、minIntervalMs 只允许
 * ≥1000（上限 600000）——模式边界即 clamp：放松红线的值在加载/解析时拒绝
 * （fails loud），不静默改值。
 *
 * v0.1.1：新增顶层字段 specialUrl（牛客秋招专场页 URL，备用路线
 * 直开入口），http(s) URL 格式校验（非法值解析时拒绝，与红线同口径）。
 *
 * settings 服务可选：host 顶层 inject 保持 ['tools','skills']；apply 内经
 * ctx.inject(['settings'], ...) 瀑布挂载（provider 缺席时跳过，不挂起）。
 */

// 同文件 import cordis 的 Context（type 别名引用即可）是下方 declare module
// 自增强生效的前提（v0.1）：缺失时插件可见的 Context 会丢失 cordis 包内
// 自增强挂上的成员（get/set/provide、inject/plugin）。
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/**
 * Settings 服务注册面（宿主 dsh-settings 服务；插件不直接依赖该包——与
 * skill 注册面声明同模式，只声明本插件用到的 installSection 面，契约与
 * SettingsProvider.installSection 一致：owner/ns/schema/entry/hooks
 * {setSource, onChange, validate?}）。
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Settings 服务（仅经 ctx.inject(['settings']) 瀑布使用）。 */
    settings: {
      installSection<T>(
        owner: Context,
        ns: string,
        schema: unknown,
        entry: T,
        hooks: {
          setSource(current: () => T): void
          onChange(): void
          validate?: (value: T) => void
        },
      ): void
    }
  }
}

/** Settings namespace（v0.1：单一来源在 src/ns.ts，此处 re-export 保持既有 import 面）。 */
export { NS } from './ns.ts'

/** 插件配置（见文件头；profile 为求职画像三数组、只存 settings 无 workspace 副本，collection 为采集红线）。 */
export interface Config {
  /** 求职画像（三个字符串数组；v0.1.1 起只存 settings，经 campus_job_search 返回直供模型）。 */
  profile: {
    /** 求职方向。 */
    directions: string[]
    /** 目标城市。 */
    cities: string[]
    /** 目标公司。 */
    targetCompanies: string[]
  }
  /** 简历文件路径（'' = 未设置）。 */
  resumePath: string
  /** 牛客秋招专场页 URL（备用路线直开入口；http(s) URL）。 */
  specialUrl: string
  /** 采集红线（只收紧不放松，模式边界即 clamp）。 */
  collection: {
    /** 域名白名单（host 后缀匹配；采集范围 = 白名单内）。 */
    allowedDomains: string[]
    /** 单轮采集上限（红线 ≤50）。 */
    maxItemsPerRun: number
    /** 页面导航最小间隔毫秒（红线 ≥1000，上限 600000）。 */
    minIntervalMs: number
  }
}

/** 默认专场页 URL（27 届秋招正式批专场；v0.1.1 起可经 specialUrl 覆盖）。 */
export const DEFAULT_SPECIAL_URL = 'https://www.nowcoder.com/jobs/activity/v2/special-activity/index/2027QZzc'

/** 默认配置（cordis.patch.yml entry `config:` 段的同值 YAML；模式解析 `{}` 得同值）。 */
export const defaultConfig: Config = {
  profile: { directions: [], cities: [], targetCompanies: [] },
  resumePath: '',
  specialUrl: DEFAULT_SPECIAL_URL,
  collection: {
    allowedDomains: ['nowcoder.com'],
    maxItemsPerRun: 50,
    minIntervalMs: 1000,
  },
}

const profileShape = {
  directions: z.array(z.string()).default([]),
  cities: z.array(z.string()).default([]),
  targetCompanies: z.array(z.string()).default([]),
}
const collectionShape = {
  allowedDomains: z.array(z.string()).default(['nowcoder.com']),
  maxItemsPerRun: z.number().step(1).min(1).max(50).default(50),
  minIntervalMs: z.number().step(1).min(1000).max(600000).default(1000),
}

/**
 * 配置校验模式（settings namespace schema + cordis entry config 校验）。
 * 每字段带 default：entry 或用户层缺键时按默认补齐。
 */
export const Config: z<Config> = z.object({
  profile: z.object(profileShape).default({ directions: [], cities: [], targetCompanies: [] }),
  resumePath: z.string().default(''),
  // v0.1.1：http(s) URL 格式校验（schemastery 无 refine 回调，取 .pattern
  // 表达；非法值解析时拒绝，与红线同口径）。
  specialUrl: z.string().min(1).pattern(/^https?:\/\/\S+$/).default(DEFAULT_SPECIAL_URL),
  collection: z.object(collectionShape).default({
    allowedDomains: ['nowcoder.com'],
    maxItemsPerRun: 50,
    minIntervalMs: 1000,
  }),
})

// ---- 当前配置源线（setSource 模式，cookbook）----

let source: () => Config = () => defaultConfig

/**
 * 接通当前配置源：apply 置为 entry 值 thunk；settings 挂载后经
 * installSection 的 setSource 换成 settings 解析值（base + 用户层）。
 * @param next - 返回当前权威配置值的 thunk。
 */
export function setSource(next: () => Config): void {
  source = next
}

/** 当前配置（工具 execute 每次运行读取 → 配置改动下次运行即时生效）。 */
export function currentConfig(): Config {
  return source()
}

// ---- 域名白名单 ----

/**
 * 域名白名单校验（host 后缀匹配）：url 的 host 等于白名单条目，或为其
 * 子域（如白名单 'nowcoder.com' 放行 www.nowcoder.com，拒绝
 * evil-nowcoder.com / nowcoder.com.evil.com）。
 * 非 http(s) 协议、不可解析、空白名单条目 → false（白名单外一律拒绝）。
 * @param url - 待校验 URL。
 * @param allowedDomains - 白名单（host 或域后缀）。
 */
export function isDomainAllowed(url: string, allowedDomains: string[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  return allowedDomains.some((entry) => {
    const domain = entry.trim().toLowerCase()
    return domain !== '' && (host === domain || host.endsWith('.' + domain))
  })
}
