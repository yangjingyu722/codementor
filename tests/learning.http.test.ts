import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LearningEngine } from '@codementor/learning-engine';
import { DecisionEngine } from '@codementor/decision-engine';
import { CodeMentorStorage } from '@codementor/storage';
import { startHttpServer } from '../apps/server/src/http.js';

const TOKEN = 'learning-test-token';

let dir: string;
let storage: CodeMentorStorage;
let server: import('node:http').Server;
let port: number;
let headers: Record<string, string>;
let decisionId: string;
let exerciseIds: string[] = [];

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'cm-learnhttp-'));
  storage = CodeMentorStorage.open(path.join(dir, 'learn.db'));
  const engine = new DecisionEngine(storage);
  const learning = new LearningEngine(storage);
  const project = engine.registerProject({ name: 'demo', rootPath: '/repo/demo' });
  const task = engine.startTask({ projectId: project.id, title: '实现缓冲策略' });
  const declared = engine.declareDecision({
    taskId: task.id,
    question: '日志缓冲为何用环形缓冲而不是无限队列',
    title: '环形日志缓冲',
    chosenOption: '固定大小环形缓冲',
    alternatives: [{ name: '无限队列', summary: '实现最简单但内存不可控' }],
    decidedBy: 'agent',
    declaredClaims: [{ kind: 'constraint', statement: '嵌入式设备内存有限，缓冲必须固定大小' }],
  });
  decisionId = declared.decision.id;

  const running = await startHttpServer({ engine, learning, token: TOKEN });
  server = running.server;
  port = running.port;
  headers = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` };
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeAllConnections();
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('学习 HTTP 端点（真实回环连接）', () => {
  it('POST learning 生成会话：含三类练习且 answerKey 已剥离', async () => {
    const base = `http://127.0.0.1:${port}`;
    const res = await fetch(`${base}/api/decisions/${decisionId}/learning`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      regenerated: boolean;
      session: {
        exercises: Array<{
          id: string;
          type: string;
          answerKey?: unknown;
          attempts: unknown[];
        }>;
        explanation: string;
      };
    };
    expect(body.regenerated).toBe(true);
    expect(body.session.exercises).toHaveLength(2); // 无锚点：predict + transfer
    exerciseIds = body.session.exercises.map((e) => e.id);
    expect(body.session.exercises.every((e) => e.answerKey === undefined)).toBe(true);
    expect(body.session.explanation).toContain('嵌入式设备内存有限');
    expect(body.session.exercises.find((e) => e.type === 'locate_code')).toBeUndefined();
  });

  it('重复 POST 幂等；GET 会话恢复相同状态', async () => {
    const base = `http://127.0.0.1:${port}`;
    const again = await fetch(`${base}/api/decisions/${decisionId}/learning`, {
      method: 'POST',
      headers,
    });
    const body = (await again.json()) as { regenerated: boolean };
    expect(body.regenerated).toBe(false);

    const got = await fetch(`${base}/api/decisions/${decisionId}/learning`, { headers });
    expect(got.status).toBe(200);
    const wrapped = (await got.json()) as { session: { exercises: Array<{ id: string }> } };
    expect(wrapped.session.exercises.map((e) => e.id)).toEqual(exerciseIds);
  });

  it('POST attempts：错误答案 → fail 反馈引用真实方案；进度出现在会话中', async () => {
    const base = `http://127.0.0.1:${port}`;
    const mcqId = exerciseIds[0]!;
    const res = await fetch(`${base}/api/exercises/${mcqId}/attempts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ answer: '无限队列', level: 1 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { outcome: string; feedback: string };
    expect(body.outcome).toBe('fail');
    expect(body.feedback).toContain('固定大小环形缓冲');

    const got = await fetch(`${base}/api/decisions/${decisionId}/learning`, { headers });
    const session = (
      (await got.json()) as {
        session: {
          exercises: Array<{ id: string; attempts: Array<{ outcome: string; level: number }> }>;
          recommendedLevel: number;
        };
      }
    ).session;
    const mcq = session.exercises.find((e) => e.id === mcqId)!;
    expect(mcq.attempts).toHaveLength(1);
    expect(mcq.attempts[0]!.outcome).toBe('fail');
    expect(mcq.attempts[0]!.level).toBe(1);
    expect(session.recommendedLevel).toBe(1);
  });

  it('非法载荷 → 400；不存在的决策/练习 → 404', async () => {
    const base = `http://127.0.0.1:${port}`;
    const bad = await fetch(`${base}/api/exercises/${exerciseIds[0]}/attempts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ answer: '', level: 9 }),
    });
    expect(bad.status).toBe(400);

    const missingDecision = await fetch(`${base}/api/decisions/dec_x/learning`, {
      method: 'POST',
      headers,
    });
    expect(missingDecision.status).toBe(404);

    const missingExercise = await fetch(`${base}/api/exercises/ex_x/attempts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ answer: 'a', level: 1 }),
    });
    expect(missingExercise.status).toBe(404);
  });

  it('学习失败不影响既有决策 API（不阻塞开发流程）', async () => {
    const base = `http://127.0.0.1:${port}`;
    const bundle = await fetch(`${base}/api/decisions/${decisionId}`, { headers });
    expect(bundle.status).toBe(200);
    const body = (await bundle.json()) as {
      decision: { status: string };
      integrity: { ok: boolean };
    };
    expect(body.decision.status).toBe('declared');
    expect(body.integrity.ok).toBe(true);
  });
});
