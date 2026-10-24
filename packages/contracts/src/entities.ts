import { z } from 'zod';
import {
  commitSha,
  entityId,
  isoTimestamp,
  nonEmptyString,
  repoRelativePath,
} from './primitives.js';

// ---------------------------------------------------------------------------
// 枚举
// ---------------------------------------------------------------------------

/** 已适配的 AI 编程 Agent 标识；generic 兜底，保证不锁定单一厂商。 */
export const AgentIdSchema = z.enum(['opencode', 'codex', 'claude-code', 'generic']);
export type AgentId = z.infer<typeof AgentIdSchema>;

/**
 * 主张的认知来源——本项目的核心分类学：
 * - declared:    代码产生之前明确声明的设计意图（可验证“先声明后实现”）
 * - observed:    从世界中测量得到的事实（测试、diff、构建输出）
 * - rationalized: 代码产生之后由 AI 或人补写的解释（无法与真实动机区分）
 */
export const EpistemicOriginSchema = z.enum(['declared', 'observed', 'rationalized']);
export type EpistemicOrigin = z.infer<typeof EpistemicOriginSchema>;

/** 主张的类型：约束 / 权衡 / 风险 / 收益。 */
export const ClaimKindSchema = z.enum(['constraint', 'tradeoff', 'risk', 'benefit']);
export type ClaimKind = z.infer<typeof ClaimKindSchema>;

