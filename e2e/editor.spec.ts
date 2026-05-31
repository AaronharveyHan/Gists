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
    await browser.$('[data-testid="gist-list"]').waitForDisplayed({ timeout: 15000 });
  });

  it("selecting a gist shows the Monaco editor", async () => {
    const item = await browser.$('.gist-item');
    await item.waitForExist({ timeout: 8000 });
    await item.click();

    // Monaco editor container
    const editor = await browser.$('.monaco-editor');
    await editor.waitForExist({ timeout: 10000 });
    expect(await editor.isExisting()).toBe(true);
  });

  it("clicking the editor container focuses it", async () => {
    // Monaco's .inputarea has opacity:0 (not interactable via WebDriver).
    // Click the outer editor container instead — Monaco handles focus internally.
    const editor = await browser.$('.monaco-editor');
    await editor.waitForDisplayed({ timeout: 8000 });
    await editor.click();
    // Verify the editor received focus by checking the focused class Monaco adds
    const focusedEditor = await browser.$('.monaco-editor.focused');
    expect(await focusedEditor.isExisting()).toBe(true);
  });

  it("typing updates the editor content", async () => {
    const editor = await browser.$('.monaco-editor');
    await editor.click();
    // Select all and replace
    await browser.keys(['Control', 'a']);
    await browser.pause(100);
    await browser.keys('Hello E2E world');
    await browser.pause(300);

    // The editor view-lines should contain the typed text
    const editorContent = await browser.$('.monaco-editor .view-lines');
    const text = await editorContent.getText();
    expect(text).toContain('Hello E2E world');
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
    // Editor toolbar should have a preview/toggle button
    const previewBtn = await browser.$('.editor__preview-btn, button[title*="review"], button[title*="Preview"]');
    expect(await previewBtn.isExisting()).toBe(true);
  });
});
