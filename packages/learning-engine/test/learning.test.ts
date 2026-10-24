import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DecisionEngine } from '@codementor/decision-engine';
import { CodeMentorStorage } from '@codementor/storage';
import { LearningEngine } from '../src/index.js';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'cm-learn-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 真实决策夹具：含备选、声明主张、锚点（可选观察证据）。 */
function makeWorld(opts: { withAlternatives: boolean; withAnchors: boolean }) {
  const storage = CodeMentorStorage.open(
    path.join(dir, `learn-${Math.random().toString(36).slice(2)}.db`),
  );
  const engine = new DecisionEngine(storage);
  const learning = new LearningEngine(storage);
  const project = engine.registerProject({ name: 'riscv-os', rootPath: '/repo/riscv-os' });
  const task = engine.startTask({ projectId: project.id, title: '实现上下文切换' });
  const { decision } = engine.declareDecision({
    taskId: task.id,
    question: '为什么需要上下文切换，切换时为何只保存部分寄存器？',
    title: '上下文切换采用 callee-saved 策略',
    chosenOption: '仅保存 callee-saved 寄存器（ra/sp/s0-s11）',
    alternatives: opts.withAlternatives
      ? [{ name: '全量寄存器保存', summary: '保存全部 32 个通用寄存器，实现简单但切换开销大' }]
      : [],
    decidedBy: 'agent',
    declaredClaims: [
      {
        kind: 'tradeoff',
        statement:
          'RISC-V 调用约定下 caller-saved 寄存器由编译器在调用点保存，内核只需保存 callee-saved 寄存器',
      },
    ],
  });

  let anchorId: string | undefined;
  if (opts.withAnchors) {
    const anchor = storage.createCodeAnchor({
      decisionId: decision.id,
      filePath: 'swtch.c',
      symbolPath: ['swtch'],
      symbolKind: 'function',
      startLine: 3,
      endLine: 6,
      contentHash: 'a'.repeat(64),
      commitSha: 'a'.repeat(40),
      status: 'confirmed',
      origin: 'declared',
      anchoredAt: '2026-10-24T10:00:00Z',
    });
    anchorId = anchor.id;
  }
  return { storage, engine, learning, decision, task, anchorId, close: () => storage.close() };
}

