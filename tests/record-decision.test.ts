import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestRepo } from '../packages/code-mapping/test/test-repo.js';

/**
 * record-decision.mjs 真实运行验证：flags 模式对临时服务执行，
 * 核对任务/决策/锚点真实落库。交互式模式的提问逻辑由代码审查覆盖。
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const tool = fileURLToPath(new URL('../tools/record-decision.mjs', import.meta.url));
const serverEntry = fileURLToPath(new URL('../apps/server/dist/index.js', import.meta.url));

let home: string;
let server: ReturnType<typeof spawn> | undefined;
let base = '';
let token = '';
let repo: TestRepo;

beforeAll(async () => {
  if (!existsSync(serverEntry)) {
    throw new Error('server 构建产物缺失，请先 pnpm build');
  }
  home = mkdtempSync(path.join(tmpdir(), 'cm-record-'));
  repo = new TestRepo('cm-record-ws-');
  repo.write('src/main.c', 'int main(void) { return 0; }\n');
  repo.commit('init');
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
}, 30000);

afterAll(async () => {
  if (server !== undefined && server.exitCode === null) {
    server.kill();
    await Promise.race([
      new Promise<void>((resolve) => server!.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
  }
  repo.cleanup();
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    // 尽力清理
  }
});

describe('tools/record-decision.mjs（真实服务 + 真实脚本执行）', () => {
  it('flags 模式：一条命令登记任务/决策/锚点并真实落库', async () => {
    const { execFileSync } = await import('node:child_process');
    const output = execFileSync(
      process.execPath,
      [
        tool,
        '--repo',
        repo.root,
        '--home',
        home,
        '--task',
        '实现登录模块',
        '--question',
        '密码为什么加盐存储',
        '--title',
        '加盐哈希',
        '--chosen',
        'bcrypt 加盐',
        '--alternative',
        '明文存储|不可接受的安全风险',
        '--claim',
        'constraint|密码不得明文落库',
        '--anchor',
        'src/main.c|main',
      ],
      { cwd: repoRoot, encoding: 'utf8', timeout: 60000 },
    );
    expect(output).toContain('决策已声明');
    expect(output).toContain('锚点：src/main.c');

    const headers = { authorization: `Bearer ${token}` };
    const lookup = await fetch(
      `${base}/api/symbols/lookup?filePath=${encodeURIComponent('src/main.c')}&symbol=main`,
      { headers },
    );
    expect(lookup.status).toBe(200);
    const body = (await lookup.json()) as {
      matches: Array<{ decision: { title: string; question: string } }>;
    };
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0]!.decision.title).toBe('加盐哈希');
  });

  it('幂等：重复执行复用项目与进行中任务', async () => {
    const { execFileSync } = await import('node:child_process');
    const output = execFileSync(
      process.execPath,
      [
        tool,
        '--repo',
        repo.root,
        '--home',
        home,
        '--task',
        '实现登录模块',
        '--question',
        '会话为何用 JWT',
        '--title',
        'JWT 会话',
        '--chosen',
        '无状态 JWT',
        '--claim',
        'tradeoff|水平扩展无需共享会话存储',
      ],
      { cwd: repoRoot, encoding: 'utf8', timeout: 60000 },
    );
    expect(output).toContain('复用进行中的任务');
    expect(output).toContain('决策已声明');
  });
});
