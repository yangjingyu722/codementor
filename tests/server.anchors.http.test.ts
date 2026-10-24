import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MappingService } from '@codementor/code-mapping';
import { DecisionEngine } from '@codementor/decision-engine';
import { CodeMentorStorage } from '@codementor/storage';
import { startHttpServer } from '../apps/server/src/http.js';
import { TestRepo } from '../packages/code-mapping/test/test-repo.js';

const TOKEN = 'anchor-test-token';

const PROC_H = 'struct pcb { int pid; };\n';
const PROC_C = 'void scheduler(void) { return; }\n';

let dir: string;
let repo: TestRepo;
let storage: CodeMentorStorage;
let server: import('node:http').Server;
let port: number;
let headers: Record<string, string>;
let decisionId: string;
let projectId: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'cm-anchorhttp-'));
  repo = new TestRepo('cm-anchorhttp-');
  repo.write('proc.h', PROC_H);
  repo.write('proc.c', PROC_C);
  repo.commit('init');

  storage = CodeMentorStorage.open(path.join(dir, 'anchor.db'));
  const engine = new DecisionEngine(storage);
  const mapping = new MappingService(storage);
  const project = engine.registerProject({ name: 'demo', rootPath: repo.root });
  projectId = project.id;
  const task = engine.startTask({ projectId: project.id, title: 't' });
  const declared = engine.declareDecision({
    taskId: task.id,
    question: 'q',
    title: 't',
    chosenOption: 'c',
    decidedBy: 'agent',
    declaredClaims: [{ kind: 'constraint', statement: 's' }],
  });
  decisionId = declared.decision.id;

  const running = await startHttpServer({ engine, mapping, token: TOKEN });
  server = running.server;
  port = running.port;
  headers = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` };
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeAllConnections();
  storage.close();
  repo.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

describe('锚点 HTTP 端点（真实回环连接 + 真实仓库）', () => {
  it('POST anchors 创建成功并返回精确定位', async () => {
    const base = `http://127.0.0.1:${port}`;
    const res = await fetch(`${base}/api/decisions/${decisionId}/anchors`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ filePath: 'proc.c', symbolPath: ['scheduler'], origin: 'declared' }),
    });
    expect(res.status).toBe(201);
    const anchor = (await res.json()) as {
      status: string;
      symbolKind: string;
      startLine: number;
    };
    expect(anchor).toMatchObject({ status: 'confirmed', symbolKind: 'function', startLine: 1 });
  });

  it('不存在的符号 → 404，而不是凭空创建', async () => {
    const base = `http://127.0.0.1:${port}`;
    const res = await fetch(`${base}/api/decisions/${decisionId}/anchors`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ filePath: 'proc.c', symbolPath: ['ghost'], origin: 'declared' }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('GET anchors 与 symbols/lookup 反向查询', async () => {
    const base = `http://127.0.0.1:${port}`;
    const list = await fetch(`${base}/api/decisions/${decisionId}/anchors`, { headers });
    expect(list.status).toBe(200);
    expect((await list.json()) as unknown[]).toHaveLength(1);

    const lookup = await fetch(`${base}/api/symbols/lookup?filePath=proc.c&symbol=scheduler`, {
      headers,
    });
    expect(lookup.status).toBe(200);
    const body = (await lookup.json()) as {
      matches: Array<{ decision: { id: string }; anchor: { symbolPath: string[] } }>;
    };
    expect(body.matches[0]!.decision.id).toBe(decisionId);
    expect(body.matches[0]!.anchor.symbolPath).toEqual(['scheduler']);
  });

  it('revalidate：修改 proc.c 后行号经 HTTP 触发重定位', async () => {
    const base = `http://127.0.0.1:${port}`;
    repo.write('proc.c', '// shift\n// shift\nvoid scheduler(void) { return; }\n');
    repo.commit('shift');

    const res = await fetch(`${base}/api/projects/${projectId}/anchors/revalidate`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      results: Array<{ status: string; relocated: boolean }>;
    };
    expect(body.results[0]).toMatchObject({ status: 'confirmed', relocated: true });

    const list = (await (
      await fetch(`${base}/api/decisions/${decisionId}/anchors`, { headers })
    ).json()) as Array<{ startLine: number }>;
    expect(list[0]!.startLine).toBe(3);
  });

  it('projects/lookup：按 rootPath 查找，未注册返回 404', async () => {
    const base = `http://127.0.0.1:${port}`;
    const encoded = encodeURIComponent(repo.root);
    const found = await fetch(`${base}/api/projects/lookup?rootPath=${encoded}`, { headers });
    expect(found.status).toBe(200);
    const project = (await found.json()) as { id: string; rootPath: string };
    expect(project.id).toBe(projectId);

    const missing = await fetch(
      `${base}/api/projects/lookup?rootPath=${encodeURIComponent('/definitely/absent')}`,
      { headers },
    );
    expect(missing.status).toBe(404);

    const bad = await fetch(`${base}/api/projects/lookup`, { headers });
    expect(bad.status).toBe(400);
  });

  it('projects/:id/tasks 与 projects/:id/anchors 列表端点', async () => {
    const base = `http://127.0.0.1:${port}`;
    const tasks = await fetch(`${base}/api/projects/${projectId}/tasks`, { headers });
    expect(tasks.status).toBe(200);
    const taskList = (await tasks.json()) as Array<{ id: string }>;
    expect(taskList.length).toBeGreaterThan(0);

    const anchors = await fetch(`${base}/api/projects/${projectId}/anchors`, { headers });
    expect(anchors.status).toBe(200);
    const anchorList = (await anchors.json()) as Array<{ decisionId: string; filePath: string }>;
    expect(anchorList.length).toBeGreaterThan(0);
    expect(anchorList.every((a) => a.decisionId === decisionId)).toBe(true);

    const missing = await fetch(`${base}/api/projects/proj_missing/tasks`, { headers });
    expect(missing.status).toBe(404);
  });
});
