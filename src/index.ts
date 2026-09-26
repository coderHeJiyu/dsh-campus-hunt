import type { Context } from '@deepseek-ai/cordis'
import { jobTrackTool } from './tools/job-track.ts'
import { campusJobSearchTool } from './tools/campus-job-search.ts'
import { campusJobDetailTool } from './tools/campus-job-detail.ts'
import { campusScheduleTool } from './tools/campus-schedule.ts'
import { buildCampusHuntSkill } from './skill/campus-hunt.skill.ts'
import { PLUGIN_VERSION } from './version.ts'
import {
  Config,
  EntryLive,
  NS,
  currentConfig,
  resolveEntryValue,
  setSource,
  toSourceConfig,
} from './config.ts'

export { Config, NS, currentConfig, resolveEntryValue, setSource }
export { defaultConfig, isDomainAllowed } from './config.ts'
export { PLUGIN_VERSION } from './version.ts'

/**
 * dsh-campus-hunt — DSH 校招求职 Client 插件（host 半场）。
 *
 * v0.1：注册 job_track（本地投递流水线，纯 JSON 无网络）。
 * v0.1：注册 campus_job_search（校招岗位入库，raw 由 campus-hunt skill
 * 的浏览器采集工作流提供，工具本身不碰网络）与 campus-hunt skill（注入
 * tools + skills 两个服务）。
 * v0.1：注册 campus_job_detail（岗位 JD 详情入库，写 job.jd / 覆盖
 * deadline / 刷新 fetchedAt）与 campus_schedule（校招日程入库，company
 * 去重合并进 schedule.json）；campus-hunt skill 追加 JD 详情与校招日程
 * 两节工作流（表达式 5/6）。
 * v0.1：4 个工具 presentationMeta 从"规范值本身"升级为卡片投影
 * （{ card: 'jobs'|'job'|'schedule'|'tracks', tool, 数据字段 }），
 * client 半场（src/client/）以会话节点 campus-cards 在回答区注册三 tab
 * 卡片（v0.1.1）。
 * v0.1：settings 半场——Config（schemastery）双重身份（cordis entry
 * `config:` 校验 + settings namespace 模式）；apply 接收 entry 配置；
 * 3 个采集工具（search/detail/schedule）消费采集红线（截断 /
 * 域名白名单，job_track 不消费采集配置）；skill 改工厂，红线两行随配置
 * 参数化，best-effort 重注册（同 id runtime skill first-wins：先 dispose
 * 再注册，content 不变 no-op）。
 * v0.1.1（画像直供）：profile.json 物化（syncProfile）废弃——求职画像
 * 只存 settings 分节、无 workspace 副本；free-search 模式（host 侧每次
 * execute 活读 currentConfig()）下由 campus_job_search 返回行直供模型。
 * v0.1.4（0.1.7 settings 模型）：installSection 废弃——namespace 由 entry
 * config schema 自动派生（ns = entry id 'dsh-campus-hunt'，D1）；apply 经
 * ctx.get('settings') 读可选服务（缺席时源保持 entry 值、同步返回不挂起），
 * 在场时订阅 'settings/document-updated'（按 ns 过滤）+ 'app-boot/config-
 * reload' 活重读：describe({ redactSecrets: false }) 的 NS 条目 .value 经
 * Config 模式校验后 setSource（值与当前源不同才换源 + skill 重注册）。
 * 数据层 local-first（workspace 下 3 个数据文件：jobs.json / track.json /
 * schedule.json，schema v0）。
 */
export const name = 'dsh-campus-hunt'
export const inject = ['tools', 'skills']

export function apply(ctx: Context, config: EntryLive): void {
  // entry 配置即初始权威源（v0.1.4：settings 服务在场时经活重读把 entry
  // 解析值 setSource 换上；工具 execute 每次运行读 currentConfig()）。
  setSource(() => toSourceConfig(config))

  ctx.tools.register(jobTrackTool)
  ctx.tools.register(campusJobSearchTool)
  ctx.tools.register(campusJobDetailTool)
  ctx.tools.register(campusScheduleTool)

  // skill：按当前配置构建；配置变更时 best-effort 重注册。
  // 宿主语义（dsh-skill）：同层同 id runtime skill first-wins——重复 register
  // 只告警 + no-op disposer，不替换不抛错；故先 dispose 旧注册（清掉层内
  // 条目）再 register 新值。dispose 后若 id 仍被他人占着（本插件独占
  // 'campus-hunt'，正常不可达），新注册降级为告警 no-op——best-effort。
  const initialSkill = buildCampusHuntSkill(currentConfig())
  let skillContent = initialSkill.content
  let disposeSkill = ctx.skills.register(initialSkill)

  const resyncSkill = (): void => {
    const next = buildCampusHuntSkill(currentConfig())
    if (next.content !== skillContent) {
      disposeSkill()
      skillContent = next.content
      disposeSkill = ctx.skills.register(next)
    }
  }

  // settings 服务可选（宿主口径：可选服务经 ctx.get 读取）：provider 未挂载
  // 时配置源保持 entry 值、apply 同步返回不挂起（v0.1 口径延续）。
  const settings = ctx.get('settings')
  if (settings !== undefined) {
    // 活重读：describe → 取 ns === NS 条目的 .value（entry 解析值）→ 经
    // Config 模式校验 → 与当前源不同才 setSource + skill 重注册。entry 未
    // 投影或校验失败 → 保持当前源（fail-loud，不静默吞）。
    const reread = (): void => {
      let descriptors: Array<{ ns: string; value: unknown; revision: number }>
      try {
        descriptors = settings.describe({ redactSecrets: false })
      } catch (error) {
        console.warn('[dsh-campus-hunt] settings.describe 失败，保持当前配置源：', error)
        return
      }
      const entry = descriptors.find((d) => d.ns === NS)
      if (entry === undefined) return // entry 未投影：保持当前源
      let parsed: Config
      try {
        parsed = resolveEntryValue(entry.value)
      } catch (error) {
        console.warn('[dsh-campus-hunt] entry 值未通过 Config 校验，保持当前配置源：', error)
        return
      }
      if (JSON.stringify(parsed) === JSON.stringify(currentConfig())) return // 值未变 → no-op
      setSource(() => parsed)
      resyncSkill()
    }
    ctx.on('settings/document-updated', (ns, _revision) => {
      if (ns === NS) reread()
    })
    ctx.on('app-boot/config-reload', () => {
      reread()
    })
  }

  // 版本号单一来源在 src/version.ts（内联自包根 package.json 的 version），bump 后重建即同步。
  console.log(`[dsh-campus-hunt] job_track + campus_job_search + campus_job_detail + campus_schedule + campus-hunt skill registered (v${PLUGIN_VERSION})`)
}
