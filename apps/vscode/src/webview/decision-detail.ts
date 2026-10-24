import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { CodeAnchor } from '@codementor/contracts';
import type { ApiClient, DecisionDetail } from '../client/api-client';

const ANCHOR_STATUS_ZH: Record<CodeAnchor['status'], string> = {
  confirmed: '已确认',
  ambiguous: '无法精确定位（显示最后已知位置）',
  missing: '符号已缺失（显示最后已知位置）',
};

const ANCHOR_STATUS_COLOR: Record<CodeAnchor['status'], string> = {
  confirmed: 'var(--vscode-charts-green)',
  ambiguous: 'var(--vscode-editorWarning-foreground)',
  missing: 'var(--vscode-errorForeground)',
};

/** 全部动态文本必须经此转义后再进 HTML。 */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function claimList(
  items: Array<{ kind: string; statement: string; verification?: string }>,
  accentVar: string,
): string {
  if (items.length === 0) {
    return '<p class="muted">（无）</p>';
  }
  return items
    .map((claim) => {
      const badge =
        claim.verification === undefined
          ? ''
          : `<span class="badge" style="border-color:${accentVar};color:${accentVar}">${esc(claim.verification)}</span>`;
      return `<li><span class="kind">${esc(claim.kind)}</span> ${esc(claim.statement)} ${badge}</li>`;
    })
    .join('');
}

function evidenceList(
  claims: DecisionDetail['claims'],
  evidence: DecisionDetail['evidence'],
): string {
  const observed = claims.filter((c) => c.origin === 'observed' && c.evidenceRefs.length > 0);
  if (observed.length === 0) {
    return '<p class="muted">（尚无证据）</p>';
  }
  const byId = new Map(evidence.map((e) => [e.id, e]));
  return observed
    .flatMap((claim) =>
      claim.evidenceRefs.map((ref) => {
        const e = byId.get(ref);
        if (e === undefined) {
          return `<li><span class="kind">${esc(claim.kind)}</span> ${esc(claim.statement)} → 证据缺失</li>`;
        }
        return `<li><span class="kind">${esc(e.kind)}</span> ${esc(e.summary || e.contentRef)} <span class="badge">${esc(e.verdict)}</span> <span class="muted">${esc(e.producedAt)}</span></li>`;
      }),
    )
    .join('');
}

function anchorRows(anchors: CodeAnchor[]): string {
  if (anchors.length === 0) {
    return '<p class="muted">（该决策尚未关联代码）</p>';
  }
  return anchors
    .map(
      (a) => `<button class="anchor" data-anchor-id="${esc(a.id)}">
        <span class="mono">${esc(a.filePath)}:${a.startLine}-${a.endLine}</span>
        <span class="muted">${esc(a.symbolPath.join('.'))} · ${esc(a.symbolKind)}</span>
        <span class="badge" style="border-color:${ANCHOR_STATUS_COLOR[a.status]};color:${ANCHOR_STATUS_COLOR[a.status]}">${esc(ANCHOR_STATUS_ZH[a.status])}</span>
        ${a.origin === 'inferred' ? '<span class="badge">自动关联</span>' : ''}
      </button>`,
    )
    .join('');
}

