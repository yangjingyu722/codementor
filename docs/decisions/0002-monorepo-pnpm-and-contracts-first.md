# ADR-0002：Monorepo（pnpm workspace）与契约优先的包结构

- 状态：已接受（阶段 0）
- 日期：2026-10-24
- 影响：仓库布局、CI、发布流程

## 背景

CodeMentor 天然是多交付物项目：一个 VS Code 扩展、一个本地服务、若干可复用引擎与一个共享数据契约。需要决定仓库组织与包边界。

## 决策

1. **单一 Monorepo，pnpm workspace 管理**，目录：`apps/*`（有独立运行形态的交付物）与 `packages/*`（被依赖的库）。
2. **契约优先**：`packages/contracts` 是唯一共享内核（Zod schema + 完整性规则），所有模块依赖它、且只依赖它做跨模块数据交换。
3. 引擎类包（storage / engines）在其所属阶段创建，不预先占位。

## 理由：为什么是 Monorepo 而不是多仓库

1. **原子化跨包变更**：修改契约字段必然同时影响服务、适配器与扩展。Monorepo 里这是一次提交 + 一次 CI；多仓库则是一次版本发布 + N 个升级 PR，v0.x 阶段这种耦合变更每周都会发生。
2. **单一质量门**：一套 lint/typecheck/test 配置对全部代码生效，CI 一次跑完（本仓库 `.github/workflows/ci.yml`），不存在"某个子仓库忘了升级 TypeScript"的漂移。
3. **依赖去重与幽灵依赖防护**：pnpm workspace 用符号链接提供严格的依赖边界——`apps/vscode` 无法悄悄 import 只在 `apps/server` 声明的依赖。
4. **代码体量匹配**：核心代码（不含生成的 lockfile）在可预见的未来是万行级，多仓库的管理成本远超收益。

代价：仓库克隆体积稍大、CI 需要按包做增量（v0.1 规模下无必要，阶段 6 再评估）。

## 理由：为什么契约独立成包而不是放进服务里

1. **编译期依赖即文档**：`import type { Decision } from '@codementor/contracts'` 让每个模块的消费关系显式化。
2. **测试锚点**：契约规则（完整性校验）独立于任何运行时，可在根级集成测试（`tests/`）中直接验证，无需启动服务。
3. **防止上行依赖**：契约包零业务依赖（仅 zod），任何层都可以安全依赖它；若契约住在服务里，扩展就得依赖整个服务代码树。

## 备选方案

- **Turborepo/Nx**：收益在包数量 ≥10 且有远程缓存需求时才显现；v0.1 引入是过度设计。
- **npm/yarn workspace**：pnpm 的硬符号链接边界与磁盘效率更适合本项目的多交付物形态。

## 后果

- 根脚本（`typecheck/lint/format:check/test/build`）是唯一的质量入口，CI 与本地完全一致。
- 新包必须在 `pnpm-workspace.yaml` 覆盖的目录下创建，且必须携带 `build`/`typecheck` 脚本，否则 `pnpm -r` 链路会漏检（CI 失败可暴露）。
