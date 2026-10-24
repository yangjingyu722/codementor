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

  <h2>完整性</h2>
  ${integrityBlock}
</body>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button.anchor');
    if (button !== null) {
      vscode.postMessage({ type: 'reveal', anchorId: button.dataset.anchorId });
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

  async show(decisionId: string): Promise<void> {
    const existing = this.panels.get(decisionId);
    if (existing !== undefined) {
      existing.reveal();
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

    panel.webview.onDidReceiveMessage(async (message: { type?: string; anchorId?: string }) => {
      if (message.type === 'reveal' && typeof message.anchorId === 'string') {
        const anchor = anchors.find((a) => a.id === message.anchorId);
        if (anchor !== undefined) {
          await this.reveal(anchor);
        }
      }
    });
    panel.onDidDispose(() => {
      this.panels.delete(decisionId);
    });
    this.panels.set(decisionId, panel);
  }
}
