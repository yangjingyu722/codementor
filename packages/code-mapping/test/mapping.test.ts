import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DecisionEngine } from '@codementor/decision-engine';
import { CodeMentorStorage } from '@codementor/storage';
import { MappingService, hashSymbolText } from '../src/index.js';
import { TestRepo } from './test-repo.js';

let dbDir: string;
beforeAll(() => {
  dbDir = mkdtempSync(path.join(tmpdir(), 'cm-mapdb-'));
});
afterAll(() => {
  rmSync(dbDir, { recursive: true, force: true });
});

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
`;

/** 每个场景独立的：临时 git 仓库 + 临时数据库 + 引擎/映射服务。 */
function makeEnv(files: Record<string, string>, commitMsg = 'init') {
  const repo = new TestRepo('cm-map-');
  for (const [rel, content] of Object.entries(files)) {
    repo.write(rel, content);
  }
  repo.commit(commitMsg);

  const storage = CodeMentorStorage.open(
    path.join(dbDir, `map-${Math.random().toString(36).slice(2)}.db`),
  );
  const engine = new DecisionEngine(storage);
  const mapping = new MappingService(storage);
  const project = engine.registerProject({ name: 'proc-demo', rootPath: repo.root });
  const task = engine.startTask({ projectId: project.id, title: '实现进程调度' });
  const { decision } = engine.declareDecision({
    taskId: task.id,
    question: '调度器为何轮询就绪态',
    title: '轮询调度器',
    chosenOption: '单链轮询 + 状态标记',
    decidedBy: 'agent',
    declaredClaims: [{ kind: 'constraint', statement: '无抢占需求，轮询足够' }],
  });
  return { repo, storage, engine, mapping, project, task, decision };
}

function anchorInput(
  decisionId: string,
  filePath: string,
  symbol: string,
  origin: 'declared' | 'inferred' = 'declared',
) {
  return { decisionId, filePath, symbolPath: [symbol], origin };
}

describe('MappingService：锚定与失效（真实仓库 + 真实存储）', () => {
  it('场景1 新增函数：符号不存在时拒绝创建；出现后锚定成功且行号准确', async () => {
    const env = makeEnv({ 'proc.h': PROC_H, 'proc.c': PROC_C });
    try {
      // v1 中尚无 spawn 函数
      await expect(
        env.mapping.createAnchor(anchorInput(env.decision.id, 'proc.c', 'spawn')),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const withSpawn = `${PROC_C}int spawn(int priority) {\n    return priority;\n}\n`;
      env.repo.write('proc.c', withSpawn);
      env.repo.commit('add spawn');
      const anchor = await env.mapping.createAnchor(
        anchorInput(env.decision.id, 'proc.c', 'spawn'),
      );
      expect(anchor.status).toBe('confirmed');
      expect(anchor.symbolKind).toBe('function');
      expect(anchor.startLine).toBe(PROC_C.split('\n').length); // 紧随原内容之后
      expect(anchor.contentHash).toBe(hashSymbolText(withSpawn, anchor.startLine, anchor.endLine));
    } finally {
      env.repo.cleanup();
      env.storage.close();
    }
  });

  it('场景2 修改函数：重定位后行范围与内容哈希更新到新提交', async () => {
    const env = makeEnv({ 'proc.h': PROC_H, 'proc.c': PROC_C });
    try {
      const anchor = await env.mapping.createAnchor(
        anchorInput(env.decision.id, 'proc.c', 'scheduler'),
      );
      const original = { ...anchor };

      const modified = PROC_C.replace(
        '    if (next >= 0) { current = next; table[next].state = RUNNING; }',
        '    if (next >= 0) {\n        current = next;\n        table[next].state = RUNNING;\n    }',
      );
      env.repo.write('proc.c', modified);
      const newHead = env.repo.commit('extend scheduler body');

      const { results } = await env.mapping.revalidateProject(env.project.id);
      expect(results[0]).toMatchObject({ status: 'confirmed', relocated: true });
      const updated = env.storage.getCodeAnchor(anchor.id);
      expect(updated.commitSha).toBe(newHead);
      expect(updated.endLine).toBeGreaterThan(original.endLine);
      expect(updated.contentHash).not.toBe(original.contentHash);
      expect(updated.contentHash).toBe(
        hashSymbolText(modified, updated.startLine, updated.endLine),
      );
    } finally {
      env.repo.cleanup();
      env.storage.close();
    }
  });

  it('场景3 新增结构体：struct 与 typedef 均可锚定', async () => {
    const env = makeEnv({ 'proc.h': PROC_H, 'proc.c': PROC_C });
    try {
      const structAnchor = await env.mapping.createAnchor(
        anchorInput(env.decision.id, 'proc.h', 'pcb'),
      );
      expect(structAnchor.symbolKind).toBe('struct');
      expect(structAnchor.startLine).toBe(5);
      expect(structAnchor.endLine).toBe(9);

      env.repo.write('types.h', 'typedef struct runq { int head; } runq_t;\n');
      env.repo.commit('add typedef');
      const td = await env.mapping.createAnchor(anchorInput(env.decision.id, 'types.h', 'runq_t'));
      expect(td.symbolKind).toBe('typedef');
    } finally {
      env.repo.cleanup();
      env.storage.close();
    }
  });

  it('场景4 同名函数不同文件：锚点各归其位，反向查询互不串扰', async () => {
    const env = makeEnv({
      'proc.h': PROC_H,
      'proc.c': `${PROC_C}static void tick(void) { sched_tick++; }\n`,
      'switch.c': 'static void tick(void) { switch_tick++; }\n',
    });
    try {
      const { decision: d2 } = env.engine.declareDecision({
        taskId: env.task.id,
        question: '上下文切换计数为何分文件维护',
        title: '独立计数器',
        chosenOption: '编译单元内 static 计数',
        decidedBy: 'agent',
        declaredClaims: [{ kind: 'benefit', statement: '避免跨单元链接依赖' }],
      });
      const a1 = await env.mapping.createAnchor(anchorInput(env.decision.id, 'proc.c', 'tick'));
      const a2 = await env.mapping.createAnchor(anchorInput(d2.id, 'switch.c', 'tick'));
      expect(a1.filePath).toBe('proc.c');
      expect(a2.filePath).toBe('switch.c');

      const inProc = env.mapping.findDecisionsForSymbol('proc.c', 'tick');
      const inSwitch = env.mapping.findDecisionsForSymbol('switch.c', 'tick');
      expect(inProc).toHaveLength(1);
      expect(inSwitch).toHaveLength(1);
      expect(inProc[0]!.decision.id).toBe(env.decision.id);
      expect(inSwitch[0]!.decision.id).toBe(d2.id);
    } finally {
      env.repo.cleanup();
      env.storage.close();
    }
  });

  it('场景5 函数位置移动：仅重定位行号，不改内容哈希以外的语义', async () => {
    const env = makeEnv({ 'proc.h': PROC_H, 'proc.c': PROC_C });
    try {
      const anchor = await env.mapping.createAnchor(
        anchorInput(env.decision.id, 'proc.c', 'scheduler'),
      );
      const shifted = `/* 新增的文件头注释 */\n/* 第二行 */\n${PROC_C}`;
      env.repo.write('proc.c', shifted);
      env.repo.commit('shift lines');

      await env.mapping.revalidateProject(env.project.id);
      const updated = env.storage.getCodeAnchor(anchor.id);
      expect(updated.status).toBe('confirmed');
      expect(updated.startLine).toBe(anchor.startLine + 2);
      expect(updated.contentHash).toBe(hashSymbolText(shifted, updated.startLine, updated.endLine));
    } finally {
      env.repo.cleanup();
      env.storage.close();
    }
  });

  it('场景6 文件重命名：经 git -M 跟随到新路径', async () => {
    const env = makeEnv({ 'proc.h': PROC_H, 'proc.c': PROC_C });
    try {
      const anchor = await env.mapping.createAnchor(
        anchorInput(env.decision.id, 'proc.c', 'scheduler'),
      );
      env.repo.mv('proc.c', 'process.c');
      env.repo.commit('rename file');

      const { results } = await env.mapping.revalidateProject(env.project.id);
      expect(results[0]).toMatchObject({ status: 'confirmed' });
      const updated = env.storage.getCodeAnchor(anchor.id);
      expect(updated.filePath).toBe('process.c');
      expect(updated.status).toBe('confirmed');
    } finally {
      env.repo.cleanup();
      env.storage.close();
    }
  });

  it('场景7 符号删除：标记 missing，记录保留、不静默清除', async () => {
    const env = makeEnv({ 'proc.h': PROC_H, 'proc.c': PROC_C });
    try {
      const anchor = await env.mapping.createAnchor(
        anchorInput(env.decision.id, 'proc.c', 'scheduler'),
      );
      env.repo.write(
        'proc.c',
        `#include "proc.h"\nstatic struct pcb table[MAX_PROC];\n/* scheduler 已被移除 */\n`,
      );
      env.repo.commit('remove scheduler');

      const { results } = await env.mapping.revalidateProject(env.project.id);
      expect(results[0]).toMatchObject({ status: 'missing', relocated: false });
      const kept = env.storage.getCodeAnchor(anchor.id);
      expect(kept.status).toBe('missing');
      expect(kept.startLine).toBe(anchor.startLine); // 保留最后已知位置
    } finally {
      env.repo.cleanup();
      env.storage.close();
    }
  });

  it('场景8 语法错误：创建拒绝；重验证标 ambiguous 而非猜测位置', async () => {
    const env = makeEnv({ 'proc.h': PROC_H, 'proc.c': PROC_C });
    try {
      const anchor = await env.mapping.createAnchor(
        anchorInput(env.decision.id, 'proc.c', 'scheduler'),
      );
      // 先锚定成功，再引入语法错误
      env.repo.write('proc.c', `${PROC_C}\nvoid broken( { ;;;\n`);
      env.repo.commit('introduce syntax error');

      await expect(
        env.mapping.createAnchor(anchorInput(env.decision.id, 'proc.c', 'broken')),
      ).rejects.toMatchObject({ code: 'INVALID_STATE' });

      await env.mapping.revalidateProject(env.project.id);
      const updated = env.storage.getCodeAnchor(anchor.id);
      expect(updated.status).toBe('ambiguous');
      expect(updated.startLine).toBe(anchor.startLine); // 不更新为可能错误的位置
    } finally {
      env.repo.cleanup();
      env.storage.close();
    }
  });

  it('ambiguous：条件编译产生两个同名结构体时创建与重验证都拒绝精确定位', async () => {
    const env = makeEnv({ 'proc.h': PROC_H, 'proc.c': PROC_C });
    try {
      await expect(
        env.mapping.createAnchor(anchorInput(env.decision.id, 'proc.h', 'pcb')),
      ).resolves.toMatchObject({ status: 'confirmed' });

      const dual = `#ifndef PROC_H\n#define PROC_H\n#ifdef FAST\nstruct pcb { int pid; int fast; };\n#else\nstruct pcb { int pid; int slow; };\n#endif\n#endif\n`;
      env.repo.write('proc.h', dual);
      env.repo.commit('dual pcb');
      await env.mapping.revalidateProject(env.project.id);
      const anchors = env.storage.listCodeAnchorsByDecision(env.decision.id);
      expect(anchors.find((a) => a.filePath === 'proc.h')?.status).toBe('ambiguous');
    } finally {
      env.repo.cleanup();
      env.storage.close();
    }
  });

  it('来源三角：declared 与 inferred 关联并存且可区分；自动提案绝不落库', async () => {
    const env = makeEnv({ 'proc.h': PROC_H, 'proc.c': PROC_C });
    try {
      const declared = await env.mapping.createAnchor(
        anchorInput(env.decision.id, 'proc.c', 'scheduler', 'declared'),
      );
      const inferred = await env.mapping.createAnchor(
        anchorInput(env.decision.id, 'proc.h', 'pcb', 'inferred'),
      );
      expect(declared.origin).toBe('declared');
      expect(inferred.origin).toBe('inferred');

      // 提案流程：新增 spawn，并真正修改 scheduler 函数体
      const v1 = env.repo.head();
      const next = `${PROC_C.replace('int next = -1;', 'int next = -2;')}int spawn(int p) { return p; }\n`;
      env.repo.write('proc.c', next);
      const v2 = env.repo.commit('add spawn, tweak scheduler');

      const { proposals } = await env.mapping.proposeAnchors({
        taskId: env.task.id,
        oldRev: v1,
        newRev: v2,
      });
      const names = proposals.map((p) => `${p.change}:${p.symbol.name}`).sort();
      expect(names).toContain('added:spawn');
      expect(names).toContain('modified:scheduler');
      expect(proposals.every((p) => p.candidateDecisionIds.includes(env.decision.id))).toBe(true);
      // 提案不落库：锚点数量不变
      expect(env.storage.listCodeAnchorsByDecision(env.decision.id)).toHaveLength(2);
    } finally {
      env.repo.cleanup();
      env.storage.close();
    }
  });

  it('路径穿越与未知类型被拒绝', async () => {
    const env = makeEnv({ 'proc.h': PROC_H, 'proc.c': PROC_C });
    try {
      await expect(
        env.mapping.createAnchor(anchorInput(env.decision.id, '../outside.c', 'x')),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      // 文件存在但没有注册对应语言的解析器 → VALIDATION
      env.repo.write('notes.md', '# notes\n');
      await expect(
        env.mapping.createAnchor(anchorInput(env.decision.id, 'notes.md', 'x')),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(
        env.mapping.createAnchor(anchorInput('dec_missing', 'proc.c', 'scheduler')),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      env.repo.cleanup();
      env.storage.close();
    }
  });

  it('完整工作流不读取文件时间：时间语义只有 git 版本与服务端时钟', async () => {
    const env = makeEnv({ 'proc.h': PROC_H, 'proc.c': PROC_C });
    try {
      const anchor = await env.mapping.createAnchor(
        anchorInput(env.decision.id, 'proc.c', 'scheduler'),
      );
      expect(anchor.commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(anchor.anchoredAt).toBeTruthy();
      expect(anchor).not.toHaveProperty('mtime');
    } finally {
      env.repo.cleanup();
      env.storage.close();
    }
  });
});
