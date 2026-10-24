import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCodementorPlugin,
  mapEventType,
  normalizeOpenCodeEvent,
} from '@codementor/opencode-adapter';
import { spawn } from 'node:child_process';

const serverEntry = fileURLToPath(new URL('../../../apps/server/dist/index.js', import.meta.url));

let home: string;
let server: ReturnType<typeof spawn> | undefined;
let base = '';
let token = '';
let repo: { root: string; cleanup: () => void };

beforeAll(async () => {
  home = mkdtempSync(path.join(tmpdir(), 'cm-adapter-'));
  const { TestRepo } = await import('../../../packages/code-mapping/test/test-repo.js');
  const r = new TestRepo('cm-adapter-ws-');
  r.write('src/a.c', 'void a(void) {}\n');
  r.commit('init');
  repo = { root: r.root, cleanup: () => r.cleanup() };
  server = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, CODEMENTOR_HOME: home },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const stateFile = path.join(home, 'server.json');
  const deadline = Date.now() + 15000;
  while (!existsSync(stateFile)) {
    if (Date.now() > deadline) throw new Error('server.json 未出现');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const state = JSON.parse(readFileSync(stateFile, 'utf8')) as { port: number; token: string };
  base = `http://127.0.0.1:${state.port}`;
  token = state.token;
  // 注册项目 + 活跃任务（事件归属目标）
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  const project = (await (
    await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'adapter-demo', rootPath: repo.root }),
    })
  ).json()) as { id: string };
  await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ projectId: project.id, title: '适配器任务' }),
  });
}, 30000);

afterAll(async () => {
  if (server !== undefined && server.exitCode === null) {
    server.kill();
    await Promise.race([
      new Promise<void>((resolve) => server!.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
  }
  repo?.cleanup();
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    // 尽力清理
  }
});

describe('OpenCode 事件归一化', () => {
  it('显式映射：file/session/tool/test/message → 对应类型', () => {
    expect(mapEventType('file.edited')).toBe('file_edit');
    expect(mapEventType('session.created')).toBe('session_start');
    expect(mapEventType('session.deleted')).toBe('session_end');
    expect(mapEventType('tool.bash')).toBe('tool_call');
    expect(mapEventType('test.run')).toBe('test_run');
    expect(mapEventType('message.updated')).toBe('message');
    expect(mapEventType('totally.unknown')).toBe('other');
  });

  it('normalize：提取 sessionID、净化敏感键、透传最小 payload', () => {
    const n = normalizeOpenCodeEvent({
      type: 'file.edited',
      properties: {
        sessionID: 'ses_123',
        file: 'src/a.c',
        apikey: 'SHOULD_BE_REDACTED',
        nested: { deep: 'object' },
      },
    });
    expect(n.agent).toBe('opencode');
    expect(n.type).toBe('file_edit');
    expect(n.sessionId).toBe('ses_123');
    expect(n.payload['apikey']).toBe('[redacted]');
    expect(n.payload['file']).toBe('src/a.c');
    expect(n.payload['nested']).toBeUndefined(); // 嵌套对象不透传
  });
});

describe('插件处理器（真实核心服务）', () => {
  it('事件经处理器提交并归属活跃任务', async () => {
    const plugin = createCodementorPlugin({ coreHome: home, projectRoot: repo.root });
    await plugin.event({
      event: { type: 'file.edited', properties: { sessionID: 'ses_x', file: 'src/a.c' } },
    });
    await plugin.event({
      event: { type: 'session.created', properties: { sessionID: 'ses_x' } },
    });

    const state = JSON.parse(readFileSync(path.join(home, 'server.json'), 'utf8')) as {
      port: number;
      token: string;
    };
    const headers = { authorization: `Bearer ${state.token}` };
    const project = (await (
      await fetch(`${base}/api/projects/lookup?rootPath=${encodeURIComponent(repo.root)}`, {
        headers,
      })
    ).json()) as { id: string };
    const tasks = (await (
      await fetch(`${base}/api/projects/${project.id}/tasks`, { headers })
    ).json()) as Array<{ id: string }>;
    const events = (await (
      await fetch(`${base}/api/tasks/${tasks[0]!.id}/events`, { headers })
    ).json()) as Array<{ type: string; sessionId: string; taskId: string | null }>;
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.type).sort()).toEqual(['file_edit', 'session_start']);
    expect(events.every((e) => e.taskId === tasks[0]!.id)).toBe(true);
  });

  it('降级：服务未运行时处理器静默返回，不阻塞 Agent', async () => {
    const plugin = createCodementorPlugin({
      coreHome: path.join(tmpdir(), 'cm-no-such-home'),
      projectRoot: repo.root,
    });
    await expect(
      plugin.event({ event: { type: 'file.edited', properties: { file: 'x.c' } } }),
    ).resolves.toBeUndefined();
  });
});
