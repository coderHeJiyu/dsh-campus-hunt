import type { Context } from '@deepseek-ai/cordis'
import { jobTrackTool } from './tools/job-track.ts'
import { campusJobSearchTool } from './tools/campus-job-search.ts'
import { campusJobDetailTool } from './tools/campus-job-detail.ts'
import { campusScheduleTool } from './tools/campus-schedule.ts'
import { buildCampusHuntSkill } from './skill/campus-hunt.skill.ts'
import { PLUGIN_VERSION } from './version.ts'
import {
  Config,
  NS,
  currentConfig,
  setSource,
} from './config.ts'

export { Config, NS, currentConfig, setSource }
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
 * `config:` 校验 + settings namespace `campus-hunt` 模式）；apply 接收 entry
 * 配置、经 ctx.inject(['settings']) 瀑布 installSection（provider 缺席时
 * 跳过）；3 个采集工具（search/detail/schedule）消费采集红线（截断 /
 * 域名白名单，job_track 不消费采集配置）；skill 改工厂，红线两行随配置
 * 参数化，onChange best-effort 重注册（同 id runtime skill first-wins：先
 * dispose 再注册）。
 * v0.1.1（画像直供）：profile.json 物化（syncProfile）废弃——求职画像
 * 只存 settings 的 campus-hunt 分节、无 workspace 副本；free-search 模式
 * （host 侧每次 execute 活读 currentConfig()）下由 campus_job_search 返回行
 * 直供模型。
 * 数据层 local-first（workspace 下 3 个数据文件：jobs.json / track.json /
 * schedule.json，schema v0）。
 */
export const name = 'dsh-campus-hunt'
export const inject = ['tools', 'skills']

export function apply(ctx: Context, config: Config): void {
  // entry 配置即初始权威源（settings 挂载后被 installSection 的 setSource
  // 换成 settings 解析值；工具 execute 每次运行读 currentConfig()）。
  setSource(() => config)

  ctx.tools.register(jobTrackTool)
  ctx.tools.register(campusJobSearchTool)
  ctx.tools.register(campusJobDetailTool)
  ctx.tools.register(campusScheduleTool)

  // skill：按当前配置构建；settings 变更时 best-effort 重注册。
  // 宿主语义（dsh-skill）：同层同 id runtime skill first-wins——重复 register
  // 只告警 + no-op disposer，不替换不抛错；故先 dispose 旧注册（清掉层内
  // 条目）再 register 新值。dispose 后若 id 仍被他人占着（本插件独占
  // 'campus-hunt'，正常不可达），新注册降级为告警 no-op——best-effort。
  const initialSkill = buildCampusHuntSkill(currentConfig())
  let skillContent = initialSkill.content
  let disposeSkill = ctx.skills.register(initialSkill)

  // settings 服务可选：provider 未挂载时瀑布跳过本回调，配置源保持 entry 值。
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, NS, Config, config, {
      setSource,
      onChange: () => {
        const next = buildCampusHuntSkill(currentConfig())
        if (next.content !== skillContent) {
          disposeSkill()
          skillContent = next.content
          disposeSkill = ctx.skills.register(next)
        }
      },
    })
  })

  // 版本号单一来源在 src/version.ts（内联自包根 package.json 的 version），bump 后重建即同步。
  console.log(`[dsh-campus-hunt] job_track + campus_job_search + campus_job_detail + campus_schedule + campus-hunt skill registered (v${PLUGIN_VERSION})`)
}
