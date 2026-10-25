import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  AgentEventSchema,
  AttemptSchema,
  ClaimSchema,
  CodeAnchorSchema,
  DecisionSchema,
  ExerciseSchema,
  EvidenceSchema,
  ProjectSchema,
  TaskSchema,
  type AgentEvent,
  type Attempt,
  type Claim,
  type CodeAnchor,
  type Decision,
  type DecisionAlternative,
  type DecisionStatus,
  type Evidence,
  type Exercise,
  type Project,
  type Task,
  type TaskStatus,
  type VerificationStatus,
} from '@codementor/contracts';
import { migrate } from './migrations.js';

export class StorageError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export type ProjectInput = Omit<Project, 'id'>;
export type TaskInput = Omit<Task, 'id'>;
export type DecisionInput = Omit<Decision, 'id'>;
export type ClaimInput = Omit<Claim, 'id'>;
export type EvidenceInput = Omit<Evidence, 'id'>;
export type CodeAnchorInput = Omit<CodeAnchor, 'id'>;
export type ExerciseInput = Omit<Exercise, 'id'>;
export type AttemptInput = Omit<Attempt, 'id'>;
export type AgentEventInput = Omit<AgentEvent, 'id'>;
/** 重定位/状态变更时可更新的字段子集。 */
export type CodeAnchorPatch = Partial<
  Pick<CodeAnchor, 'filePath' | 'startLine' | 'endLine' | 'contentHash' | 'commitSha' | 'status'>
>;

interface ProjectRow {
  id: string;
  name: string;
  root_path: string;
  created_at: string;
}
interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  goal: string;
  status: string;
  started_at: string;
  ended_at: string | null;
}
interface DecisionRow {
  id: string;
  project_id: string;
  task_id: string;
  question: string;
  title: string;
  chosen_option: string;
  alternatives: string;
  status: string;
  decided_by: string;
  declared_at: string;
}
interface ClaimRow {
  id: string;
  decision_id: string;
  kind: string;
  origin: string;
  statement: string;
  verification: string;
  evidence_refs: string;
  created_at: string;
}
interface EvidenceRow {
  id: string;
  kind: string;
  verdict: string;
  produced_at: string;
  produced_by: string;
  content_ref: string;
  summary: string;
}

// 行数据出库后一律经过契约 schema 解析：存储损坏在读取边界即暴露，不向下游扩散。

function rowToProject(row: ProjectRow): Project {
  return ProjectSchema.parse({
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    createdAt: row.created_at,
  });
}

function rowToTask(row: TaskRow): Task {
  return TaskSchema.parse({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    goal: row.goal,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
  });
}

function rowToDecision(row: DecisionRow): Decision {
  return DecisionSchema.parse({
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    question: row.question,
    title: row.title,
    chosenOption: row.chosen_option,
    alternatives: JSON.parse(row.alternatives) as DecisionAlternative[],
    status: row.status,
    decidedBy: row.decided_by,
    declaredAt: row.declared_at,
  });
}

function rowToClaim(row: ClaimRow): Claim {
  return ClaimSchema.parse({
    id: row.id,
    decisionId: row.decision_id,
    kind: row.kind,
    origin: row.origin,
    statement: row.statement,
    verification: row.verification,
    evidenceRefs: JSON.parse(row.evidence_refs) as string[],
    createdAt: row.created_at,
  });
}

function rowToEvidence(row: EvidenceRow): Evidence {
  return EvidenceSchema.parse({
    id: row.id,
    kind: row.kind,
    verdict: row.verdict,
    producedAt: row.produced_at,
    producedBy: row.produced_by,
    contentRef: row.content_ref,
    summary: row.summary,
  });
}

interface AnchorRow {
  id: string;
  decision_id: string;
  file_path: string;
  symbol_name: string;
  symbol_path: string;
  symbol_kind: string;
  start_line: number;
  end_line: number;
  content_hash: string;
  commit_sha: string;
  status: string;
  origin: string;
  anchored_at: string;
}

