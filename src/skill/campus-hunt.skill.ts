/**
 * dsh-campus-hunt — campus-hunt skill 定义（v0.1）。
 * v0.1 追加两节工作流：JD 详情（campus_job_detail 入库）与校招日程
 * （campus_schedule 入库），对应新增「表达式 5 / 表达式 6」。
 * v0.1 改工厂 buildCampusHuntSkill(cfg)：红线两行（导航间隔 / 单轮上限）
 * 按当前配置参数化；默认配置下 content 与 v0.1 注册值字节一致。
 * v0.1.1 新增「GUI 动作回调协议」一节：回答区卡片 3 个按钮的动作提示词
 * 使用本插件自有 [campus-hunt-action] 前缀，由 skill 自教 agent 协议语义，
 * 自然语言指令句保留为兜底。
 * v0.1.1：专场页 URL 可配置（cfg.specialUrl，默认 2027QZzc）；默认
 * 配置下 content 与 v0.1.1 字节一致。
 * v0.1.1：新增「个性化推荐」节（用户要推荐/挑选时按画像语义过滤
 * 排序，不重新采集）；whenToUse 注册字段与 content「何时使用」节各补一行
 * 推荐意图（纯推荐措辞的路由修复落在注册字段——模型实际看到的路由面）。
 * v0.1.1（画像直供）：推荐节的画像来源从「读 workspace 副本」改为
 * 「campus_job_search 返回的画像行」（画像只存 settings、无 workspace 副本）；
 * 当前会话没有该返回时先调 campus_job_search(raw=[]) 一次（查询调用，
 * 零副作用）。
 *
 * 给模型的牛客校招岗位采集工作流（2026-09-04 实测修订版）：
 *   主路线：ego_navigate 列表页 → 点「秋招正式批」tab → 读总览卡
 *   「查看详情」href（去 query 规范化）→ ego_navigate 专场页 → 关登录弹窗
 *   （Escape）→ 点「热招职位」区块 → ego_js 提取表达式 →
 *   campus_job_search 入库。
 *   备用路线：主路线任一步失败时直接 ego_navigate 专场 URL
 *   https://www.nowcoder.com/jobs/activity/v2/special-activity/index/2027QZzc
 *   （2026-09-04 实测匿名可访问；列表页总览卡「查看详情」href 实测指向该
 *   页——「列表页→查看详情」能自动发现专场 URL，更抗改版，故列为主路线）。
 *
 * 背景：列表页「全部职位」tab 的 line-one 卡片混届（Job schema 无届字段
 * 无法区分）；匿名态「秋招正式批」tab 只有企业总览墙 + 登录弹窗，
 * 无岗位列表。真实列表在专场页「热招职位」区块（40 张卡第一屏，
 * 无分页）。
 *
 * 六个表达式从 src/nowcoder/extract.ts 原样嵌入 content（代码块），
 * 保证 skill 指令与测试求值的字符串是同一份（单一事实源）。
 *
 * content 用行数组 join 构造（而非模板字符串）：markdown 代码围栏需要
 * 裸反引号，行数组避免转义。
 */

import {
  CLICK_ACTIVITY_TAB_EXPRESSION,
  CLICK_HOT_TAB_EXPRESSION,
  EXTRACT_JD_EXPRESSION,
  EXTRACT_LIST_EXPRESSION,
  EXTRACT_SCHEDULE_EXPRESSION,
  GET_ACTIVITY_DETAIL_HREF_EXPRESSION,
} from '../nowcoder/extract.ts'
import { defaultConfig, type Config } from '../config.ts'

/**
 * Skill 注册面（最小声明）。
 *
 * 宿主提供 @deepseek-ai/dsh-skill 的 SkillRegistry 服务（ctx.skills）；
 * 插件不直接依赖该包——与 dsh-tools 经声明合并扩展 cordis Context 同模式，
 * 这里只声明本插件用到的 register 面（注册值字段名/取值与 SkillRegistry
 * 的 SkillRegistration 契约一致：name/description/whenToUse?/source/content）。
 */
