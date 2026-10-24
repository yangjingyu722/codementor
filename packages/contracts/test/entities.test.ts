import { describe, expect, it } from 'vitest';
import {
  AgentEventSchema,
  AttemptSchema,
  ClaimSchema,
  CodeAnchorSchema,
  DecisionSchema,
  EvidenceSchema,
  ExerciseSchema,
  ProjectSchema,
  TaskSchema,
} from '@codementor/contracts';

const validProject = {
  id: 'p1',
  name: 'demo-app',
  rootPath: '/home/dev/demo-app',
  createdAt: '2026-01-01T00:00:00Z',
};

const validTask = {
  id: 't1',
  projectId: 'p1',
  title: '添加配置模块',
  goal: '支持环境变量覆盖的配置加载',
  status: 'active',
  startedAt: '2026-01-02T00:00:00Z',
};

const validDecision = {
  id: 'd1',
  projectId: 'p1',
  taskId: 't1',
  question: '配置校验为什么在启动时失败而不是首次读取时',
  title: '配置校验采用启动时全量校验',
  chosenOption: '启动时用 Zod 全量校验',
  alternatives: [{ name: '惰性校验', summary: '首次读取时校验，启动更快' }],
  status: 'declared',
  decidedBy: 'agent',
  declaredAt: '2026-01-02T01:00:00Z',
};

const validClaim = {
  id: 'c1',
  decisionId: 'd1',
  kind: 'constraint',
  origin: 'declared',
  statement: '配置错误必须在进程启动时暴露',
  createdAt: '2026-01-02T01:00:00Z',
};

const validEvidence = {
  id: 'e1',
  kind: 'test_run',
  verdict: 'pass',
  producedAt: '2026-01-02T02:00:00Z',
  producedBy: 'agent',
  contentRef: 'objects/e1.json',
  summary: 'vitest 全量通过',
};

const validAnchor = {
  id: 'a1',
  decisionId: 'd1',
  filePath: 'src/config.ts',
  startLine: 10,
  endLine: 42,
  symbolPath: ['loadConfig'],
  commitSha: '0123456789abcdef0123456789abcdef01234567',
};

const validEvent = {
  id: 'ev1',
  sessionId: 's1',
  agent: 'opencode',
  type: 'tool_call',
  payload: { tool: 'declare_decision' },
  occurredAt: '2026-01-02T01:00:01Z',
};

const validExercise = {
  id: 'x1',
  decisionId: 'd1',
  type: 'explain_choice',
  prompt: '为什么选择启动时校验而不是惰性校验？',
  createdAt: '2026-01-03T00:00:00Z',
};

const validAttempt = {
  id: 'at1',
  exerciseId: 'x1',
  answer: '因为配置错误越早暴露，排查成本越低……',
  submittedAt: '2026-01-03T01:00:00Z',
};

describe('全部 9 个实体的合法样例', () => {
  it.each([
    ['Project', ProjectSchema, validProject],
    ['Task', TaskSchema, validTask],
    ['Decision', DecisionSchema, validDecision],
    ['Claim', ClaimSchema, validClaim],
    ['Evidence', EvidenceSchema, validEvidence],
    ['CodeAnchor', CodeAnchorSchema, validAnchor],
    ['AgentEvent', AgentEventSchema, validEvent],
    ['Exercise', ExerciseSchema, validExercise],
    ['Attempt', AttemptSchema, validAttempt],
  ] as const)('%s 通过解析', (_name, schema, sample) => {
    expect(() => schema.parse(sample)).not.toThrow();
  });
});

describe('字段级拒绝用例', () => {
  it('拒绝空 id', () => {
    expect(ProjectSchema.safeParse({ ...validProject, id: '' }).success).toBe(false);
  });

  it('拒绝带时区偏移的时间戳（只允许 UTC Z）', () => {
    expect(
      ProjectSchema.safeParse({ ...validProject, createdAt: '2026-01-01T00:00:00+08:00' }).success,
    ).toBe(false);
  });

  it('拒绝非法枚举值', () => {
    expect(TaskSchema.safeParse({ ...validTask, status: 'paused' }).success).toBe(false);
    expect(ClaimSchema.safeParse({ ...validClaim, origin: 'guessed' }).success).toBe(false);
  });

  it('CodeAnchor 拒绝 startLine > endLine', () => {
    expect(CodeAnchorSchema.safeParse({ ...validAnchor, startLine: 50 }).success).toBe(false);
  });

  it('CodeAnchor 拒绝非法 commitSha 与绝对路径', () => {
    expect(CodeAnchorSchema.safeParse({ ...validAnchor, commitSha: 'HEAD' }).success).toBe(false);
    expect(CodeAnchorSchema.safeParse({ ...validAnchor, filePath: '/src/config.ts' }).success).toBe(
      false,
    );
  });

  it('拒绝非整数或非正数行号', () => {
    expect(CodeAnchorSchema.safeParse({ ...validAnchor, startLine: 1.5 }).success).toBe(false);
    expect(CodeAnchorSchema.safeParse({ ...validAnchor, endLine: 0 }).success).toBe(false);
  });
});

describe('默认值', () => {
  it('Claim 默认 unverified / 空 evidenceRefs', () => {
    const { verification, evidenceRefs } = ClaimSchema.parse({
      id: 'c2',
      decisionId: 'd1',
      kind: 'risk',
      origin: 'rationalized',
      statement: '事后看来这样更好',
      createdAt: '2026-01-02T03:00:00Z',
    });
    expect(verification).toBe('unverified');
    expect(evidenceRefs).toEqual([]);
  });

  it('Attempt 默认 ungraded / 空 feedback', () => {
    const attempt = AttemptSchema.parse({
      id: 'at2',
      exerciseId: 'x1',
      answer: '另一种回答',
      submittedAt: '2026-01-04T00:00:00Z',
    });
    expect(attempt.outcome).toBe('ungraded');
    expect(attempt.feedback).toBe('');
  });
});