function buildHtml(detail: DecisionDetail, anchors: CodeAnchor[], nonce: string): string {
  const { decision, claims, evidence, integrity } = detail;
  const declared = claims.filter((c) => c.origin === 'declared');
  const observed = claims.filter((c) => c.origin === 'observed');
  const rationalized = claims.filter((c) => c.origin === 'rationalized');
  const alternatives = decision.alternatives
    .map((alt) => `<li><strong>${esc(alt.name)}</strong> — ${esc(alt.summary)}</li>`)
    .join('');
  const integrityBlock = integrity.ok
    ? '<p class="muted">完整性校验通过（R1–R5）</p>'
    : `<ul>${integrity.issues
        .map((i) => `<li class="integrity-issue">${esc(i.code)}：${esc(i.message)}</li>`)
        .join('')}</ul>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  body { color: var(--vscode-editor-foreground); font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size, 13px); padding: 12px 20px; line-height: 1.6; }
  h1 { font-size: 1.25em; margin: 0 0 4px; }
  h2 { font-size: 1.05em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; margin-top: 1.6em; }
  .question { color: var(--vscode-descriptionForeground); margin: 0 0 8px; }
  .badge { display: inline-block; border: 1px solid var(--vscode-panel-border); border-radius: 3px; padding: 0 6px; margin-left: 6px; font-size: 0.9em; }
  .kind { display: inline-block; color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-right: 6px; }
  .muted { color: var(--vscode-descriptionForeground); }
  .mono { font-family: var(--vscode-editor-font-family); }
  .chosen { border-left: 3px solid var(--vscode-charts-green); padding: 6px 10px; background: var(--vscode-editor-background); margin: 8px 0; }
  .origin-declared { border-left: 3px solid var(--vscode-charts-green); padding-left: 10px; }
  .origin-observed { border-left: 3px solid var(--vscode-charts-blue); padding-left: 10px; }
  .origin-rationalized { border-left: 3px solid var(--vscode-charts-orange); padding-left: 10px; }
  .origin-note { font-size: 0.9em; color: var(--vscode-descriptionForeground); }
  ul { padding-left: 18px; }
  .anchor { display: flex; gap: 10px; align-items: center; width: 100%; text-align: left; cursor: pointer;
            background: var(--vscode-editor-background); color: var(--vscode-editor-foreground);
            border: 1px solid var(--vscode-panel-border); border-radius: 3px; padding: 6px 10px; margin: 4px 0; }
  .anchor:hover { background: var(--vscode-list-hoverBackground); outline: 1px solid var(--vscode-focusBorder); }
  .integrity-issue { color: var(--vscode-errorForeground); }
  .learn-step { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 10px 12px; margin: 8px 0; }
  .learn-step.done { border-color: var(--vscode-charts-green); }
  .learn-step .status-line { font-weight: 600; }
  .learn-step label { display: block; margin: 4px 0; cursor: pointer; }
  .learn-step input[type="text"], .learn-step textarea {
    width: 100%; box-sizing: border-box; background: var(--vscode-input-background);
    color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);
    border-radius: 2px; padding: 4px 6px; font-family: var(--vscode-editor-font-family);
  }
  .learn-step button, .learn-actions button {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; border-radius: 2px; padding: 4px 12px; cursor: pointer; margin: 6px 6px 0 0;
  }
  .learn-step button:hover, .learn-actions button:hover { background: var(--vscode-button-hoverBackground); }
  .learn-step button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .hint { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin: 2px 0; }
  .feedback-pass { color: var(--vscode-charts-green); }
  .feedback-partial { color: var(--vscode-charts-orange); }
  .feedback-fail { color: var(--vscode-errorForeground); }
  .learn-meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
</style>
</head>
<body>
  <h1>${esc(decision.title)}</h1>
  <p class="question">${esc(decision.question)}</p>
  <p>
    <span class="badge">${esc(decision.status)}</span>
    <span class="badge">决策人：${esc(decision.decidedBy)}</span>
    <span class="badge">声明于 ${esc(decision.declaredAt)}</span>
  </p>

  <h2>最终选择</h2>
  <div class="chosen mono">${esc(decision.chosenOption)}</div>

  <h2>备选方案（未选择）</h2>
  <ul>${alternatives || '<p class="muted">（未记录备选方案）</p>'}</ul>

  <h2>设计理由 · 事前声明（declared）</h2>
  <div class="origin-declared">
    <p class="origin-note">编码前由 Agent/人显式声明，可被时间戳与完整性规则核验。</p>
    <ul>${claimList(declared, 'var(--vscode-charts-green)')}</ul>
  </div>

  <h2>设计理由 · 观察事实（observed）</h2>
  <div class="origin-observed">
    <p class="origin-note">来自测试/diff/构建等机器可核查的事实，必须携带证据。</p>
    <ul>${claimList(observed, 'var(--vscode-charts-blue)')}</ul>
    <h3>验证证据</h3>
    <ul>${evidenceList(claims, evidence)}</ul>
  </div>

  <h2>设计理由 · 事后推断（rationalized）</h2>
  <div class="origin-rationalized">
    <p class="origin-note">实现之后补写的解释，<strong>不能视为原始设计意图</strong>。</p>
    <ul>${claimList(rationalized, 'var(--vscode-charts-orange)')}</ul>
  </div>

  <h2>关联代码</h2>
  ${anchorRows(anchors)}

  <h2>学习</h2>
  <div class="learn-actions" id="learning-root">
    <p class="muted">围绕本决策的五步学习：问题 → 方案判断 → 解释 → 代码验证 → 独立练习。内容全部来自该决策的真实记录。</p>
    <button id="start-learning">开始学习</button>
    <div id="learning-body"></div>
  </div>

  <h2>完整性</h2>
  ${integrityBlock}
</body>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button.anchor');
    if (button !== null) {
      vscode.postMessage({ type: 'reveal', anchorId: button.dataset.anchorId });
      return;
    }
    if (event.target.id === 'start-learning') {
      vscode.postMessage({ type: 'startLearning' });
    }
  });

  function el(tag, attrs, text) {
    const node = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'class') { node.className = attrs[k]; } else { node.setAttribute(k, attrs[k]); }
    }
    if (text !== undefined) { node.textContent = text; }
    return node;
  }

  function feedbackClass(outcome) {
    return outcome === 'pass' ? 'feedback-pass' : outcome === 'partial' ? 'feedback-partial' : 'feedback-fail';
  }

  function outcomeZh(outcome) {
    return { pass: '通过', partial: '部分正确', fail: '未通过', ungraded: '未评分' }[outcome] || outcome;
  }

  function stepTitle(step) {
    return {
      predict: '第 1 步 · 方案判断（Predict）',
      verify: '第 2 步 · 代码验证（Verify）',
      transfer: '第 3 步 · 独立练习（Transfer）',
    }[step] || step;
  }

  let currentLevel = 2;

  function renderStep(exercise, completedIds) {
    const done = completedIds.includes(exercise.id);
    const wrap = el('div', { class: 'learn-step' + (done ? ' done' : '') });
    wrap.appendChild(el('div', { class: 'status-line' }, stepTitle(exercise.flowStep) + (done ? '  ✓ 已通过' : '')));

    if (exercise.type === 'predict_choice') {
      wrap.appendChild(el('p', {}, exercise.prompt));
      exercise.options.forEach((option, index) => {
        const label = el('label', {});
        const radio = el('input', { type: 'radio', name: 'opt-' + exercise.id, value: String(index) });
        label.appendChild(radio);
        label.appendChild(document.createTextNode(' ' + option));
        wrap.appendChild(label);
      });
      const submit = el('button', {}, '提交判断');
      submit.addEventListener('click', () => {
        const picked = wrap.querySelector('input[type=radio]:checked');
        if (picked !== null) {
          vscode.postMessage({ type: 'submitAttempt', exerciseId: exercise.id, answer: picked.value, level: currentLevel });
        }
      });
      wrap.appendChild(submit);
    } else if (exercise.type === 'locate_code') {
      wrap.appendChild(el('p', {}, exercise.prompt));
      const input = el('input', { type: 'text', placeholder: '文件路径 符号名（例如 main.c main）' });
      wrap.appendChild(input);
      const submit = el('button', {}, '提交定位');
      submit.addEventListener('click', () => {
        if (input.value.trim().length > 0) {
          vscode.postMessage({ type: 'submitAttempt', exerciseId: exercise.id, answer: input.value.trim(), level: currentLevel });
        }
      });
      wrap.appendChild(submit);
      const evidenceBtn = el('button', { class: 'secondary' }, '查看代码证据');
      evidenceBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'locateTarget', symbolName: (exercise.prompt.match(/符号「(.*?)」/) || [])[1] || '' });
      });
      wrap.appendChild(evidenceBtn);
    } else {
      wrap.appendChild(el('p', {}, exercise.prompt));
      const area = el('textarea', { rows: '4', placeholder: '用自己的话解释（将按该决策的真实记录做确定性核对）' });
      wrap.appendChild(area);
      const submit = el('button', {}, '提交练习');
      submit.addEventListener('click', () => {
        if (area.value.trim().length > 0) {
          vscode.postMessage({ type: 'submitAttempt', exerciseId: exercise.id, answer: area.value.trim(), level: currentLevel });
        }
      });
      wrap.appendChild(submit);
    }

    const hintCount = currentLevel === 1 ? exercise.hints.length : currentLevel === 2 ? Math.min(1, exercise.hints.length) : 0;
    exercise.hints.slice(0, hintCount).forEach((h) => wrap.appendChild(el('p', { class: 'hint' }, '提示：' + h)));

    (exercise.attempts || []).slice(-2).forEach((a) => {
      wrap.appendChild(el('p', { class: feedbackClass(a.outcome) }, outcomeZh(a.outcome) + '（Level ' + a.level + '）：' + a.feedback));
    });
    return wrap;
  }

  function renderSession(session) {
    currentLevel = session.recommendedLevel || 2;
    const body = document.getElementById('learning-body');
    body.textContent = '';
    const levelName = currentLevel === 1 ? '完整引导' : currentLevel === 2 ? '提示式参与' : '独立练习';
    body.appendChild(el('p', { class: 'learn-meta' }, '学习级别：Level ' + currentLevel + '（' + levelName + '）' + (session.completed ? ' · 本决策学习已完成 ✓' : '')));
    body.appendChild(el('p', { class: 'hint' }, '解释：' + session.explanation.split('\\n\\n').join(' / ')));
    const order = { predict: 0, verify: 1, transfer: 2 };
    session.exercises
      .slice()
      .sort((a, b) => order[a.flowStep] - order[b.flowStep])
      .forEach((exercise) => body.appendChild(renderStep(exercise, session.completedExerciseIds)));
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'learningSession') {
      renderSession(msg.session);
    } else if (msg.type === 'attemptError') {
      // 提交失败不打断页面：反馈由扩展端以非模态提示展示
    }
  });
</script>
</html>`;
}

