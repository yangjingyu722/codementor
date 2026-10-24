import { z } from 'zod';
import {
  ClaimKindSchema,
  DecisionAlternativeSchema,
  DecisionAuthorSchema,
  EvidenceKindSchema,
  EvidenceProducerSchema,
  EvidenceVerdictSchema,
  isoTimestamp,
  nonEmptyString,
} from '@codementor/contracts';

/**
 * 引擎方法的输入 schema：HTTP/MCP 等入口把原始载荷直接交给引擎，
 * 引擎是唯一校验点（所有方法接受 unknown，先 parse 再使用）。
 */

export const RegisterProjectInputSchema = z.object({
  name: nonEmptyString,
  rootPath: nonEmptyString,
});

export const StartTaskInputSchema = z.object({
  projectId: nonEmptyString,
  title: nonEmptyString,
  goal: z.string().default(''),
});

export const DeclareDecisionInputSchema = z.object({
  taskId: nonEmptyString,
  question: nonEmptyString,
  title: nonEmptyString,
  chosenOption: nonEmptyString,
  alternatives: z.array(DecisionAlternativeSchema).default([]),
  decidedBy: DecisionAuthorSchema,
  /** 编码前声明的意图主张：至少一条，这是 Decision 成为“设计决策”的门槛。 */
  declaredClaims: z.array(z.object({ kind: ClaimKindSchema, statement: nonEmptyString })).min(1),
});

export const RecordObservationInputSchema = z.object({
  decisionId: nonEmptyString,
  claim: z.object({ kind: ClaimKindSchema, statement: nonEmptyString }),
  evidence: z.object({
    kind: EvidenceKindSchema,
    verdict: EvidenceVerdictSchema,
    producedBy: EvidenceProducerSchema.default('agent'),
    contentRef: nonEmptyString,
    summary: z.string().default(''),
    /**
     * 事实产生时刻。缺省由服务端时钟盖章；
     * 仅用于回放适配器捕获的历史事件（阶段 2）。
     */
    producedAt: isoTimestamp.optional(),
  }),
});

export const RecordRationalizationInputSchema = z.object({
  decisionId: nonEmptyString,
  kind: ClaimKindSchema,
  statement: nonEmptyString,
});

export type RegisterProjectInput = z.infer<typeof RegisterProjectInputSchema>;
export type StartTaskInput = z.infer<typeof StartTaskInputSchema>;
export type DeclareDecisionInput = z.infer<typeof DeclareDecisionInputSchema>;
export type RecordObservationInput = z.infer<typeof RecordObservationInputSchema>;
export type RecordRationalizationInput = z.infer<typeof RecordRationalizationInputSchema>;
