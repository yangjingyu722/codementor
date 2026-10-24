import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * 真实子进程集成：spawn 构建产物 node dist/index.js，
 * 通过 server.json 完成端口/token 握手后走真实 HTTP 调用。
 * 依赖构建产物：请先运行 pnpm build（CI 已按 build → test 排序）。
 */

const serverEntry = fileURLToPath(new URL('../apps/server/dist/index.js', import.meta.url));

let ctx:
  | {
      child: ReturnType<typeof spawn>;
      home: string;
      state: { port: number; token: string; pid: number };
      exited: Promise<unknown[]>;
    }
  | undefined;
const stderrChunks: string[] = [];

async function waitForFile(file: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${file}`);
}

beforeAll(async () => {
  if (!existsSync(serverEntry)) {
    throw new Error(
      `server build artifact missing: ${serverEntry} — run "pnpm build" first (CI runs build before test)`,
    );
  }
  const home = mkdtempSync(path.join(tmpdir(), 'cm-proc-'));
  const child = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, CODEMENTOR_HOME: home, CODEMENTOR_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString('utf8')));

  const stateFile = path.join(home, 'server.json');
  await waitForFile(stateFile, 15000);
  const state = JSON.parse(readFileSync(stateFile, 'utf8')) as {
    port: number;
    token: string;
    pid: number;
  };
  const exited = once(child, 'exit');
  ctx = { child, home, state, exited };
}, 30000);

afterAll(async () => {
  if (ctx === undefined) {
    return;
  }
  if (ctx.child.exitCode === null && !ctx.child.killed) {
    ctx.child.kill();
  }
  await ctx.exited;
  rmSync(ctx.home, { recursive: true, force: true });
  if (stderrChunks.length > 0) {
    console.error('[process test] server stderr:\n', stderrChunks.join(''));
  }
});

describe('本地核心服务进程（真实 spawn + server.json 握手）', () => {
  it('server.json 提供端口与 token，health 可访问', async () => {
    const { state } = ctx!;
    expect(state.port).toBeGreaterThan(0);
    expect(state.token).toMatch(/^[0-9a-f]{64}$/);
    expect(state.pid).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${state.port}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('token 鉴权后可完成一次决策声明（真实跨进程持久化）', async () => {
    const { state } = ctx!;
    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${state.token}`,
    };
    const base = `http://127.0.0.1:${state.port}`;

    const unauthorized = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', rootPath: '/x' }),
    });
    expect(unauthorized.status).toBe(401);

    const project = (await (
      await fetch(`${base}/api/projects`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'proc-demo', rootPath: '/repo/proc-demo' }),
      })
    ).json()) as { id: string };
    const task = (await (
      await fetch(`${base}/api/tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectId: project.id, title: '进程集成任务' }),
      })
    ).json()) as { id: string };
    const declared = (await (
      await fetch(`${base}/api/decisions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          taskId: task.id,
          question: 'q',
          title: 't',
          chosenOption: 'c',
          decidedBy: 'agent',
          declaredClaims: [{ kind: 'constraint', statement: 's' }],
        }),
      })
    ).json()) as { decision: { id: string; declaredAt: string } };

    expect(declared.decision.declaredAt).toBeTruthy();

    // 声明在服务进程的数据库文件中真实存在
    const bundle = (await (
      await fetch(`${base}/api/decisions/${declared.decision.id}`, { headers })
    ).json()) as { integrity: { ok: boolean }; claims: Array<{ origin: string }> };
    expect(bundle.claims.map((c) => c.origin)).toEqual(['declared']);
    expect(bundle.integrity.ok).toBe(true);
  });

  it('进程可被终止', async () => {
    const { child, exited } = ctx!;
    child.kill();
    const event = await exited;
    expect(event).toBeDefined();
  });
});
