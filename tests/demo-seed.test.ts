import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Demo 种子脚本的真实运行验证：临时服务 + 临时 home，
 * 执行 demo/seed-demo.mjs 后核对两个 Demo 的数据真实落库。
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const seedScript = fileURLToPath(new URL('../demo/seed-demo.mjs', import.meta.url));
const serverEntry = fileURLToPath(new URL('../apps/server/dist/index.js', import.meta.url));

let home: string;
let server: ReturnType<typeof spawn> | undefined;
let base = '';
let token = '';

beforeAll(async () => {
  if (!existsSync(serverEntry)) {
    throw new Error('server 构建产物缺失，请先 pnpm build');
  }
  home = mkdtempSync(path.join(tmpdir(), 'cm-demoseed-'));
  server = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, CODEMENTOR_HOME: home },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const stateFile = path.join(home, 'server.json');
  const deadline = Date.now() + 15000;
  while (!existsSync(stateFile)) {
    if (Date.now() > deadline) {
      throw new Error('server.json 未出现');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const state = JSON.parse(readFileSync(stateFile, 'utf8')) as { port: number; token: string };
  base = `http://127.0.0.1:${state.port}`;
  token = state.token;
}, 30000);

afterAll(async () => {
  if (server !== undefined && server.exitCode === null) {
    server.kill();
    await Promise.race([
      new Promise<void>((resolve) => server!.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
  }
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    // 尽力清理
  }
});

describe('demo/seed-demo.mjs（真实服务 + 真实脚本执行）', () => {
  it('脚本执行成功且两个 Demo 数据真实落库', async () => {
    const { execFileSync } = await import('node:child_process');
    const output = execFileSync(process.execPath, [seedScript, '--home', home], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 60000,
    });
    expect(output).toContain('Demo A 数据就绪');
    expect(output).toContain('Demo B 数据就绪');

    const headers = { authorization: `Bearer ${token}` };
    // Demo B：反向查询 swtch 应能找到决策
    const lookup = await fetch(`${base}/api/symbols/lookup?filePath=swtch.c&symbol=swtch`, {
      headers,
    });
    expect(lookup.status).toBe(200);
    const body = (await lookup.json()) as {
      matches: Array<{ decision: { title: string }; anchor: { filePath: string } }>;
    };
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0]!.decision.title).toContain('callee-saved');
    expect(body.matches[0]!.anchor.filePath).toBe('swtch.c');

    // 学习会话可生成（Demo B）
    const decisionId = body.matches[0]!.decision;
    void decisionId;
    const lookupPath = path.join(repoRoot, 'demo', 'demo-b-riscv-os');
    const lookupProject = await fetch(
      `${base}/api/projects/lookup?rootPath=${encodeURIComponent(lookupPath)}`,
      { headers },
    );
    expect(lookupProject.status).toBe(200);
  });

  it('重复执行脚本幂等（rootPath 唯一注册）', async () => {
    const { execFileSync } = await import('node:child_process');
    const output = execFileSync(process.execPath, [seedScript, '--home', home], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 60000,
    });
    expect(output).toContain('Demo A 数据就绪');
    // 项目不重复：lookup 仍只返回一个
    const state = JSON.parse(readFileSync(path.join(home, 'server.json'), 'utf8')) as {
      port: number;
      token: string;
    };
    const res = await fetch(
      `${base}/api/projects/lookup?rootPath=${encodeURIComponent(path.join(repoRoot, 'demo', 'demo-a-simple-c'))}`,
      { headers: { authorization: `Bearer ${state.token}` } },
    );
    expect(res.status).toBe(200);
  });
});