describe('LearningEngine（真实存储，确定性模板）', () => {
  it('要求1：从真实决策生成学习任务（predict/locate/transfer 三题且引用真实数据）', () => {
    const w = makeWorld({ withAlternatives: true, withAnchors: true });
    try {
      const { regenerated, session } = w.learning.generateSession(w.decision.id);
      expect(regenerated).toBe(true);
      expect(session.decision.question).toContain('上下文切换');
      const types = session.exercises.map((e) => e.type);
      expect(types).toContain('predict_choice');
      expect(types).toContain('locate_code');
      expect(types).toContain('open_explanation');

      const mcq = session.exercises.find((e) => e.type === 'predict_choice')!;
      expect(mcq.flowStep).toBe('predict');
      expect(mcq.options).toContain(w.decision.chosenOption);
      expect(mcq.options).toHaveLength(2);
      expect(mcq.hints[0]).toContain('全量寄存器保存');

      const locate = session.exercises.find((e) => e.type === 'locate_code')!;
      expect(locate.prompt).toContain('swtch');

      const transfer = session.exercises.find((e) => e.type === 'open_explanation')!;
      expect(transfer.prompt).toContain(w.decision.chosenOption);
    } finally {
      w.close();
    }
  });

  it('要求2：答案正确 → pass，反馈引用真实工程信息', () => {
    const w = makeWorld({ withAlternatives: true, withAnchors: true });
    try {
      const { session } = w.learning.generateSession(w.decision.id);
      const mcq = session.exercises.find((e) => e.type === 'predict_choice')!;
      const correctText = w.decision.chosenOption;
      const result = w.learning.submitAttempt(mcq.id, { answer: correctText, level: 2 });
      expect(result.outcome).toBe('pass');
      expect(result.feedback).toContain(correctText);

      const locate = session.exercises.find((e) => e.type === 'locate_code')!;
      const ok = w.learning.submitAttempt(locate.id, { answer: 'swtch.c swtch', level: 2 });
      expect(ok.outcome).toBe('pass');
    } finally {
      w.close();
    }
  });

  it('要求3：答案错误 → 有针对性的解释（引用真实备选/真实位置）', () => {
    const w = makeWorld({ withAlternatives: true, withAnchors: true });
    try {
      const { session } = w.learning.generateSession(w.decision.id);
      const mcq = session.exercises.find((e) => e.type === 'predict_choice')!;
      const wrong = w.learning.submitAttempt(mcq.id, {
        answer: '全量寄存器保存',
        level: 2,
      });
      expect(wrong.outcome).toBe('fail');
      expect(wrong.feedback).toContain(w.decision.chosenOption);

      const locate = session.exercises.find((e) => e.type === 'locate_code')!;
      const miss = w.learning.submitAttempt(locate.id, { answer: 'proc.c scheduler', level: 2 });
      expect(miss.outcome).toBe('fail');
      expect(miss.feedback).toContain('swtch.c');
      expect(miss.feedback).toContain('swtch');
    } finally {
      w.close();
    }
  });

  it('要求4：缺少证据/锚点时不生成虚假引用（无锚点→无定位题；解释只引用真实主张）', () => {
    const w = makeWorld({ withAlternatives: true, withAnchors: false });
    try {
      const { session } = w.learning.generateSession(w.decision.id);
      expect(session.exercises.find((e) => e.type === 'locate_code')).toBeUndefined();
      // 解释文本只引用真实声明主张，不出现任何虚构的"测试结果"
      expect(session.explanation).toContain('RISC-V 调用约定');
      expect(session.explanation).not.toContain('已被证据支撑的观察事实');
    } finally {
      w.close();
    }
  });

  it('要求5：作答可靠保存（落库可查，含 level 与 gradedBy）', () => {
    const w = makeWorld({ withAlternatives: true, withAnchors: true });
    try {
      const { session } = w.learning.generateSession(w.decision.id);
      const mcq = session.exercises.find((e) => e.type === 'predict_choice')!;
      w.learning.submitAttempt(mcq.id, { answer: w.decision.chosenOption, level: 3 });
      const attempts = w.storage.listAttemptsByExercise(mcq.id);
      expect(attempts).toHaveLength(1);
      expect(attempts[0]!.level).toBe(3);
      expect(attempts[0]!.gradedBy).toBe('deterministic');
      expect(attempts[0]!.outcome).toBe('pass');
    } finally {
      w.close();
    }
  });

  it('要求6：重开存储后进度可恢复（会话状态由 Attempt 派生）', () => {
    const dbPath = path.join(dir, `persist-${Math.random().toString(36).slice(2)}.db`);
    const storage = CodeMentorStorage.open(dbPath);
    const engine = new DecisionEngine(storage);
    const learning = new LearningEngine(storage);
    const project = engine.registerProject({ name: 'p', rootPath: '/repo/p' });
    const task = engine.startTask({ projectId: project.id, title: 't' });
    const { decision } = engine.declareDecision({
      taskId: task.id,
      question: 'q',
      title: 't',
      chosenOption: '甲方案',
      alternatives: [{ name: '乙方案', summary: '备选' }],
      decidedBy: 'agent',
      declaredClaims: [{ kind: 'benefit', statement: '甲方案实现更简单清晰' }],
    });
    const { session } = learning.generateSession(decision.id);
    const mcq = session.exercises.find((e) => e.type === 'predict_choice')!;
    learning.submitAttempt(mcq.id, { answer: '甲方案', level: 2 });
    storage.close();

    // 重新打开：生成幂等 + 进度恢复（关闭放在 finally，避免失败时句柄泄漏）
    let reopenedStorage: CodeMentorStorage | undefined;
    try {
      reopenedStorage = CodeMentorStorage.open(dbPath);
      const reopened = new LearningEngine(reopenedStorage);
      const again = reopened.generateSession(decision.id);
      expect(again.regenerated).toBe(false);
      expect(again.session.completedExerciseIds).toContain(mcq.id);
      expect(again.session.recommendedLevel).toBe(3);
      const finalSession = again.session;
      // 会话视图剥离 answerKey：raw 存储里仍存在（供服务端评分），视图层不可见
      const rawExercise = reopenedStorage.listExercisesByDecision(decision.id);
      expect(rawExercise.every((e) => e.answerKey !== undefined)).toBe(true);
      expect(finalSession.exercises.every((e) => !('answerKey' in e))).toBe(true);
    } finally {
      reopenedStorage?.close();
    }
  });

  it('要求7：学习任务与 Decision 正确关联（会话只含该决策的练习）', () => {
    const w = makeWorld({ withAlternatives: true, withAnchors: true });
    try {
      // 另一个任务/决策也生成会话，验证两套练习互不串扰
      const task2 = w.engine.startTask({
        projectId: w.storage.findProjectByRootPath('/repo/riscv-os')!.id,
        title: '另一个任务',
      });
      const { decision: other } = w.engine.declareDecision({
        taskId: task2.id,
        question: '中断为何要嵌套',
        title: '中断嵌套策略',
        chosenOption: '两层嵌套',
        alternatives: [{ name: '单层', summary: '实现最简单' }],
        decidedBy: 'agent',
        declaredClaims: [{ kind: 'risk', statement: '嵌套过深会耗尽内核栈' }],
      });
      const mine = w.learning.generateSession(w.decision.id).session;
      const theirs = w.learning.generateSession(other.id).session;
      expect(mine.exercises.every((e) => e.decisionId === w.decision.id)).toBe(true);
      expect(theirs.exercises.every((e) => e.decisionId === other.id)).toBe(true);
      expect(mine.exercises).not.toHaveLength(
        theirs.exercises.length === 0 ? -1 : mine.exercises.length + 1,
      );
    } finally {
      w.close();
    }
  });

  it('要求8：学习不阻塞开发流程（练习/作答不触碰决策状态与完整性）', () => {
    const w = makeWorld({ withAlternatives: true, withAnchors: true });
    try {
      w.engine.markImplemented(w.decision.id);
      const before = w.engine.getDecisionBundle(w.decision.id);
      const { session } = w.learning.generateSession(w.decision.id);
      const mcq = session.exercises.find((e) => e.type === 'predict_choice')!;
      w.learning.submitAttempt(mcq.id, { answer: '全量寄存器保存', level: 1 });
      const after = w.engine.getDecisionBundle(w.decision.id);
      expect(after.decision.status).toBe(before.decision.status);
      expect(after.claims).toEqual(before.claims);
      expect(after.integrity).toEqual(before.integrity);
    } finally {
      w.close();
    }
  });

  it('幂等生成：重复调用不产生重复练习、不破坏已有作答', () => {
    const w = makeWorld({ withAlternatives: true, withAnchors: true });
    try {
      const first = w.learning.generateSession(w.decision.id);
      const mcq = first.session.exercises.find((e) => e.type === 'predict_choice')!;
      w.learning.submitAttempt(mcq.id, { answer: w.decision.chosenOption, level: 2 });
      const second = w.learning.generateSession(w.decision.id);
      expect(second.regenerated).toBe(false);
      expect(second.session.exercises).toHaveLength(first.session.exercises.length);
      const mcqAgain = second.session.exercises.find((e) => e.type === 'predict_choice')!;
      expect(mcqAgain.attempts).toHaveLength(1);
    } finally {
      w.close();
    }
  });

  it('级别推荐：有 fail → 1；有 pass → 3；无作答 → 2', () => {
    const w = makeWorld({ withAlternatives: true, withAnchors: true });
    try {
      const { session } = w.learning.generateSession(w.decision.id);
      expect(session.recommendedLevel).toBe(2);
      const mcq = session.exercises.find((e) => e.type === 'predict_choice')!;
      w.learning.submitAttempt(mcq.id, { answer: '全量寄存器保存', level: 2 });
      expect(w.learning.getSession(w.decision.id).recommendedLevel).toBe(1);
      w.learning.submitAttempt(mcq.id, { answer: w.decision.chosenOption, level: 2 });
      expect(w.learning.getSession(w.decision.id).recommendedLevel).toBe(3);
    } finally {
      w.close();
    }
  });

  it('rubric 评分：pass/partial/fail 三档且反馈引用真实要点', () => {
    const w = makeWorld({ withAlternatives: true, withAnchors: true });
    try {
      const { session } = w.learning.generateSession(w.decision.id);
      const transfer = session.exercises.find((e) => e.type === 'open_explanation')!;

      const good = w.learning.submitAttempt(transfer.id, {
        answer:
          'RISC-V 调用约定下 caller-saved 寄存器由编译器保存，所以内核只需要保存 callee-saved 寄存器，切换开销小。',
        level: 2,
      });
      expect(good.outcome).toBe('pass');

      const partial = w.learning.submitAttempt(transfer.id, {
        answer: '因为 callee-saved 寄存器更少。',
        level: 1,
      });
      expect(partial.outcome).toBe('partial');
      expect(partial.feedback).toContain('真实设计要点');

      const bad = w.learning.submitAttempt(transfer.id, { answer: '不知道', level: 1 });
      expect(bad.outcome).toBe('fail');
      expect(bad.feedback).toContain('真实设计要点');
    } finally {
      w.close();
    }
  });

  it('缺 claims 的决策拒绝生成（不造假内容）；会话视图剥离 answerKey', () => {
    const w = makeWorld({ withAlternatives: true, withAnchors: true });
    try {
      // 直接经存储写入一个无主张决策（绕过引擎门槛）来验证防线
      const bare = w.storage.createDecision({
        projectId: w.storage.findProjectByRootPath('/repo/riscv-os')!.id,
        taskId: w.task.id,
        question: 'q',
        title: 't',
        chosenOption: 'c',
        alternatives: [],
        status: 'draft',
        decidedBy: 'agent',
        declaredAt: '2026-10-24T10:00:00Z',
      });
      expect(() => w.learning.generateSession(bare.id)).toThrowError(/no claims/);

      const { session } = w.learning.generateSession(w.decision.id);
      expect(session.exercises.every((e) => !('answerKey' in e))).toBe(true);
    } finally {
      w.close();
    }
  });
});
