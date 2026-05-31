/**
 * Shared helpers for Gists Client E2E tests.
 */

/** Call a Tauri backend command and return the result. */
export async function invoke<T = unknown>(
  command: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  // browser.tauri.execute() uses DirectEvalClient which runs in an isolated JS
  // context where window.__TAURI_INTERNALS__ is not visible. Use the standard
  // WebDriver executeAsyncScript (browser.executeAsync) which runs in the page's
  // main world — the same context that localStorage access works in.
  type Envelope = { ok: T } | { err: string };
  const raw = await (browser.executeAsync(function (
    cmd: string,
    a: Record<string, unknown>,
    done: (r: Envelope) => void
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__TAURI_INTERNALS__.core
      .invoke(cmd, a)
      .then((v: T) => done({ ok: v }))
      .catch((e: unknown) => done({ err: String(e) }));
  },
  command,
  args) as unknown as Envelope);
  if ("err" in raw) throw new Error(raw.err);
  return raw.ok;
}

/**
 * If the onboarding screen is visible, skip it by entering local mode.
 * Call this at the start of any test that requires the main UI.
 */
export async function skipOnboardingIfShown(): Promise<void> {
  const waitForKnownState = (ms: number) =>
    browser.waitUntil(
      async () => {
        const hasOnboarding = await browser.$('[data-testid="onboarding"]').isExisting();
        const hasGistList = await browser.$('[data-testid="gist-list"]').isExisting();
        return hasOnboarding || hasGistList;
      },
      { timeout: ms, interval: 500 }
    );

  // First attempt. If the app is in a stale/broken state after previous specs
  // (blank screen, React error boundary, etc.) this will timeout.
  let reached = false;
  try {
    await waitForKnownState(15000);
    reached = true;
  } catch {
    // Fall through to refresh
  }

  if (!reached) {
    // Force a clean page load and try again. localStorage is preserved so the
    // app will skip onboarding if a previous spec already navigated to local mode.
    await browser.refresh();
    await waitForKnownState(20000);
  }

  const onboarding = await browser.$('[data-testid="onboarding"]');
  const isShown = await onboarding.isExisting();
  if (!isShown) return;

  const skipBtn = await browser.$('.ob__ghost-link');
  await skipBtn.waitForDisplayed({ timeout: 5000 });
  await skipBtn.click();

  await browser.$('[data-testid="gist-list"]').waitForDisplayed({ timeout: 10000 });
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
