import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LearningEngine } from '@codementor/learning-engine';
import { DecisionEngine } from '@codementor/decision-engine';
import { MappingService } from '@codementor/code-mapping';
import { CodeMentorStorage } from '@codementor/storage';
import { startHttpServer } from '../apps/server/src/http.js';
import { TestRepo } from '../packages/code-mapping/test/test-repo.js';

/**
 * 阶段 6 集成验证：完整数据流（每一节都用真实实现执行）。
 *
 * 用户提交开发需求
 * → Agent 创建工程任务
 * → Agent 声明设计决策
 * → Agent 修改源码
 * → CodeMentor 分析源码变化
 * → 建立决策与代码关联
 * → VS Code 展示工程决策（数据就绪断言；UI 渲染由扩展测试 8/8 覆盖）
 * → 用户完成学习交互
 * → 保存学习结果
 *
 * Agent 以真实 HTTP 客户端身份走核心服务 API（v0.1 的真实 Agent 接入点；
 * MCP 封装属阶段 2，尚未实现——见最终验收报告 NOT_RUN 项）。
 */

const TOKEN = 'e2e-flow-token';

const CONFIG_H = `#ifndef APP_CONFIG_H
#define APP_CONFIG_H
struct app_config {
    char *host;
    int port;
};
#endif
`;

const CONFIG_C_V1 = `#include "app_config.h"
struct app_config g_config;
void load_config(void) {
    g_config.host = "localhost";
    g_config.port = 8080;
}
`;

let dir: string;
let repo: TestRepo;
let storage: CodeMentorStorage;
let server: import('node:http').Server;
let port: number;
let headers: Record<string, string>;
let projectId = '';
let taskId = '';

async function post(
  p: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function get(p: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, { headers });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'cm-e2e-'));
  repo = new TestRepo('cm-e2e-ws-');
  repo.write('app_config.h', CONFIG_H);
  repo.write('app_config.c', CONFIG_C_V1);
  repo.commit('baseline');

  storage = CodeMentorStorage.open(path.join(dir, 'e2e.db'));
  const engine = new DecisionEngine(storage);
  const mapping = new MappingService(storage);
  const learning = new LearningEngine(storage);
  const running = await startHttpServer({ engine, mapping, learning, token: TOKEN });
  server = running.server;
  port = running.port;
  headers = { authorization: `Bearer ${TOKEN}` };
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeAllConnections();
  storage.close();
  repo.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