export class DecisionDetailPanel {
  private readonly panels = new Map<string, vscode.WebviewPanel>();

  constructor(
    private readonly client: ApiClient,
    private readonly reveal: (anchor: CodeAnchor) => Promise<void>,
  ) {}

  get openedCount(): number {
    return this.panels.size;
  }

  /** 面向测试与命令的会话启动计数（非功能状态）。 */
  learningSessionsStarted = 0;

  async show(decisionId: string, options: { autoStartLearning?: boolean } = {}): Promise<void> {
    const existing = this.panels.get(decisionId);
    if (existing !== undefined) {
      existing.reveal();
      if (options.autoStartLearning === true) {
        await this.startLearning(existing, decisionId);
      }
      return;
    }

    const detail = await this.client.getDecisionDetail(decisionId);
    const anchors = await this.client.listAnchors(decisionId);
    const nonce = randomBytes(16).toString('hex');

    const panel = vscode.window.createWebviewPanel(
      'codementor.decisionDetail',
      detail.decision.title,
      vscode.ViewColumn.Beside,
      { enableScripts: true, localResourceRoots: [] },
    );
    panel.webview.html = buildHtml(detail, anchors, nonce);

    panel.webview.onDidReceiveMessage(
      async (message: {
        type?: string;
        anchorId?: string;
        symbolName?: string;
        exerciseId?: string;
        answer?: string;
        level?: number;
      }) => {
        try {
          if (message.type === 'reveal' && typeof message.anchorId === 'string') {
            const anchor = anchors.find((a) => a.id === message.anchorId);
            if (anchor !== undefined) {
              await this.reveal(anchor);
            }
            return;
          }
          if (message.type === 'startLearning') {
            await this.startLearning(panel, decisionId);
            return;
          }
          if (
            message.type === 'submitAttempt' &&
            typeof message.exerciseId === 'string' &&
            typeof message.answer === 'string'
          ) {
            const level =
              message.level === 1 || message.level === 2 || message.level === 3 ? message.level : 2;
            await this.client.submitAttempt(message.exerciseId, {
              answer: message.answer,
              level,
            });
            // 重新拉取会话：进度、反馈与级别推荐统一由服务端给出
            const session = await this.client.getLearningSession(decisionId);
            // postMessage 不进入 await 链：webview 未就绪时其 Thenable 可能永不 settle
            void Promise.resolve(
              panel.webview.postMessage({ type: 'learningSession', session }),
            ).catch(() => {});
            return;
          }
          if (message.type === 'locateTarget' && typeof message.symbolName === 'string') {
            const anchor = anchors.find(
              (a) => a.symbolPath[a.symbolPath.length - 1] === message.symbolName,
            );
            if (anchor !== undefined) {
              await this.reveal(anchor);
            }
          }
        } catch (err) {
          void Promise.resolve(
            panel.webview.postMessage({
              type: 'attemptError',
              message: err instanceof Error ? err.message : String(err),
            }),
          ).catch(() => {});
          void vscode.window.showErrorMessage(
            `学习操作失败：${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    );
    panel.onDidDispose(() => {
      this.panels.delete(decisionId);
    });
    this.panels.set(decisionId, panel);

    if (options.autoStartLearning === true) {
      await this.startLearning(panel, decisionId);
    }
  }

  /** 开始学习：生成（幂等）并推送会话到面板。 */
  private async startLearning(panel: vscode.WebviewPanel, decisionId: string): Promise<void> {
    const { session } = await this.client.startLearningSession(decisionId);
    this.learningSessionsStarted += 1;
    void Promise.resolve(panel.webview.postMessage({ type: 'learningSession', session })).catch(
      () => {},
    );
  }
}