export interface CampusHuntSkillRegistration {
  /** kebab-case skill 名（/^[a-z0-9]+(?:-[a-z0-9]+)*$/）。 */
  name: string
  /** 一行路由描述（必填，非空）。 */
  description: string
  /** 额外路由指引（可选）。 */
  whenToUse?: string
  /** 来源：runtime 注册。 */
  source: 'runtime'
  /** markdown 指令正文。 */
  content: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Skill 注册表（宿主 dsh-skill 服务）；插件只用 register 面。 */
    skills: { register(skill: CampusHuntSkillRegistration): () => void }
  }
}

const FENCE = '```'

/**
 * 构造 skill 正文。
 * @param intervalSec - 导航间隔秒数（collection.minIntervalMs / 1000；红线行）。
 * @param maxItems - 单轮采集上限条数（collection.maxItemsPerRun；红线行）。
 * @param specialUrl - 专场页 URL（cfg.specialUrl；备用路线直开入口）。
 */
function buildContent(intervalSec: number, maxItems: number, specialUrl: string): string {
  const lines: string[] = [
    '# campus-hunt — 牛客校招岗位采集',
    '',
    '## 何时使用',
    '用户要查看/采集牛客（nowcoder.com）校招岗位（尤其「秋招正式批」专场），',
    '如"看看牛客秋招有什么岗位"、"采集校招职位"、"把牛客校招岗位入库"。',
    '用户要推荐/挑选适合自己的校招岗位（如"帮我推荐岗位"、"哪些岗位适合我"）时',
    '同样适用——走下文「个性化推荐」节（不重新采集）。',
    '',
    '## GUI 动作回调协议（回答区岗位卡片按钮）',
    '收到以 `[campus-hunt-action]` 开头的提示词 = 回答区岗位卡片（岗位列表 / 详情 / 投递追踪',
    '三 tab）的动作回调，不是用户手打消息。格式 `[campus-hunt-action] <action> <JSON>`，',
    '其后一行是自然语言指令句；按 JSON payload 与指令句执行，回复简短：',
    '- `campus_hunt.track_status` → 用 job_track 更新 payload 中岗位的状态',
    '  （payload：jobId/company/title/status）。',
    '- `campus_hunt.track_add` → 用 job_track 以「未处理」状态新增 payload 中的岗位',
    '  （payload：jobId/company/title）。',
    '- `campus_hunt.recollect_jd` → 对 payload 中的 jobId 执行下文「JD 详情」工作流，',
    '  经 campus_job_detail 入库（payload：jobId，可能含 url）。',
    '前缀后的指令句是同一动作的兜底描述，与上述处置一致时直接按其执行。',
    '',
    '## 工作流（按顺序执行；页面导航之间间隔 ≥1 秒）',
    '0. 打开任务空间：ego_space_open("nowcoder")——隔离浏览上下文（继承登录态），',
    '   本次采集流程的全部 ego_* 调用都在该空间执行（无需逐次传 space 参数）。',
    '   采集完成后必须用 ego_space_close("nowcoder") 关闭（见第 24 步后收尾说明）。',
    '### 主路线：列表页 →「秋招正式批」总览卡 →「查看详情」→ 专场页',
    '1. 打开列表页：ego_navigate 访问 https://www.nowcoder.com/jobs/school/jobs',
    '2. 等 tab 栏渲染：ego_wait_for_selector 等待 selector "ul.category-list li"',
    '   （tab 列表动态加载，「秋招正式批」可能稍后才出现）。',
    "3. 点「秋招正式批」tab：ego_js 执行「表达式 1」。",
    "   - 返回 'ok' → 继续下一步",
    "   - 返回 'tab not found' → ego_wait 约 1500ms 后重试一次；仍 'tab not found'",
    '     → 改用备用路线（第 8 步）',
    '4. 等总览卡渲染：ego_wait_for_selector 等待 selector ".activity-info"。',
    '   （该 tab 下是「企业：N家 在招职位：N个」总览卡 + 企业墙，**没有岗位列表**。）',
    '5. 读「查看详情」链接：ego_js 执行「表达式 2」，返回去 query 规范化的',
    `   专场页 URL（形如 ${specialUrl}）。`,
    "   - 返回 URL → 间隔 ≥1 秒后 ego_navigate 该 URL",
    "   - 返回 'detail link not found' → 改用备用路线（第 8 步）",
    '### 备用路线（主路线任一步失败时）',
    `8. 直接 ego_navigate 专场页：${specialUrl}`,
    '   （2026-09-04 实测匿名可访问；「查看详情」href 实测即指向此页。）',
    '### 专场页提取（主/备用路线汇合后）',
    '9. 若出现登录弹窗（.v-modal / .login-dialog 遮罩）：ego_key 按 Escape 关闭并',
    '   记录该事实；不登录、不填写任何账号信息（见红线）。',
    '   随后用 ego_captcha 检测人机验证（reCAPTCHA / hCaptcha / Cloudflare /',
    '   Turnstile）：detected=true → 提示用户在「ego lite - agent」观察窗完成验证，',
    '   确认完成后继续；不代解、不绕验证（见红线）。',
    '10. 等 tab 栏渲染：ego_wait_for_selector 等待 selector "div.tab-bar"。',
    '11. 点「热招职位」区块：ego_js 执行「表达式 3」——页面默认停在',
    '    「热招企业」tab（企业墙，无岗位列表），必须切换。',
    "    - 返回 'ok' → 继续下一步",
    "    - 返回 'hot tab not found' → 立即停止并告知用户（页面结构可能已变化）",
    '12. 等岗位卡片渲染：ego_wait_for_selector 等待 selector "a.job-item"，再 ego_wait',
    '    约 1000ms。第一屏约 40 张卡，**无分页、无「加载更多」，只采第一屏**。',
    '13. 提取岗位：ego_js 执行「表达式 4」，返回值是 JSON 字符串',
    '    （岗位对象数组，字段 id/company/title/city/salary/degree/url，缺失省略）。',
    '14. 入库：把第 13 步返回的 JSON 数组作为 raw 调用 campus_job_search',
    '    （JSON 字符串原样传或解析成数组传均可）；用户指定了城市或关键词时',
    '    同时传 filter（query 匹配公司/岗位名，city 匹配城市字段，两者同时给为 AND）。',
    '### JD 详情（用户指定岗位后执行；一次只采 1 条）',
    '15. 选岗：从 jobs.json（或上一步 campus_job_search 返回的 jobs）里选出用户',
    '    指定的 1 个岗位，取其 id 与 url（形如 https://www.nowcoder.com/jobs/detail/<id>）。',
    '    若用户没指定岗位：先展示岗位列表让用户选，不擅自批量循环采 JD。',
    '16. 打开详情页：间隔 ≥1 秒后 ego_navigate 该 url。',
    '17. 等详情渲染：ego_wait_for_selector 等待 selector ".job-detail-infos"（timeout 30s）。',
    '    若出现登录弹窗（.v-modal / .login-dialog）：ego_key 按 Escape 关闭并',
    '    记录该事实；不登录、不填写任何账号信息。',
    '    随后用 ego_captcha 检测人机验证：detected=true → 提示用户在「ego lite -',
    '    agent」观察窗完成验证，确认完成后继续；不代解、不绕验证（见红线）。',
    '18. 提取 JD：ego_js 执行「表达式 5」，返回值是 JSON 字符串',
    '    （description[]/requirements[]，缺失键省略：bonus?/deadline?/graduationYear?）。',
    '19. 解析返回值：若含 error 键（如 "job-detail-infos not found"）→ 立即停止',
    '    并告知用户（页面结构可能已变化），不重试。',
    '20. 入库：campus_job_detail（raw = 第 18 步 JSON 原样传或解析成对象传均可，',
    '    jobId = 岗位 id）。工具会写入 job.jd、覆盖 deadline（若 raw 带 ISO 截止日）、',
    '    覆盖 graduationYear（若 raw 带毕业要求原文；raw 未带则保留',
    '    既有值）、刷新 fetchedAt。一次只采 1 条 JD。',
    '### 校招日程（用户要日程时执行）',
    '21. 打开日程页：间隔 ≥1 秒后 ego_navigate https://www.nowcoder.com/jobs/school/schedule',
    '22. 等卡片渲染：ego_wait_for_selector 等待 selector "div.list-item"（timeout 30s）。',
    '    若出现登录弹窗（.v-modal / .login-dialog）：ego_key 按 Escape 关闭并',
    '    记录该事实；不登录、不填写任何账号信息。',
    '    随后用 ego_captcha 检测人机验证：detected=true → 提示用户在「ego lite -',
    '    agent」观察窗完成验证，确认完成后继续；不代解、不绕验证（见红线）。',
    '23. 提取日程：ego_js 执行「表达式 6」，返回值是 JSON 字符串（公司卡数组：',
    '    company/batch?/recordedDate?/cities?，缺失省略；空骨架卡已在表达式内跳过）。',
    '    **只采第一屏，不翻页、不点「加载更多」、不滚动触发加载。**',
    '24. 入库：campus_schedule（raw = 第 23 步 JSON 原样传或解析成数组传均可）。',
    '    工具按 company 去重合并进 schedule.json，返回合并后全量。',
    '收尾（本次采集流程结束后）：ego_space_close("nowcoder") 关闭任务空间——',
    'close 必须是本次任务的最后一个 ego_* 调用。',
    '### 个性化推荐（用户要「推荐/挑几个/哪些适合我」时执行；不重新采集）',
    '25. 数据源：会话 workspace 的 jobs.json（或本次入库返回的全量 jobs）。',
    '    **推荐不重新采集**：jobs.json 不存在或为空时，先走上文采集工作流入库，',
    '    再执行本节。',
    '26. 读画像：用 campus_job_search 返回的画像行（该工具返回恒带当前画像：',
    '    「当前画像：方向 a/b · 城市 c · 目标公司 d」；「画像未设置（要个性化',
    '    推荐请在设置页填写）」= 未设置）。当前会话没有该返回（还没做过采集 /',
    '    查询）→ 先调 campus_job_search(raw=[]) 一次（取全量 jobs + 当前画像的',
    '    查询调用，零副作用），再执行本节。',
    '    - 画像行为「画像未设置」→ 不过滤：展示全量岗位（公司/名称/城市/',
    '      薪资），并提示用户「可在设置页填写求职画像（方向/城市/目标公司）后获得',
    '      个性化推荐」。',
    '    - 存在画像 → 按 directions/cities/targetCompanies 对全量 jobs 做语义过滤',
    '      与排序（目标公司命中优先、方向匹配岗位名/公司名次之、城市再次；拿不准的',
    '      宁缺毋滥），输出推荐短名单（3–8 条）+ 每条的匹配理由（命中哪个 tag、',
    '      为何合适）。',
    '    - 无岗位命中画像 → 明说「画像内暂无匹配岗位」，附 2–3 条最接近的岗位',
    '      并说明差距。',
    '27. 推荐结果以文字回复（每条含公司/岗位名/城市/薪资与理由）；用户点名某岗位后，',
    '    按需走「JD 详情」工作流或 GUI 卡片按钮动作，不擅自批量采 JD。',
    '',
    '## 红线（不可违反）',
    '- 只读采集：不登录、不注册、不绕过验证码、不向用户索要任何账号/密码/凭证。',
    '- 专场页/列表页/详情页/日程页出现登录弹窗（.v-modal / .login-dialog）：只按 Escape 关闭并记录。',
    '- 出现登录墙或验证码**阻断内容**时：立即停止，把现状告知用户，不重试、不尝试绕过。',
    '- 人机验证（反爬）：页面被 reCAPTCHA / hCaptcha / Cloudflare / Turnstile 等人机验证组件',
    '  拦截时，用 ego_captcha 检测（或 ego_page_info 的 humanCheck 字段）：detected=true →',
    '  提示用户在「ego lite - agent」观察窗完成验证，确认完成后继续；不代解、不绕验证、不重试。',
    '- 只采第一屏/首页（约 40 张卡；日程页同样只采第一屏）：不翻页、不点「加载更多」、不滚动触发加载。',
    // v0.1：红线两行按当前配置参数化（默认 1 秒 / 50 条，字节与 v0.1 一致）。
    `- 页面导航之间间隔 ≥${intervalSec} 秒。`,
    `- 单轮采集 ≤${maxItems} 条：返回数组超过 ${maxItems} 条时只入库前 ${maxItems} 条，并告知用户。`,
    '- JD 详情一次只采 1 条（用户指定哪条），不批量循环。',
    '',
    '## 表达式 1：列表页点「秋招正式批」tab（ego_js）',
    FENCE + 'js',
    CLICK_ACTIVITY_TAB_EXPRESSION,
    FENCE,
    '',
    '## 表达式 2：列表页总览卡读「查看详情」专场页 URL（ego_js）',
    FENCE + 'js',
    GET_ACTIVITY_DETAIL_HREF_EXPRESSION,
    FENCE,
    '',
    '## 表达式 3：专场页点「热招职位」区块（ego_js）',
    FENCE + 'js',
    CLICK_HOT_TAB_EXPRESSION,
    FENCE,
    '',
    '## 表达式 4：提取专场页「热招职位」列表岗位（ego_js）',
    FENCE + 'js',
    EXTRACT_LIST_EXPRESSION,
    FENCE,
    '',
    '## 表达式 5：提取岗位详情页 JD（ego_js）',
    FENCE + 'js',
    EXTRACT_JD_EXPRESSION,
    FENCE,
    '',
    '## 表达式 6：提取校招日程页公司卡（ego_js）',
    FENCE + 'js',
    EXTRACT_SCHEDULE_EXPRESSION,
    FENCE,
  ]
  return lines.join('\n')
}

