# ADR-0004：核心服务传输采用回环 HTTP + Bearer token + server.json 发现文件

- 状态：已接受（阶段 1）
- 日期：2026-10-24
- 影响：apps/server、阶段 2 的 MCP 适配器、阶段 4 的 VS Code 扩展

## 背景

ADR-0001 把业务逻辑放进独立的本地核心服务进程。随之而来的问题：VS Code 扩展（阶段 4）、MCP 适配器（阶段 2）、未来可能的 CLI 如何与该进程通信？

## 决策

1. **传输**：`node:http` 实现的 JSON over HTTP，只绑定 `127.0.0.1`，零第三方框架。
2. **鉴权**：启动时生成 256 位随机 token；除 `GET /health` 外全部要求 `Authorization: Bearer <token>`（timing-safe 比较）。回环地址保证只有本机进程可达，token 防御本机其他用户态进程的误用。
3. **服务发现**：端口（默认 0 = 系统分配）与 token 写入 `<CODEMENTOR_HOME>/server.json`（含 pid/startedAt），客户端（MCP 适配器、扩展）读该文件完成握手；优雅退出时删除该文件。
4. **错误协议**：统一 `{ error: { code, message, details? } }`，引擎错误码映射 HTTP 状态（NOT_FOUND→404、VALIDATION→400、INVALID_STATE→409、INTEGRITY_VIOLATION→422）。

## 理由

- **双客户端形态**：MCP 适配器是独立进程（被 Agent 拉起），VS Code 扩展在扩展宿主内——两者都能说 HTTP，而 IPC/stdio 只适合一对一父子进程。
- **跨平台**：Unix domain socket 不存在于 Windows；named pipe 跨平台语义复杂。回环 TCP 三平台行为一致且可用 `fetch`/`curl` 调试。
- **零框架**：路由面很小（11 条），`node:http` + Zod 校验足够，避免为 6 个端点引入框架依赖；请求体上限（1MB）、Content-Length 预检、溢出排水等安全细节已在实现与测试中覆盖。
- **server.json 而非固定端口**：避免端口冲突与竞态；文件在数据目录内，与数据库同生命周期。

## 备选方案

- **stdio/IPC（扩展直连服务）**：要求服务作为扩展子进程存在，Agent 无扩展时（headless）无法接入，违背 ADR-0001 的进程隔离目标。
- **固定端口 + 无鉴权**：端口冲突风险 + 本机任意进程可写入用户工程认知数据，不可接受。
- **gRPC**：跨语言收益在本项目不存在（全 TS），代价是代码生成链路。

## 后果与风险

- token 以明文存在数据目录——威胁模型限定为"同用户本机进程"，与业界本地服务（如 Docker desktop socket、VS Code server）一致；文档明示。
- 端口由系统分配意味着客户端必须能读到 `CODEMENTOR_HOME`（同一用户环境）——MCP 适配器与扩展默认同环境，满足。
