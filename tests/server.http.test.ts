import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DecisionEngine } from '@codementor/decision-engine';
import { CodeMentorStorage } from '@codementor/storage';
import { startHttpServer } from '../apps/server/src/http.js';

const TOKEN = 'test-token';

let dir: string;
let storage: CodeMentorStorage;
let port: number;
let server: import('node:http').Server;
let baseUrl: string;
let authHeaders: Record<string, string>;
const sharedIds: { taskId: string; decisionId: string } = { taskId: '', decisionId: '' };

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'cm-http-'));
  storage = CodeMentorStorage.open(path.join(dir, 'http.db'));
  const engine = new DecisionEngine(storage);
  const running = await startHttpServer({ engine, token: TOKEN });
  server = running.server;
  port = running.port;
  baseUrl = `http://127.0.0.1:${port}`;
  authHeaders = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` };
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeAllConnections();
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('本地核心服务 HTTP（真实回环连接）', () => {
  it('health 无需鉴权即可访问', async () => {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { service: string; status: string };
    expect(body.service).toBe('codementor-core');
    expect(body.status).toBe('ok');
  });

  it('API 缺少或错误 token → 401', async () => {
    const none = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', rootPath: '/x' }),
    });
    expect(none.status).toBe(401);

    const bad = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
      body: JSON.stringify({ name: 'x', rootPath: '/x' }),
    });
    expect(bad.status).toBe(401);
  });

  it('完整工作流：项目 → 任务 → 声明 → 观察 → 实现 → 验证 → 读取', async () => {
    const projectRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'demo', rootPath: '/repo/demo' }),
    });
    expect(projectRes.status).toBe(201);
    const project = (await projectRes.json()) as { id: string };

    const taskRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        projectId: project.id,
        title: '添加配置模块',
        goal: '尽早暴露坏配置',
      }),
    });
    expect(taskRes.status).toBe(201);
    const task = (await taskRes.json()) as { id: string; status: string };
    expect(task.status).toBe('active');

    const decisionRes = await fetch(`${baseUrl}/api/decisions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        taskId: task.id,
        question: '配置校验时机',
        title: '启动时全量校验',
        chosenOption: 'Zod fail-fast',
        alternatives: [{ name: '惰性校验', summary: '首次读取时校验' }],
        decidedBy: 'agent',
        declaredClaims: [{ kind: 'constraint', statement: '坏配置必须启动即失败' }],
      }),
    });
    expect(decisionRes.status).toBe(201);
    const declared = (await decisionRes.json()) as {
      decision: { id: string; status: string; declaredAt: string };
      claims: Array<{ origin: string }>;
    };
    expect(declared.decision.status).toBe('declared');
    expect(declared.decision.declaredAt).toBeTruthy();
    expect(declared.claims.map((c) => c.origin)).toEqual(['declared']);
    sharedIds.decisionId = declared.decision.id;

    // verify 前置观察
    const obsRes = await fetch(`${baseUrl}/api/decisions/${declared.decision.id}/observations`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        decisionId: declared.decision.id,
        claim: { kind: 'benefit', statement: '缺失配置时启动即失败' },
        evidence: { kind: 'test_run', verdict: 'pass', contentRef: 'objects/evd.json' },
      }),
    });
    expect(obsRes.status).toBe(201);
    const observed = (await obsRes.json()) as { claim: { verification: string } };
    expect(observed.claim.verification).toBe('supported');

    const implRes = await fetch(`${baseUrl}/api/decisions/${declared.decision.id}/implement`, {
      method: 'POST',
      headers: authHeaders,
    });
    expect(implRes.status).toBe(201);

    const verifyRes = await fetch(`${baseUrl}/api/decisions/${declared.decision.id}/verify`, {
      method: 'POST',
      headers: authHeaders,
    });
    expect(verifyRes.status).toBe(201);
    const verified = (await verifyRes.json()) as { decision: { status: string } };
    expect(verified.decision.status).toBe('verified');

    const bundleRes = await fetch(`${baseUrl}/api/decisions/${declared.decision.id}`, {
      headers: authHeaders,
    });
    expect(bundleRes.status).toBe(200);
    const bundle = (await bundleRes.json()) as {
      decision: { status: string };
      claims: unknown[];
      evidence: unknown[];
      integrity: { ok: boolean };
    };
    expect(bundle.decision.status).toBe('verified');
    expect(bundle.claims).toHaveLength(2);
    expect(bundle.evidence).toHaveLength(1);
    expect(bundle.integrity.ok).toBe(true);

    const finishRes = await fetch(`${baseUrl}/api/tasks/${task.id}/finish`, {
      method: 'POST',
      headers: authHeaders,
    });
    expect(finishRes.status).toBe(201);
  });

  it('非法输入 → 400 VALIDATION（Zod issues 透传）', async () => {
    const res = await fetch(`${baseUrl}/api/decisions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ taskId: 't', question: '', decidedBy: 'nope' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION');
  });

  it('完整性不满足 → 422 INTEGRITY_VIOLATION', async () => {
    const project = (await (
      await fetch(`${baseUrl}/api/projects`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ name: 'p2', rootPath: '/repo/p2' }),
      })
    ).json()) as { id: string };
    const task = (await (
      await fetch(`${baseUrl}/api/tasks`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ projectId: project.id, title: 't2' }),
      })
    ).json()) as { id: string };
    const declared = (await (
      await fetch(`${baseUrl}/api/decisions`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          taskId: task.id,
          question: 'q',
          title: 't',
          chosenOption: 'c',
          decidedBy: 'human',
          declaredClaims: [{ kind: 'risk', statement: 's' }],
        }),
      })
    ).json()) as { decision: { id: string } };

    const res = await fetch(`${baseUrl}/api/decisions/${declared.decision.id}/verify`, {
      method: 'POST',
      headers: authHeaders,
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: { code: string; details: Array<{ code: string }> };
    };
    expect(body.error.code).toBe('INTEGRITY_VIOLATION');
    expect(body.error.details.map((d) => d.code)).toContain(
      'verified-without-supported-observation',
    );
  });

  it('未知路由 404；错误方法 405；超限请求体 413', async () => {
    const notFound = await fetch(`${baseUrl}/api/nothing`, { headers: authHeaders });
    expect(notFound.status).toBe(404);

    const wrongMethod = await fetch(`${baseUrl}/health`, { method: 'POST' });
    expect(wrongMethod.status).toBe(405);

    const big = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'x', rootPath: '/x', pad: 'a'.repeat(1024 * 1024 + 10) }),
    });
    expect(big.status).toBe(413);
  });

  it('HTTP 写入对独立引擎实例可见（跨连接真实持久化）', async () => {
    // 在同一 db 文件上另开一个引擎（独立连接），读取上面工作流验证过的决策
    const otherStorage = CodeMentorStorage.open(path.join(dir, 'http.db'));
    const other = new DecisionEngine(otherStorage);
    const bundle = other.getDecisionBundle(sharedIds.decisionId);
    expect(bundle.decision.status).toBe('verified');
    expect(bundle.integrity.ok).toBe(true);
    otherStorage.close();
  });
});
