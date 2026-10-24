# ADR-0003：存储采用 better-sqlite3 + 版本化 SQL 迁移

- 状态：已接受（阶段 1）
- 日期：2026-10-24
- 影响：packages/storage、apps/server、CI（原生模块编译）

## 背景

CodeMentor 需要一个单机、零运维、可随仓库演进的结构化存储。总控指令已定 SQLite，需要决定具体驱动与迁移策略。

## 决策

1. 驱动选 **better-sqlite3**（同步 API 的原生绑定）。
2. 迁移采用 **内置 SQL 清单 + `migrations` 登记表**：迁移以 `(id, name, up)` 数组固化在代码里，按序在事务中执行并登记；`PRAGMA user_version` 记录水位。
3. 每个阶段只为其真正需要的实体建表（阶段 1：projects/tasks/decisions/claims/evidence 五表），不预建占位表。

## 理由

- **同步 API 匹配单用户本地服务**：CodeMentor 是单用户、本机、低并发的进程，同步调用消除了异步竞态面，事务边界（如"决策+主张同生共死"）可以用一行 `db.transaction` 表达并测试。
- **成熟度与类型**：better-sqlite3 是 Node 生态最成熟的 SQLite 绑定之一，带官方预编译二进制（Windows/macOS/Linux 主流 Node 版本），配 `@types/better-sqlite3` 可在 Strict TS 下使用。已在目标环境（Windows + Node 24）实际探测通过后再引入。
- **读路径契约校验**：行数据出库即过 `@codementor/contracts` 的 Zod schema，存储损坏在读取边界暴露（有测试覆盖外部篡改场景）。

## 备选方案

- **`node:sqlite`（Node 内置）**：零依赖，但 22.5 才引入且标记实验性，而项目基线要求 Node ≥ 20、CI 用 Node 20——直接排除；且 API 变动风险高于社区维护的 better-sqlite3。
- **sql.js（WASM）**：无原生编译，但纯内存、持久化要手工导出文件，事务与并发语义都要自己搭，不适合作为长期地基。
- **Drizzle/Prisma 等 ORM**：v0.1 的查询面很小（按任务/项目取决策），ORM 引入的抽象层与生成物远超收益；在 SQL 之上保留直接迁移的掌控力更重要。

## 后果与风险

- 原生模块依赖预编译二进制：Node 大版本升级时若预编译缺失会触发 node-gyp 编译（Windows 需 VS Build Tools）。缓解：CI 固定 Node 20 LTS + 锁定 better-sqlite3 大版本；本机开发已验证 Node 24 可用。
- 迁移不可变约定：已发布的迁移条目永不修改，只追加（与 migrations 登记表配合保证幂等）。
