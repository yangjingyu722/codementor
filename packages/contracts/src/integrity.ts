import type { Claim, Decision, Evidence } from './entities.js';

/**
 * 完整性规则编号与 docs/CONTRACTS.md 中的不变式一一对应；
 * 文档是规范，本文件是可执行的实现。
 */
export type IntegrityIssueCode =
  /** R1：没有 declared 主张的 Decision 只是事后记录，不是设计决策。 */
  | 'missing-declared-claim'
  /** R2：主张引用了输入集合中不存在的证据。 */
  | 'unknown-evidence-ref'
  /** R3：observed 主张是机器事实，必须引用至少一条证据。 */
  | 'observed-claim-without-evidence'
  /** R4：verified 决策必须有“已获证据支撑的 observed 主张”。 */
  | 'verified-without-supported-observation'
  /** R5：声明时间晚于其观察证据的产生时间——意图是事后补写的。 */
  | 'declared-after-evidence';

export interface IntegrityIssue {
  code: IntegrityIssueCode;
  message: string;
}

export interface DecisionIntegrityInput {
  decision: Decision;
  /** 允许传入多条决策的主张，只取 decisionId 匹配者。 */
  claims: Claim[];
  evidence: Evidence[];
}

export interface IntegrityResult {
  ok: boolean;
  issues: IntegrityIssue[];
}

/**
 * 校验一条 Decision 及其主张/证据组成的局部视图是否满足工程认知完整性规则。
 * 所有时间戳均为 UTC ISO 字符串（见 primitives.ts），可按字典序直接比较。
 */
export function validateDecisionIntegrity(input: DecisionIntegrityInput): IntegrityResult {
  const issues: IntegrityIssue[] = [];
  const { decision } = input;

  const claims = input.claims.filter((c) => c.decisionId === decision.id);
  const evidenceIds = new Set(input.evidence.map((e) => e.id));
  const evidenceById = new Map(input.evidence.map((e) => [e.id, e] as const));

  // R1
  if (!claims.some((c) => c.origin === 'declared')) {
    issues.push({
      code: 'missing-declared-claim',
      message: `decision ${decision.id} has no claim with origin 'declared'`,
    });
  }

  // R2 / R3
  for (const claim of claims) {
    for (const ref of claim.evidenceRefs) {
      if (!evidenceIds.has(ref)) {
        issues.push({
          code: 'unknown-evidence-ref',
          message: `claim ${claim.id} references unknown evidence ${ref}`,
        });
      }
    }
    if (claim.origin === 'observed' && claim.evidenceRefs.length === 0) {
      issues.push({
        code: 'observed-claim-without-evidence',
        message: `observed claim ${claim.id} must cite at least one evidence`,
      });
    }
  }

  // R4
  if (decision.status === 'verified') {
    const hasSupportedObservation = claims.some(
      (c) => c.origin === 'observed' && c.verification === 'supported' && c.evidenceRefs.length > 0,
    );
    if (!hasSupportedObservation) {
      issues.push({
        code: 'verified-without-supported-observation',
        message: `decision ${decision.id} is verified but has no supported observed claim`,
      });
    }
  }

  // R5
  const observedTimes = claims
    .filter((c) => c.origin === 'observed')
    .flatMap((c) => c.evidenceRefs)
    .map((ref) => evidenceById.get(ref))
    .filter((e): e is Evidence => e !== undefined)
    .map((e) => e.producedAt)
    .sort();
  const earliest = observedTimes[0];
  if (earliest !== undefined && decision.declaredAt > earliest) {
    issues.push({
      code: 'declared-after-evidence',
      message: `decision ${decision.id} declared at ${decision.declaredAt}, after earliest observed evidence at ${earliest}`,
    });
  }

  return { ok: issues.length === 0, issues };
}
