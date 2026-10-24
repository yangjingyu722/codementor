import { describe, expect, it } from 'vitest';
import {
  type Claim,
  type Decision,
  type Evidence,
  validateDecisionIntegrity,
} from '@codementor/contracts';

const decision: Decision = {
  id: 'd1',
  projectId: 'p1',
  taskId: 't1',
  question: '为什么用 SQLite 而不是文件 JSON 存储',
  title: '存储采用 SQLite',
  chosenOption: 'SQLite',
  alternatives: [{ name: 'JSON 文件', summary: '实现最简单但无查询能力' }],
  status: 'implemented',
  decidedBy: 'agent',
  declaredAt: '2026-01-02T01:00:00Z',
};

const declaredClaim: Claim = {
  id: 'c1',
  decisionId: 'd1',
  kind: 'constraint',
  origin: 'declared',
  statement: '决策查询需要按任务与状态过滤，必须有索引能力',
  verification: 'unverified',
  evidenceRefs: [],
  createdAt: '2026-01-02T01:00:00Z',
};

const observedClaim: Claim = {
  id: 'c2',
  decisionId: 'd1',
  kind: 'benefit',
  origin: 'observed',
  statement: '一万条决策记录的过滤查询在 10ms 内完成',
  verification: 'supported',
  evidenceRefs: ['e1'],
  createdAt: '2026-01-02T02:00:00Z',
};

const evidence: Evidence = {
  id: 'e1',
  kind: 'test_run',
  verdict: 'pass',
  producedAt: '2026-01-02T02:00:00Z',
  producedBy: 'agent',
  contentRef: 'objects/e1.json',
  summary: '存储基准测试通过',
};

describe('validateDecisionIntegrity', () => {
  it('完整场景通过', () => {
    const result = validateDecisionIntegrity({
      decision,
      claims: [declaredClaim, observedClaim],
      evidence: [evidence],
    });
    expect(result).toEqual({ ok: true, issues: [] });
  });

  it('R1: 只有 rationalized 主张时报告 missing-declared-claim', () => {
    const rationalized: Claim = {
      ...declaredClaim,
      id: 'c9',
      origin: 'rationalized',
    };
    const result = validateDecisionIntegrity({
      decision,
      claims: [rationalized],
      evidence: [],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('missing-declared-claim');
  });

  it('R2: 引用不存在的证据', () => {
    const dangling: Claim = { ...observedClaim, evidenceRefs: ['ghost'] };
    const result = validateDecisionIntegrity({
      decision,
      claims: [declaredClaim, dangling],
      evidence: [],
    });
    expect(result.issues.map((i) => i.code)).toContain('unknown-evidence-ref');
  });

  it('R3: observed 主张不引用证据', () => {
    const bare: Claim = { ...observedClaim, evidenceRefs: [] };
    const result = validateDecisionIntegrity({
      decision,
      claims: [declaredClaim, bare],
      evidence: [],
    });
    expect(result.issues.map((i) => i.code)).toContain('observed-claim-without-evidence');
  });

  it('R4: verified 决策缺少受支撑的 observed 主张', () => {
    const verified: Decision = { ...decision, status: 'verified' };
    const result = validateDecisionIntegrity({
      decision: verified,
      claims: [declaredClaim],
      evidence: [],
    });
    expect(result.issues.map((i) => i.code)).toContain('verified-without-supported-observation');
  });

  it('R4: 补充受支撑的 observed 主张后通过', () => {
    const verified: Decision = { ...decision, status: 'verified' };
    const result = validateDecisionIntegrity({
      decision: verified,
      claims: [declaredClaim, observedClaim],
      evidence: [evidence],
    });
    expect(result.ok).toBe(true);
  });

  it('R5: 声明时间晚于观察证据产生时间', () => {
    const late: Decision = { ...decision, declaredAt: '2026-01-02T03:00:00Z' };
    const result = validateDecisionIntegrity({
      decision: late,
      claims: [declaredClaim, observedClaim],
      evidence: [evidence],
    });
    expect(result.issues.map((i) => i.code)).toContain('declared-after-evidence');
  });

  it('忽略属于其他决策的主张', () => {
    const foreign: Claim = { ...observedClaim, id: 'cX', decisionId: 'd-other' };
    const result = validateDecisionIntegrity({
      decision,
      claims: [declaredClaim, foreign],
      evidence: [evidence],
    });
    expect(result.ok).toBe(true);
  });
});
