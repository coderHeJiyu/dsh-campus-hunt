/**
 * Vitest 配置（v0.1）。
 *
 * 客户端测试（test/client-*.test.tsx，jsdom）需要 react + react-dom：插件 devDeps
 * 只有 react（18.3.1），没有 react-dom——任务口径不引入新依赖，因此把 react /
 * react-dom 这对同版本（18.3.1）模块 alias 到相邻 deepseek-harness 工作区的
 * pnpm 虚拟存储条目（react-dom 条目内带 react peer 副本），并让所有 react 导入
 * 都走同一份物理副本（react-dom 内部再 require('react') 时同样命中 alias）——
 * 单一 React 实例，避免"双 React"导致的 hook dispatcher 报错。
 *
 * 相邻 deepseek-harness 缺失时（独立 checkout）：locateReactPair 返回
 * undefined、alias 全空、react-dom 无法解析——client（jsdom）测试在导入时
 * 大声失败，host 侧测试不受影响。
 *
 * preserveSymlinks: true 是关键：Windows 下 vite 默认对 pnpm 符号链接做
 * safe-realpath 解析（spawn 子进程），在本沙箱内会 EPERM；保留符号链接后
 * 不再触发该解析。
 *
 * host 侧测试不用 React，不受此配置影响。pool 用 threads（package.json 的 test
 * 脚本已经通过 CLI 强制 --pool=threads；此处重复声明防止配置漂移）。
 *
 * 不 import 任何 bare 包（只用 node: 内建）：配置打包阶段的 externalize-deps
 * 对 bare import 会再做一次符号链接解析，同样可能触发 spawn EPERM。
 */
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 在相邻 deepseek-harness 的 .pnpm 中定位 react-dom@18.x 条目（其 node_modules 内带 react peer 副本）。 */
function locateReactPair(): { react: string; reactDom: string } | undefined {
  const pnpmRoot = join(HERE, '..', 'deepseek-harness', 'node_modules', '.pnpm')
  if (!existsSync(pnpmRoot)) return undefined
  for (const entry of readdirSync(pnpmRoot)) {
    if (!/^react-dom@18\./.test(entry)) continue
    const reactDom = join(pnpmRoot, entry, 'node_modules', 'react-dom')
    const react = join(pnpmRoot, entry, 'node_modules', 'react')
    if (existsSync(join(reactDom, 'client.js')) && existsSync(join(react, 'index.js'))) {
      return { react, reactDom }
    }
  }
  return undefined
}

const pair = locateReactPair()

// alias 顺序敏感：更具体的前缀必须在前（'react' 也会前缀命中 'react/jsx-runtime'）。
const alias: Array<{ find: string; replacement: string }> = []
if (pair !== undefined) {
  alias.push({ find: 'react/jsx-runtime', replacement: join(pair.react, 'jsx-runtime.js') })
  alias.push({ find: 'react/jsx-dev-runtime', replacement: join(pair.react, 'jsx-dev-runtime.js') })
  alias.push({ find: 'react-dom/client', replacement: join(pair.reactDom, 'client.js') })
  alias.push({ find: 'react-dom/test-utils', replacement: join(pair.reactDom, 'test-utils.js') })
  alias.push({ find: 'react', replacement: join(pair.react, 'index.js') })
  alias.push({ find: 'react-dom', replacement: join(pair.reactDom, 'index.js') })
}

export default {
  resolve: {
    preserveSymlinks: true,
    alias,
  },
  test: {
    pool: 'threads',
  },
}
