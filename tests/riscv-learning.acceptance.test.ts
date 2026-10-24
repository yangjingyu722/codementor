import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestRepo } from '../packages/code-mapping/test/test-repo.js';

/**
 * 阶段 5 验收场景（端到端，全部真实数据）：
 * 简化 RISC-V OS 进程管理——
 * 1. 查看设计问题（为什么需要上下文切换/只保存部分寄存器）
 * 2. Predict：用户尝试回答方案
 * 3. Explain：系统解释并引用真实主张
 * 4. Verify：按提示定位 scheduler 与 swtch（真实源码锚点）
 * 5. Transfer：完成独立解释练习
 * 6. 服务重启后进度恢复
 */

const serverEntry = fileURLToPath(new URL('../apps/server/dist/index.js', import.meta.url));

const PROC_H = `#ifndef PROC_H
#define PROC_H
#define NPROC 8
struct context {
    unsigned long ra;
    unsigned long sp;
    unsigned long s0;
    unsigned long s1;
    unsigned long s2;
};
struct pcb {
    int pid;
    enum { UNUSED, READY, RUNNING } state;
    struct context ctx;
};
#endif
`;

const SWTCH_C = `/* RISC-V 上下文切换（简化 C 表达）。
 * 只保存 callee-saved 寄存器：ra/sp/s0-s11；
 * caller-saved 寄存器由编译器在调用点保存。 */
void swtch(struct context *old, struct context *next) {
    old->ra = 0; old->sp = 0; old->s0 = 0; old->s1 = 0; old->s2 = 0;
    next->ra = 0; next->sp = 0; next->s0 = 0; next->s1 = 0; next->s2 = 0;
}
`;

const PROC_C = `#include "proc.h"
static struct pcb ptable[NPROC];
static struct pcb *current;
struct pcb *scheduler(void) {
    for (int i = 0; i < NPROC; i++) {
        if (ptable[i].state == READY) {
            current = &ptable[i];
            ptable[i].state = RUNNING;
            return current;
        }
    }
    return 0;
}
`;

let home: string;
let repo: TestRepo;
let serverProcess: ReturnType<typeof spawn> | undefined;
const logs: string[] = [];
let base = '';
let headers: Record<string, string>;
let decisionId = '';
const taskTitle = '实现上下文切换';

interface Json {
  [k: string]: unknown;
}

async function post(p: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${base}${p}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Json };
}

