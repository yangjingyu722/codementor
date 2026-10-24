/**
 * tree-sitter-c（0.23.4）未自带类型声明；其导出为 tree-sitter 的 Language 实例。
 * 版本必须与 tree-sitter 核心 ABI 配对（见 ADR-0005）：
 * 0.24+ 的语法包采用新版绑定包装对象，与本包锁定的核心 0.22.4 不兼容。
 */
declare module 'tree-sitter-c' {
  import type { Language } from 'tree-sitter';
  const language: Language;
  export = language;
}
