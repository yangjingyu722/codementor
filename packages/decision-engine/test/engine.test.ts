import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CodeMentorStorage } from '@codementor/storage';
import { CodeMentorError, DecisionEngine } from '@codementor/decision-engine';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'cm-engine-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 可推进的时钟：每次调用自增 1 秒（秒精度，无毫秒），保证时间戳单调且可控。 */
function makeClock(startSeconds: number): { now: () => string; tick: (n: number) => void } {
  let seconds = startSeconds;
  return {
    now: () => {
      const iso = new Date(Date.UTC(2026, 9, 24, 10, 0, seconds++)).toISOString();
      return `${iso.slice(0, -5)}Z`;
    },
    tick: (n: number) => {
      seconds += n;
    },
  };
}

function makeEngine(): {
  engine: DecisionEngine;
  clock: ReturnType<typeof makeClock>;
  close: () => void;
} {
  const storage = CodeMentorStorage.open(
    path.join(dir, `db-${Math.random().toString(36).slice(2)}.db`),
  );
  const clock = makeClock(0);
  return {
    engine: new DecisionEngine(storage, { now: clock.now }),
    clock,
    close: () => storage.close(),
  };
}

function startTaskWithDecision(engine: DecisionEngine): { taskId: string; decisionId: string } {
  const project = engine.registerProject({ name: 'demo', rootPath: '/repo/demo' });
  const task = engine.startTask({ projectId: project.id, title: '添加配置模块' });
  const { decision } = engine.declareDecision({
    taskId: task.id,
    question: '配置校验时机',
    title: '启动时全量校验',
    chosenOption: 'Zod fail-fast',
    alternatives: [{ name: '惰性校验', summary: '首次读取时校验' }],
    decidedBy: 'agent',
    declaredClaims: [{ kind: 'constraint', statement: '坏配置必须启动即失败' }],
  });
  return { taskId: task.id, decisionId: decision.id };
}

