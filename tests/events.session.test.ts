import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CodeMentorStorage } from '@codementor/storage';
import { createCodementorPlugin } from '@codementor/opencode-adapter';
import { TestRepo } from '../packages/code-mapping/test/test-repo.js';

/**
 * M1 修复验证：事件可按 session 查询（PRD F3 验收原文
 * "会话/工具调用/测试事件入库且可按 session 查询"）。
 * 真实服务子进程 + 真实适配器提交 + 真实 HTTP 查询。
 */

let home: string;
let server: import('node:http').Server | undefined;
let base = '';
let headers: Record<string, string>;
let repo: TestRepo;
let storage: CodeMentorStorage;

beforeAll(async () => {
  home = mkdtempSync(path.join(tmpdir(), 'cm-session-'));
  repo = new TestRepo('cm-session-ws-');
  repo.write('src/a.c', 'void a(void) {}\n');
  repo.commit('init');
  storage = CodeMentorStorage.open(path.join(home, 'session.db'));
  const { startHttpServer } = await import('../apps/server/src/http.js');
  const { DecisionEngine } = await import('@codementor/decision-engine');
  const engine = new DecisionEngine(storage);
  const running = await startHttpServer({ engine, token: 'session-token' });
  server = running.server;
  base = `http://127.0.0.1:${running.port}`;
  headers = { authorization: 'Bearer session-token', 'content-type': 'application/json' };
  // server.json 指向进程内服务（适配器经它发现）
  writeFileSync(
    path.join(home, 'server.json'),
    JSON.stringify({ host: '127.0.0.1', port: running.port, token: 'session-token' }),
  );
  const project = (await (
    await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'session-demo', rootPath: repo.root }),
    })
  ).json()) as { id: string };
  await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ projectId: project.id, title: '会话查询任务' }),
  });
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

const SESSION_A = 'ses_aaa-111';
const SESSION_B = 'ses_bbb-222';

describe('M1：事件按 session 查询（PRD F3 验收原文）', () => {
  it('同一 session 的三类事件（会话/文件/工具）经适配器真实入库', async () => {
    const plugin = createCodementorPlugin({ coreHome: home, projectRoot: repo.root });
    await plugin.event({
      event: { type: 'session.created', properties: { sessionID: SESSION_A } },
    });
    await plugin.event({
      event: { type: 'file.edited', properties: { sessionID: SESSION_A, file: 'src/a.c' } },
    });
    await plugin.event({
      event: { type: 'tool.bash', properties: { sessionID: SESSION_A, command: 'ls' } },
    });
    // 另一个 session 的事件（用于验证过滤）
    await plugin.event({
      event: { type: 'message.updated', properties: { sessionID: SESSION_B } },
    });
  });

  it('按 session 查询：只返回该会话的事件且类型正确', async () => {
    const res = await fetch(`${base}/api/sessions/${SESSION_A}/events`, { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: Array<{ type: string; sessionId: string; taskId: string | null }>;
    };
    expect(body.events).toHaveLength(3);
    expect(body.events.every((e) => e.sessionId === SESSION_A)).toBe(true);
    expect(body.events.map((e) => e.type).sort()).toEqual([
      'file_edit',
      'session_start',
      'tool_call',
    ]);
    // 事件归属活跃任务
    expect(body.events.every((e) => e.taskId !== null)).toBe(true);
  });

  it('另一个 session 独立可查；不存在的 session 返回空数组', async () => {
    const b = await fetch(`${base}/api/sessions/${SESSION_B}/events`, { headers });
    expect(((await b.json()) as { events: unknown[] }).events).toHaveLength(1);

    const none = await fetch(`${base}/api/sessions/ses_none/events`, { headers });
    expect(none.status).toBe(200);
    expect(((await none.json()) as { events: unknown[] }).events).toHaveLength(0);
  });
});
