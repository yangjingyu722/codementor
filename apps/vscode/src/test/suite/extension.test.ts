import { spawn } from 'node:child_process';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

/**
 * CodeMentor 扩展集成测试：真实 VS Code 实例 + 真实核心服务进程 + 真实种子数据。
 * 数据全部经核心服务 API 写入（扩展自身是只读视图层）。
 */

const serviceHome = process.env['CODEMENTOR_TEST_HOME'] as string;
const fixturePath = process.env['CODEMENTOR_TEST_WS'] as string;
const serverEntry = process.env['CODEMENTOR_TEST_SERVER'] as string;
const EXT_ID = 'codementor-dev.codementor';

interface Seeded {
  server: ReturnType<typeof spawn>;
  decisionA: string;
  decisionB: string;
  anchorSwitch: Record<string, unknown>;
  anchorSched: Record<string, unknown>;
}

let seeded: Seeded | undefined;
let ext: vscode.Extension<Record<string, unknown>>;

function waitFile(file: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (fs.existsSync(file)) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`timed out waiting for ${file}`));
      }
    }, 100);
  });
}

async function seedAll(): Promise<Seeded> {
  const nodeBin = process.env['CODEMENTOR_TEST_NODE'] ?? 'node';
  const server = spawn(nodeBin, [serverEntry], {
    env: { ...process.env, CODEMENTOR_HOME: serviceHome },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs: string[] = [];
  server.stderr?.on('data', (chunk: Buffer) => logs.push(chunk.toString('utf8')));
  await waitFile(path.join(serviceHome, 'server.json'), 20000);

  const state = JSON.parse(fs.readFileSync(path.join(serviceHome, 'server.json'), 'utf8')) as {
    port: number;
    token: string;
  };
  const base = `http://127.0.0.1:${state.port}`;
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${state.token}`,
  };
  const post = async (p: string, body: unknown): Promise<Record<string, unknown>> => {
    const res = await fetch(`${base}${p}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (res.status >= 400) {
      throw new Error(`seed ${p} -> ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as Record<string, unknown>;
  };

  const project = await post('/api/projects', {
    name: 'proc-demo',
    rootPath: fixturePath,
  });
  const task = await post('/api/tasks', {
    projectId: project.id,
    title: '实现上下文切换',
    goal: '在任务切换时保存与恢复执行现场',
  });
  const decisionA = await post('/api/decisions', {
    taskId: task.id,
    question: '上下文切换为何保存完整寄存器组',
    title: '全量寄存器保存',
    chosenOption: '栈帧内联保存',
    decidedBy: 'agent',
    declaredClaims: [{ kind: 'constraint', statement: '可抢占调度要求完整现场' }],
  });
  const decisionB = await post('/api/decisions', {
    taskId: task.id,
    question: '调度器为何轮询就绪队列',
    title: '轮询调度',
    chosenOption: '线性扫描就绪进程',
    decidedBy: 'agent',
    declaredClaims: [{ kind: 'tradeoff', statement: '进程数少时轮询常数更小' }],
  });
  const decisionAId = (decisionA.decision as { id: string }).id;
  const decisionBId = (decisionB.decision as { id: string }).id;
  const anchorSwitch = await post(`/api/decisions/${decisionAId}/anchors`, {
    filePath: 'proc.c',
    symbolPath: ['switch_to'],
    origin: 'declared',
  });
  const anchorSched = await post(`/api/decisions/${decisionBId}/anchors`, {
    filePath: 'proc.c',
    symbolPath: ['scheduler'],
    origin: 'declared',
  });

  return {
    server,
    decisionA: decisionAId,
    decisionB: decisionBId,
    anchorSwitch,
    anchorSched,
  };
}

describe('CodeMentor 扩展（真实 VS Code + 真实核心服务）', function () {
  this.timeout(90000);

  before(async function () {
    seeded = await seedAll();
    ext = vscode.extensions.getExtension(EXT_ID)!;
    await ext.activate();
    (ext.exports.loader as { invalidate(): void }).invalidate();
    (ext.exports.tree as { refresh(): void }).refresh();
  });

  after(async function () {
    const server = seeded?.server;
    if (server === undefined) {
      return;
    }
    if (server.exitCode === null) {
      server.kill();
    }
    if (server.exitCode === null) {
      await Promise.race([
        new Promise<void>((resolve) => server.once('exit', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
    }
  });

  it('激活并注册全部命令', async () => {
    const commands = await vscode.commands.getCommands();
    for (const name of [
      'codementor.refresh',
      'codementor.openDecision',
      'codementor.revealAnchor',
      'codementor.revalidateAnchors',
      'codementor.showServiceHelp',
    ]) {
      assert.ok(commands.includes(name), `missing command: ${name}`);
    }
  });

  it('决策树呈现 Project → Task → Decision → Anchor（真实数据）', async () => {
    const tree = ext.exports.tree as {
      getChildren(node?: unknown): Promise<Array<Record<string, unknown>>>;
    };
    (ext.exports.loader as { invalidate(): void }).invalidate();

    const roots = await tree.getChildren();
    assert.strictEqual(roots.length, 1);
    assert.strictEqual(roots[0]!.kind, 'project');

    const tasks = await tree.getChildren(roots[0]!);
    const taskNode = tasks.find((n) => n.kind === 'task');
    assert.ok(taskNode !== undefined, 'task node missing');
    assert.strictEqual((taskNode.task as { title: string }).title, '实现上下文切换');

    const decisions = await tree.getChildren(taskNode!);
    assert.strictEqual(decisions.length, 2);
    const titles = decisions.map((n) => (n.decision as { title: string }).title).sort();
    assert.deepStrictEqual(titles, ['全量寄存器保存', '轮询调度']);

    const anchors = await tree.getChildren(decisions[0]!);
    assert.ok(
      anchors.some((n) => n.kind === 'anchor'),
      'anchor node missing',
    );
  });

  it('CodeLens 在 proc.c 的函数上提供决策入口', async () => {
    (ext.exports.loader as { invalidate(): void }).invalidate();
    const doc = await vscode.workspace.openTextDocument(path.join(fixturePath, 'proc.c'));
    const lenses = await (
      ext.exports.lenses as {
        provideCodeLenses(
          doc: vscode.TextDocument,
          token: vscode.CancellationToken,
        ): Promise<vscode.CodeLens[]>;
      }
    ).provideCodeLenses(doc, new vscode.CancellationTokenSource().token);
    assert.ok(lenses.length >= 2, `expected >= 2 lenses, got ${lenses.length}`);
    const titles = lenses.map((l) => l.command?.title ?? '').join(' | ');
    assert.ok(titles.includes('全量寄存器保存'), `lens title missing decision A: ${titles}`);
    assert.ok(titles.includes('轮询调度'), `lens title missing decision B: ${titles}`);
  });

  it('从决策关联跳转到代码（reveal + 选中锚点行）', async () => {
    await vscode.commands.executeCommand('codementor.revealAnchor', seeded!.anchorSwitch);
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor !== undefined, 'no active editor after reveal');
    assert.ok(
      editor.document.fileName.endsWith('proc.c'),
      `wrong file: ${editor.document.fileName}`,
    );
    const expectedLine = (seeded!.anchorSwitch as { startLine: number }).startLine - 1;
    assert.strictEqual(editor.selection.start.line, expectedLine);
  });

  it('打开决策详情面板（问题/方案/理由分区展示）', async () => {
    const before = (ext.exports.__test as { panelsOpened: number }).panelsOpened;
    await vscode.commands.executeCommand('codementor.openDecision', seeded!.decisionA);
    assert.ok(
      (ext.exports.__test as { panelsOpened: number }).panelsOpened > before,
      'panel was not opened',
    );
  });

  it('服务停止后决策树明确提示离线', async function () {
    seeded!.server.kill();
    await new Promise<void>((resolve) => seeded!.server.once('exit', () => resolve()));
    (ext.exports.loader as { invalidate(): void }).invalidate();
    const tree = ext.exports.tree as {
      getChildren(node?: unknown): Promise<Array<Record<string, unknown>>>;
    };
    const roots = await tree.getChildren();
    assert.strictEqual(roots[0]!.kind, 'info');
    assert.strictEqual((roots[0] as { label: string }).label, '核心服务未连接');
  });
});
