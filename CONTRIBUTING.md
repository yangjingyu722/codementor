# 贡献指南

感谢你考虑为 CodeMentor 做贡献。

## 开发环境

- Node.js ≥ 20
- pnpm 8（仓库通过 `package.json` 的 `packageManager` 字段钉住版本，corepack 用户无需手动安装）

```bash
git clone <repo-url>
cd codementor
pnpm install
pnpm verify   # typecheck + lint + format:check + test + build
```

提交前请确保 `pnpm verify` 本地全绿；CI 会执行完全相同的链路。

## 提交规范

- 使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：`feat: ...`、`fix: ...`、`docs: ...`、`test: ...`、`refactor: ...`、`chore: ...`。
- 一个提交做一件事；跨包的契约变更与其消费方更新放在同一提交。

## 代码要求

- TypeScript Strict Mode；公共接口必须有明确类型。
- 外部输入（Agent 载荷、文件、用户操作）必须经过 `@codementor/contracts` 的 Zod 校验，禁止手工断言。
- 核心业务逻辑不得依赖 VS Code API 或任何 Agent 厂商 SDK（隔离在 `apps/vscode` 与各 Adapter 中）。
- 测试覆盖核心正常流程与关键异常情况；集成测试必须使用真实进程/文件，不得用 Mock 冒充。
- 格式化与静态检查以仓库配置为准，不引入个人风格配置。

## 架构变更

影响模块边界、数据契约或外部协议的改动，请先阅读 [docs/decisions/](docs/decisions/) 中的相关 ADR，并随 PR 附带新的或修订的 ADR。

## 报告问题

Issue 请包含：复现步骤、期望行为、实际行为、环境（OS / Node / pnpm / Agent 及版本）。安全问题请勿公开 Issue，参见仓库的安全披露说明（发布时提供）。

## 许可

提交即表示你同意以 [MIT](LICENSE) 许可你的贡献。
