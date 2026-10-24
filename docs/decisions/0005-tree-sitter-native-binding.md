# ADR-0005：源码解析采用 tree-sitter 原生绑定，版本精确钉住并经原生 require 加载

- 状态：已接受（阶段 3）
- 日期：2026-10-24
- 影响：packages/code-mapping、CI、后续语言扩展

## 背景

Code Mapping Engine 需要把设计决策锚定到源码符号（函数/结构体），并在代码漂移后重定位。要求：结构化语法树（而非正则）、行级位置、多语言可扩展（首版 C，后续 TypeScript）。

## 决策

1. **解析器**：tree-sitter（`tree-sitter@0.22.4` + `tree-sitter-c@0.23.4`，**精确版本、无 `^`**）。
2. **加载方式**：原生 CJS/NAPI 模块一律经 `createRequire` 的 Node 原生 `require` 加载，不走打包器 ESM 互操作。
3. **语言抽象**：`SourceParser` 接口（languageId / extensions / parse）+ `ParserRegistry` 按扩展名路由；新增语言 = 实现接口并注册，映射引擎其余部分不感知语言。

## 证据（为什么是这两个精确版本）

tree-sitter 核心与语法包之间存在 **ABI 耦合**，不是语义化版本能表达的：

- `tree-sitter@latest + tree-sitter-c@0.24.1`：安装成功，运行时崩溃（`nodeTypeNamesById undefined`）——0.24+ 的语法包导出新版绑定包装对象 `{name, language, nodeTypeInfo}`，旧核心不识别。
- `tree-sitter@0.22.4 + tree-sitter-c@0.23.4`：探针与全量测试通过（预编译二进制，Windows + Node 24 无需编译器）。

第二个坑：Vitest/Vite 对 CJS 的 default-import 互操作会包装 NAPI 对象，`import C from 'tree-sitter-c'` 在测试运行时同样触发上述崩溃。`createRequire` 原生加载彻底规避（对构建产物在纯 Node 下运行也是正确路径）。

## 备选方案

- **web-tree-sitter + WASM 语法包**：零原生依赖，但需要额外维护 wasm 产物来源（第三方聚合包或自行生成），版本漂移面更大。保留为 CI 某平台缺失预编译时的回退方案。
- **正则/手写解析**：无法可靠处理宏、注释、嵌套，重定位需要的是语法树而非文本匹配——直接否决。
- **LSP（如 clangd）**：重依赖、外部进程生命周期管理复杂，超出本地轻量工具的合理边界。

## 后果与风险

- 升级 tree-sitter 时必须**成对**升级核心与全部语法包，并在真实运行环境验证（探针先行，测试兜底）；版本锁定写死在 package.json。
- 原生模块对 Node 大版本升级敏感（同 better-sqlite3，见 ADR-0003），CI 固定 Node 20 LTS 提供交叉验证。
