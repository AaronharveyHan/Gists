/**
 * Shared helpers for Gists Client E2E tests.
 *
 * All Tauri IPC calls go through browser.tauri.execute() which runs JS
 * in the app's webview with access to window.__TAURI_INTERNALS__.
 */

/** Call a Tauri backend command and return the result. */
export async function invoke<T = unknown>(
  command: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  return browser.tauri.execute(
    ({ core }, cmd, a) => core.invoke(cmd, a),
    command,
    args
  ) as Promise<T>;
}

/**
 * If the onboarding screen is visible, skip it by entering local mode.
 * Call this at the start of any test that requires the main UI.
 */
export async function skipOnboardingIfShown(): Promise<void> {
  const onboarding = await browser.$('[data-testid="onboarding"]');
  const isShown = await onboarding.isExisting();
  if (!isShown) return;

  const skipBtn = await browser.$('.ob__ghost-link');
  await skipBtn.waitForDisplayed({ timeout: 5000 });
  await skipBtn.click();

  await browser.$('[data-testid="gist-list"]').waitForExist({ timeout: 10000 });
}

/** Wait until the gist list is rendered (possibly empty). */
export async function waitForGistList() {
  const list = await browser.$('[data-testid="gist-list"]');
  await list.waitForExist({ timeout: 10000 });
  return list;
}

/** Create a local draft gist through the UI and type content into Monaco. */
export async function createLocalDraft(
  description: string,
  content: string
): Promise<void> {
  const newBtn = await browser.$('[data-testid="new-gist-btn"]');
  await newBtn.waitForDisplayed({ timeout: 5000 });
  await newBtn.click();

  const descInput = await browser.$('.sidebar__new-gist-desc, input[placeholder]');
  await descInput.waitForDisplayed({ timeout: 5000 });
  await descInput.setValue(description);

  const createBtn = await browser.$('.sidebar__new-gist-create, button[type="submit"]');
  await createBtn.click();

  // Click the Monaco editor container — .inputarea is opacity:0 under WebKitGTK
  const monacoEditor = await browser.$('.monaco-editor');
  await monacoEditor.waitForExist({ timeout: 8000 });
  await monacoEditor.click();
  await browser.keys(['Control', 'a']);
  await browser.keys('Backspace');
  await browser.keys(content.split(''));
}

/** Count DOM elements matching a selector without using ChainablePromiseArray.length. */
export async function countElements(selector: string): Promise<number> {
  return browser.execute(
    (sel: string) => document.querySelectorAll(sel).length,
    selector
  );
}
