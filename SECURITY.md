# Security Policy / 安全策略

## Supported Versions / 支持版本

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |

## Reporting a Vulnerability / 报告漏洞

**中文**：请勿通过公开 Issue 报告安全漏洞。请在 GitHub 上使用 [Private vulnerability reporting](https://github.com/yangjingyu722/codementor/security/advisories/new) 私密报告，或在 Issue 中申请私下联系方式。我们会在 7 天内确认，并在修复发布后致谢（可选）。

**English**: Please do not report security vulnerabilities through public GitHub issues. Use [Private vulnerability reporting](https://github.com/yangjingyu722/codementor/security/advisories/new) instead. We aim to acknowledge within 7 days and will credit reporters (opt-in) after the fix ships.

## Security Model / 安全模型

CodeMentor 是**本地优先**（local-first）工具。v0.1.0 的信任边界：

1. **零网络依赖、零遥测**：核心功能不发起任何外部网络请求；用户代码、会话与学习数据全部保存在本机数据目录（默认 `~/.codementor`）。卸载即删除数据目录即可完全清除。
2. **本地传输**：核心服务仅绑定 `127.0.0.1`，不提供任何远程监听配置。所有 API（除存活探测 `GET /health`）要求 `Authorization: Bearer <token>`（启动时随机 256-bit，timing-safe 比较）。
3. **服务发现文件**：`<CODEMENTOR_HOME>/server.json` 包含端口与**明文 token**，服务退出时删除。它仅对本机当前用户可读——威胁模型限定为"同用户本机进程"，与 Docker desktop socket、VS Code server 等本地开发工具同级。请不要把数据目录放入多用户可写位置。
4. **扩展权限**：VS Code 扩展是纯视图层，零运行时 npm 依赖，仅通过本机 HTTP 与核心服务通信。

## Known Considerations / 已知考量

- **依赖审计**：`pnpm audit --prod` 在 v0.1.0 发布时为 0 已知漏洞。devDependencies（构建/测试工具链）存在传递依赖告警，不进入运行时与发布物（扩展 vsix 12 文件、22.65 KB、零运行时 npm 依赖）；我们在每次发布前重新审计。
- **原生模块**：better-sqlite3 与 tree-sitter 以精确版本钉住（ABI 配对），升级需按 ADR-0003/0005 的探针流程验证。
- **Agent 数据可信性**：CodeMentor 的设计目标之一就是区分"事前声明 / 机器观察 / 事后推断"。完整性规则（docs/CONTRACTS.md R1–R5）与 `gradedBy` 评分来源标注是本项目的安全属性之一，变更需经架构评审（ADR 流程）。

## Scope / 范围

v0.1.0 不包含：多用户、云同步、远端 API、鉴权用户体系。若你将其暴露到网络（自行修改监听地址），即超出本安全模型的保障范围。
