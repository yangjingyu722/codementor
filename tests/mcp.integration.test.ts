import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { CodeMentorStorage } from '@codementor/storage';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { TestRepo } from '../packages/code-mapping/test/test-repo.js';

/**
 * 阶段 2 集成测试：真实 MCP stdio 协议（SDK Client ↔ 子进程 MCP Server）
 * + 真实核心服务 HTTP + 真实 git 仓库。无 Mock。
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const mcpEntry = fileURLToPath(new URL('../packages/mcp/dist/main.js', import.meta.url));
const serverEntry = fileURLToPath(new URL('../apps/server/dist/index.js', import.meta.url));

let home: string;
let server: import('node:http').Server;
let storage: CodeMentorStorage;
let repo: TestRepo;
let client: Client;

beforeAll(async () => {
  if (!existsSync(mcpEntry)) {
    throw new Error(`MCP 构建产物缺失：${mcpEntry}（先 pnpm build）`);
  }
  home = mkdtempSync(path.join(tmpdir(), 'cm-mcp-'));
  repo = new TestRepo('cm-mcp-ws-');
  repo.write('src/main.c', 'int main(void) { return 0; }\n');
  repo.commit('init');

  storage = CodeMentorStorage.open(path.join(home, 'mcp.db'));
  const { startHttpServer } = await import('../apps/server/src/http.js');
  const { DecisionEngine } = await import('@codementor/decision-engine');
  const { MappingService } = await import('@codementor/code-mapping');
  const { LearningEngine } = await import('@codementor/learning-engine');
  const engine = new DecisionEngine(storage);
  const running = await startHttpServer({
    engine,
    mapping: new MappingService(storage),
    learning: new LearningEngine(storage),
    token: TOKEN,
  });
  server = running.server;
  // 写 server.json：MCP 子进程经它发现核心服务
  writeFileSync(
    path.join(home, 'server.json'),
    JSON.stringify({ host: '127.0.0.1', port: running.port, token: TOKEN }),
  );

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpEntry],
    env: { ...process.env, CODEMENTOR_HOME: home },
  });
  client = new Client({ name: 'mcp-test', version: '0.1.0' });
  await client.connect(transport);
}, 30000);

afterAll(async () => {
  await client?.close();
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

const TOKEN = 'mcp-integration-token';

/** SDK 1.32 的 CallToolResult.content 类型在 zod4 下推断不稳，统一取文本。 */
function textOf(res: unknown): string {
  const r = res as { content?: Array<{ text?: string }> };
  return r.content?.[0]?.text ?? '{}';
}

function readServerJson(): { port: number; token: string } {
  return JSON.parse(readFileSync(path.join(home, 'server.json'), 'utf8')) as {
    port: number;
    token: string;
  };
}

describe('MCP Server（真实 stdio 协议）', () => {
  it('工具发现：5 个 mentor_* 工具且 Schema 严格', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'mentor_finish_task',
      'mentor_get_context',
      'mentor_record_decision',
      'mentor_record_verification',
      'mentor_start_task',
    ]);
    const start = tools.find((t) => t.name === 'mentor_start_task')!;
    expect(start.inputSchema).toMatchObject({
      type: 'object',
      required: ['title'],
      additionalProperties: false,
    });
  });

  it('mentor_start_task：注册项目并创建任务（经核心服务持久化）', async () => {
    const res = await client.callTool({
      name: 'mentor_start_task',
      arguments: {
        projectRoot: repo.root,
        title: '实现登录模块',
        goal: '加盐存储密码',
      },
    });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(textOf(res));
    expect(payload.status).toBe('active');

    const state = readServerJson();
    const tasks = (await (
      await fetch(`http://127.0.0.1:${state.port}/api/projects/${payload.projectId}/tasks`, {
        headers: { authorization: `Bearer ${state.token}` },
      })
    ).json()) as Array<{ title: string; status: string }>;
    expect(tasks.some((t) => t.title === '实现登录模块' && t.status === 'active')).toBe(true);
  });

  it('mentor_record_decision：声明决策（declaredAt 服务端盖章）', async () => {
    const res = await client.callTool({
      name: 'mentor_record_decision',
      arguments: {
        question: '密码为什么加盐存储？',
        title: '加盐哈希',
        chosenOption: 'bcrypt 加盐',
        alternatives: [{ name: '明文存储', summary: '不可接受的安全风险' }],
        claims: [{ kind: 'constraint', statement: '密码不得明文落库' }],
      },
    });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(textOf(res));
    expect(payload.declaredAt).toBeTruthy();
    expect(payload.claimIds).toHaveLength(1);
  });

  it('mentor_record_verification + mentor_get_context：验证闭环可读', async () => {
    const state = readServerJson();
    const headers = { authorization: `Bearer ${state.token}` };
    const project = (await (
      await fetch(
        `${base_url(state)}/api/projects/lookup?rootPath=${encodeURIComponent(repo.root)}`,
        { headers },
      )
    ).json()) as { id: string };
    const decisions = (await (
      await fetch(`${base_url(state)}/api/projects/${project.id}/tasks`, { headers })
    ).json()) as Array<{ id: string }>;
    const taskDecisions = (await (
      await fetch(`${base_url(state)}/api/tasks/${decisions[0]!.id}/decisions`, { headers })
    ).json()) as Array<{ id: string }>;
    expect(taskDecisions.length).toBeGreaterThan(0);

    const verify = await client.callTool({
      name: 'mentor_record_verification',
      arguments: {
        claim: { kind: 'benefit', statement: '加盐哈希通过测试用例' },
        evidence: { kind: 'test_run', verdict: 'pass', contentRef: 'objects/evd.json' },
      },
    });
    expect(verify.isError).toBeFalsy();

    const ctx = await client.callTool({
      name: 'mentor_get_context',
      arguments: { taskId: decisions[0]!.id },
    });
    const list = JSON.parse(textOf(ctx)) as Array<{ id: string }>;
    expect(taskDecisions.length).toBeGreaterThan(0);
    expect(list.length).toBeGreaterThan(0);
  });

  it('mentor_finish_task：完成任务', async () => {
    const res = await client.callTool({ name: 'mentor_finish_task', arguments: {} });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(textOf(res));
    expect(payload.status).toBe('completed');
  });

  it('非法输入：record_decision 缺 claims → isError 结构化错误', async () => {
    const res = await client.callTool({
      name: 'mentor_record_decision',
      arguments: { title: 't', question: 'q', chosenOption: 'c', claims: [] },
    });
    expect(res.isError).toBe(true);
    const payload = JSON.parse(textOf(res));
    expect(payload.error).toBeTruthy();
  });
});

function base_url(state: { port: number }): string {
  return `http://127.0.0.1:${state.port}`;
}