function rowToAnchor(row: AnchorRow): CodeAnchor {
  return CodeAnchorSchema.parse({
    id: row.id,
    decisionId: row.decision_id,
    filePath: row.file_path,
    symbolPath: JSON.parse(row.symbol_path) as string[],
    symbolKind: row.symbol_kind,
    startLine: row.start_line,
    endLine: row.end_line,
    contentHash: row.content_hash,
    commitSha: row.commit_sha,
    status: row.status,
    origin: row.origin,
    anchoredAt: row.anchored_at,
  });
}

interface EventRow {
  id: string;
  session_id: string;
  agent: string;
  type: string;
  payload: string;
  task_id: string | null;
  occurred_at: string;
}

function rowToEvent(row: EventRow): AgentEvent {
  return AgentEventSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    agent: row.agent,
    type: row.type,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    taskId: row.task_id ?? undefined,
    occurredAt: row.occurred_at,
  });
}

interface ExerciseRow {
  id: string;
  decision_id: string;
  type: string;
  flow_step: string;
  prompt: string;
  options: string;
  hints: string;
  answer_key: string | null;
  focus_claim_ids: string;
  created_at: string;
}

function rowToExercise(row: ExerciseRow): Exercise {
  return ExerciseSchema.parse({
    id: row.id,
    decisionId: row.decision_id,
    type: row.type,
    flowStep: row.flow_step,
    prompt: row.prompt,
    options: JSON.parse(row.options) as string[],
    hints: JSON.parse(row.hints) as string[],
    answerKey: row.answer_key === null ? undefined : JSON.parse(row.answer_key),
    focusClaimIds: JSON.parse(row.focus_claim_ids) as string[],
    createdAt: row.created_at,
  });
}

interface AttemptRow {
  id: string;
  exercise_id: string;
  answer: string;
  outcome: string;
  feedback: string;
  level: number;
  graded_by: string;
  submitted_at: string;
}

function rowToAttempt(row: AttemptRow): Attempt {
  return AttemptSchema.parse({
    id: row.id,
    exerciseId: row.exercise_id,
    answer: row.answer,
    outcome: row.outcome,
    feedback: row.feedback,
    level: row.level,
    gradedBy: row.graded_by,
    submittedAt: row.submitted_at,
  });
}

/**
 * SQLite 存储层：只负责持久化与查询，不含业务规则。
 * 业务规则（生命周期、完整性）在 @codementor/decision-engine。
 */
export class CodeMentorStorage {
  private readonly db: Database.Database;

  private constructor(db: Database.Database) {
    this.db = db;
  }

  static open(dbPath: string): CodeMentorStorage {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    migrate(db);
    return new CodeMentorStorage(db);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
  }

  // ---- Project ----

  createProject(input: ProjectInput): Project {
    const project = ProjectSchema.parse({ ...input, id: `proj_${randomUUID()}` });
    try {
      this.db
        .prepare('INSERT INTO projects (id, name, root_path, created_at) VALUES (?, ?, ?, ?)')
        .run(project.id, project.name, project.rootPath, project.createdAt);
    } catch (err) {
      if (err instanceof Database.SqliteError && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new StorageError('CONFLICT', `project with rootPath already exists`);
      }
      throw err;
    }
    return project;
  }

  getProject(id: string): Project {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
      ProjectRow | undefined;
    if (row === undefined) {
      throw new StorageError('NOT_FOUND', `project ${id} not found`);
    }
    return rowToProject(row);
  }

  findProjectByRootPath(rootPath: string): Project | undefined {
    const row = this.db.prepare('SELECT * FROM projects WHERE root_path = ?').get(rootPath) as
      ProjectRow | undefined;
    return row === undefined ? undefined : rowToProject(row);
  }

  // ---- Task ----

