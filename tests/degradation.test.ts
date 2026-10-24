import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CodeMentorStorage } from '@codementor/storage';
import { MappingService } from '@codementor/code-mapping';
import { createCodementorPlugin } from '@codementor/opencode-adapter';
import { TestRepo } from '../packages/code-mapping/test/test-repo.js';

/**
 * 阶段 2 降级机制测试：Agent 完全不调用 MCP 时的系统行为。
 * 红线：不得伪造事前设计决策；文件变化仍可形成观察记录（提案）。
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
let home: string;
let server: import('node:http').Server | undefined;
let base = '';
let headers: Record<string, string>;
let repo: TestRepo;
let storage: CodeMentorStorage;
let projectId = '';
let taskId = '';

beforeAll(async () => {
  home = mkdtempSync(path.join(tmpdir(), 'cm-degrade-'));
  repo = new TestRepo('cm-degrade-ws-');
  repo.write('src/main.c', 'int main(void) { return 0; }\n');
  repo.commit('init');
  storage = CodeMentorStorage.open(path.join(home, 'degrade.db'));
  const { startHttpServer } = await import('../apps/server/src/http.js');
  const { DecisionEngine } = await import('@codementor/decision-engine');
  const engine = new DecisionEngine(storage);
  const running = await startHttpServer({ engine, token: 'degrade-token' });
  server = running.server;
  base = `http://127.0.0.1:${running.port}`;
  headers = { authorization: 'Bearer degrade-token' };
  // 关键：server.json 指向进程内服务（适配器经它发现），不要再 spawn 第二个服务
  writeFileSync(
    path.join(home, 'server.json'),
    JSON.stringify({ host: '127.0.0.1', port: running.port, token: 'degrade-token' }),
  );

  const res = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'degrade', rootPath: repo.root }),
  });
  projectId = ((await res.json()) as { id: string }).id;
  const task = (await (
    await fetch(`${base}/api/tasks`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, title: '降级场景任务' }),
    })
  ).json()) as { id: string };
  taskId = task.id;
}, 30000);

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server?.closeAllConnections();
  storage?.close();
  repo?.cleanup();
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    // 尽力清理
  }
});

describe('降级机制：Agent 不调用 MCP（真实服务 + 真实仓库）', () => {
  it('红线：无法伪造事前声明——declaredClaims 为空被契约拒绝（400）', async () => {
    const res = await fetch(`${base}/api/decisions`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        taskId,
        question: 'q',
        title: 't',
        chosenOption: 'c',
        decidedBy: 'agent',
        declaredClaims: [],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('观察通道仍可用：文件变化 → 锚点提案（observed 分析不依赖 MCP）', async () => {
    repo.write('src/util.c', 'int helper(void) { return 1; }\n');
    const newRev = repo.commit('add helper');
    const mapping = new MappingService(storage);
    const { proposals } = await mapping.proposeAnchors({
      taskId,
      oldRev: repo.rev(1),
      newRev,
    });
    expect(proposals.map((p) => p.symbol.name)).toContain('helper');
    // 提案不落库：决策列表仍然为空
    const decisions = (await (
      await fetch(`${base}/api/tasks/${taskId}/decisions`, { headers })
    ).json()) as unknown[];
    expect(decisions).toHaveLength(0);
  });

  it('事后分析只能标记 rationalized（OpenCode 适配器事件照常入库）', async () => {
    const plugin = createCodementorPlugin({ coreHome: home, projectRoot: repo.root });
    await plugin.event({
      event: { type: 'file.edited', properties: { sessionID: 'ses_d', file: 'src/util.c' } },
    });
    const events = (await (
      await fetch(`${base}/api/tasks/${taskId}/events`, { headers })
    ).json()) as Array<{ type: string }>;
    expect(events.map((e) => e.type)).toContain('file_edit');
    void projectId;
    void storage;
  });
});
