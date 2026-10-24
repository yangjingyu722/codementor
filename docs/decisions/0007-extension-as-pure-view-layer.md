# ADR-0007：VS Code 扩展是纯视图层——只消费核心服务 API，不复制引擎逻辑

- 状态：已接受（阶段 4）
- 日期：2026-10-24
- 影响：apps/vscode 全部实现、后续 IDE 前端

## 背景

阶段 4 要把决策树、详情、CodeLens、跳转做进 VS Code。存在两条路线：扩展内置业务/解析逻辑，或扩展作为核心服务的薄视图。

## 决策

1. **扩展零业务逻辑、零运行时依赖**：只用 Node 内置模块（http/fs/path/crypto）+ VS Code API；数据契约类型以 type-only import 引入（编译期擦除）。
2. **数据一律来自核心服务 HTTP API**（`server.json` 发现 + token）：树、详情、CodeLens、跳转、重验证全部走 `docs/LOCAL_API.md` 端点。为此补了 3 个只读查询端点（projects/lookup、projects/:id/tasks、projects/:id/anchors）——它们是对既有存储查询的透出，不是新业务。
3. **不在扩展内跑 tree-sitter**：CodeLens 的符号位置来自核心服务的锚点数据（阶段 3 引擎解析 + 重验证），扩展只按文件路径过滤缓存快照。代价是编辑器内未保存的新编辑不实时产生 CodeLens（锚点经"重新验证"命令刷新）——接受，因为它换来单一事实源。
4. **构建形态 CJS**：扩展宿主对 CommonJS 支持最成熟（ESM 扩展尚在演进）；测试文件随 src 编译但被 .vscodeignore 排除出发布物。
5. **离线/未注册是显式 UI 状态**：树根显示引导节点 + 状态栏仅在离线时出现；不弹窗轰炸。错误提示集中在用户主动触发的命令上。

## 理由

- **测试与演进的单一性**：引擎逻辑只有一份（packages/*），在 CI 上无 IDE 依赖地全量验证；扩展只测视图装配（@vscode/test-electron）。
- **Agent 头less 使用同一 API**：MCP 适配器（阶段 2）与扩展消费同一服务——不存在"两套写入路径导致数据不一致"的可能。
- **平台风险隔离**：tree-sitter 原生模块不进扩展宿主，避免 VS Code 版本 × Node ABI 的矩阵问题。

## 备选方案

- **扩展内嵌引擎（workspace 依赖 contracts/storage）**：分发体积与 ABI 风险陡增，且破坏"扩展崩溃不影响数据"的进程隔离（ADR-0001）。
- **扩展直读 SQLite**：绕过完整性规则与状态机，制造旁路——直接违反总控架构。

## 后果

- CodeLens/树的实时性依赖锚点缓存（5s TTL + 手动刷新/重验证）——文档明示为 v1 语义。
- 新 IDE 前端（未来 CLI/其他编辑器）复用同一 API 集，成本仅为视图层重写。
