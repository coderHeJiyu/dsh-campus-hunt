# dsh-campus-hunt
中文 | [English](docs/README.en.md)

> DSH（DeepSeek Harness）校招求职 Client 插件（牛客渠道）：4 个 host tool
> （岗位检索 / JD 详情 / 校招日程 / 投递流水线）+ 回答区 GUI 三 tab 卡片
> （列表 · 详情 · 追踪），本地优先数据层，只读采集安全策略。

## 最新版本
**v0.1.3**

## 简介

dsh-campus-hunt 是 DSH Web GUI 的校招求职插件。浏览器这头全交给 agent：它用
[dsh-ego-browser](https://github.com/Fisfzy/dsh-ego-browser) 浏览器采集后端
的 `ego_*` 工具（必需，见「安装指南」）打开牛客（nowcoder.com）的校招页面：岗位列表、
JD 详情、校招日程。插件的工具只干一件事：把提取结果规范化、去重，入库到
会话 workspace 的 JSON 文件。

agent 每调一次工具，该回合回答末尾就在 GUI 渲染一张交互式岗位卡片（岗位列表
/ 详情 / 投递追踪三个 tab，回答区卡片）；设置页卡片负责求职
画像、专场地址、采集域名白名单和频率红线。

- 本地优先（local-first）：数据全部落在当前会话 workspace（`jobs.json` /
  `track.json` / `schedule.json` 三个文件），无云服务、不写固定个人目录，
  数据不出 workspace。
- 只读采集：只读岗位列表 / JD / 日程，不投递、不发消息、不登录、不绕过验证码。
- 浏览器由 agent 驱动：工具自身不做网络 I/O，也不引入 playwright/puppeteer
  这类重依赖；届次切换 / 专场地址变化时，在设置页改「专场入口」就行，无需
  改 skill；站点结构改版时，改 skill 里的提取表达式就行。

## 支持范围

支持：

- 牛客（nowcoder.com）校招：岗位列表（秋招正式批专场页）、JD 详情
  （无需登录可见）、校招日程（哪些公司已开放/即将开放网申）；
- 4 个 host tool：`campus_job_search`（岗位采集入库）/ `campus_job_detail`（JD
  详情，一次 1 条）/ `campus_schedule`（校招日程）/ `job_track`（投递追踪流水线，
  纯本地，无网络）；
- 回答区 GUI 卡片：岗位列表 / 详情 / 投递追踪三个 tab（回合末尾，compact /
  normal 显示模式均可见）；选 tab、标记状态等本地交互零往返，需要 agent
  参与的动作用 action 回调带回；
- 设置页卡片（GUI 设置页 `campus-hunt` 分节）：求职画像（方向 / 城市 / 目标
  公司）、牛客采集配置（域名白名单 `allowedDomains` / 单次条数上限 / 导航间隔）、
  简历文件路径、专场入口（牛客秋招专场页 URL，默认 27 届 2027QZzc 专场）；
- 个性化推荐：用户说「帮我推荐岗位 /
  哪些岗位适合我」时，skill 用 campus_job_search 返回的画像行（画像只存设置
  分节、无 workspace 副本；当前会话没有该返回时先以 raw=[] 查询一次，零副作用）
  按方向 / 城市 / 目标公司做语义过滤与排序，输出带匹配理由的短名单；画像为空时
  展示全量并提示去设置页填写；推荐不重新采集；
- 数据层：3 个文件统一 `{ "schema": 0, "data": ... }` 信封（结构详见
  [workspace 数据文件说明](docs/workspace-output.zh.md)）。

暂不支持：

- 不自动投递 / 不登录 / 不存凭证 / 不绕过 CAPTCHA；
- 简历解析与规则化 JD 匹配评分（暂不实现；模型按画像的语义推荐已支持，见上
  「个性化推荐」）；
- 牛客以外的站点（公司官网等 JS 重站点）；
- 桌面快捷方式 / 独立调度器 / 面试提醒；
- 多用户 / 云服务，纯本地单用户。

## 安装

```powershell
dsh plugin --profile web add github:coderHeJiyu/dsh-campus-hunt
```

从 GitHub 仓库直接安装，拉取默认分支的最新提交。前提（DSH / Node.js / pnpm /
dsh-ego-browser）、验证、源码安装、更新与卸载详见
[安装指南](docs/installation.zh.md)。

## 安全声明

- 采集范围：只采集 `allowedDomains` 白名单（默认 `nowcoder.com`，host 后缀
  匹配）内的页面；URL 不在白名单的岗位/详情/日程会被跳过或报错返回，不入库。
- 只读承诺：只读取并存储岗位列表 / JD / 日程；不自动投递、不发送任何消息、
  不填写表单、不注册账号。
- 不绕登录 / CAPTCHA：出现登录弹窗只按 Escape 关闭并记录；出现登录墙或
  验证码阻断内容时立即停止并告知用户，不重试、不尝试绕过。
- 绝不索要凭证：不向用户索要账号、密码、cookie 或任何形式的凭证，也不存储。
- 频率红线只收紧：单次采集 ≤ 50 条（范围 1–50）、页面导航间隔 ≥ 1 秒
  （范围 1–600 秒）：设置页只能把这些红线改得更严格，不能放松；JD 详情一次只
  采 1 条；只采第一屏，不翻页、不点「加载更多」。
- local-first 数据不出 workspace：所有数据写入当前会话 workspace，无网络
  上传、无云同步。
- [更多](docs/security.zh.md) 

## 截图

回答区岗位卡片（牛客秋招岗位，列表 / 详情 / 追踪三 tab）：

![列表 tab：岗位表与投递追踪台账](docs/images/campus-hunt-jobs-card.png)

![详情 tab：选中岗位的完整 JD 与状态标记](docs/images/campus-hunt-jobs-card-detail.png)

![投递追踪 tab：按状态汇总与投递台账](docs/images/campus-hunt-jobs-card-track.png)

## 文档

| 文档 | 中文 | English |
|---|---|---|
| 安装指南 | [installation.zh.md](docs/installation.zh.md) | [installation.en.md](docs/installation.en.md) |
| 安全声明全文 | [security.zh.md](docs/security.zh.md) | [security.en.md](docs/security.en.md) |
| workspace 数据文件说明 | [workspace-output.zh.md](docs/workspace-output.zh.md) | [workspace-output.en.md](docs/workspace-output.en.md) |
