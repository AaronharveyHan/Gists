/**
 * Shared helpers for Gists Client E2E tests.
 */

/** Call a Tauri backend command and return the result. */
export async function invoke<T = unknown>(
  command: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  // browser.tauri.execute() runs in an isolated JS context where
  // window.__TAURI_INTERNALS__ is not visible.
  // browser.executeAsync (executeAsyncScript) is unreliable with the embedded
  // WebDriver — some WebKitWebDriver builds don't implement it correctly.
  //
  // Instead: fire the Tauri invoke synchronously via browser.execute(), stash the
  // result in a unique window global, then poll with browser.execute() until it
  // resolves.  browser.execute() (executeScript) is confirmed to work because
  // the onboarding spec already uses it (localStorage.removeItem).
  const key = `__e2e_invoke_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  await browser.execute(
    (k: string, cmd: string, a: Record<string, unknown>) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      w[k] = undefined;
      w.__TAURI_INTERNALS__.core
        .invoke(cmd, a)
        .then((v: unknown) => { w[k] = { ok: v }; })
        .catch((e: unknown) => { w[k] = { err: String(e) }; });
    },
    key, command, args
  );

  await browser.waitUntil(
    () => browser.execute((k: string) => (window as any)[k] !== undefined, key),
    { timeout: 15000, interval: 100 }
  );

  type Envelope = { ok: T } | { err: string };
  const result = await browser.execute(
    (k: string) => (window as any)[k],
    key
  ) as Envelope;

  // Clean up the temporary global
  await browser.execute((k: string) => { delete (window as any)[k]; }, key);

  if ("err" in result) throw new Error(result.err);
  return result.ok;
}

/**
 * Ensure the app is in local mode and the gist-list is rendered.
 * Call this at the start of any test that requires the main UI.
 *
 * Approach: write localMode=true directly into localStorage before the page
 * re-initialises. When zustand rehydrates on the next mount, App.tsx takes
 * the localMode fast-path and renders Layout without ever calling getToken().
 * This eliminates the WebKitGTK IPC slow-start flake where getToken() hangs
 * indefinitely and the app never leaves the "Loading…" splash.
 */
export async function skipOnboardingIfShown(): Promise<void> {
  const injectLocalMode = () =>
    browser.execute(() => {
      localStorage.setItem(
        "gists-client-auth",
        JSON.stringify({ state: { localMode: true }, version: 0 })
      );
    });

  await injectLocalMode();

  // Fast-path: gist-list is already in the DOM (e.g. second call within the
  // same spec after the spec's own browser.refresh(), which preserves the
  // localStorage we wrote and lets the app start in local mode directly).
  if (await browser.$('[data-testid="gist-list"]').isExisting()) return;

  // Refresh so zustand rehydrates the localMode write on next React mount.
  // In local mode App.tsx sets checking=false synchronously (no IPC), so
  // Layout → Sidebar → gist-list renders in the very first render pass.
  await browser.refresh();

  // Wait for gist-list. Retry with another refresh on rare blank-page flakes.
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      await browser.waitUntil(
        () => browser.$('[data-testid="gist-list"]').isExisting(),
        { timeout: 20000, interval: 500 }
      );
      return;
    } catch {
      if (attempt < 2) {
        await injectLocalMode();
        await browser.refresh();
      }
    }
  }

  throw new Error(
    "gist-list never appeared after local-mode localStorage injection + 2 refreshes"
  );
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
