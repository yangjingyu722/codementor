import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CodeMentorStorage, StorageError } from '../src/index.js';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'cm-storage-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const T0 = '2026-10-24T10:00:00Z';

function seedWorkflow(storage: CodeMentorStorage): { projectId: string; taskId: string } {
  const project = storage.createProject({ name: 'demo', rootPath: '/repo/demo', createdAt: T0 });
  const task = storage.createTask({
    projectId: project.id,
    title: '添加配置模块',
    goal: '',
    status: 'active',
    startedAt: T0,
  });
  return { projectId: project.id, taskId: task.id };
}

describe('CodeMentorStorage（真实 SQLite 临时文件）', () => {
  it('open 应用迁移：user_version 与 migrations 登记', () => {
    const dbPath = path.join(dir, 'migrate.db');
    const storage = CodeMentorStorage.open(dbPath);
    storage.close();
    const raw = new Database(dbPath);
    const version = raw.prepare('PRAGMA user_version').get() as { user_version: number };
    const rows = raw.prepare('SELECT id, name FROM migrations').all() as Array<{
      id: number;
      name: string;
    }>;
    raw.close();
    expect(version.user_version).toBeGreaterThanOrEqual(1);
    expect(rows.map((r) => r.name)).toContain('0001_init_decision_workflow');
  });

  it('五实体往返保持契约类型（含 JSON 列与默认值）', () => {
    const storage = CodeMentorStorage.open(path.join(dir, 'roundtrip.db'));
    const { taskId } = seedWorkflow(storage);
    const decision = storage.createDecision({
      projectId: storage.findProjectByRootPath('/repo/demo')!.id,
      taskId,
      question: '何时校验配置',
      title: '启动时全量校验',
      chosenOption: 'Zod fail-fast',
      alternatives: [{ name: '惰性校验', summary: '首次读取时校验' }],
      status: 'declared',
      decidedBy: 'agent',
      declaredAt: T0,
    });
    const claim = storage.createClaim({
      decisionId: decision.id,
      kind: 'constraint',
      origin: 'declared',
      statement: '坏配置必须启动即失败',
      verification: 'unverified',
      evidenceRefs: [],
      createdAt: T0,
    });
    const evidence = storage.createEvidence({
      kind: 'test_run',
      verdict: 'pass',
      producedAt: '2026-10-24T10:30:00Z',
      producedBy: 'agent',
      contentRef: 'objects/evd-1.json',
      summary: '启动失败用例通过',
    });

    expect(storage.getDecision(decision.id)).toEqual(decision);
    expect(storage.listClaimsByDecision(decision.id)).toEqual([claim]);
    expect(storage.getEvidence(evidence.id)).toEqual(evidence);
    storage.close();
  });

  it('关闭后重新打开同一数据库文件，数据仍在（真实持久化）', () => {
    const dbPath = path.join(dir, 'persist.db');
    const first = CodeMentorStorage.open(dbPath);
    const { taskId } = seedWorkflow(first);
    first.close();

    const second = CodeMentorStorage.open(dbPath);
    const task = second.listTasksByProject(second.findProjectByRootPath('/repo/demo')!.id);
    expect(task).toHaveLength(1);
    expect(task[0]!.id).toBe(taskId);
    second.close();
  });

  it('外键前置检查：不存在的 task/project/decision 报 NOT_FOUND', () => {
    const storage = CodeMentorStorage.open(path.join(dir, 'fk.db'));
    seedWorkflow(storage);
    expect(() =>
      storage.createDecision({
        projectId: 'proj_missing',
        taskId: 'task_missing',
        question: 'q',
        title: 't',
        chosenOption: 'c',
        alternatives: [],
        status: 'declared',
        decidedBy: 'agent',
        declaredAt: T0,
      }),
    ).toThrowError(/not found/);
    expect(() => storage.getTask('task_missing')).toThrowError(StorageError);
    storage.close();
  });

  it('rootPath 唯一冲突报 CONFLICT', () => {
    const storage = CodeMentorStorage.open(path.join(dir, 'conflict.db'));
    seedWorkflow(storage);
    expect(() =>
      storage.createProject({ name: 'again', rootPath: '/repo/demo', createdAt: T0 }),
    ).toThrowError(StorageError);
    storage.close();
  });

  it('列表查询按归属过滤；状态更新落库', () => {
    const storage = CodeMentorStorage.open(path.join(dir, 'lists.db'));
    const { projectId, taskId } = seedWorkflow(storage);
    const other = storage.createTask({
      projectId,
      title: '另一个任务',
      goal: '',
      status: 'active',
      startedAt: T0,
    });
    storage.createDecision({
      projectId,
      taskId,
      question: 'q1',
      title: 'd1',
      chosenOption: 'c',
      alternatives: [],
      status: 'declared',
      decidedBy: 'agent',
      declaredAt: T0,
    });

    expect(storage.listDecisionsByTask(taskId)).toHaveLength(1);
    expect(storage.listDecisionsByTask(other.id)).toHaveLength(0);

    const finished = storage.updateTask(taskId, {
      status: 'completed',
      endedAt: '2026-10-24T12:00:00Z',
    });
    expect(finished.status).toBe('completed');
    expect(storage.getTask(taskId).endedAt).toBe('2026-10-24T12:00:00Z');

    const implemented = storage.updateDecisionStatus(
      storage.listDecisionsByTask(taskId)[0]!.id,
      'implemented',
    );
    expect(implemented.status).toBe('implemented');
    storage.close();
  });

  it('读取路径的契约校验兜底：行被外部篡改时抛出而非扩散脏数据', () => {
    const dbPath = path.join(dir, 'corrupt.db');
    const storage = CodeMentorStorage.open(dbPath);
    const { projectId, taskId } = seedWorkflow(storage);
    const decision = storage.createDecision({
      projectId,
      taskId,
      question: 'q',
      title: 't',
      chosenOption: 'c',
      alternatives: [],
      status: 'declared',
      decidedBy: 'agent',
      declaredAt: T0,
    });
    storage.createClaim({
      decisionId: decision.id,
      kind: 'risk',
      origin: 'declared',
      statement: 's',
      verification: 'unverified',
      evidenceRefs: [],
      createdAt: T0,
    });
    storage.close();

    const raw = new Database(dbPath);
    // origin/kind 列有 CHECK 约束无法直接篡改；statement 无约束，
    // 置空后违反 ClaimSchema 的 min(1)，读取路径应抛出
    raw.exec("UPDATE claims SET statement = ''");
    raw.close();

    const reopened = CodeMentorStorage.open(dbPath);
    expect(() => reopened.listClaimsByDecision(decision.id)).toThrow();
    reopened.close();
  });

  it('transaction 保证原子性：中途抛出则整体回滚', () => {
    const storage = CodeMentorStorage.open(path.join(dir, 'tx.db'));
    seedWorkflow(storage);
    expect(() =>
      storage.transaction(() => {
        storage.createTask({
          projectId: storage.findProjectByRootPath('/repo/demo')!.id,
          title: '会回滚的任务',
          goal: '',
          status: 'active',
          startedAt: T0,
        });
        throw new Error('abort');
      }),
    ).toThrowError('abort');
    expect(
      storage.listTasksByProject(storage.findProjectByRootPath('/repo/demo')!.id),
    ).toHaveLength(1);
    storage.close();
  });
});
