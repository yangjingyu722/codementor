import type { ZodTypeAny } from 'zod';
import type { Claim, Decision, Evidence, IntegrityResult, Task } from '@codementor/contracts';
import { validateDecisionIntegrity } from '@codementor/contracts';
import { CodeMentorStorage } from '@codementor/storage';
import { CodeMentorError } from './errors.js';
import {
  DeclareDecisionInputSchema,
  RecordObservationInputSchema,
  RecordRationalizationInputSchema,
  RegisterProjectInputSchema,
  StartTaskInputSchema,
} from './schemas.js';

export interface DecisionEngineOptions {
  /**
   * 时钟注入（测试用）。生产环境必须使用真实时间：
   * declaredAt 等信任锚点一律由此时钟盖章，禁止客户端回填。
   */
  now?: () => string;
}

export interface DecisionBundle {
  decision: Decision;
  claims: Claim[];
  evidence: Evidence[];
  integrity: IntegrityResult;
}

const ACTIVE_DECISION_STATUSES: readonly Decision['status'][] = ['declared', 'implemented'];

/**
 * 决策引擎：任务/决策生命周期与完整性规则的唯一执行者。
 * 所有方法接受 unknown 输入并自行校验；存储层只做持久化。
 */
export class DecisionEngine {
  private readonly now: () => string;

