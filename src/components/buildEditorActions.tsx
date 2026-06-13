/**
 * Builds the OverflowActions item list for the Editor toolbar.
 *
 * Extracted from the inline IIFE so the hidden/disabled/label logic can be
 * unit-tested without rendering the full Editor (which requires Monaco +
 * multiple Tauri IPC calls on mount).
 */
import type { OverflowItem } from "./OverflowActions";
import type { Gist } from "../api/tauri";
import type { useT } from "../store/useI18nStore";

export interface EditorActionParams {
  gist: Gist;
  networkOnline: boolean;
  saving: boolean;
  isDirty: boolean;
  /** True when any ConflictState is present (callers pass !!conflict). */
  hasConflict: boolean;
  showHistory: boolean;
  showAI: boolean;
  showBacklinks: boolean;
  showRun: boolean;
  isRunnable: boolean;
  t: ReturnType<typeof useT>;
  onPushToGitHub: () => void;
  onPublish: () => Promise<void>;
  onDelete: () => void;
  onRun: () => void;
  onFind: () => void;
  onReplace: () => void;
  onToggleHistory: () => void;
  onToggleAI: () => void;
  onShare: () => void;
  onToggleBacklinks: () => void;
  onTemplate: () => void;
  onPromptStar: () => void;
  onPromptLib: () => void;
  onViewOnGitHub: () => void;
}

