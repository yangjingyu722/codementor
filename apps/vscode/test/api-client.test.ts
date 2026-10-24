import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiClient,
  ApiError,
  ServiceLocator,
  ServiceUnavailableError,
  defaultHomeDir,
} from '@codementor/vscode/client';
import { TestRepo } from '../../../packages/code-mapping/test/test-repo.js';

/**
 * ApiClient 集成测试：真实核心服务进程 + 真实回环 HTTP。
 * 服务端构建产物缺失时整体跳过（依赖 pnpm build，CI 已按序执行）。
 */
const serverEntry = fileURLToPath(new URL('../../../apps/server/dist/index.js', import.meta.url));

let serviceHome: string;
let fixtureRepo: TestRepo;
let server: ReturnType<typeof spawn> | undefined;
let client: ApiClient;
const serverLogs: string[] = [];

async function waitForServerJson(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path.join(serviceHome, 'server.json'))) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server.json 未在超时时间内出现');
}

beforeAll(async (ctx) => {
  if (!existsSync(serverEntry)) {
    console.warn(`[skip] server build artifact missing: ${serverEntry}`);
    (ctx as unknown as { skip(): void }).skip();
    return;
  }
  serviceHome = mkdtempSync(path.join(tmpdir(), 'cm-apiclient-home-'));
  fixtureRepo = new TestRepo('cm-apiclient-ws-');
  fixtureRepo.write('proc.c', 'void scheduler(void) { return; }\n');
  fixtureRepo.commit('init');

  server = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, CODEMENTOR_HOME: serviceHome },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr?.on('data', (chunk: Buffer) => serverLogs.push(chunk.toString('utf8')));
  await waitForServerJson(15000);
  client = new ApiClient(new ServiceLocator(serviceHome));
}, 30000);

afterAll(async () => {
  if (server !== undefined) {
    server.kill();
    await new Promise<void>((resolve) => server!.once('exit', () => resolve()));
  }
  if (serviceHome !== undefined) {
    rmSync(serviceHome, { recursive: true, force: true });
  }
  fixtureRepo?.cleanup();
  if (serverLogs.length > 0) {
    console.error('[api-client test] server stderr:', serverLogs.join(''));
  }
});

describe('ApiClient（真实服务进程）', () => {
  it('无 server.json 时报 ServiceUnavailableError', async () => {
    const empty = new ApiClient(new ServiceLocator(path.join(tmpdir(), 'cm-no-such-home')));
    await expect(empty.health()).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it('health 可达；lookupProject 对未注册工作区返回 undefined', async () => {
    await expect(client.health()).resolves.toBeUndefined();
    await expect(client.lookupProject('/nowhere/at/all')).resolves.toBeUndefined();
  });

  it('完整只读链路：lookup → tasks → decisions → detail → anchors', async () => {
    // 写路径只用于种子（扩展是只读客户端）；读取链路全部走被测 ApiClient
    const stateFile = path.join(serviceHome, 'server.json');
    const state = JSON.parse(readFileSync(stateFile, 'utf8')) as { port: number; token: string };
    const base = `http://127.0.0.1:${state.port}`;
    const seedHeaders = {
      'content-type': 'application/json',
      authorization: `Bearer ${state.token}`,
    };

    const projectRes = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: seedHeaders,
      body: JSON.stringify({ name: 'ws-demo', rootPath: fixtureRepo.root }),
    });
    expect(projectRes.status).toBe(201);

    const project = await client.lookupProject(fixtureRepo.root);
    expect(project).toBeDefined();

    const taskRes = await fetch(`${base}/api/tasks`, {
      method: 'POST',
      headers: seedHeaders,
      body: JSON.stringify({ projectId: project!.id, title: '实现上下文切换' }),
    });
    const task = (await taskRes.json()) as { id: string };
    const decisionRes = await fetch(`${base}/api/decisions`, {
      method: 'POST',
      headers: seedHeaders,
      body: JSON.stringify({
        taskId: task.id,
        question: '上下文切换为何保存完整寄存器组',
        title: '全量寄存器保存',
        chosenOption: '栈帧内联保存',
        decidedBy: 'agent',
        declaredClaims: [{ kind: 'constraint', statement: '可抢占调度要求完整现场' }],
      }),
    });
    const { decision } = (await decisionRes.json()) as { decision: { id: string } };

    await expect(client.listTasks(project!.id)).resolves.toHaveLength(1);
    const decisions = await client.listTaskDecisions(task.id);
    expect(decisions.map((d) => d.title)).toEqual(['全量寄存器保存']);

    const detail = await client.getDecisionDetail(decision.id);
    expect(detail.decision.question).toContain('寄存器');
    expect(detail.claims[0]?.origin).toBe('declared');
    expect(detail.integrity.ok).toBe(true);
    await expect(client.listAnchors(decision.id)).resolves.toEqual([]);
  });

  it('服务端错误透传为 ApiError（含 code 与 status）', async () => {
    const err = await client.getDecisionDetail('dec_missing').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).code).toBe('NOT_FOUND');
  });

  it('defaultHomeDir 遵循环境变量', () => {
    expect(defaultHomeDir({ CODEMENTOR_HOME: '/custom/home' })).toBe('/custom/home');
    expect(defaultHomeDir({})).toContain('.codementor');
  });
});