  constructor(
    private readonly storage: CodeMentorStorage,
    options: DecisionEngineOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** ZodTypeAny + _output：带 .default() 的 schema（Input≠Output）也能得到精确的输出类型。 */
  private parse<S extends ZodTypeAny>(schema: S, input: unknown, context: string): S['_output'] {
    const result = schema.safeParse(input);
    if (!result.success) {
      throw new CodeMentorError('VALIDATION', `invalid ${context} input`, result.error.issues);
    }
    return result.data;
  }

  private requireTaskActive(taskId: string): Task {
    const task = this.storage.getTask(taskId);
    if (task.status !== 'active') {
      throw new CodeMentorError(
        'INVALID_STATE',
        `task ${task.id} is '${task.status}', expected 'active'`,
      );
    }
    return task;
  }

  private requireDecisionMutable(decisionId: string): Decision {
    const decision = this.storage.getDecision(decisionId);
    if (!ACTIVE_DECISION_STATUSES.includes(decision.status)) {
      throw new CodeMentorError(
        'INVALID_STATE',
        `decision ${decision.id} is '${decision.status}', expected one of ${ACTIVE_DECISION_STATUSES.join('|')}`,
      );
    }
    return decision;
  }

  /** 按 rootPath 幂等注册项目。 */
  registerProject(input: unknown): ReturnType<CodeMentorStorage['createProject']> {
    const parsed = this.parse(RegisterProjectInputSchema, input, 'registerProject');
    const existing = this.storage.findProjectByRootPath(parsed.rootPath);
    if (existing !== undefined) {
      return existing;
    }
    return this.storage.createProject({ ...parsed, createdAt: this.now() });
  }

  startTask(input: unknown): Task {
    const parsed = this.parse(StartTaskInputSchema, input, 'startTask');
    this.storage.getProject(parsed.projectId);
    return this.storage.createTask({
      projectId: parsed.projectId,
      title: parsed.title,
      goal: parsed.goal,
      status: 'active',
      startedAt: this.now(),
    });
  }

  finishTask(taskId: string): Task {
    const task = this.requireTaskActive(taskId);
    return this.storage.updateTask(task.id, { status: 'completed', endedAt: this.now() });
  }

  /**
   * 编码前声明决策。declaredAt 由服务端时钟盖章——
   * 这是区分“事前声明”与“事后补写”的信任锚点。
   */
  declareDecision(input: unknown): { decision: Decision; claims: Claim[] } {
    const parsed = this.parse(DeclareDecisionInputSchema, input, 'declareDecision');
    const task = this.requireTaskActive(parsed.taskId);
    return this.storage.transaction(() => {
      const decision = this.storage.createDecision({
        projectId: task.projectId,
        taskId: task.id,
        question: parsed.question,
        title: parsed.title,
        chosenOption: parsed.chosenOption,
        alternatives: parsed.alternatives,
        status: 'declared',
        decidedBy: parsed.decidedBy,
        declaredAt: this.now(),
      });
      const claims = parsed.declaredClaims.map((claim) =>
        this.storage.createClaim({
          decisionId: decision.id,
          kind: claim.kind,
          origin: 'declared',
          statement: claim.statement,
          verification: 'unverified',
          evidenceRefs: [],
          createdAt: this.now(),
        }),
      );
      return { decision, claims };
    });
  }

  markImplemented(decisionId: string): Decision {
    const decision = this.storage.getDecision(decisionId);
    if (decision.status !== 'declared') {
      throw new CodeMentorError(
        'INVALID_STATE',
        `decision ${decision.id} is '${decision.status}', expected 'declared'`,
      );
    }
    return this.storage.updateDecisionStatus(decisionId, 'implemented');
  }

  /**
   * 记录观察事实：机器可核查的证据 + 由其支撑的 observed 主张。
   * 证据 verdict 直接决定主张初始验证状态（pass→supported，fail→refuted）。
   */
  recordObservation(input: unknown): { claim: Claim; evidence: Evidence } {
    const parsed = this.parse(RecordObservationInputSchema, input, 'recordObservation');
    this.requireDecisionMutable(parsed.decisionId);
    const producedAt = parsed.evidence.producedAt ?? this.now();
    return this.storage.transaction(() => {
      const evidence = this.storage.createEvidence({
        kind: parsed.evidence.kind,
        verdict: parsed.evidence.verdict,
        producedAt,
        producedBy: parsed.evidence.producedBy,
        contentRef: parsed.evidence.contentRef,
        summary: parsed.evidence.summary,
      });
      const verification =
        parsed.evidence.verdict === 'pass'
          ? 'supported'
          : parsed.evidence.verdict === 'fail'
            ? 'refuted'
            : 'unverified';
      const claim = this.storage.createClaim({
        decisionId: parsed.decisionId,
        kind: parsed.claim.kind,
        origin: 'observed',
        statement: parsed.claim.statement,
        verification,
        evidenceRefs: [evidence.id],
        createdAt: this.now(),
      });
      return { claim, evidence };
    });
  }

  /** 记录事后推断：永不升级为 declared；仅当决策缺声明主张时会在完整性上暴露 R1。 */
  recordRationalization(input: unknown): Claim {
    const parsed = this.parse(RecordRationalizationInputSchema, input, 'recordRationalization');
    this.storage.getDecision(parsed.decisionId);
    return this.storage.createClaim({
      decisionId: parsed.decisionId,
      kind: parsed.kind,
      origin: 'rationalized',
      statement: parsed.statement,
      verification: 'unverified',
      evidenceRefs: [],
      createdAt: this.now(),
    });
  }

  /**
   * 校验并升级为 verified：升级必须由完整性结果授予，而非调用方声称。
   * R4 检查的是 verified 状态下的不变式，而升级前状态尚是 declared/implemented，
   * 因此必须在“假定已升级”的决策状态上评估（prospective check）。
   */
  verifyDecision(decisionId: string): { decision: Decision; integrity: IntegrityResult } {
    const bundle = this.getDecisionBundle(decisionId);
    if (!bundle.integrity.ok) {
      throw new CodeMentorError(
        'INTEGRITY_VIOLATION',
        `decision ${decisionId} violates integrity rules`,
        bundle.integrity.issues,
      );
    }
    const prospective = validateDecisionIntegrity({
      decision: { ...bundle.decision, status: 'verified' },
      claims: bundle.claims,
      evidence: bundle.evidence,
    });
    if (!prospective.ok) {
      throw new CodeMentorError(
        'INTEGRITY_VIOLATION',
        `decision ${decisionId} cannot be verified: integrity rules unmet`,
        prospective.issues,
      );
    }
    this.requireDecisionMutable(decisionId);
    const decision = this.storage.updateDecisionStatus(decisionId, 'verified');
    return { decision, integrity: prospective };
  }

  /** 读取决策全貌并即时重算完整性（R1–R5）。 */
  getDecisionBundle(decisionId: string): DecisionBundle {
    const decision = this.storage.getDecision(decisionId);
    const claims = this.storage.listClaimsByDecision(decisionId);
    const evidenceIds = [...new Set(claims.flatMap((claim) => claim.evidenceRefs))];
    const evidence = this.storage.listEvidenceByIds(evidenceIds);
    const integrity = validateDecisionIntegrity({ decision, claims, evidence });
    return { decision, claims, evidence, integrity };
  }

  listTaskDecisions(taskId: string): Decision[] {
    this.storage.getTask(taskId);
    return this.storage.listDecisionsByTask(taskId);
  }
}
