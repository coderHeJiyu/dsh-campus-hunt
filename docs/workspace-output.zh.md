# workspace 数据文件说明 — dsh-campus-hunt

> 本插件产生 3 个数据文件：`jobs.json` / `track.json` / `schedule.json`。
> 全部本地优先（local-first）：落在当前会话 workspace 根（对话所在的
> workspace），不写固定个人目录，数据不出 workspace。求职画像不产生文件
> （只存设置分节，经 `campus_job_search` 返回的画像行直供模型）。

## 位置与信封格式

- 位置：当前会话 workspace 根目录。工具运行时取 agent 会话的 workspace 路径
  （session header cwd）；没有会话 workspace 的调用会报错（isError），绝不回退
  到宿主进程的 cwd。
- 统一信封：每个文件都是 `{ "schema": 0, "data": <载荷> }`；当前 schema
  版本为 v0。
- 写入格式：2 空格缩进 + 尾换行；临时文件 + rename 原子替换，不会留下写
  一半的文件。
- 文件不存在时，读取方按各自的空载荷继续（空岗位库 / 空台账 / 空日程），
  不创建文件。

## jobs.json — 岗位库

`data.jobs`：岗位记录数组，主键 `id`（牛客岗位 id）。由 `campus_job_search`
（列表采集，按 id 去重合并）与 `campus_job_detail`（JD 详情，一次 1 条写入
`job.jd`）维护。

| 字段 | 类型 | 必有 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 牛客岗位 id（列表页 href `/jobs/detail/<id>` 中的 `<id>`），主键，去重合并按此 |
| `company` | string | 是 | 公司名 |
| `title` | string | 是 | 岗位名 |
| `city` | string | 否 | 城市（如「北京」） |
| `salary` | string | 否 | 薪资原文（如「40-70K·14薪」） |
| `degree` | string | 否 | 学历要求（如「硕士」） |
| `deadline` | string | 否 | 截止时间（建议 ISO `YYYY-MM-DD`） |
| `graduationYear` | string | 否 | 毕业要求原文（JD 页提取） |
| `url` | string | 否 | 岗位详情页 URL（`https://www.nowcoder.com/jobs/detail/<id>`） |
| `fetchedAt` | string | 是 | 采集时间（ISO 8601） |
| `jd` | object | 否 | JD 详情（`campus_job_detail` 写入；未采过详情的岗位无此键）：`description[]` 岗位职责（按行）、`requirements[]` 岗位要求（按行）、`bonus[]?` 加分项（页面缺席时省略） |

示例：

```json
{
  "schema": 0,
  "data": {
    "jobs": [
      {
        "id": "123456",
        "company": "快手",
        "title": "大模型应用工程师（秋招）",
        "city": "北京",
        "salary": "40-70K·14薪",
        "degree": "硕士",
        "deadline": "2026-12-31",
        "graduationYear": "20XX届",
        "url": "https://www.nowcoder.com/jobs/detail/123456",
        "fetchedAt": "2026-09-04T12:30:00.000Z",
        "jd": {
          "description": ["负责大模型应用相关研发工作"],
          "requirements": ["硕士及以上学历", "熟悉 LLM 推理与调用链路"]
        }
      }
    ]
  }
}
```

## track.json — 投递追踪台账

`data.tracks`：追踪记录数组，`id` 与 `jobs.json` 的岗位 id 对齐（未采集的岗位
用 公司+岗位名 生成）。由 `job_track`（list / add / update / status）维护，是
GUI「投递追踪」tab 的数据源；纯本地读写，无网络。

| 字段 | 类型 | 必有 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 岗位 id |
| `company` | string | 是 | 公司名 |
| `title` | string | 是 | 岗位名 |
| `status` | string | 是 | 投递状态，枚举：`未处理` / `已投递` / `笔试` / `面试` / `已拒` / `offer`（中文直值：模型输入、GUI 展示、JSON 存储三方一致） |
| `note` | string | 否 | 备注（面试轮次、笔试链接提示等人工信息） |
| `deadline` | string | 否 | 截止时间（建议 ISO `YYYY-MM-DD`） |
| `createdAt` | string | 是 | 记录创建时间（ISO 8601） |
| `updatedAt` | string | 是 | 最近一次变更时间（ISO 8601） |

示例：

```json
{
  "schema": 0,
  "data": {
    "tracks": [
      {
        "id": "123456",
        "company": "快手",
        "title": "大模型应用工程师（秋招）",
        "status": "已投递",
        "note": "9.5 于牛客投递",
        "deadline": "2026-12-31",
        "createdAt": "2026-09-05T02:00:00.000Z",
        "updatedAt": "2026-09-05T02:00:00.000Z"
      }
    ]
  }
}
```

## schedule.json — 校招日程

`data.items`：日程条目数组，由 `campus_schedule`（牛客日程页第一屏）维护，按
`company` 去重合并。

| 字段 | 类型 | 必有 | 说明 |
|---|---|---|---|
| `company` | string | 是 | 公司名 |
| `openDate` | string | 否 | 收录日期（ISO `YYYY-MM-DD`，由卡片「MM.dd收录」补当年换算；卡片无收录日期时省略） |
| `type` | string | 是 | 批次标签原文（如「提前批」/「网申中」；卡片无批次标签时为「未知」） |
| `cities` | string | 否 | 日程卡地点城市串原文（如「杭州、深圳、北京」） |
| `source` | string | 是 | 来源 URL（牛客日程页） |

示例：

```json
{
  "schema": 0,
  "data": {
    "items": [
      {
        "company": "快手",
        "openDate": "2026-08-20",
        "type": "提前批",
        "cities": "北京、上海",
        "source": "https://www.nowcoder.com/jobs/school/schedule"
      }
    ]
  }
}
```

## schema v0 与 `.pre-schema-<version>.bak` 约定

- 3 个文件都在信封的 `schema` 字段携带 schema 版本；v0.1 只读写 v0。
- 版本不符 → 备份 + 空数据继续（学 dsh-job-hunting 的数据文件
  `.pre-schema-<version>.bak` 做法）：工具读取到根不是对象、或
  `schema` 与当前插件版本不一致的文件（例如新版本插件写入的文件被旧版本插件
  读到）时：
  1. 把原文件备份为 `<文件名>.pre-schema-<v>.bak`（v 为当前读取插件的版本，
     v0.1 即 0，如 `jobs.json.pre-schema-0.bak`）；
  2. 拒绝迁移、不崩溃，以空数据继续（空岗位库 / 空台账 / 空日程）。
- 损坏 JSON 不当作版本不符：无法解析的字节流会大声报错（isError），原文件
  保留供人工检查，不自动备份、不自动覆盖。

## 数据独立于插件版本

- 3 个文件都是普通 JSON，与插件的安装状态解耦：更新 / 卸载插件不会自动
  删除或覆盖它们；可自行备份、迁移或删除（卸载说明见
  [安装指南](./installation.zh.md)）。
- 未来插件版本 bump schema 版本时：旧版本插件读到新版本文件按上述
  「版本不符 → 备份 + 空数据继续」处理（`.bak` 保留现场）；新版本对旧数据
  的兼容迁移策略会随该版本文档给出。
- 数据结构以 `src/nowcoder/types.ts`（类型）与 `src/data/store.ts`（信封 /
  读写 / 备份）为准。
