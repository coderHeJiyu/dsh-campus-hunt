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
 * 值并把解析结果作为 apply 第二参）。
 *
 * v0.1.4（0.1.7 settings 模型）：installSection 废弃——namespace 由 entry
 * config schema 自动派生（ns = entry id 'dsh-campus-hunt'，见 src/ns.ts）；
 * 配置源 = entry 值（apply 初值）+ 活重读（src/index.ts）：settings 服务
 * （可选，经 ctx.get 读取）在场时订阅 'settings/document-updated'（按 ns
 * 过滤）与 'app-boot/config-reload'，重读 settings.describe({
 * redactSecrets: false }) 中 ns === NS 条目的 .value（entry 解析值 =
 * inherited + profile patch），经 Config 模式校验（resolveEntryValue）后
 * setSource；entry 未投影或校验失败 → 保持当前源（fail-loud，不静默吞）；
 * 值与当前源相同 → no-op。用户改动落 $DSH_HOME 的 profile patch
 * （settings 服务机制）。
 *
 * v0.1.4 volatile 口径：4 个顶层字段（profile / resumePath / specialUrl /
 * collection）标 .default(...).volatile()——settings describe 的 entry
 * 投影门（volatileForm：无 volatile 标记的 entry 不投影，插件 ns 未服务）；
 * 解析值为 cosmokit Volatile 活引用（frozen 对象 { get(): 不可变快照 }）。
 * 插件无 cosmokit 直依，边界（apply 第二参 / resolveEntryValue）经
 * toSourceConfig 逐字段 .get() 解包为 plain 可变 Config；.get() 每次读取
 * 取当前值，文档变更时活引用由宿主原位更新，故 currentConfig() 恒新鲜。
 *
 * 红线 clamp（规格 §4.1）：maxItemsPerRun 只允许 ≤50、minIntervalMs 只允许
 * ≥1000（上限 600000）——模式边界即 clamp：放松红线的值在加载/解析时拒绝
 * （fails loud），不静默改值。
 *
 * v0.1.1：新增顶层字段 specialUrl（牛客秋招专场页 URL，备用路线
 * 直开入口），http(s) URL 格式校验（非法值解析时拒绝，与红线同口径）。
 *
 * settings 服务可选：host 顶层 inject 保持 ['tools','skills']；apply 内经
 * ctx.get('settings') 读取（provider 缺席时源保持 entry 值，apply 同步
 * 返回不挂起）。
 */

// 同文件 import cordis 的 Context（type 别名引用即可）是下方 declare module
// 自增强生效的前提（v0.1）：缺失时插件可见的 Context 会丢失 cordis 包内
// 自增强挂上的成员（get/set/provide、inject/plugin）。
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/**
 * Settings 服务最小自类型（宿主 dsh-settings 的 SettingsForms 服务；插件不
 * 依赖 dsh-settings 包——与 skill 注册面声明同模式，只声明本插件活重读用到
 * 的 describe 面与两个订阅事件）。
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Settings 服务（可选：provider 未挂载时 ctx.get('settings') 为 undefined）。 */
    settings: {
      /**
       * 读取活跃插件 schema 与其活值。
       * @param options - redact 选项（活重读传 redactSecrets: false 取未脱敏活值）。
       * @returns 每 entry id 一条：ns = entry id，value = entry 解析值（inherited + profile patch，unknown 来源）。
       */
      describe(options?: { redactSecrets?: boolean }): Array<{
        ns: string
        value: unknown
        revision: number
      }>
    }
  }
  interface Events {
    /** Settings 文档更新：settings 服务在某 ns 的 entry 投影变化时 emit (ns, revision)。 */
    'settings/document-updated'(ns: string, revision: number): void
    /** App-boot 配置重载：宿主配置变更重新进入时 emit。 */
    'app-boot/config-reload'(): void
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
export const Config = z.object({
  profile: z.object(profileShape).default({ directions: [], cities: [], targetCompanies: [] }).volatile(),
  resumePath: z.string().default('').volatile(),
  // v0.1.1：http(s) URL 格式校验（schemastery 无 refine 回调，取 .pattern
  // 表达；非法值解析时拒绝，与红线同口径）。
  specialUrl: z.string().min(1).pattern(/^https?:\/\/\S+$/).default(DEFAULT_SPECIAL_URL).volatile(),
  collection: z.object(collectionShape).default({
    allowedDomains: ['nowcoder.com'],
    maxItemsPerRun: 50,
    minIntervalMs: 1000,
  }).volatile(),
})

// ---- 当前配置源线（setSource 模式，cookbook）----

/** volatile 字段快照（递归 readonly；cosmokit VolatileSnapshot 的最小自类型，插件无 cosmokit 直依）。 */
export type ReadSnapshot<T> = T extends object ? { readonly [K in keyof T]: ReadSnapshot<T[K]> } : T
/** volatile 字段的活引用读面（cosmokit Volatile 协议）。 */
export type Live<T> = { get(): ReadSnapshot<T> }
/** entry 解析值（4 个顶层字段为 volatile 活引用，其余形态与 Config 一致）。 */
export interface EntryLive {
  profile: Live<Config['profile']>
  resumePath: Live<string>
  specialUrl: Live<string>
  collection: Live<Config['collection']>
}
/**
 * 把 entry 解析值（volatile 活引用）解包为 plain 可变 Config 快照：逐字段
 * .get() 取当前不可变快照后显式拷贝（数组 [...展开]，标量直取）。
 * @param value - apply 第二参或 z.resolve 输出（4 字段为活引用）。
 * @returns 与活引用解耦的 plain Config（每次调用取当前值）。
 */
export function toSourceConfig(value: EntryLive): Config {
  const profile = value.profile.get()
  const collection = value.collection.get()
  return {
    profile: {
      directions: [...profile.directions],
      cities: [...profile.cities],
      targetCompanies: [...profile.targetCompanies],
    },
    resumePath: value.resumePath.get(),
    specialUrl: value.specialUrl.get(),
    collection: {
      allowedDomains: [...collection.allowedDomains],
      maxItemsPerRun: collection.maxItemsPerRun,
      minIntervalMs: collection.minIntervalMs,
    },
  }
}

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

/**
 * 把 settings describe 的 entry 值（unknown 来源，如 profile patch 投影）经
 * Config 模式解析为 Config（schemastery 的 resolve 静态方法——与 cordis
 * loader 的 entry 校验同一解析口径）：缺键按默认补齐，红线 clamp 与
 * specialUrl 格式在解析失败时抛错（调用方保持当前源并告警，fail-loud 不
 * 静默吞）。
 * @param value - describe 返回的 ns === NS 条目的 .value。
 * @returns 经 Config 模式校验的完整配置。
 */
export function resolveEntryValue(value: unknown): Config {
  const resolved = z.resolve(value, Config, {})[0]
  return toSourceConfig(resolved)
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
