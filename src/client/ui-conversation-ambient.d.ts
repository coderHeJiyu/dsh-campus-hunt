/**
 * ambient 模块最小面（v0.1.4）：本插件不安装 @deepseek-ai/dsh-client-ui-conversation
 * （node_modules 里解析不到该包），此处声明一个仅含 ConversationTurnDataMap 键域
 * 的最小 ambient 模块，使 campus-cards.ts 的 declare module 声明合并
 * （增加 'campus-cards' 键）能合法进行（对照 host ui-deliverables
 * turn-deliverables.ts 的合并口径）。全局脚本文件（无 import / export），
 * 只保类型保真；运行时实现由宿主注入，不受影响。
 */
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  /** 合并可扩展的 turn 作用域 Location 数据键域（host contract/conversation.ts 同名接口）。 */
  interface ConversationTurnDataMap {}
}
