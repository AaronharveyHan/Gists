/**
 * Editor — create, edit, and save gist drafts.
 */
import { skipOnboardingIfShown, invoke } from "./helpers/app";

describe("Editor", () => {
  before(async () => {
    await skipOnboardingIfShown();
    // Seed a local draft to select
    await invoke("create_local_gist", {
      description: "Editor test gist",
      public: false,
      files: [["editor-test.md", "initial content"]],
    });
    // invoke() writes directly to the DB; reload so the React app fetches the
    // newly-created gist on mount and it appears in the gist list.
    await browser.refresh();
    await skipOnboardingIfShown();
    await browser.$('.gist-item').waitForExist({ timeout: 30000 });
  });

  it("selecting a gist shows the Monaco editor", async () => {
    const item = await browser.$('.gist-item');
    await item.waitForExist({ timeout: 8000 });
    await item.click();

    // Monaco editor container — initialises asynchronously; allow extra time in CI.
    const editor = await browser.$('.monaco-editor');
    await editor.waitForExist({ timeout: 15000 });
    expect(await editor.isExisting()).toBe(true);
  });

  it("clicking the editor container focuses it", async () => {
    // Monaco's .inputarea has opacity:0 (not interactable via WebDriver).
    // Click the outer editor container instead — Monaco handles focus internally.
    const editor = await browser.$('.monaco-editor');
    await editor.waitForDisplayed({ timeout: 8000 });
    await editor.click();
    // Monaco adds .focused via its FocusTracker after the click event is processed
    // asynchronously (requestAnimationFrame / scheduler task).  waitUntil polls
    // via browser.execute() — which runs in the main world — until the class
    // appears, rather than checking isExisting() in the same JS task as the click.
    // On each poll we also nudge Monaco's hidden textarea directly so that focus
    // is reliably delivered even if the outer-container click didn't propagate all
    // the way to the input area in WebKitGTK.
    await browser.waitUntil(
      () => browser.execute(() => {
        if (document.querySelector('.monaco-editor.focused')) return true;
        const ta = document.querySelector<HTMLElement>('.monaco-editor textarea');
        ta?.focus();
        return false;
      }),
      { timeout: 10000, interval: 100, timeoutMsg: 'Monaco editor did not receive focus within 10 s' }
    );
    const focusedEditor = await browser.$('.monaco-editor.focused');
    expect(await focusedEditor.isExisting()).toBe(true);
  });

  it("typing updates the editor content", async () => {
    const editor = await browser.$('.monaco-editor');
    // Do NOT click textarea — in WebKitGTK that triggers execute/sync timeout (30s per attempt).
    // Click the outer container; Monaco routes focus internally.
    await editor.click();
    // Select all and replace
    await browser.keys(['Control', 'a']);
    await browser.pause(100);
    await browser.keys('Hello E2E world');
    await browser.pause(300);
    await browser.keys(['Escape']);
    await browser.pause(300);
    // Verify typing via the dirty indicator (●) — it appears whenever Monaco's
    // onChange fires, without needing to read view-lines content (which is
    // polluted by AI ghost-text in this environment).
    const dirty = await browser.$('.editor__dirty');
    await dirty.waitForExist({ timeout: 5000 });
    expect(await dirty.isExisting()).toBe(true);
  });

  it("Ctrl+S saves the draft without error", async () => {
    const editor = await browser.$('.monaco-editor');
    await editor.click();
    await browser.keys(['Control', 's']);

    // No error toast should appear (wait briefly and check)
    await browser.pause(500);
    const errorToast = await browser.$('.toast--error');
    expect(await errorToast.isExisting()).toBe(false);
  });

  it("the preview toggle button renders in the toolbar", async () => {
    // Re-select the gist so the editor state is clean after previous test interactions.
    const item = await browser.$('.gist-item');
    if (await item.isExisting()) {
      await item.click();
      await browser.$('.monaco-editor').waitForExist({ timeout: 10000 });
    }

    // md-tab-preview is rendered whenever a .md file is active (isMdActive).
    // Use browser.$ (WebDriver findElement) — it reliably reaches the editor
    // DOM in WebKitGTK, whereas browser.execute() targets a JS context that
    // does NOT see the editor (only the sidebar/gist-list is visible there).
    const previewBtn = await browser.$('[data-testid="md-tab-preview"]');
    await previewBtn.waitForExist({ timeout: 20000 });
    expect(await previewBtn.isExisting()).toBe(true);
  });
});