async function get(p: string): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${base}${p}`, { headers });
  return { status: res.status, body: (await res.json()) as Json };
}

async function startServer(): Promise<void> {
  serverProcess = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, CODEMENTOR_HOME: home },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  serverProcess.stderr?.on('data', (chunk: Buffer) => logs.push(chunk.toString('utf8')));
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
  headers = { authorization: `Bearer ${state.token}` };
}

beforeAll(async () => {
  home = mkdtempSync(path.join(tmpdir(), 'cm-riscv-home-'));
  repo = new TestRepo('cm-riscv-ws-');
  repo.write('proc.h', PROC_H);
  repo.write('swtch.c', SWTCH_C);
  repo.write('proc.c', PROC_C);
  repo.commit('riscv proc baseline');
  await startServer();
}, 30000);

afterAll(async () => {
  if (serverProcess !== undefined && serverProcess.exitCode === null) {
    serverProcess.kill();
    await Promise.race([
      new Promise<void>((resolve) => serverProcess!.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
  }
  repo.cleanup();
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    // Windows 句柄释放滞后，尽力清理
  }
  if (logs.length > 0) {
    console.error('[riscv acceptance] server stderr:', logs.join(''));
  }
});

describe('验收：RISC-V 上下文切换学习流程（真实数据端到端）', () => {
  let mcqId = '';
  let locateSwtchId = '';
  let transferId = '';

  it('准备：注册工程、声明决策、锚定 swtch 与 scheduler（真实锚点）', async () => {
    const project = await post('/api/projects', { name: 'riscv-os', rootPath: repo.root });
    expect(project.status).toBe(201);
    const projectGet = await get(`/api/projects/lookup?rootPath=${encodeURIComponent(repo.root)}`);
    const projectId = (projectGet.body as { id: string }).id;

    const task = await post('/api/tasks', { projectId, title: taskTitle });
    const taskId = (task.body as { id: string }).id;
    const declared = await post('/api/decisions', {
      taskId,
      question: '为什么需要上下文切换，切换时为何只保存部分寄存器？',
      title: '上下文切换采用 callee-saved 策略',
      chosenOption: '仅保存 callee-saved 寄存器（ra/sp/s0-s11）',
      alternatives: [
        { name: '全量寄存器保存', summary: '保存全部 32 个通用寄存器，实现简单但切换开销大' },
      ],
      decidedBy: 'agent',
      declaredClaims: [
        {
          kind: 'tradeoff',
          statement:
            'RISC-V 调用约定下 caller-saved 寄存器由编译器在调用点保存，内核只需保存 callee-saved 寄存器',
        },
      ],
    });
    decisionId = (declared.body.decision as Json).id as string;

    const swtchAnchor = await post(`/api/decisions/${decisionId}/anchors`, {
      filePath: 'swtch.c',
      symbolPath: ['swtch'],
      origin: 'declared',
    });
    expect(swtchAnchor.status).toBe(201);
    const schedAnchor = await post(`/api/decisions/${decisionId}/anchors`, {
      filePath: 'proc.c',
      symbolPath: ['scheduler'],
      origin: 'declared',
    });
    expect(schedAnchor.status).toBe(201);
  });

  it('Problem + Predict：生成学习会话，用户先答错再答对方案判断', async () => {
    const gen = await post(`/api/decisions/${decisionId}/learning`);
    expect(gen.status).toBe(201);
    const session = gen.body.session as {
      decision: { question: string };
      explanation: string;
      exercises: Array<{ id: string; type: string; options: string[]; answerKey?: unknown }>;
    };
    // Problem：会话携带真实工程问题
    expect(session.decision.question).toContain('上下文切换');
    expect(session.explanation).toContain('RISC-V 调用约定');

    const mcq = session.exercises.find((e) => e.type === 'predict_choice')!;
    mcqId = mcq.id;
    expect(mcq.options).toContain('仅保存 callee-saved 寄存器（ra/sp/s0-s11）');
    expect(mcq.options).toContain('全量寄存器保存');
    expect(mcq.answerKey).toBeUndefined(); // 答案键不下发

    const wrong = await post(`/api/exercises/${mcqId}/attempts`, {
      answer: '全量寄存器保存',
      level: 1,
    });
    expect((wrong.body as { outcome: string }).outcome).toBe('fail');
    expect((wrong.body as { feedback: string }).feedback).toContain('callee-saved');

    const right = await post(`/api/exercises/${mcqId}/attempts`, {
      answer: '仅保存 callee-saved 寄存器（ra/sp/s0-s11）',
      level: 1,
    });
    expect((right.body as { outcome: string }).outcome).toBe('pass');
  });

  it('Explain：解释文本逐句引用真实主张与备选（无虚构证据）', async () => {
    const { body } = await get(`/api/decisions/${decisionId}/learning`);
    const explanation = (body.session as { explanation: string }).explanation;
    expect(explanation).toContain('全量寄存器保存');
    expect(explanation).toContain('RISC-V 调用约定下 caller-saved');
    // 该决策没有观察证据 → 解释不得声称存在
    expect(explanation).not.toContain('已被证据支撑的观察事实');
  });

  it('Verify：按提示定位 swtch 与 scheduler（真实源码锚点评分）', async () => {
    const { body } = await get(`/api/decisions/${decisionId}/learning`);
    const session = body.session as {
      exercises: Array<{ id: string; type: string; prompt: string; hints: string[] }>;
    };
    const locates = session.exercises.filter((e) => e.type === 'locate_code');
    expect(locates).toHaveLength(2); // swtch + scheduler 两个真实锚点

    const swtchEx = locates.find((e) => e.prompt.includes('swtch'))!;
    locateSwtchId = swtchEx.id;
    // Level 1 提示给出真实位置（完整引导）
    expect(swtchEx.hints.some((h) => h.includes('swtch.c'))).toBe(true);

    const wrong = await post(`/api/exercises/${locateSwtchId}/attempts`, {
      answer: 'proc.c swtch',
      level: 2,
    });
    expect((wrong.body as { outcome: string }).outcome).toBe('fail');
    expect((wrong.body as { feedback: string }).feedback).toContain('swtch.c');

    const right = await post(`/api/exercises/${locateSwtchId}/attempts`, {
      answer: 'swtch.c swtch',
      level: 2,
    });
    expect((right.body as { outcome: string }).outcome).toBe('pass');

    const schedEx = locates.find((e) => e.prompt.includes('scheduler'))!;
    const sched = await post(`/api/exercises/${schedEx.id}/attempts`, {
      answer: 'proc.c scheduler',
      level: 3,
    });
    expect((sched.body as { outcome: string }).outcome).toBe('pass');
  });

  it('Transfer：完成独立解释练习（rubric 确定性评分，引用真实要点）', async () => {
    const { body } = await get(`/api/decisions/${decisionId}/learning`);
    const session = body.session as {
      exercises: Array<{ id: string; type: string; attempts: Array<{ outcome: string }> }>;
      completed: boolean;
    };
    const transfer = session.exercises.find((e) => e.type === 'open_explanation')!;
    transferId = transfer.id;

    const weak = await post(`/api/exercises/${transferId}/attempts`, {
      answer: '主要是因为 callee-saved 寄存器数量少一些。',
      level: 2,
    });
    expect((weak.body as { outcome: string }).outcome).toBe('partial');

    const good = await post(`/api/exercises/${transferId}/attempts`, {
      answer:
        'RISC-V 调用约定下 caller-saved 寄存器由编译器在调用点保存，所以内核只需保存 callee-saved 寄存器（ra/sp/s0-s11），比全量寄存器保存切换开销更小。',
      level: 3,
    });
    expect((good.body as { outcome: string }).outcome).toBe('pass');
  });

  it('完成状态：全部练习 pass → completed=true；级别推荐 3', async () => {
    const { body } = await get(`/api/decisions/${decisionId}/learning`);
    const session = body.session as {
      completed: boolean;
      completedExerciseIds: string[];
      recommendedLevel: number;
      exercises: Array<{ id: string; attempts: unknown[] }>;
    };
    expect(session.exercises.every((e) => e.attempts.length > 0)).toBe(true);
    expect(session.completedExerciseIds).toContain(mcqId);
    expect(session.completedExerciseIds).toContain(locateSwtchId);
    expect(session.completedExerciseIds).toContain(transferId);
    expect(session.completed).toBe(true);
    expect(session.recommendedLevel).toBe(3);
  });

  it('服务重启后进度恢复（Attempt 持久化 + 幂等生成）', async () => {
    // 重启服务进程（Windows kill 为 TerminateProcess，服务的退出清理不会运行，需手动清发现文件）
    serverProcess!.kill();
    await Promise.race([
      new Promise<void>((resolve) => serverProcess!.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);
    rmSync(path.join(home, 'server.json'), { force: true });
    await startServer();

    const gen = await post(`/api/decisions/${decisionId}/learning`);
    expect((gen.body as { regenerated: boolean }).regenerated).toBe(false);

    const { body } = await get(`/api/decisions/${decisionId}/learning`);
    const session = body.session as {
      completed: boolean;
      exercises: Array<{ id: string; attempts: Array<{ outcome: string }> }>;
    };
    expect(session.completed).toBe(true);
    expect(
      session.exercises.find((e) => e.id === mcqId)!.attempts.some((a) => a.outcome === 'pass'),
    ).toBe(true);
  });
});
