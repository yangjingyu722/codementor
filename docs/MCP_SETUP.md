# MCP 接入指南（OpenCode / Codex / 通用客户端）

前置：核心服务已构建（`pnpm build`）并运行（`pnpm --filter @codementor/server start`）。MCP 进程通过 `~/.codementor/server.json` 自动发现端口与 token。

## MCP Server 入口

```
node <仓库根>/packages/mcp/dist/main.js
```

提供 5 个工具：`mentor_start_task` / `mentor_record_decision` / `mentor_record_verification` / `mentor_finish_task` / `mentor_get_context`。

## OpenCode

1. 在项目（或全局 `~/.config/opencode/`）创建 `.opencode/plugins/codementor.mjs`。
   把下方的 `<repo-root>` 替换为你的 codementor 克隆根目录；`file:` URL 必须用正斜杠
   （Windows 形如 `file:///C:/tools/codementor/...`）：

```js
import { createCodementorPlugin } from 'file:///<repo-root>/packages/opencode-adapter/dist/index.js';

export const Codementor = createCodementorPlugin({
  projectRoot: import.meta.dirname, // 仓库根目录（按需调整）
});
```

2. 在项目创建 `opencode.json`，注册 MCP（正斜杠在 Windows 上同样有效）：

```json
{
  "mcp": {
    "codementor": {
      "type": "local",
      "command": ["node", "<repo-root>/packages/mcp/dist/main.js"],
      "enabled": true
    }
  }
}
```

3. 提示词要求 Agent：实现前调用 `mentor_record_decision` 声明决策，完成后调用 `mentor_record_verification` 登记验证证据。

## Codex CLI / 其他 MCP 客户端

在 MCP 配置中注册同一命令（`type: local` / stdio）。工具 Schema 严格（additionalProperties:false），核心服务二次校验。

## 手动登记（无 Agent）

```bash
node tools/record-decision.mjs            # 交互式问答
node tools/record-decision.mjs --repo <仓库> --task "任务" --question "..." \
  --title "..." --chosen "..." --claim "constraint|理由" --anchor "src/main.c|main"
```

## 降级语义

Agent 完全不调用 MCP：系统不会创建任何"事前决策"（空声明被契约拒绝，无伪装路径）；
文件变化仍会形成锚点**提案**；事后分析只能走 rationalized 主张（UI 明确标注）。
