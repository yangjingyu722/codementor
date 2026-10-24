# CodeMentor 系统架构

状态：v0.1（阶段 0 产出） · 数据契约见 docs/CONTRACTS.md · 决策记录见 docs/decisions/

## 1. 总体形态

CodeMentor 由三层构成：

- **接入层**：VS Code 扩展（人机界面）+ MCP 服务（Agent 接入）+ OpenCode 事件适配器（事实采集）。
- **核心层**：本地 Node.js 服务进程，承载决策引擎、代码映射引擎、学习引擎。
- **数据层**：SQLite 存储 + 本地对象存储（证据内容）。

核心原则：**业务逻辑全部在核心层，接入层只做转译**。核心层不知道 VS Code API，也不知道 OpenCode 的私有格式，因此可以在无 IDE、无 Agent 的环境下被完整测试。

## 2. 模块职责

| 模块                                | 阶段 | 职责                                                                    | 不负责                 |
| ----------------------------------- | ---- | ----------------------------------------------------------------------- | ---------------------- |
| VS Code Extension (`apps/vscode`)   | 4    | TreeView / CodeLens / Webview；与本地服务通信；把用户操作翻译成服务调用 | 任何业务规则、存储     |
| Local Core Service (`apps/server`)  | 1    | 核心进程：装载引擎与存储、暴露本地传输（扩展与服务均连接于此）          | UI、Agent 私有格式解析 |
| MCP Agent Adapter (`packages/mcp`*) | 2    | 把核心层能力暴露为 MCP 工具（declare_decision 等）；校验 Agent 载荷     | 决策规则本身           |
| OpenCode Event Adapter              | 2    | 订阅 OpenCode 事件，归一化为 AgentEvent                                 | 其他 Agent 的私有格式  |
| Engineering Decision Engine         | 1/5  | 决策生命周期管理；执行完整性规则（R1–R5）；主张-证据关联                | 界面呈现               |
| Code Mapping Engine                 | 3    | Git diff + Tree-sitter：解析变更 → 生成/校准 CodeAnchor                 | 决策语义               |
| Learning Engine                     | 5    | 从决策生成练习；评阅作答                                                | 出题之外的 AI 调用     |
| SQLite Storage                      | 1    | 持久化、索引、版本化迁移                                                | 跨仓共享               |

\* 包路径以阶段 2 设计为准，此处先锁定职责。

## 3. 架构图

```mermaid
flowchart LR
  subgraph 接入层
    OC[OpenCode / Codex /<br/>Claude Code 等 Agent]
    VS[VS Code Extension<br/>apps/vscode]
  end

  subgraph 核心层 [核心层 · Local Core Service · apps/server]
    MCP[MCP Agent Adapter]
    OCA[OpenCode Event Adapter]
    DE[Engineering<br/>Decision Engine]
    CM[Code Mapping Engine]
    LE[Learning Engine]
  end

  subgraph 数据层
    DB[(SQLite Storage)]
    OBJ[(证据对象存储<br/>本地文件)]
  end

  OC -- "MCP 工具调用<br/>(declare/link/query)" --> MCP
  OC -- "会话事件流" --> OCA
  VS -- "本地传输 (查询/操作)" --> DE
  MCP --> DE
  OCA --> DE
  DE --> CM
  DE --> LE
  DE --> DB
  CM --> DB
  LE --> DB
  DE --> OBJ
```

依赖方向（编译期）：所有模块依赖 `@codementor/contracts`（数据契约与完整性规则）；引擎不依赖任何接入层。contracts 是整个系统唯一的共享内核，这保证了"文档即契约、契约即代码"。

## 4. 主要数据流

### 4.1 决策声明（Agent 动手之前）

```mermaid
sequenceDiagram
  participant A as OpenCode (Agent)
  participant M as MCP Agent Adapter
  participant D as Decision Engine
  participant S as SQLite Storage

  A->>M: declare_decision(问题/选中方案/备选/意图主张)
  M->>M: Zod 载荷校验
  M->>D: 提交声明（origin=declared）
  D->>D: 完整性规则 R1–R5
  D->>S: 写入 Decision + Claims（declaredAt=now）
  D-->>M: 决策 ID
  M-->>A: 确认（Agent 随后才开始写代码）
```

### 4.2 事实采集与代码锚定（Agent 实现之后）

```mermaid
sequenceDiagram
  participant A as OpenCode (Agent)
  participant E as Event Adapter
  participant D as Decision Engine
  participant C as Code Mapping Engine
  participant S as SQLite Storage

  A->>E: 会话事件（file_edit / test_run ...）
  E->>S: 归一化 AgentEvent
  A->>D: link_evidence(测试输出 / diff 引用)
  D->>S: 写入 Evidence + 更新 Claim.verification
  A->>C: anchor_decision(decisionId)
  C->>C: git diff + tree-sitter 符号解析
  C->>S: 写入 CodeAnchor（commitSha + 行号 + symbolPath）
```

### 4.3 理解与练习（开发者）

```mermaid
sequenceDiagram
  participant U as 开发者
  participant V as VS Code Extension
  participant D as Decision Engine
  participant L as Learning Engine

  U->>V: 点击 CodeLens / 决策树节点
  V->>D: 查询决策(含主张/证据/锚点)
  D-->>V: 决策详情（按 origin 分组）
  V-->>U: Webview 展示
  U->>V: 请求练习
  V->>L: 生成练习
  L->>L: 从决策与主张出题
  L-->>V: Exercise
  U->>V: 作答
  V->>L: 提交 Attempt
```

## 5. 关键设计约束

1. **契约优先**：`@codementor/contracts`（Zod schema + 完整性规则）是唯一被所有层共享的模块；跨模块数据必须先过契约校验。
2. **认知来源不可自动升级**：`rationalized → declared` 的转换被系统禁止；只有带可信时间戳的新声明才产生 `declared` 记录。
3. **进程边界**：VS Code 扩展崩溃不应影响核心服务；核心服务必须能在无扩展时被 Agent 独立使用（headless）。
4. **本地传输**：扩展 ↔ 服务走本机回环 + 鉴权 token（阶段 1 细化）；不监听外网地址。

## 6. 阶段映射

| 阶段        | 交付模块                                                        |
| ----------- | --------------------------------------------------------------- |
| 0（本阶段） | contracts 契约包 + 仓库骨架 + CI                                |
| 1           | SQLite Storage + Local Core Service 骨架 + Decision Engine 基础 |
| 2           | MCP Agent Adapter + OpenCode Event Adapter                      |
| 3           | Code Mapping Engine（Git + Tree-sitter）                        |
| 4           | VS Code Extension                                               |
| 5           | Learning Engine + Exercise/Attempt                              |
| 6           | 集成打磨与开源发布                                              |