  createTask(input: TaskInput): Task {
    this.getProject(input.projectId);
    const task = TaskSchema.parse({ ...input, id: `task_${randomUUID()}` });
    this.db
      .prepare(
        `INSERT INTO tasks (id, project_id, title, goal, status, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.projectId,
        task.title,
        task.goal,
        task.status,
        task.startedAt,
        task.endedAt ?? null,
      );
    return task;
  }

  getTask(id: string): Task {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    if (row === undefined) {
      throw new StorageError('NOT_FOUND', `task ${id} not found`);
    }
    return rowToTask(row);
  }

  listTasksByProject(projectId: string): Task[] {
    const rows = this.db
      .prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY started_at')
      .all(projectId) as TaskRow[];
    return rows.map(rowToTask);
  }

  updateTask(id: string, patch: { status: TaskStatus; endedAt?: string }): Task {
    const existing = this.getTask(id);
    const next = TaskSchema.parse({ ...existing, ...patch });
    this.db
      .prepare('UPDATE tasks SET status = ?, ended_at = ? WHERE id = ?')
      .run(next.status, next.endedAt ?? null, id);
    return next;
  }

  // ---- Decision ----

  createDecision(input: DecisionInput): Decision {
    this.getProject(input.projectId);
    this.getTask(input.taskId);
    const decision = DecisionSchema.parse({ ...input, id: `dec_${randomUUID()}` });
    this.db
      .prepare(
        `INSERT INTO decisions
           (id, project_id, task_id, question, title, chosen_option, alternatives, status, decided_by, declared_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        decision.id,
        decision.projectId,
        decision.taskId,
        decision.question,
        decision.title,
        decision.chosenOption,
        JSON.stringify(decision.alternatives),
        decision.status,
        decision.decidedBy,
        decision.declaredAt,
      );
    return decision;
  }

  getDecision(id: string): Decision {
    const row = this.db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as
      DecisionRow | undefined;
    if (row === undefined) {
      throw new StorageError('NOT_FOUND', `decision ${id} not found`);
    }
    return rowToDecision(row);
  }

  listDecisionsByTask(taskId: string): Decision[] {
    const rows = this.db
      .prepare('SELECT * FROM decisions WHERE task_id = ? ORDER BY declared_at')
      .all(taskId) as DecisionRow[];
    return rows.map(rowToDecision);
  }

  updateDecisionStatus(id: string, status: DecisionStatus): Decision {
    const existing = this.getDecision(id);
    const next = DecisionSchema.parse({ ...existing, status });
    this.db.prepare('UPDATE decisions SET status = ? WHERE id = ?').run(next.status, id);
    return next;
  }

  // ---- Claim ----

  createClaim(input: ClaimInput): Claim {
    this.getDecision(input.decisionId);
    const claim = ClaimSchema.parse({ ...input, id: `claim_${randomUUID()}` });
    this.db
      .prepare(
        `INSERT INTO claims
           (id, decision_id, kind, origin, statement, verification, evidence_refs, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        claim.id,
        claim.decisionId,
        claim.kind,
        claim.origin,
        claim.statement,
        claim.verification,
        JSON.stringify(claim.evidenceRefs),
        claim.createdAt,
      );
    return claim;
  }

  listClaimsByDecision(decisionId: string): Claim[] {
    const rows = this.db
      .prepare('SELECT * FROM claims WHERE decision_id = ? ORDER BY created_at')
      .all(decisionId) as ClaimRow[];
    return rows.map(rowToClaim);
  }

  updateClaimVerification(id: string, verification: VerificationStatus): Claim {
    const row = this.db.prepare('SELECT * FROM claims WHERE id = ?').get(id) as
      ClaimRow | undefined;
    if (row === undefined) {
      throw new StorageError('NOT_FOUND', `claim ${id} not found`);
    }
    this.db.prepare('UPDATE claims SET verification = ? WHERE id = ?').run(verification, id);
    return rowToClaim({ ...row, verification });
  }

  // ---- Evidence ----

  createEvidence(input: EvidenceInput): Evidence {
    const evidence = EvidenceSchema.parse({ ...input, id: `evd_${randomUUID()}` });
    this.db
      .prepare(
        `INSERT INTO evidence
           (id, kind, verdict, produced_at, produced_by, content_ref, summary)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        evidence.id,
        evidence.kind,
        evidence.verdict,
        evidence.producedAt,
        evidence.producedBy,
        evidence.contentRef,
        evidence.summary,
      );
    return evidence;
  }

  getEvidence(id: string): Evidence {
    const row = this.db.prepare('SELECT * FROM evidence WHERE id = ?').get(id) as
      EvidenceRow | undefined;
    if (row === undefined) {
      throw new StorageError('NOT_FOUND', `evidence ${id} not found`);
    }
    return rowToEvidence(row);
  }

  listEvidenceByIds(ids: string[]): Evidence[] {
    if (ids.length === 0) {
      return [];
    }
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT * FROM evidence WHERE id IN (${placeholders})`)
      .all(...ids) as EvidenceRow[];
    return rows.map(rowToEvidence);
  }

  // ---- CodeAnchor ----

  createCodeAnchor(input: CodeAnchorInput): CodeAnchor {
    this.getDecision(input.decisionId);
    const anchor = CodeAnchorSchema.parse({ ...input, id: `anch_${randomUUID()}` });
    this.db
      .prepare(
        `INSERT INTO code_anchors
           (id, decision_id, file_path, symbol_name, symbol_path, symbol_kind,
            start_line, end_line, content_hash, commit_sha, status, origin, anchored_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        anchor.id,
        anchor.decisionId,
        anchor.filePath,
        anchor.symbolPath[anchor.symbolPath.length - 1]!,
        JSON.stringify(anchor.symbolPath),
        anchor.symbolKind,
        anchor.startLine,
        anchor.endLine,
        anchor.contentHash,
        anchor.commitSha,
        anchor.status,
        anchor.origin,
        anchor.anchoredAt,
      );
    return anchor;
  }

  getCodeAnchor(id: string): CodeAnchor {
    const row = this.db.prepare('SELECT * FROM code_anchors WHERE id = ?').get(id) as
      AnchorRow | undefined;
    if (row === undefined) {
      throw new StorageError('NOT_FOUND', `code anchor ${id} not found`);
    }
    return rowToAnchor(row);
  }

  listCodeAnchorsByDecision(decisionId: string): CodeAnchor[] {
    const rows = this.db
      .prepare('SELECT * FROM code_anchors WHERE decision_id = ? ORDER BY anchored_at')
      .all(decisionId) as AnchorRow[];
    return rows.map(rowToAnchor);
  }

  /** 反向查询：同一文件内同名符号上的全部锚点（含失效锚点，交由上层解释状态）。 */
  findAnchorsBySymbol(filePath: string, symbolName: string): CodeAnchor[] {
    const rows = this.db
      .prepare('SELECT * FROM code_anchors WHERE file_path = ? AND symbol_name = ?')
      .all(filePath, symbolName) as AnchorRow[];
    return rows.map(rowToAnchor);
  }

  listCodeAnchorsByProject(projectId: string): CodeAnchor[] {
    const rows = this.db
      .prepare(
        `SELECT a.* FROM code_anchors a
         JOIN decisions d ON a.decision_id = d.id
         WHERE d.project_id = ?`,
      )
      .all(projectId) as AnchorRow[];
    return rows.map(rowToAnchor);
  }

  /** 重定位/状态更新：合并补丁后整体重新过契约校验再落库。 */
  updateCodeAnchor(id: string, patch: CodeAnchorPatch): CodeAnchor {
    const existing = this.getCodeAnchor(id);
    const next = CodeAnchorSchema.parse({ ...existing, ...patch });
    this.db
      .prepare(
        `UPDATE code_anchors
         SET file_path = ?, symbol_name = ?, start_line = ?, end_line = ?,
             content_hash = ?, commit_sha = ?, status = ?
         WHERE id = ?`,
      )
      .run(
        next.filePath,
        next.symbolPath[next.symbolPath.length - 1]!,
        next.startLine,
        next.endLine,
        next.contentHash,
        next.commitSha,
        next.status,
        id,
      );
    return next;
  }

  // ---- Exercise / Attempt（学习引擎持久化）----

  createExercise(input: ExerciseInput): Exercise {
    this.getDecision(input.decisionId);
    const exercise = ExerciseSchema.parse({ ...input, id: `ex_${randomUUID()}` });
    this.db
      .prepare(
        `INSERT INTO exercises
           (id, decision_id, type, flow_step, prompt, options, hints, answer_key, focus_claim_ids, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        exercise.id,
        exercise.decisionId,
        exercise.type,
        exercise.flowStep,
        exercise.prompt,
        JSON.stringify(exercise.options),
        JSON.stringify(exercise.hints),
        exercise.answerKey === undefined ? null : JSON.stringify(exercise.answerKey),
        JSON.stringify(exercise.focusClaimIds),
        exercise.createdAt,
      );
    return exercise;
  }

  getExercise(id: string): Exercise {
    const row = this.db.prepare('SELECT * FROM exercises WHERE id = ?').get(id) as
      ExerciseRow | undefined;
    if (row === undefined) {
      throw new StorageError('NOT_FOUND', `exercise ${id} not found`);
    }
    return rowToExercise(row);
  }

  listExercisesByDecision(decisionId: string): Exercise[] {
    const rows = this.db
      .prepare('SELECT * FROM exercises WHERE decision_id = ? ORDER BY created_at')
      .all(decisionId) as ExerciseRow[];
    return rows.map(rowToExercise);
  }

  createAttempt(input: AttemptInput): Attempt {
    this.getExercise(input.exerciseId);
    const attempt = AttemptSchema.parse({ ...input, id: `att_${randomUUID()}` });
    this.db
      .prepare(
        `INSERT INTO attempts
           (id, exercise_id, answer, outcome, feedback, level, graded_by, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        attempt.id,
        attempt.exerciseId,
        attempt.answer,
        attempt.outcome,
        attempt.feedback,
        attempt.level,
        attempt.gradedBy,
        attempt.submittedAt,
      );
    return attempt;
  }

  listAttemptsByExercise(exerciseId: string): Attempt[] {
    const rows = this.db
      .prepare('SELECT * FROM attempts WHERE exercise_id = ? ORDER BY submitted_at')
      .all(exerciseId) as AttemptRow[];
    return rows.map(rowToAttempt);
  }

  createAgentEvent(input: AgentEventInput): AgentEvent {
    const event = AgentEventSchema.parse({ ...input, id: `evt_${randomUUID()}` });
    this.db
      .prepare(
        `INSERT INTO agent_events
           (id, session_id, agent, type, payload, task_id, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.sessionId,
        event.agent,
        event.type,
        JSON.stringify(event.payload),
        event.taskId ?? null,
        event.occurredAt,
      );
    return event;
  }

  listAgentEventsByTask(taskId: string): AgentEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_events WHERE task_id = ? ORDER BY occurred_at')
      .all(taskId) as EventRow[];
    return rows.map(rowToEvent);
  }

  /** 按 session 查询（PRD F3 验收：会话事件可按 session 检索）。 */
  listAgentEventsBySession(sessionId: string): AgentEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_events WHERE session_id = ? ORDER BY occurred_at')
      .all(sessionId) as EventRow[];
    return rows.map(rowToEvent);
  }

  listAttemptsByDecision(decisionId: string): Attempt[] {
    const rows = this.db
      .prepare(
        `SELECT a.* FROM attempts a
         JOIN exercises e ON a.exercise_id = e.id
         WHERE e.decision_id = ? ORDER BY a.submitted_at`,
      )
      .all(decisionId) as AttemptRow[];
    return rows.map(rowToAttempt);
  }
}