/**
 * 按当前配置构造 campus-hunt skill 注册值（v0.1）：红线两行（导航间隔 /
 * 单轮上限）随 collection.minIntervalMs / maxItemsPerRun 变化，其余正文与
 * 路由字段不变。
 * @param cfg - 当前配置（currentConfig()）。
 */
export function buildCampusHuntSkill(cfg: Config): CampusHuntSkillRegistration {
  return {
    name: 'campus-hunt',
    description:
      '牛客（nowcoder.com）校招岗位只读采集工作流：经 ego 浏览器打开列表页、切「秋招正式批」tab、'
      + '经总览卡「查看详情」进入专场页、点「热招职位」区块执行提取表达式、'
      + '再经 campus_job_search 把岗位入库到会话 workspace 的 jobs.json；'
      + '另含 JD 详情（ego_navigate 岗位详情页执行提取表达式，经 campus_job_detail 写入 job.jd，一次 1 条）'
      + '与校招日程（ego_navigate 日程页执行提取表达式，经 campus_schedule 入库 schedule.json）。',
    whenToUse:
      '用户提到牛客/nowcoder 校招岗位、秋招（正式批）职位列表、要把校招岗位采集入库、'
      + '要看某个岗位的 JD 详情、要看牛客校招日程（哪些公司何时开放网申）、'
      + '或要推荐/挑选适合自己的校招岗位（如"帮我推荐岗位"、"哪些岗位适合我"）时。',
    source: 'runtime',
    content: buildContent(cfg.collection.minIntervalMs / 1000, cfg.collection.maxItemsPerRun, cfg.specialUrl),
  }
}

/** 默认配置的 skill 注册值（与 v0.1 注册的 content 字节一致；测试引用）。 */
export const campusHuntSkill: CampusHuntSkillRegistration = buildCampusHuntSkill(defaultConfig)
