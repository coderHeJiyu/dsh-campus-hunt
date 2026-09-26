/**
 * dsh-campus-hunt — settings namespace 身份常量（v0.1.4）。
 *
 * 纯常量文件（零 import）：host 半场（config.ts re-export，供 entry /
 * 活重读 / 测试）与 client 半场（设置页卡片的 scope 绑定与 slot id）
 * 共用同一个 namespace 字符串。client 半场不能 value-import config.ts——
 * 该模块的运行时依赖（schemastery / data/store.ts 的 node: 内建）会被
 * client bundle 内联（tsdown.config.ts 的 alwaysBundle 策略），破坏浏览器
 * 构建。
 */

/**
 * Settings namespace（v0.1.4：0.1.7 自动 namespace 口径——ns = entry id
 * 'dsh-campus-hunt'，与 cordis.patch.yml 的 entry id 同值；client 卡片 slot id
 * 同值）。
 */
export const NS = 'dsh-campus-hunt'
