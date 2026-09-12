# 安装指南 — dsh-campus-hunt

> 本文是 [README 安装节](../README.md)的展开版，覆盖前提、安装、验证、更新、卸载五个环节。

## 前提

1. **DSH（DeepSeek Harness）已安装**，且 `web` profile 已初始化（插件装到该
   profile，即 `--profile web`）。
2. **Node.js ≥ 22**（插件包 `engines` 声明 `node >= 22`）。
3. **pnpm**。`dsh plugin` 经由 pnpm 管理插件，必须已安装；源码安装方式另需
   `pnpm install` / `pnpm build` 装依赖与构建。
4. **dsh-ego-browser 浏览器采集后端**。牛客页面采集必需：agent 用它的 `ego_*`
   工具打开并提取牛客页面（列表页是 JS 渲染，普通 HTTP 抓取拿不到内容）。
   要求 DSH ≥ 0.1.2-rc.1；Windows 上 ego 浏览器是有头窗口（采集时出现可见
   浏览器窗口属正常现象），人机验证需用户在观察窗（headed 浏览器窗口 /
   Agent Browser 观察面板）完成。安装：

   ```powershell
   dsh plugin --profile web add github:Fisfzy/dsh-ego-browser#master
   ```

## 安装

### 方式一：GitHub 直接安装（推荐）

```powershell
dsh plugin --profile web add github:coderHeJiyu/dsh-campus-hunt
```

从 GitHub 仓库直接安装，拉取默认分支的 HEAD。仓库随源码提交了预构建的
`lib/` 产物，安装时不运行 `prepare` 构建脚本，pnpm ≥10 无需 `allowBuilds`
放行。

### 方式二：源码安装（试用 / 开发）

适合从源码试用或在开发中直接挂载。克隆仓库、装依赖、构建，然后挂载：

```powershell
git clone https://github.com/coderHeJiyu/dsh-campus-hunt.git
cd dsh-campus-hunt
pnpm install
pnpm build
dsh plugin --profile web add .
```

`pnpm build` 生成 `lib/` 构建产物（包的 `files` 字段引用 `lib/`，安装前必须
存在）；最后一条 `add .` 在仓库根目录执行，安装当前目录。本地开发也可以用
`link:` 软链安装（配 `pnpm dev` 监听构建，client 端改动热更，host 端改动需
重启 `dsh web`）：

```powershell
dsh plugin --profile web add link:/path/to/checkout
```

## 验证

```powershell
dsh plugin --profile web list
dsh web --dump-config | Select-String campus-hunt
```

逐项核对：

1. `dsh plugin --profile web list` 的输出中出现 `dsh-campus-hunt`，说明插件已
   注册进 web profile；
2. `dsh web --dump-config | Select-String campus-hunt` 命中 `campus-hunt` 分节。
   这是插件的设置分节（GUI 设置页卡片的落盘位置），默认值应为
   `allowedDomains: [nowcoder.com]`、`maxItemsPerRun: 50`、`minIntervalMs:
   1000`、画像字段为空数组、`resumePath` 为空；
3. **重启 DSH Web GUI**。设置分节按 restart 语义生效，runtime skill 也在重启时
   注册；
4. 打开 GUI 新建会话，对 agent 说「帮我看看牛客上秋招有哪些岗位」：
   - agent 应走 campus-hunt 工作流（ego 浏览器打开牛客页面 → 提取 → 调
     `campus_job_search` 入库）；
   - 该回合回答末尾出现岗位卡片（岗位列表 / 详情 / 投递追踪三个 tab）；
   - 会话 workspace 下生成 `jobs.json`。

## 更新

- **GitHub 安装**：重跑安装命令，重新解析到默认分支的最新提交：

  ```powershell
  dsh plugin --profile web add github:coderHeJiyu/dsh-campus-hunt
  ```

- **源码安装**：更新仓库内容（如 `git pull`）、重新构建（`pnpm build`），
  然后在仓库根目录重新执行：

  ```powershell
  dsh plugin --profile web add .
  ```

  `link:` 软链安装无需重装：配 `pnpm dev` 监听构建时 client 端改动热更，
  host 端改动重启 `dsh web` 生效。

- 更新后重启 GUI 生效。
- workspace 中的 3 个数据文件（`jobs.json` / `track.json` /
  `schedule.json`）独立于插件版本，更新不会删除或覆盖它们；schema 版本与
  `.pre-schema-<version>.bak` 备份约定见
  [workspace 数据文件说明](./workspace-output.zh.md)。

## 卸载

```powershell
dsh plugin --profile web remove dsh-campus-hunt
```

卸载后：

- 插件的 4 个工具、回答区卡片、设置页卡片与 `campus-hunt` skill 全部消失；
- workspace 中的 3 个数据文件不会自动删除，可先备份，再手动删除。

## 相关文档

- [安全声明](./security.zh.md)
- [workspace 数据文件说明](./workspace-output.zh.md)
- [返回 README](../README.md)