describe('集成：完整数据流（真实实现逐步执行）', () => {
  it('步骤 1–3：开发需求 → Agent 创建任务 → 声明设计决策（先于编码）', async () => {
    const project = await post('/api/projects', { name: 'demo-a', rootPath: repo.root });
    expect(project.status).toBe(201);
    projectId = project.body.id as string;

    // 用户需求："配置要支持环境变量覆盖，错误要尽早暴露" → Agent 建任务
    const task = await post('/api/tasks', {
      projectId,
      title: '实现可覆盖的应用配置模块',
      goal: '环境变量可覆盖默认配置；坏配置尽早暴露',
    });
    expect(task.status).toBe(201);
    taskId = task.body.id as string;

    // Agent 在编码前声明决策（服务端时钟盖章 declaredAt）
    const d1 = await post('/api/decisions', {
      taskId,
      question: '坏配置应在何时暴露',
      title: '启动时全量校验配置',
      chosenOption: 'Zod 风格 fail-fast 校验',
      alternatives: [{ name: '惰性校验', summary: '首次读取时才校验，启动更快' }],
      decidedBy: 'agent',
      declaredClaims: [{ kind: 'constraint', statement: '坏配置必须让进程启动即失败' }],
    });
    expect(d1.status).toBe(201);
    const declaredAt = ((d1.body.decision as Record<string, unknown>).declaredAt as string) ?? '';
    expect(declaredAt).toBeTruthy();
  });

  it('步骤 4–5：Agent 修改源码 → CodeMentor 分析变化（提案 + 实现 + 观察证据）', async () => {
    // 决策已声明，Agent 开始写代码：新增 validate_config 函数（真实文件 + 真实提交）
    repo.write(
      'app_config.c',
      `${CONFIG_C_V1}int validate_config(void) {
    return g_config.port > 0 ? 0 : -1;
}
`,
    );
    const newRev = repo.commit('add config validation (agent implementation)');

    // CodeMentor 分析变化区间 → 产生锚点提案（自动匹配只提案、不落库）
    const oldRev = repo.rev(1);
    const mapping = new MappingService(storage);
    const { proposals: list } = await mapping.proposeAnchors({
      taskId,
      oldRev,
      newRev,
    });
    expect(list.map((p) => `${p.change}:${p.symbol.name}`)).toContain('added:validate_config');

    // Agent 显式锚定（declared 关联）+ 记录观察证据（测试通过）
    // 取决策 ID（经任务决策列表端点——扩展树使用同一端点）
    const listRes = await get(`/api/tasks/${taskId}/decisions`);
    const decisions = (listRes.body as unknown as Array<{ id: string }>) ?? [];
    expect(decisions).toHaveLength(1);
    const decisionId = decisions[0]!.id;

    const anchor = await post(`/api/decisions/${decisionId}/anchors`, {
      filePath: 'app_config.c',
      symbolPath: ['validate_config'],
      origin: 'declared',
    });
    expect(anchor.status).toBe(201);

    const obs = await post(`/api/decisions/${decisionId}/observations`, {
      decisionId,
      claim: { kind: 'benefit', statement: '缺失必填配置时启动校验返回非零并退出' },
      evidence: { kind: 'test_run', verdict: 'pass', contentRef: 'objects/evd-e2e.json' },
    });
    expect(obs.status).toBe(201);

    const impl = await post(`/api/decisions/${decisionId}/implement`);
    expect(impl.status).toBe(201);
  });

  it('步骤 6：代码继续漂移 → 重验证重定位（confirmed + relocated）', async () => {
    repo.write(
      'app_config.c',
      `/* 模块注释新增两行 */\n/* 第二行 */\n${CONFIG_C_V1}int validate_config(void) {\n    return g_config.port > 0 ? 0 : -1;\n}\n`,
    );
    repo.commit('shift lines');

    const listRes = await get(`/api/tasks/${taskId}/decisions`);
    const decisionId = ((listRes.body as unknown as Array<{ id: string }>)[0] ?? { id: '' }).id;
    const reval = await post(`/api/projects/${projectId}/anchors/revalidate`);
    expect(reval.status).toBe(201);
    const results = reval.body.results as Array<{ status: string; relocated: boolean }>;
    expect(results[0]).toMatchObject({ status: 'confirmed', relocated: true });
    void decisionId;
  });

  it('步骤 7：VS Code 数据就绪（扩展消费的全部端点返回真实数据）', async () => {
    // 工作区识别
    const lookup = await get(`/api/projects/lookup?rootPath=${encodeURIComponent(repo.root)}`);
    expect(lookup.status).toBe(200);
    // 树：项目 → 任务 → 决策 → 锚点
    const tasks = await get(`/api/projects/${projectId}/tasks`);
    expect((tasks.body as unknown as unknown[]).length).toBe(1);
    // CodeLens 数据源
    const anchors = await get(`/api/projects/${projectId}/anchors`);
    expect((anchors.body as unknown as unknown[]).length).toBe(1);
    // 反向查询：符号 → 决策
    const lookup2 = await get(`/api/symbols/lookup?filePath=app_config.c&symbol=validate_config`);
    const matches = (lookup2.body as { matches: unknown[] }).matches;
    expect(matches).toHaveLength(1);
    // UI 渲染（树/详情/CodeLens/学习区）由真实 VS Code 扩展测试 8/8 覆盖——见 TEST_REPORT。
  });

  it('步骤 8–9：学习交互（错→对）→ 结果持久化 → 决策验证闭环', async () => {
    const listRes = await get(`/api/tasks/${taskId}/decisions`);
    const decisionId = ((listRes.body as unknown as Array<{ id: string }>)[0] ?? { id: '' }).id;

    const gen = await post(`/api/decisions/${decisionId}/learning`);
    expect(gen.status).toBe(201);
    const session = gen.body.session as {
      exercises: Array<{ id: string; type: string }>;
    };
    const mcq = session.exercises.find((e) => e.type === 'predict_choice')!;
    const wrong = await post(`/api/exercises/${mcq.id}/attempts`, {
      answer: '惰性校验',
      level: 1,
    });
    expect((wrong.body as { outcome: string }).outcome).toBe('fail');
    const right = await post(`/api/exercises/${mcq.id}/attempts`, {
      answer: 'Zod 风格 fail-fast 校验',
      level: 1,
    });
    expect((right.body as { outcome: string }).outcome).toBe('pass');

    // 学习结果已保存（同一服务内可查）且决策可完成验证闭环（完整性 R1–R5）
    const verify = await post(`/api/decisions/${decisionId}/verify`);
    expect(verify.status).toBe(201);
    expect((verify.body.decision as { status: string }).status).toBe('verified');

    const finish = await post(`/api/tasks/${taskId}/finish`);
    expect(finish.status).toBe(201);
    expect((finish.body as { status: string }).status).toBe('completed');
  });
});