/** 主张的验证状态。 */
export const VerificationStatusSchema = z.enum(['unverified', 'supported', 'refuted']);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const TaskStatusSchema = z.enum(['planned', 'active', 'completed', 'abandoned']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const DecisionStatusSchema = z.enum([
  'draft',
  'declared',
  'implemented',
  'verified',
  'superseded',
]);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

/** 决策由谁作出：AI / 人 / 人机共同。 */
export const DecisionAuthorSchema = z.enum(['agent', 'human', 'pair']);
export type DecisionAuthor = z.infer<typeof DecisionAuthorSchema>;

export const EvidenceKindSchema = z.enum([
  'test_run',
  'diff',
  'build_log',
  'agent_event',
  'manual_note',
]);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const EvidenceVerdictSchema = z.enum(['pass', 'fail', 'unknown']);
export type EvidenceVerdict = z.infer<typeof EvidenceVerdictSchema>;

export const EvidenceProducerSchema = z.enum(['agent', 'human', 'ci']);
export type EvidenceProducer = z.infer<typeof EvidenceProducerSchema>;

export const AgentEventTypeSchema = z.enum([
  'session_start',
  'session_end',
  'tool_call',
  'file_edit',
  'test_run',
  'message',
  'other',
]);
export type AgentEventType = z.infer<typeof AgentEventTypeSchema>;

export const ExerciseTypeSchema = z.enum([
  'explain_choice',
  'predict_impact',
  'alternative_tradeoff',
  'design_drill',
]);
export type ExerciseType = z.infer<typeof ExerciseTypeSchema>;

export const AttemptOutcomeSchema = z.enum(['ungraded', 'pass', 'partial', 'fail']);
export type AttemptOutcome = z.infer<typeof AttemptOutcomeSchema>;

// ---------------------------------------------------------------------------
// 实体
// ---------------------------------------------------------------------------

/** Project：一条仓库（工作区）对应的所有记录的作用域。 */
export const ProjectSchema = z.object({
  id: entityId,
  name: nonEmptyString,
  rootPath: nonEmptyString,
  createdAt: isoTimestamp,
});
export type Project = z.infer<typeof ProjectSchema>;

/** Task：一次 Agent 工作单元；决策隶属于任务。 */
export const TaskSchema = z.object({
  id: entityId,
  projectId: entityId,
  title: nonEmptyString,
  goal: z.string(),
  status: TaskStatusSchema,
  startedAt: isoTimestamp,
  endedAt: isoTimestamp.optional(),
});
export type Task = z.infer<typeof TaskSchema>;

/** 备选方案：被记录但未被选择的路线。 */
export const DecisionAlternativeSchema = z.object({
  name: nonEmptyString,
  summary: z.string(),
});
export type DecisionAlternative = z.infer<typeof DecisionAlternativeSchema>;

/**
 * Decision：核心制品——一次设计选择。
 * declaredAt 是区分“先声明后实现”与“事后补写”的时间锚点。
 */
export const DecisionSchema = z.object({
  id: entityId,
  projectId: entityId,
  taskId: entityId,
  /** 要回答的设计问题，例如“配置错误为何要在启动时失败”。 */
  question: nonEmptyString,
  title: nonEmptyString,
  chosenOption: nonEmptyString,
  alternatives: z.array(DecisionAlternativeSchema).default([]),
  status: DecisionStatusSchema,
  decidedBy: DecisionAuthorSchema,
  declaredAt: isoTimestamp,
});
export type Decision = z.infer<typeof DecisionSchema>;

/** Claim：组成决策理由的原子主张；origin 字段实现认知来源分类。 */
export const ClaimSchema = z.object({
  id: entityId,
  decisionId: entityId,
  kind: ClaimKindSchema,
  origin: EpistemicOriginSchema,
  statement: nonEmptyString,
  verification: VerificationStatusSchema.default('unverified'),
  evidenceRefs: z.array(entityId).default([]),
  createdAt: isoTimestamp,
});
export type Claim = z.infer<typeof ClaimSchema>;

/** CodeAnchor：决策到代码位置的稳定指针（commit + 行号 + 可选符号路径）。 */
export const CodeAnchorSchema = z
  .object({
    id: entityId,
    decisionId: entityId,
    filePath: repoRelativePath,
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    /** Tree-sitter 解析出的符号链，如 ["ConfigStore", "load"]；行号漂移时的二次定位依据。 */
    symbolPath: z.array(nonEmptyString).optional(),
    commitSha,
  })
  .refine((anchor) => anchor.startLine <= anchor.endLine, {
    message: 'startLine must be <= endLine',
    path: ['startLine'],
  });
export type CodeAnchor = z.infer<typeof CodeAnchorSchema>;

/** Evidence：机器可核查的制品引用，支撑或反驳主张。 */
export const EvidenceSchema = z.object({
  id: entityId,
  kind: EvidenceKindSchema,
  verdict: EvidenceVerdictSchema,
  producedAt: isoTimestamp,
  producedBy: EvidenceProducerSchema,
  /** 指向本地对象存储内容的引用（路径或内容哈希），不含上传的外部 URL。 */
  contentRef: nonEmptyString,
  summary: z.string().default(''),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/** AgentEvent：由各 Agent 适配器归一化后的原始事件流。 */
export const AgentEventSchema = z.object({
  id: entityId,
  sessionId: entityId,
  agent: AgentIdSchema,
  type: AgentEventTypeSchema,
  payload: z.record(z.unknown()),
  occurredAt: isoTimestamp,
});
export type AgentEvent = z.infer<typeof AgentEventSchema>;

/** Exercise：从真实决策派生的学习练习。 */
export const ExerciseSchema = z.object({
  id: entityId,
  decisionId: entityId,
  type: ExerciseTypeSchema,
  prompt: nonEmptyString,
  /** 练习重点考察的主张。 */
  focusClaimIds: z.array(entityId).default([]),
  createdAt: isoTimestamp,
});
export type Exercise = z.infer<typeof ExerciseSchema>;

/** Attempt：一次练习作答记录。 */
export const AttemptSchema = z.object({
  id: entityId,
  exerciseId: entityId,
  answer: nonEmptyString,
  outcome: AttemptOutcomeSchema.default('ungraded'),
  feedback: z.string().default(''),
  submittedAt: isoTimestamp,
});
export type Attempt = z.infer<typeof AttemptSchema>;
