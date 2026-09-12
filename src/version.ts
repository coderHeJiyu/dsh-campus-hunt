/**
 * dsh-campus-hunt — 插件版本号单一来源。
 *
 * 直接 import 包根 package.json 的 version 字段：tsdown 构建时内联为字面量
 * （宿主经 tsx 从源码直接 import 时同样解析到包根）。bump package.json
 * 版本后重建即同步——日志等运行时输出与包版本永不漂移，无需另维护常量。
 */
import pkg from '../package.json' with { type: 'json' }

/** 当前插件版本（package.json 的 version 原文，如 "0.1.1"）。 */
export const PLUGIN_VERSION: string = pkg.version