export function buildEditorActions(p: EditorActionParams): OverflowItem[] {
  const {
    gist, networkOnline, saving, isDirty, hasConflict,
    showHistory, showAI, showBacklinks, showRun, isRunnable, t,
    onPushToGitHub, onPublish, onDelete, onRun,
    onFind, onReplace, onToggleHistory, onToggleAI,
    onShare, onToggleBacklinks, onTemplate,
    onPromptStar, onPromptLib, onViewOnGitHub,
  } = p;

  return [
    // ── Tier 1: Primary actions ───────────────────────────────────────────────
    {
      key: "sync",
      priority: 1,
      hidden: !gist.local_only && !gist.pending_push,
      node: gist.local_only ? (
        <button
          type="button"
          className={`btn${networkOnline ? " btn--sync-ready" : ""}`}
          onClick={async () => {
            if (!networkOnline) return;
            await onPublish();
          }}
          disabled={saving || !networkOnline}
          title={networkOnline ? t.editor.publish : t.editor.offline}
        >
          {networkOnline ? `↑ ${t.editor.publish}` : t.editor.offline}
        </button>
      ) : (
        <button
          type="button"
          className={`btn${(gist.pending_push && !isDirty && !hasConflict) ? " btn--sync-ready" : ""}`}
          onClick={onPushToGitHub}
          disabled={saving || !gist.pending_push || hasConflict || isDirty}
          title={isDirty ? t.editor.waitForSave : t.editor.syncToGitHubTitle}
        >
          {`↑ ${t.editor.syncToGitHub}`}
        </button>
      ),
      menuLabel: gist.local_only ? t.editor.publish : t.editor.syncToGitHub,
      menuOnClick: gist.local_only ? onPublish : onPushToGitHub,
      menuDisabled: gist.local_only
        ? saving || !networkOnline
        : saving || !gist.pending_push || hasConflict || isDirty,
    },
    {
      key: "run",
      priority: 1,
      hidden: !isRunnable,
      node: (
        <button
          type="button"
          className={`btn btn--primary${showRun ? " btn--icon--active" : ""}`}
          onClick={onRun}
          title={t.editor.runTitle}
        >
          {t.editor.run}
        </button>
      ),
      menuLabel: t.editor.run,
      menuOnClick: onRun,
    },

    // ── Separator before editing tools ────────────────────────────────────────
    { key: "sep-edit", priority: 2, isSeparator: true, node: null, menuLabel: "" },

    // ── Tier 2: Editing tools (icon-only) ─────────────────────────────────────
    {
      key: "find",
      priority: 2,
      node: (
        <button type="button" className="btn btn--icon" onClick={onFind} title={t.editor.findTitle}>
          ⌕
        </button>
      ),
      menuLabel: t.editor.find,
      menuOnClick: onFind,
    },
    {
      key: "replace",
      priority: 2,
      node: (
        <button type="button" className="btn btn--icon" onClick={onReplace} title={t.editor.replaceTitle}>
          ⇄
        </button>
      ),
      menuLabel: t.editor.replace,
      menuOnClick: onReplace,
    },

    // ── Separator before panel toggles ────────────────────────────────────────
    { key: "sep-panels", priority: 3, isSeparator: true, node: null, menuLabel: "" },

    // ── Tier 3: Panel toggles (icon-only) ─────────────────────────────────────
    {
      key: "history",
      priority: 3,
      node: (
        <button type="button" className={`btn btn--icon${showHistory ? " btn--icon--active" : ""}`} onClick={onToggleHistory} title={t.editor.historyTitle}>
          ↺
        </button>
      ),
      menuLabel: t.editor.history,
      menuOnClick: onToggleHistory,
    },
    {
      key: "ai",
      priority: 3,
      node: (
        <button type="button" className={`btn btn--icon${showAI ? " btn--icon--active" : ""}`} onClick={onToggleAI} title={t.editor.aiTitle}>
          ✦
        </button>
      ),
      menuLabel: t.editor.ai,
      menuOnClick: onToggleAI,
    },
    {
      key: "share",
      priority: 4,
      node: (
        <button type="button" className="btn btn--icon" onClick={onShare} title={t.editor.shareTitle}>
          ↗
        </button>
      ),
      menuLabel: t.editor.share,
      menuOnClick: onShare,
    },
    {
      key: "backlinks",
      priority: 4,
      node: (
        <button type="button" data-testid="backlinks-btn" className={`btn btn--icon${showBacklinks ? " btn--icon--active" : ""}`} onClick={onToggleBacklinks} title={t.backlinks.panelHint + " (⌘⇧B)"}>
          ↩
        </button>
      ),
      menuLabel: t.backlinks.panelTitle,
      menuOnClick: onToggleBacklinks,
    },
    {
      key: "template",
      priority: 4,
      node: (
        <button type="button" className="btn btn--icon" onClick={onTemplate} title={t.editor.templateTitle}>
          ⊞
        </button>
      ),
      menuLabel: t.editor.template,
      menuOnClick: onTemplate,
    },

    // ── Separator before org tools ────────────────────────────────────────────
    { key: "sep-org", priority: 5, isSeparator: true, node: null, menuLabel: "" },

    // ── Tier 3: Org tools (icon-only) ─────────────────────────────────────────
    {
      key: "prompt-star",
      priority: 5,
      node: (
        <button
          type="button"
          className={`btn btn--icon${gist.category === "prompt" ? " btn--icon--active" : ""}`}
          onClick={onPromptStar}
          title={gist.category === "prompt" ? t.editor.removeFromPrompt : t.editor.addToPrompt}
        >
          {gist.category === "prompt" ? "★" : "☆"}
        </button>
      ),
      menuLabel: gist.category === "prompt" ? t.editor.removeFromPrompt : t.editor.addToPrompt,
      menuOnClick: onPromptStar,
    },
    {
      key: "prompt-lib",
      priority: 5,
      node: (
        <button type="button" className="btn btn--icon" onClick={onPromptLib} title={t.editor.libraryTitle}>
          ≡
        </button>
      ),
      menuLabel: t.editor.library,
      menuOnClick: onPromptLib,
    },

    // ── Always overflow: GitHub link + Delete ─────────────────────────────────
    {
      key: "github-link",
      priority: 6,
      alwaysOverflow: !gist.local_only,
      hidden: gist.local_only,
      node: null,
      menuLabel: t.editor.viewOnGitHub,
      menuOnClick: onViewOnGitHub,
    },
    {
      key: "delete",
      priority: 6,
      alwaysOverflow: true,
      node: null,
      menuLabel: t.editor.delete,
      menuOnClick: onDelete,
      menuDanger: true,
    },
  ];
}
