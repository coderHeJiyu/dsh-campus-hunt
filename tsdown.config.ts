/**
 * 双阶段产出（对齐官方 packages/client/tsdown.client.ts 的闭包工厂契约）：
 *
 * 1. node 半场：src/index.ts → lib/index.js（ESM，host 侧 cordis 插件，宿主从源码
 *    启动经 tsx 直接 import）。运行时依赖仅两个 external：node: 内建 + cordis
 *    （宿主单实例，官方"every plugin shares the installation's single cordis
 *    instance"口径）+ dsh-tools（v0.1 口径：externalize 而非内联——
 *    测试环境 link: 插件经 realpath 解析到本仓库 node_modules 的
 *    @deepseek-ai/dsh-tools@0.1.2-rc.1；tarball 发布环境经 $DSH_HOME/profiles/
 *    node_modules 的 healed closure 与宿主共享同一实例。defineTool 是纯函数，
 *    双实例无身份风险）。
 * 2. client 半场：src/client/index.tsx → lib/client.js（CJS 浏览器 bundle，
 *    `window.__ModuleLoader__.load({ id, factory })` 形式；基线外部模块走宿主
 *    注入的 require 模块表，其余第三方库全部内联）。
 *
 * 两个配置都 clean: false：node 半场重建不得清掉 client.js（host 对
 * lib/client.js 做 stat-poll，bundle 缺失会在启动时大声失败）。
 */
import type { UserConfig } from 'tsdown'

/** Shell 共享进冻结模块表的基线外部模块（与 packages/client/web/src/platform.ts 一致）。 */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

function isBaseline(specifier: string): boolean {
  return (PLATFORM_MODULES as readonly string[]).includes(specifier)
}

const nodeHalf: UserConfig = {
  name: 'dsh-campus-hunt',
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  outputOptions: {
    // package.json exports 指向 ./lib/index.js（与官方包布局一致）。
    entryFileNames: 'index.js',
  },
  deps: {
    // node: 内建 + 基线外部模块 + dsh-tools 保持 external：
    // - cordis 走宿主单实例（见文件头 v0.1 口径注释）；
    // - dsh-tools 测试环境（link: 插件）解析到本仓库 node_modules 的
    //   @0.1.2-rc.1，发布环境（tarball）解析到 profile 的 healed closure，
    //   与宿主共享同一实例；defineTool 为纯函数，双实例无身份风险。
    // 注意：tsdown 默认只 externalize package.json dependencies 中的裸包，
    // dsh-tools 是 optional peer，必须显式列入，否则会被内联进 lib/index.js。
    neverBundle: (specifier) =>
      specifier.startsWith('node:')
      || isBaseline(specifier)
      || specifier === '@deepseek-ai/dsh-tools'
      || specifier.startsWith('@deepseek-ai/dsh-tools/'),
  },
}

const clientHalf: UserConfig = {
  name: 'dsh-campus-hunt/client',
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    // 基线外部模块走模块表；其余第三方实现库一律内联（私有副本）。
    neverBundle: isBaseline,
    alwaysBundle: (specifier) => !isBaseline(specifier),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify('dsh-campus-hunt')}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [nodeHalf, clientHalf]
