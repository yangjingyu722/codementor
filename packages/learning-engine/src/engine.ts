import type { ZodTypeAny } from 'zod';
import type {
  Attempt,
  Claim,
  CodeAnchor,
  Decision,
  Evidence,
  Exercise,
} from '@codementor/contracts';
import { CodeMentorError } from '@codementor/decision-engine';
import { CodeMentorStorage } from '@codementor/storage';
import { SubmitAttemptInputSchema } from './schemas.js';

export type LearningLevel = 1 | 2 | 3;

/** 面向客户端的练习视图：answerKey 永不出服务端。 */
export type ExerciseView = Omit<Exercise, 'answerKey'> & { attempts: Attempt[] };

export interface LearningSessionView {
  decision: Pick<Decision, 'id' | 'title' | 'question' | 'status' | 'chosenOption'>;
  /** Explain 步文本：逐句引用真实主张与备选，构建期即固化引用关系。 */
  explanation: string;
  exercises: ExerciseView[];
  completedExerciseIds: string[];
  completed: boolean;
  recommendedLevel: LearningLevel;
}

export interface AttemptResult {
  attempt: Attempt;
  exerciseId: string;
  outcome: Attempt['outcome'];
  feedback: string;
}

export interface LearningEngineOptions {
  now?: () => string;
}

interface DecisionBundleData {
  decision: Decision;
  claims: Claim[];
  evidence: Evidence[];
  anchors: CodeAnchor[];
}

/**
 * 学习引擎（v0.1：确定性模板）。
 *
 * 设计底线（ADR-0008）：
 * - 题目、提示、解释、反馈的全部内容都派生自真实 Decision/Claim/CodeAnchor/Evidence，
 *   不存在与工程无关的泛泛题；数据不足时宁可少出题（缺锚点→无定位题）。
 * - 评分全部确定性；gradedBy 记录评分来源，未来 LLM 参与时永不作为事实依据。
 * - 会话视图剥离 answerKey；进度由 Attempt 派生，服务/插件重启后自然恢复。
 */
export class LearningEngine {
  private readonly now: () => string;

