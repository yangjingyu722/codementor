# 本地核心服务 API（阶段 1 起，阶段 3 增补锚点端点）

基地址：`http://127.0.0.1:<port>`（端口见 `~/.codementor/server.json`，可用 `CODEMENTOR_HOME` 改变数据目录）。
鉴权：除 `GET /health` 外均需 `Authorization: Bearer <token>`（token 同样在 server.json）。
请求体：JSON，上限 1MB。
错误协议：`{ "error": { "code": "...", "message": "...", "details?": ... } }`；状态码映射见 ADR-0004。

| 方法 | 路径                                  | 请求体                                                                                                    | 成功响应                                      | 说明                                                     |
| ---- | ------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------- |
| GET  | /health                               | —                                                                                                         | 200 `{service,version,status}`                | 存活探测，无需鉴权                                       |
| POST | /api/projects                         | `{name, rootPath}`                                                                                        | 201 Project                                   | 按 rootPath 幂等                                         |
| POST | /api/tasks                            | `{projectId, title, goal?}`                                                                               | 201 Task                                      | 状态 active                                              |
| POST | /api/tasks/:id/finish                 | —                                                                                                         | 201 Task                                      | active→completed                                         |
| POST | /api/decisions                        | `{taskId, question, title, chosenOption, alternatives?, decidedBy, declaredClaims(min 1)}`                | 201 `{decision, claims}`                      | **编码前声明**；declaredAt 由服务端盖章                  |
| POST | /api/decisions/:id/implement          | —                                                                                                         | 201 Decision                                  | declared→implemented                                     |
| POST | /api/decisions/:id/observations       | `{decisionId, claim{kind,statement}, evidence{kind,verdict,producedBy?,contentRef,summary?,producedAt?}}` | 201 `{claim, evidence}`                       | observed 主张 + 证据；pass→supported / fail→refuted      |
| POST | /api/decisions/:id/rationalizations   | `{decisionId, kind, statement}`                                                                           | 201 Claim                                     | 事后推断，永不升级为 declared                            |
| POST | /api/decisions/:id/verify             | —                                                                                                         | 201 `{decision, integrity}`                   | 完整性（R1–R5，按假定 verified 状态评估）通过才升级      |
| GET  | /api/decisions/:id                    | —                                                                                                         | 200 `{decision, claims, evidence, integrity}` | 决策全貌 + 即时完整性                                    |
| GET  | /api/tasks/:id/decisions              | —                                                                                                         | 200 Decision[]                                | 任务下决策列表                                           |
| POST | /api/decisions/:id/anchors            | `{filePath, symbolPath[], symbolKind?, origin}`                                                           | 201 CodeAnchor                                | 阶段 3：符号必须唯一可解析，否则 404/409，绝不凭空造符号 |
| GET  | /api/decisions/:id/anchors            | —                                                                                                         | 200 CodeAnchor[]                              | 决策的锚点列表（含 missing/ambiguous）                   |
| GET  | /api/symbols/lookup?filePath=&symbol= | —                                                                                                         | 200 `{matches:[{anchor,decision}]}`           | 反向查询：符号 → 决策                                    |
| GET  | /api/projects/lookup?rootPath=        | —                                                                                                         | 200 Project / 404                             | 阶段 4：扩展工作区识别（未注册不算错误）                 |
| GET  | /api/projects/:id/tasks               | —                                                                                                         | 200 Task[]                                    | 阶段 4：决策树第二层                                     |
| GET  | /api/projects/:id/anchors             | —                                                                                                         | 200 CodeAnchor[]                              | 阶段 4：CodeLens 数据源                                  |
| POST | /api/projects/:id/anchors/revalidate  | —                                                                                                         | 201 `{head, results[]}`                       | 重验证：符号优先重定位；ambiguous/missing 显式标记       |
| POST | /api/decisions/:id/learning           | —                                                                                                         | 201 `{regenerated, session}`                  | 阶段 5：生成学习会话（幂等；answerKey 不下发）           |
| GET  | /api/decisions/:id/learning           | —                                                                                                         | 200 `{session}`                               | 阶段 5：学习会话视图（进度/级别推荐由作答派生）          |
| POST | /api/exercises/:id/attempts           | `{answer, level}`                                                                                         | 201 `{attempt, outcome, feedback}`            | 阶段 5：确定性评分并保存作答；反馈引用真实工程信息       |
| POST | /api/events                           | `{projectRoot, sessionId, agent, type, payload}`                                                          | 201 AgentEvent                                | 阶段 2：OpenCode 适配器事件入库（归属活跃任务，可空）    |
| GET  | /api/tasks/:id/events                 | —                                                                                                         | 200 AgentEvent[]                              | 阶段 2：任务事件列表                                     |
| GET  | /api/sessions/:id/events              | —                                                                                                         | 200 `{events: AgentEvent[]}`                  | 阶段 2：**按 session 查询**（PRD F3 验收原文）           |
| POST | /api/exercises/:id/attempts           | `{answer, level(1\|2\|3)}`                                                                                | 201 `{attempt, outcome, feedback}`            | 阶段 5：确定性评分并保存作答；反馈引用真实工程信息       |

错误码 → HTTP：`VALIDATION`/`INVALID_JSON`→400、`UNAUTHORIZED`→401、`NOT_FOUND`→404、`METHOD_NOT_ALLOWED`→405、`INVALID_STATE`→409（含符号歧义）、`CONFLICT`→409、`INTEGRITY_VIOLATION`→422、`PAYLOAD_TOO_LARGE`→413、`MAPPING_UNAVAILABLE`→503、`GIT_ERROR`→500、`INTERNAL`→500。

启动：`pnpm --filter @codementor/server start`（或 `node apps/server/dist/index.js`，需先构建）。环境变量：`CODEMENTOR_HOME`（数据目录，默认 `~/.codementor`）、`CODEMENTOR_PORT`（0=自动分配）。
