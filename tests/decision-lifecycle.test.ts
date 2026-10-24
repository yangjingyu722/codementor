/**
 * 根级集成测试：验证从仓库根目录通过包入口 '@codementor/contracts'
 * 能完成一次真实的“声明 → 实现 → 观察 → 验证 → 学习”数据流转。
 */
import { describe, expect, it } from 'vitest';
import {
  AttemptSchema,
  ClaimSchema,
  CodeAnchorSchema,
  DecisionSchema,
  EvidenceSchema,
  ExerciseSchema,
  ProjectSchema,
  TaskSchema,
  validateDecisionIntegrity,
} from '@codementor/contracts';

describe('决策生命周期端到端契约流转', () => {
  const project = ProjectSchema.parse({
    id: 'pj-1',
    name: 'demo-app',
    rootPath: '/home/dev/demo-app',
    createdAt: '2026-10-20T08:00:00Z',
  });

  const task = TaskSchema.parse({
    id: 'task-42',
    projectId: project.id,
    title: '引入配置模块',
    goal: '环境变量可覆盖默认配置，错误尽早暴露',
    status: 'active',
    startedAt: '2026-10-20T08:05:00Z',
  });

  // 1) Agent 通过 MCP 工具在写代码之前声明决策与意图主张
  const decision = DecisionSchema.parse({
    id: 'dec-1',
    projectId: project.id,
    taskId: task.id,
    question: '配置解析失败应何时暴露给开发者',
    title: '启动时全量校验配置',
    chosenOption: 'Zod 启动时校验，fail fast',
    alternatives: [
      { name: '惰性校验', summary: '首次读取时才校验，启动更快' },
      { name: '不校验', summary: '依赖下游类型系统兜底' },
    ],
    status: 'declared',
    decidedBy: 'agent',
    declaredAt: '2026-10-20T08:10:00Z',
  });

  const intentClaim = ClaimSchema.parse({
    id: 'claim-1',
    decisionId: decision.id,
    kind: 'constraint',
    origin: 'declared',
    statement: '坏配置必须让进程在启动阶段失败，而不是运行到一半',
    createdAt: '2026-10-20T08:10:00Z',
  });

  // 2) 实现之后，观察事实与证据产生
  const testEvidence = EvidenceSchema.parse({
    id: 'evd-1',
    kind: 'test_run',
    verdict: 'pass',
    producedAt: '2026-10-20T08:40:00Z',
    producedBy: 'agent',
    contentRef: 'objects/evd-1.json',
    summary: '配置缺失字段时进程启动失败的用例通过',
  });

  const observedClaim = ClaimSchema.parse({
    id: 'claim-2',
    decisionId: decision.id,
    kind: 'benefit',
    origin: 'observed',
    statement: '缺失必填配置时进程在 200ms 内以非零码退出',
    verification: 'supported',
    evidenceRefs: [testEvidence.id],
    createdAt: '2026-10-20T08:41:00Z',
  });

  const anchor = CodeAnchorSchema.parse({
    id: 'anch-1',
    decisionId: decision.id,
    filePath: 'src/config.ts',
    startLine: 5,
    endLine: 30,
    symbolPath: ['loadConfig'],
    commitSha: 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3',
  });

  it('声明 → 观察 → 验证 全链路完整性通过，可升级为 verified', () => {
    const verified = DecisionSchema.parse({ ...decision, status: 'verified' });
    const result = validateDecisionIntegrity({
      decision: verified,
      claims: [intentClaim, observedClaim],
      evidence: [testEvidence],
    });
    expect(result.ok).toBe(true);
    expect(anchor).toBeDefined();
  });

  it('篡改声明时间到证据之后，完整性校验必须拦截', () => {
    const forged = DecisionSchema.parse({
      ...decision,
      declaredAt: '2026-10-20T09:00:00Z',
    });
    const result = validateDecisionIntegrity({
      decision: forged,
      claims: [intentClaim, observedClaim],
      evidence: [testEvidence],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('declared-after-evidence');
  });

  it('学习闭环：从决策派生练习并记录作答', () => {
    const exercise = ExerciseSchema.parse({
      id: 'ex-1',
      decisionId: decision.id,
      type: 'alternative_tradeoff',
      prompt: '若改用惰性校验，最晚会在什么场景下暴露坏配置？代价是什么？',
      focusClaimIds: [intentClaim.id],
      createdAt: '2026-10-21T00:00:00Z',
    });

    const attempt = AttemptSchema.parse({
      id: 'att-1',
      exerciseId: exercise.id,
      answer: '首次读取该配置项时才暴露；代价是故障出现在流量最高的时候',
      outcome: 'pass',
      feedback: '正确识别了 fail-later 的风险转嫁',
      submittedAt: '2026-10-21T00:10:00Z',
    });

    expect(attempt.outcome).toBe('pass');
  });
});