describe('DecisionEngine（真实存储 + 可控时钟）', () => {
  it('registerProject 按 rootPath 幂等', () => {
    const { engine, close } = makeEngine();
    const a = engine.registerProject({ name: 'demo', rootPath: '/repo/demo' });
    const b = engine.registerProject({ name: '改名也幂等', rootPath: '/repo/demo' });
    expect(b.id).toBe(a.id);
    close();
  });

  it('declaredAt 由服务端时钟盖章，且声明主张为 declared 来源', () => {
    const { engine, close } = makeEngine();
    const { decisionId } = startTaskWithDecision(engine);
    const bundle = engine.getDecisionBundle(decisionId);
    // 时钟调用序列：registerProject(0s) → startTask(1s) → declaredAt(2s) → 声明主张(3s)
    expect(bundle.decision.declaredAt).toBe('2026-10-24T10:00:02Z');
    expect(bundle.claims.map((c) => c.origin)).toEqual(['declared']);
    expect(bundle.integrity.ok).toBe(true);
    close();
  });

  it('declaredClaims 为空时拒绝（R1 门槛）', () => {
    const { engine, close } = makeEngine();
    const project = engine.registerProject({ name: 'demo', rootPath: '/repo/demo' });
    const task = engine.startTask({ projectId: project.id, title: 't' });
    try {
      engine.declareDecision({
        taskId: task.id,
        question: 'q',
        title: 't',
        chosenOption: 'c',
        decidedBy: 'agent',
        declaredClaims: [],
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CodeMentorError);
      expect((err as CodeMentorError).code).toBe('VALIDATION');
    }
    close();
  });

  it('任务非 active 时禁止声明决策（INVALID_STATE）', () => {
    const { engine, close } = makeEngine();
    const { taskId } = startTaskWithDecision(engine);
    engine.finishTask(taskId);
    try {
      engine.declareDecision({
        taskId,
        question: 'q',
        title: 't',
        chosenOption: 'c',
        decidedBy: 'agent',
        declaredClaims: [{ kind: 'risk', statement: 's' }],
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as CodeMentorError).code).toBe('INVALID_STATE');
    }
    close();
  });

  it('观察证据 pass → observed 主张 supported；verify 升级为 verified 并持久化', () => {
    const { engine, clock, close } = makeEngine();
    const { decisionId } = startTaskWithDecision(engine);
    clock.tick(60);
    const { claim, evidence } = engine.recordObservation({
      decisionId,
      claim: { kind: 'benefit', statement: '缺失配置时启动即失败（200ms 内退出）' },
      evidence: {
        kind: 'test_run',
        verdict: 'pass',
        contentRef: 'objects/evd-1.json',
        summary: '配置缺失用例通过',
      },
    });
    expect(claim.origin).toBe('observed');
    expect(claim.verification).toBe('supported');
    expect(claim.evidenceRefs).toEqual([evidence.id]);

    engine.markImplemented(decisionId);
    const { decision } = engine.verifyDecision(decisionId);
    expect(decision.status).toBe('verified');
    expect(engine.getDecisionBundle(decisionId).decision.status).toBe('verified');
    close();
  });

  it('无受支撑观察时 verify 拒绝（R4），返回 422 语义的 INTEGRITY_VIOLATION', () => {
    const { engine, close } = makeEngine();
    const { decisionId } = startTaskWithDecision(engine);
    try {
      engine.verifyDecision(decisionId);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as CodeMentorError).code).toBe('INTEGRITY_VIOLATION');
      const issues = (err as CodeMentorError).details as Array<{ code: string }>;
      expect(issues.map((i) => i.code)).toContain('verified-without-supported-observation');
    }
    close();
  });

  it('recordRationalization 的主张永远标记为 rationalized，不能充当声明或证据', () => {
    const { engine, close } = makeEngine();
    const { decisionId } = startTaskWithDecision(engine);
    const claim = engine.recordRationalization({
      decisionId,
      kind: 'benefit',
      statement: '事后看，分层让模块更清晰',
    });
    expect(claim.origin).toBe('rationalized');
    expect(claim.evidenceRefs).toEqual([]);

    // 增加事后解释不降低 verify 的证据门槛（R4 仍缺受支撑观察）
    try {
      engine.verifyDecision(decisionId);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as CodeMentorError).code).toBe('INTEGRITY_VIOLATION');
    }
    close();
  });

  it('回填早于 declaredAt 的 producedAt → 完整性暴露 declared-after-evidence', () => {
    const { engine, close } = makeEngine();
    const { decisionId } = startTaskWithDecision(engine); // declaredAt = 10:00:01
    engine.recordObservation({
      decisionId,
      claim: { kind: 'benefit', statement: '观察' },
      evidence: {
        kind: 'test_run',
        verdict: 'pass',
        contentRef: 'objects/x.json',
        producedAt: '2026-10-24T09:00:00Z', // 早于声明：时序造假在读取侧暴露
      },
    });
    const bundle = engine.getDecisionBundle(decisionId);
    expect(bundle.integrity.ok).toBe(false);
    expect(bundle.integrity.issues.map((i) => i.code)).toContain('declared-after-evidence');
    close();
  });

  it('finishTask 只允许 active → completed；重复 finish 报错', () => {
    const { engine, close } = makeEngine();
    const project = engine.registerProject({ name: 'demo', rootPath: '/repo/demo' });
    const task = engine.startTask({ projectId: project.id, title: 't' });
    const finished = engine.finishTask(task.id);
    expect(finished.status).toBe('completed');
    expect(() => engine.finishTask(task.id)).toThrowError(CodeMentorError);
    close();
  });

  it('输入校验：非法字段值报 VALIDATION 并附 issues', () => {
    const { engine, close } = makeEngine();
    try {
      engine.startTask({ projectId: '', title: 't' }); // projectId 为空字符串
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as CodeMentorError).code).toBe('VALIDATION');
      expect((err as CodeMentorError).details).toBeDefined();
    }
    close();
  });
});
