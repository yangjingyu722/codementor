import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MappingService } from '@codementor/code-mapping';
import { DecisionEngine } from '@codementor/decision-engine';
import { CodeMentorStorage } from '@codementor/storage';
import { TestRepo } from '../packages/code-mapping/test/test-repo.js';

/**
 * 阶段 3 验收场景：简化进程管理工程（proc.h / proc.c）。
 * CodeMentor 能够：找到 PCB 与 scheduler、关联设计决策、反向查询、变更后更新/标记失效。
 */

const PROC_H = `#ifndef PROC_H
#define PROC_H
#define MAX_PROC 8
enum proc_state { READY, RUNNING, BLOCKED };
struct pcb {
    int pid;
    enum proc_state state;
    int priority;
};
#endif
`;

const PROC_C = `#include "proc.h"
static struct pcb table[MAX_PROC];
static int current = -1;
void scheduler(void) {
    int next = -1;
    for (int i = 0; i < MAX_PROC; i++) {
        if (table[i].state == READY) { next = i; break; }
    }
    if (next >= 0) { current = next; table[next].state = RUNNING; }
}
int spawn(int priority) {
    for (int i = 0; i < MAX_PROC; i++) {
        if (table[i].pid == 0) {
            table[i].pid = i + 1;
            table[i].priority = priority;
            table[i].state = READY;
            return table[i].pid;
        }
    }
    return -1;
}
`;

let repo: TestRepo;
let storage: CodeMentorStorage;
let mapping: MappingService;
let project: { id: string };
let pcbDecisionId: string;
let schedulerDecisionId: string;

beforeAll(() => {
  repo = new TestRepo('cm-accept-');
  repo.write('proc.h', PROC_H);
  repo.write('proc.c', PROC_C);
  repo.commit('proc project baseline');

  const dbDir = mkdtempSync(path.join(tmpdir(), 'cm-acceptdb-'));
  storage = CodeMentorStorage.open(path.join(dbDir, 'accept.db'));
  const engine = new DecisionEngine(storage);
  mapping = new MappingService(storage);

  const p = engine.registerProject({ name: 'proc-demo', rootPath: repo.root });
  project = { id: p.id };
  const task = engine.startTask({ projectId: p.id, title: '实现简单进程调度' });

  const pcb = engine.declareDecision({
    taskId: task.id,
    question: '进程控制块为何用扁平结构体而不是指针链表',
    title: 'PCB 采用固定数组 + 扁平结构体',
    chosenOption: 'struct pcb 固定数组',
    alternatives: [{ name: '动态链表', summary: '灵活但引入分配/释放复杂度' }],
    decidedBy: 'agent',
    declaredClaims: [{ kind: 'constraint', statement: '最大进程数固定且小，静态分配足够' }],
  });
  pcbDecisionId = pcb.decision.id;

  const sched = engine.declareDecision({
    taskId: task.id,
    question: '调度器为何采用轮询而非优先级队列',
    title: '轮询调度器',
    chosenOption: '线性扫描就绪进程',
    alternatives: [{ name: '优先级队列', summary: '更快但维护成本高' }],
    decidedBy: 'agent',
    declaredClaims: [{ kind: 'tradeoff', statement: '进程数 ≤ 8 时轮询的常数更小' }],
  });
  schedulerDecisionId = sched.decision.id;
});

afterAll(() => {
  storage.close();
  repo.cleanup();
});

describe('验收：proc 工程的决策↔源码映射', () => {
  it('1&2. 找到 PCB 数据结构与 scheduler 函数（真实解析）', async () => {
    const pcb = await mapping.createAnchor({
      decisionId: pcbDecisionId,
      filePath: 'proc.h',
      symbolPath: ['pcb'],
      origin: 'declared',
    });
    expect(pcb).toMatchObject({
      symbolKind: 'struct',
      status: 'confirmed',
      startLine: 5,
      endLine: 9,
    });

    const sched = await mapping.createAnchor({
      decisionId: schedulerDecisionId,
      filePath: 'proc.c',
      symbolPath: ['scheduler'],
      origin: 'declared',
    });
    expect(sched).toMatchObject({
      symbolKind: 'function',
      status: 'confirmed',
      startLine: 4,
      endLine: 10,
    });
  });

  it('3. 决策与代码的关联已建立（按决策查询锚点）', () => {
    const pcbAnchors = mapping.listAnchors(pcbDecisionId);
    const schedAnchors = mapping.listAnchors(schedulerDecisionId);
    expect(pcbAnchors.map((a) => a.filePath)).toEqual(['proc.h']);
    expect(schedAnchors.map((a) => a.filePath)).toEqual(['proc.c']);
  });

  it('4. 反向查询：符号 → 对应的工程问题', () => {
    const matches = mapping.findDecisionsForSymbol('proc.c', 'scheduler');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.decision.id).toBe(schedulerDecisionId);
    expect(matches[0]!.decision.question).toContain('轮询');
    expect(matches[0]!.anchor.symbolPath).toEqual(['scheduler']);
  });

  it('5a. 代码变更后：scheduler 行号漂移被自动重定位', async () => {
    const before = mapping.listAnchors(schedulerDecisionId)[0]!;
    repo.write('proc.c', `/* 调度策略注释 */\n/* 第二行 */\n${PROC_C}`);
    repo.commit('add header comments');

    const { results } = await mapping.revalidateProject(project.id);
    expect(results.find((r) => r.anchorId === before.id)).toMatchObject({
      status: 'confirmed',
      relocated: true,
    });
    const after = mapping.listAnchors(schedulerDecisionId)[0]!;
    expect(after.startLine).toBe(before.startLine + 2);
    expect(after.endLine).toBe(before.endLine + 2);
  });

  it('5b. 符号删除后：PCB 锚点标记 missing，记录与历史保留', async () => {
    repo.write(
      'proc.h',
      `#ifndef PROC_H\n#define PROC_H\n#define MAX_PROC 8\nenum proc_state { READY, RUNNING, BLOCKED };\n#endif\n`,
    );
    repo.commit('remove pcb struct');

    const { results } = await mapping.revalidateProject(project.id);
    const pcbAnchor = mapping.listAnchors(pcbDecisionId)[0]!;
    const pcbResult = results.find((r) => r.anchorId === pcbAnchor.id);
    expect(pcbResult).toMatchObject({ status: 'missing' });
    expect(pcbAnchor.startLine).toBe(5); // 最后已知位置保留

    // scheduler 锚点不受影响
    const schedAnchor = mapping.listAnchors(schedulerDecisionId)[0]!;
    expect(schedAnchor.status).toBe('confirmed');
  });
});
