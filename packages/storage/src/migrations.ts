import type Database from 'better-sqlite3';

export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly up: string;
}

/**
 * 迁移清单：只追加、不修改已应用的条目。
 * 每个阶段只为其真正需要的实体建表（阶段 1：决策工作流五实体）。
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: '0001_init_decision_workflow',
    up: `
      CREATE TABLE projects (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        root_path  TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE tasks (
        id         TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        title      TEXT NOT NULL,
        goal       TEXT NOT NULL DEFAULT '',
        status     TEXT NOT NULL CHECK (status IN ('planned','active','completed','abandoned')),
        started_at TEXT NOT NULL,
        ended_at   TEXT
      );
      CREATE INDEX idx_tasks_project ON tasks(project_id);

      CREATE TABLE decisions (
        id            TEXT PRIMARY KEY,
        project_id    TEXT NOT NULL REFERENCES projects(id),
        task_id       TEXT NOT NULL REFERENCES tasks(id),
        question      TEXT NOT NULL,
        title         TEXT NOT NULL,
        chosen_option TEXT NOT NULL,
        alternatives  TEXT NOT NULL DEFAULT '[]',
        status        TEXT NOT NULL CHECK (status IN ('draft','declared','implemented','verified','superseded')),
        decided_by    TEXT NOT NULL CHECK (decided_by IN ('agent','human','pair')),
        declared_at   TEXT NOT NULL
      );
      CREATE INDEX idx_decisions_task ON decisions(task_id);
      CREATE INDEX idx_decisions_project ON decisions(project_id);

      CREATE TABLE claims (
        id            TEXT PRIMARY KEY,
        decision_id   TEXT NOT NULL REFERENCES decisions(id),
        kind          TEXT NOT NULL CHECK (kind IN ('constraint','tradeoff','risk','benefit')),
        origin        TEXT NOT NULL CHECK (origin IN ('declared','observed','rationalized')),
        statement     TEXT NOT NULL,
        verification  TEXT NOT NULL DEFAULT 'unverified'
                      CHECK (verification IN ('unverified','supported','refuted')),
        evidence_refs TEXT NOT NULL DEFAULT '[]',
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_claims_decision ON claims(decision_id);

      CREATE TABLE evidence (
        id          TEXT PRIMARY KEY,
        kind        TEXT NOT NULL CHECK (kind IN ('test_run','diff','build_log','agent_event','manual_note')),
        verdict     TEXT NOT NULL CHECK (verdict IN ('pass','fail','unknown')),
        produced_at TEXT NOT NULL,
        produced_by TEXT NOT NULL CHECK (produced_by IN ('agent','human','ci')),
        content_ref TEXT NOT NULL,
        summary     TEXT NOT NULL DEFAULT ''
      );
    `,
  },
  {
    id: 2,
    name: '0002_code_anchors',
    up: `
      CREATE TABLE code_anchors (
        id           TEXT PRIMARY KEY,
        decision_id  TEXT NOT NULL REFERENCES decisions(id),
        file_path    TEXT NOT NULL,
        symbol_name  TEXT NOT NULL,
        symbol_path  TEXT NOT NULL,
        symbol_kind  TEXT NOT NULL CHECK (symbol_kind IN ('function','struct','typedef','other')),
        start_line   INTEGER NOT NULL,
        end_line     INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        commit_sha   TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'confirmed'
                     CHECK (status IN ('confirmed','ambiguous','missing')),
        origin       TEXT NOT NULL CHECK (origin IN ('declared','inferred')),
        anchored_at  TEXT NOT NULL,
        CHECK (start_line <= end_line)
      );
      CREATE INDEX idx_anchors_decision ON code_anchors(decision_id);
      CREATE INDEX idx_anchors_symbol ON code_anchors(file_path, symbol_name);
    `,
  },
  {
    id: 3,
    name: '0003_learning_exercises',
    up: `
      CREATE TABLE exercises (
        id              TEXT PRIMARY KEY,
        decision_id     TEXT NOT NULL REFERENCES decisions(id),
        type            TEXT NOT NULL CHECK (type IN
                        ('explain_choice','predict_impact','alternative_tradeoff','design_drill',
                         'predict_choice','locate_code','open_explanation')),
        flow_step       TEXT NOT NULL CHECK (flow_step IN ('predict','verify','transfer')),
        prompt          TEXT NOT NULL,
        options         TEXT NOT NULL DEFAULT '[]',
        hints           TEXT NOT NULL DEFAULT '[]',
        answer_key      TEXT,
        focus_claim_ids TEXT NOT NULL DEFAULT '[]',
        created_at      TEXT NOT NULL
      );
      CREATE INDEX idx_exercises_decision ON exercises(decision_id);

      CREATE TABLE attempts (
        id           TEXT PRIMARY KEY,
        exercise_id  TEXT NOT NULL REFERENCES exercises(id),
        answer       TEXT NOT NULL,
        outcome      TEXT NOT NULL CHECK (outcome IN ('ungraded','pass','partial','fail')),
        feedback     TEXT NOT NULL DEFAULT '',
        level        INTEGER NOT NULL DEFAULT 2 CHECK (level IN (1,2,3)),
        graded_by    TEXT NOT NULL DEFAULT 'deterministic'
                     CHECK (graded_by IN ('deterministic','self','llm')),
        submitted_at TEXT NOT NULL
      );
      CREATE INDEX idx_attempts_exercise ON attempts(exercise_id);
    `,
  },
  {
    id: 4,
    name: '0004_agent_events',
    up: `
      CREATE TABLE agent_events (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL,
        agent       TEXT NOT NULL CHECK (agent IN ('opencode','codex','claude-code','generic')),
        type        TEXT NOT NULL CHECK (type IN
                    ('session_start','session_end','tool_call','file_edit','test_run','message','other')),
        payload     TEXT NOT NULL DEFAULT '{}',
        task_id     TEXT REFERENCES tasks(id),
        occurred_at TEXT NOT NULL
      );
      CREATE INDEX idx_agent_events_task ON agent_events(task_id);
    `,
  },
  {
    id: 5,
    name: '0005_agent_events_session_index',
    up: `
      CREATE INDEX idx_agent_events_session ON agent_events(session_id);
    `,
  },
];

/** 幂等迁移：未应用的迁移按序在事务中执行并登记。 */
export function migrate(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  const appliedRows = db.prepare('SELECT id FROM migrations').all() as Array<{ id: number }>;
  const applied = new Set(appliedRows.map((row) => row.id));

  const runOne = db.transaction((migration: Migration): void => {
    db.exec(migration.up);
    db.prepare('INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
      migration.id,
      migration.name,
      new Date().toISOString(),
    );
  });

  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.id)) {
      runOne(migration);
    }
  }
  db.pragma(`user_version = ${MIGRATIONS.length}`);
}
