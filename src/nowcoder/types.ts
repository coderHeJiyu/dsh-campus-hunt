/**
 * dsh-campus-hunt — 领域类型（v0.1）。
 *
 * Job / Track / ScheduleItem 三个核心实体的规范类型，供数据层
 * （src/data/store.ts）与工具层（src/tools/*）共享。全部为纯类型模块：
 * 零运行时依赖，可安全被 node 半场与 client 半场同时 import。
 *
 * v0.1：Job 增可选 jd（增量字段，schema v0 不 bump）；ScheduleItem
 * 适配真实日程页（type 改批次标签原文 string，openDate 改可选收录日期）。
 * v0.1（字段扩展修正）：Job 再增可选 graduationYear（毕业要求原文）、
 * ScheduleItem 再增可选 cities（地点城市串原文）；均为增量字段，schema v0 不 bump。
 *
 * schema v0：结构变更时 bump 版本并走 store 的备份迁移（.pre-schema-<v>.bak）。
 */

/** 投递状态枚举（中文直值：模型输入、GUI 展示、JSON 存储三方一致，v0.1 口径）。 */
export const TRACK_STATUSES = [
  '未处理', '已投递', '笔试', '面试', '已拒', 'offer',
] as const

export type TrackStatus = (typeof TRACK_STATUSES)[number]

/**
 * 一条投递追踪记录（track.json 的 data.tracks 元素；id 与 jobs.json 的岗位 id 对齐）。
 *
 * v0.1：interface → type 别名（纯类型层，零运行时影响）——dsh-tools 的
 * JsonValue 对象分支要求隐式 index signature，interface 不具备（type 字面量
 * 具备），presentationMeta 的投影返回值因此可赋值给 JsonValue。
 */
export type Track = {
  /** 岗位 id（与 jobs.json 主键一致；未采集岗位时用 company+title 生成）。 */
  id: string
  /** 公司名。 */
  company: string
  /** 岗位名。 */
  title: string
  /** 当前投递状态。 */
  status: TrackStatus
  /** 可选备注（面试轮次、笔试链接提示等人工信息）。 */
  note?: string
  /** 可选截止时间（建议 ISO YYYY-MM-DD；模型负责把"12.31"换算成完整日期）。 */
  deadline?: string
  /** 记录创建时间（ISO 8601）。 */
  createdAt: string
  /** 最近一次变更时间（ISO 8601）。 */
  updatedAt: string
}

/** 一条岗位记录（jobs.json 的 data.jobs 元素；M2 由 campus_job_search/detail 写入）。v0.1：见 Track 注释（type 别名）。 */
export type Job = {
  /** 牛客岗位 id（列表页 href /jobs/detail/<id> 的 <id>；主键）。 */
  id: string
  /** 公司名。 */
  company: string
  /** 岗位名。 */
  title: string
  /** 城市（如"北京"）。 */
  city?: string
  /** 薪资原文（如"40-70K·14薪"）。 */
  salary?: string
  /** 学历要求（如"硕士"）。 */
  degree?: string
  /** 截止时间（建议 ISO YYYY-MM-DD）。 */
  deadline?: string
  /** 毕业要求原文（JD 页 deliver-range 提取，`v0.1`）。 */
  graduationYear?: string
  /** 岗位详情页 URL（https://www.nowcoder.com/jobs/detail/<id>）。 */
  url?: string
  /** 采集时间（ISO 8601）。 */
  fetchedAt: string
  /**
   * JD 详情（M2 由 campus_job_detail 写入，v0.1）。
   * 增量可选字段：未采过详情的岗位无此键（schema v0 不 bump）。
   */
  jd?: {
    /** 岗位职责（按行）。 */
    description: string[]
    /** 岗位要求（按行）。 */
    requirements: string[]
    /** 加分项（页面缺席时省略）。 */
    bonus?: string[]
  }
}

/**
 * 校招日程条目（schedule.json 的 data.items 元素；M2 由 campus_schedule 写入）。
 *
 * v0.1 适配真实日程页（对 v0.1 类型的偏离，协调者口径）：
 *   type  = 批次标签**原文**（站点标签原样，如「网申中」），
 *           不再是 '提前批' | '正式' 二值枚举；卡片无批次标签时为「未知」。
 *   openDate = 收录日期（ISO YYYY-MM-DD，由「MM.dd收录」补当年换算），
 *           页面卡片无收录日期（如「正在收集中」形态）时省略。
 */
export type ScheduleItem = {
  /** 公司名。 */
  company: string
  /** 收录日期（ISO YYYY-MM-DD；无收录日期时省略）。v0.1：改可选。 */
  openDate?: string
  /** 批次标签原文（如「网申中」；无批次为「未知」）。v0.1：改 string。 */
  type: string
  /** 日程卡地点城市串原文（如「杭州、深圳、北京」），`v0.1`。 */
  cities?: string
  /** 来源 URL（牛客日程页）。 */
  source: string
}