  constructor(
    private readonly storage: CodeMentorStorage,
    options: LearningEngineOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private parse<S extends ZodTypeAny>(schema: S, input: unknown, context: string): S['_output'] {
    const result = schema.safeParse(input);
    if (!result.success) {
      throw new CodeMentorError('VALIDATION', `invalid ${context} input`, result.error.issues);
    }
    return result.data;
  }

  private loadBundle(decisionId: string): DecisionBundleData {
    const decision = this.storage.getDecision(decisionId);
    const claims = this.storage.listClaimsByDecision(decisionId);
    const anchors = this.storage.listCodeAnchorsByDecision(decisionId);
    const evidenceIds = [...new Set(claims.flatMap((c) => c.evidenceRefs))];
    const evidence = this.storage.listEvidenceByIds(evidenceIds);
    return { decision, claims, evidence, anchors };
  }

  /**
   * 生成学习会话（幂等）：已有练习时直接返回，不重复生成、不破坏已有作答。
   * 数据不足时跳过对应题型——绝不虚构。
   */
  generateSession(decisionId: string): { regenerated: boolean; session: LearningSessionView } {
    const existing = this.storage.listExercisesByDecision(decisionId);
    if (existing.length > 0) {
      return { regenerated: false, session: this.getSession(decisionId) };
    }
    const bundle = this.loadBundle(decisionId);
    if (bundle.claims.length === 0) {
      throw new CodeMentorError(
        'VALIDATION',
        `decision ${decisionId} has no claims to teach from; learning content is only generated from real decision data`,
      );
    }

    const createdAt = this.now();
    // --- Predict：方案判断（有真实备选才出题，单选项无意义） ---
    if (bundle.decision.alternatives.length > 0) {
      const names = [
        bundle.decision.chosenOption,
        ...bundle.decision.alternatives.map((a) => a.name),
      ];
      const options = shuffle(names);
      const correctIndex = options.indexOf(bundle.decision.chosenOption);
      this.storage.createExercise({
        decisionId,
        type: 'predict_choice',
        flowStep: 'predict',
        prompt: `不查看实现，先作判断：面对「${bundle.decision.question}」这个问题，你会选择哪个方案？`,
        options,
        hints: bundle.decision.alternatives.map((a) => `备选「${a.name}」的记录：${a.summary}`),
        answerKey: { kind: 'choice', correctIndex },
        focusClaimIds: bundle.claims.filter((c) => c.origin === 'declared').map((c) => c.id),
        createdAt,
      });
    }

    // --- Verify：源码定位（只依据真实锚点，最多 2 题） ---
    for (const anchor of bundle.anchors.filter((a) => a.status !== 'missing').slice(0, 2)) {
      const leaf = anchor.symbolPath[anchor.symbolPath.length - 1] ?? anchor.filePath;
      this.storage.createExercise({
        decisionId,
        type: 'locate_code',
        flowStep: 'verify',
        prompt: `源码定位：符号「${leaf}」（${kindZh(anchor.symbolKind)}）是该设计的实现位置之一。请在工程中找到它，回答「文件路径 符号名」，例如 main.c main。`,
        options: [],
        hints: [
          `它是一个${kindZh(anchor.symbolKind)}，锚定于提交 ${anchor.commitSha.slice(0, 8)}。`,
          `定位提示：搜索符号名「${leaf}」。`,
          `它位于 ${anchor.filePath}（第 ${anchor.startLine} 行附近）。`,
        ],
        answerKey: { kind: 'locate', filePath: anchor.filePath, symbolName: leaf },
        focusClaimIds: [],
        createdAt,
      });
    }

    // --- Transfer：独立解释（rubric 关键词取自真实备选/方案/主张/锚点） ---
    const keywords = buildRubricKeywords(bundle);
    this.storage.createExercise({
      decisionId,
      type: 'open_explanation',
      flowStep: 'transfer',
      prompt: `独立练习：合上代码，用自己的话解释——在这个工程里，为什么「${bundle.decision.chosenOption}」是针对「${bundle.decision.question}」的正确选择？写出你的理由。`,
      options: [],
      hints: [],
      answerKey: {
        kind: 'rubric',
        keywords,
        minMatches: Math.min(2, keywords.length),
      },
      focusClaimIds: bundle.claims.map((c) => c.id),
      createdAt,
    });

    return { regenerated: true, session: this.getSession(decisionId) };
  }

  /** 会话视图：answerKey 剥离；完成状态与级别推荐由作答派生。 */
  getSession(decisionId: string): LearningSessionView {
    const bundle = this.loadBundle(decisionId);
    const exercises = this.storage.listExercisesByDecision(decisionId);
    const attempts = this.storage.listAttemptsByDecision(decisionId);
    const attemptsByExercise = new Map<string, Attempt[]>();
    for (const attempt of attempts) {
      const list = attemptsByExercise.get(attempt.exerciseId) ?? [];
      list.push(attempt);
      attemptsByExercise.set(attempt.exerciseId, list);
    }

    const completedExerciseIds = exercises
      .filter((e) => (attemptsByExercise.get(e.id) ?? []).some((a) => a.outcome === 'pass'))
      .map((e) => e.id);

    return {
      decision: {
        id: bundle.decision.id,
        title: bundle.decision.title,
        question: bundle.decision.question,
        status: bundle.decision.status,
        chosenOption: bundle.decision.chosenOption,
      },
      explanation: buildExplanation(bundle),
      // 真正剥离 answerKey（键不出现），而非置 undefined
      exercises: exercises.map((exercise) => {
        const { answerKey: _answerKey, ...rest } = exercise;
        return { ...rest, attempts: attemptsByExercise.get(exercise.id) ?? [] };
      }),
      completedExerciseIds,
      completed: exercises.length > 0 && completedExerciseIds.length === exercises.length,
      recommendedLevel: recommendLevel(attempts),
    };
  }

  /** 提交作答：确定性评分并落库；反馈逐句引用真实工程信息。 */
  submitAttempt(exerciseId: string, input: unknown): AttemptResult {
    const parsed = this.parse(SubmitAttemptInputSchema, input, 'submitAttempt');
    const exercise = this.storage.getExercise(exerciseId);
    if (exercise.answerKey === undefined) {
      throw new CodeMentorError(
        'INVALID_STATE',
        `exercise ${exerciseId} has no answer key (only generated exercises are gradeable)`,
      );
    }
    const graded = grade(exercise, exercise.answerKey, parsed.answer);
    const attempt = this.storage.createAttempt({
      exerciseId,
      answer: parsed.answer,
      outcome: graded.outcome,
      feedback: graded.feedback,
      level: parsed.level,
      gradedBy: 'deterministic',
      submittedAt: this.now(),
    });
    return {
      attempt,
      exerciseId,
      outcome: attempt.outcome,
      feedback: attempt.feedback,
    };
  }
}

// --- 以下为确定性内容的构建函数（全部以真实数据为输入） ---

function kindZh(kind: CodeAnchor['symbolKind']): string {
  switch (kind) {
    case 'function':
      return '函数';
    case 'struct':
      return '结构体';
    case 'typedef':
      return '类型别名';
    default:
      return '符号';
  }
}

function shuffle(items: string[]): string[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/** rubric 关键词：备选名 + 所选方案 + 主张片段 + 锚点符号名，全部来自真实数据。 */
function buildRubricKeywords(bundle: DecisionBundleData): string[] {
  const raw = [
    bundle.decision.chosenOption,
    ...bundle.decision.alternatives.map((a) => a.name),
    ...bundle.claims.map((c) => c.statement),
    ...bundle.anchors.flatMap((a) => a.symbolPath),
  ];
  const segments = new Set<string>();
  for (const text of raw) {
    for (const piece of text.split(/[，。；、：:（）()\s,.;:]+/)) {
      const trimmed = piece.trim();
      if (trimmed.length >= 4 && trimmed.length <= 24) {
        segments.add(trimmed);
      }
    }
  }
  return [...segments].slice(0, 6);
}

/** Explain 步文本：逐句引用真实备选与主张，不引入任何外部知识。 */
function buildExplanation(bundle: DecisionBundleData): string {
  const { decision, claims } = bundle;
  const parts: string[] = [];
  parts.push(`工程问题：「${decision.question}」。`);
  parts.push(`最终选择：「${decision.chosenOption}」。`);
  if (decision.alternatives.length > 0) {
    const alts = decision.alternatives.map((a) => `「${a.name}」（${a.summary}）`).join('、');
    parts.push(`被记录但未选择的备选：${alts}。`);
  }
  const declared = claims.filter((c) => c.origin === 'declared');
  if (declared.length > 0) {
    parts.push(`编码前声明的取舍依据：${declared.map((c) => `「${c.statement}」`).join('；')}。`);
  }
  const observed = claims.filter((c) => c.origin === 'observed' && c.verification === 'supported');
  if (observed.length > 0) {
    parts.push(`已被证据支撑的观察事实：${observed.map((c) => `「${c.statement}」`).join('；')}。`);
  }
  return parts.join('\n\n');
}

function grade(
  exercise: Exercise,
  answerKey: NonNullable<Exercise['answerKey']>,
  answer: string,
  // 占位以保持签名稳定；实际使用 exercise.answerKey
  _unused?: string,
): { outcome: Attempt['outcome']; feedback: string } {
  switch (answerKey.kind) {
    case 'choice': {
      const parsed = parseChoiceAnswer(answer, exercise.options);
      if (parsed === answerKey.correctIndex) {
        return {
          outcome: 'pass',
          feedback: `正确。「${exercise.options[answerKey.correctIndex] ?? ''}」正是该决策记录的最终选择；完整的取舍依据见解释区。`,
        };
      }
      const correctText = exercise.options[answerKey.correctIndex] ?? '';
      return {
        outcome: 'fail',
        feedback: `不对。工程中实际选择的方案是「${correctText}」。回看该决策的备选方案与设计理由，再想想为什么否决了其他选项。`,
      };
    }
    case 'locate': {
      const { filePath, symbolName } = parseLocateAnswer(answer);
      if (filePath === answerKey.filePath && symbolName === answerKey.symbolName) {
        return {
          outcome: 'pass',
          feedback: `定位正确：${answerKey.filePath} 中的 ${answerKey.symbolName} 正是该设计锚定的实现位置。可点击上方锚点直接跳转核对。`,
        };
      }
      return {
        outcome: 'fail',
        feedback: `未定位准确。真实位置：${answerKey.filePath} 的 ${answerKey.symbolName}。提示：锚点记录的行号可在决策详情的“关联代码”中核对。`,
      };
    }
    case 'rubric': {
      const normalized = answer.toLowerCase();
      const hits = answerKey.keywords.filter((k) => normalized.includes(k.toLowerCase()));
      if (hits.length >= answerKey.minMatches) {
        return {
          outcome: 'pass',
          feedback: `解释成立：命中了真实设计要点（${hits.join('、')}）。对照解释区核对是否遗漏了权衡。`,
        };
      }
      if (hits.length > 0) {
        return {
          outcome: 'partial',
          feedback: `方向正确但不完整：仅命中「${hits.join('、')}」。真实设计要点还包括：${answerKey.keywords
            .filter((k) => !hits.includes(k))
            .join('、')}。这些全部来自该决策的真实记录。`,
        };
      }
      return {
        outcome: 'fail',
        feedback: `解释未触及真实设计要点。该决策的记录中包含这些要点：${answerKey.keywords.join('、')}。建议先阅读解释区，再用自己的话重写。`,
      };
    }
  }
}

/** 接受 "2"、"B"、或选项原文作为选择题答案。 */
function parseChoiceAnswer(answer: string, options: string[]): number {
  const trimmed = answer.trim();
  const byIndex = Number.parseInt(trimmed, 10);
  if (
    !Number.isNaN(byIndex) &&
    String(byIndex) === trimmed &&
    byIndex >= 0 &&
    byIndex < options.length
  ) {
    return byIndex;
  }
  const byExact = options.findIndex((o) => o === trimmed);
  if (byExact >= 0) {
    return byExact;
  }
  const byLetter = /^[A-Za-z]$/.exec(trimmed);
  if (byLetter !== null) {
    const idx = trimmed.toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < options.length) {
      return idx;
    }
  }
  return -1;
}

/** 接受 "proc.c switch_to"、"proc.c: switch_to"、"switch_to @ proc.c" 等格式。 */
function parseLocateAnswer(answer: string): { filePath: string; symbolName: string } {
  const normalized = answer
    .trim()
    .replace(/[:@,]+/g, ' ')
    .replace(/\s+/g, ' ');
  const tokens = normalized.split(' ');
  if (tokens.length < 2) {
    return { filePath: '', symbolName: normalized };
  }
  const filePath = tokens.find((t) => t.includes('.')) ?? '';
  const symbolName = tokens.filter((t) => t !== filePath).join(' ');
  return { filePath, symbolName };
}

function recommendLevel(attempts: Attempt[]): LearningLevel {
  // 以最近一次作答为准：刚答错（还在挣扎）→ 回到完整引导；答对/部分对 → 独立练习。
  const latest = attempts[attempts.length - 1];
  if (latest === undefined) {
    return 2;
  }
  if (latest.outcome === 'fail') {
    return 1;
  }
  if (latest.outcome === 'pass' || latest.outcome === 'partial') {
    return 3;
  }
  return 2;
}
