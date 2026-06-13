import { describe, it, expect, vi } from "vitest";
import { buildEditorActions, type EditorActionParams } from "./buildEditorActions";
import { translations } from "../i18n/translations";
import type { Gist } from "../api/tauri";

// Pure-function tests — no DOM, no mocks, no store setup.
// Build a params object, call the function, assert on the metadata fields.

const t = translations["en"];

const noop = vi.fn();

function gist(overrides: Partial<Gist> = {}): Gist {
  return {
    id: "g1",
    description: "test gist",
    public: false,
    html_url: "https://gist.github.com/g1",
    created_at: "",
    updated_at: "",
    files: [],
    pending_push: false,
    local_only: false,
    category: "gist",
    ...overrides,
  };
}

function params(over: Partial<EditorActionParams> = {}): EditorActionParams {
  return {
    gist: gist(),
    networkOnline: true,
    saving: false,
    isDirty: false,
    hasConflict: false,
    showHistory: false,
    showAI: false,
    showBacklinks: false,
    showRun: false,
    isRunnable: false,
    t,
    onPushToGitHub: noop,
    onPublish: noop,
    onDelete: noop,
    onRun: noop,
    onFind: noop,
    onReplace: noop,
    onToggleHistory: noop,
    onToggleAI: noop,
    onShare: noop,
    onToggleBacklinks: noop,
    onTemplate: noop,
    onPromptStar: noop,
    onPromptLib: noop,
    onViewOnGitHub: noop,
    ...over,
  };
}

function item(items: ReturnType<typeof buildEditorActions>, key: string) {
  const found = items.find((i) => i.key === key);
  if (!found) throw new Error(`item "${key}" not found`);
  return found;
}

describe("buildEditorActions", () => {
  // ── Sync / publish item ─────────────────────────────────────────────────────

  it("sync item is hidden when no pending_push and not local_only", () => {
    const items = buildEditorActions(params({ gist: gist({ pending_push: false, local_only: false }) }));
    expect(item(items, "sync").hidden).toBe(true);
  });

  it("sync item is visible when there is a pending_push", () => {
    const items = buildEditorActions(params({ gist: gist({ pending_push: true }) }));
    expect(item(items, "sync").hidden).toBeFalsy();
  });

  it("sync item is visible for local_only gists (even with no pending_push)", () => {
    const items = buildEditorActions(params({ gist: gist({ local_only: true, pending_push: false }) }));
    expect(item(items, "sync").hidden).toBeFalsy();
  });

  it("sync menuLabel shows 'Publish' for local_only gists", () => {
    const items = buildEditorActions(params({ gist: gist({ local_only: true }) }));
    expect(item(items, "sync").menuLabel).toBe(t.editor.publish);
  });

  it("sync menuLabel shows 'Sync to GitHub' for remote gists", () => {
    const items = buildEditorActions(params({ gist: gist({ pending_push: true }) }));
    expect(item(items, "sync").menuLabel).toBe(t.editor.syncToGitHub);
  });

  it("sync is disabled when isDirty (must save before sync)", () => {
    const items = buildEditorActions(params({
      gist: gist({ pending_push: true }),
      isDirty: true,
    }));
    expect(item(items, "sync").menuDisabled).toBe(true);
  });

  it("sync is disabled when hasConflict", () => {
    const items = buildEditorActions(params({
      gist: gist({ pending_push: true }),
      hasConflict: true,
    }));
    expect(item(items, "sync").menuDisabled).toBe(true);
  });

  it("sync is disabled when saving", () => {
    const items = buildEditorActions(params({
      gist: gist({ pending_push: true }),
      saving: true,
    }));
    expect(item(items, "sync").menuDisabled).toBe(true);
  });

  it("publish (local_only) is disabled when offline", () => {
    const items = buildEditorActions(params({
      gist: gist({ local_only: true }),
      networkOnline: false,
    }));
    expect(item(items, "sync").menuDisabled).toBe(true);
  });

  // ── Run item ─────────────────────────────────────────────────────────────────

  it("run item is hidden when the file extension is not runnable", () => {
    const items = buildEditorActions(params({ isRunnable: false }));
    expect(item(items, "run").hidden).toBe(true);
  });

  it("run item is visible for runnable extensions", () => {
    const items = buildEditorActions(params({ isRunnable: true }));
    expect(item(items, "run").hidden).toBeFalsy();
  });

  // ── GitHub link / delete ──────────────────────────────────────────────────

  it("github-link is hidden for local_only gists", () => {
    const items = buildEditorActions(params({ gist: gist({ local_only: true }) }));
    expect(item(items, "github-link").hidden).toBe(true);
  });

  it("github-link alwaysOverflow is false for local_only (it is hidden entirely)", () => {
    const items = buildEditorActions(params({ gist: gist({ local_only: true }) }));
    expect(item(items, "github-link").alwaysOverflow).toBeFalsy();
  });

  it("github-link alwaysOverflow is true for remote gists", () => {
    const items = buildEditorActions(params({ gist: gist({ local_only: false }) }));
    expect(item(items, "github-link").alwaysOverflow).toBe(true);
  });

  it("delete is always overflow and always menuDanger", () => {
    const items = buildEditorActions(params());
    expect(item(items, "delete").alwaysOverflow).toBe(true);
    expect(item(items, "delete").menuDanger).toBe(true);
  });

  // ── Prompt star ──────────────────────────────────────────────────────────────

  it("prompt-star menuLabel reflects current category", () => {
    const prompt = buildEditorActions(params({ gist: gist({ category: "prompt" }) }));
    const normal = buildEditorActions(params({ gist: gist({ category: "gist" }) }));
    expect(item(prompt, "prompt-star").menuLabel).toBe(t.editor.removeFromPrompt);
    expect(item(normal, "prompt-star").menuLabel).toBe(t.editor.addToPrompt);
  });

  // ── Separators present ────────────────────────────────────────────────────────

  it("returns three separator items", () => {
    const items = buildEditorActions(params());
    expect(items.filter((i) => i.isSeparator)).toHaveLength(3);
  });
});
