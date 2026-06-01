/**
 * Shared helpers for Gists Client E2E tests.
 */

// Track which WDIO sessions have already had their window switched so we only
// pay the 5 s IPC-timeout cost of browser.switchWindow() once per spec.
const _switchedSessions = new Set<string>();

/**
 * Switch to the main Tauri window (label "main") and bypass the
 * @wdio/tauri-service beforeCommand overhead for the rest of the spec.
 *
 * The embedded WebDriver non-deterministically connects to whichever Tauri
 * window registers first — sometimes the secondary "quick-search" window
 * instead of "main".  Using browser.tauri.switchWindow() (the tauri-service
 * custom command at browser.tauri, NOT WDIO's built-in browser.switchWindow)
 * both corrects the active window AND adds the session to
 * userSwitchedWindowCache inside the service, which causes
 * ensureActiveWindowFocus() to short-circuit for every subsequent DOM command,
 * eliminating the per-command 5 s getWindowStates() IPC timeout.
 *
 * switchWindowByLabel() calls listWindowLabels() first, which itself has a 5 s
 * IPC timeout.  We therefore only call browser.tauri.switchWindow("main") ONCE
 * per session; subsequent calls are skipped because userSwitchedWindowCache
 * already has the session and the bypass is in effect for the remaining
 * lifetime of the session.
 */
export async function switchToMainWindow(): Promise<void> {
  const sid = browser.sessionId ?? "default";
  if (_switchedSessions.has(sid)) return;   // already bypassed for this session
  _switchedSessions.add(sid);

  // IMPORTANT: use browser.tauri.switchWindow (tauri-service API), NOT
  // browser.switchWindow (WDIO built-in that searches by title/URL and never
  // touches userSwitchedWindowCache).
  await (browser as any).tauri.switchWindow("main");
}

/** Call a Tauri backend command and return the result.
 *
 * Uses a localStorage-based bridge that runs in the app's main JS world (where
 * __TAURI_INTERNALS__ is accessible).  WebDriver's browser.execute() runs in an
 * isolated world that shares DOM Web APIs but cannot access custom window globals
 * set by page scripts — including __TAURI_INTERNALS__ and browser.tauri.execute().
 *
 * The bridge is registered in src/main.tsx when localStorage.__e2e__ === '1'.
 * skipOnboardingIfShown() sets that flag before the first page refresh, so the
 * bridge is active by the time any test calls invoke().
 */
export async function invoke<T = unknown>(
  command: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const reqKey = `__e2e_req_${id}`;
  const resKey = `__e2e_res_${id}`;

  await browser.execute(
    (rk: string, cmd: string, a: Record<string, unknown>) => {
      localStorage.setItem(rk, JSON.stringify({ cmd, args: a }));
    },
    reqKey, command, args
  );

  await browser.waitUntil(
    () => browser.execute(
      (resK: string) => localStorage.getItem(resK) !== null,
      resKey
    ),
    { timeout: 15000, interval: 100, timeoutMsg: `invoke(${command}) timed out after 15s` }
  );

  type Envelope = { ok: T } | { err: string };
  const result = await browser.execute((resK: string) => {
    const raw = localStorage.getItem(resK)!;
    localStorage.removeItem(resK);
    return JSON.parse(raw);
  }, resKey) as Envelope;

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
  // Ensure we're on the main window, not the secondary quick-search window.
  await switchToMainWindow();

  const injectLocalMode = () =>
    browser.execute(() => {
      localStorage.setItem(
        "gists-client-auth",
        JSON.stringify({ state: { localMode: true }, version: 0 })
      );
      // Activate the E2E bridge in src/main.tsx so invoke() can call Tauri IPC
      // from the main world after the next page refresh.
      localStorage.setItem("__e2e__", "1");
    });

  await injectLocalMode();

  // Use browser.execute() for DOM presence checks — unlike browser.$() these
  // do NOT trigger ensureActiveWindowFocus in beforeCommand, so they never pay
  // the 5 s getWindowStates() IPC-timeout penalty regardless of cache state.
  const hasGistList = () =>
    browser.execute(() => !!document.querySelector('[data-testid="gist-list"]'));

  // Fast-path: gist-list is already in the DOM (e.g. second call within the
  // same spec after the spec's own browser.refresh(), which preserves the
  // localStorage we wrote and lets the app start in local mode directly).
  if (await hasGistList()) return;

  // Refresh so zustand rehydrates the localMode write on next React mount.
  // In local mode App.tsx sets checking=false synchronously (no IPC), so
  // Layout → Sidebar → gist-list renders in the very first render pass.
  await browser.refresh();

  // Wait for gist-list. Retry with another refresh on rare blank-page flakes.
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      await browser.waitUntil(hasGistList, { timeout: 20000, interval: 500 });
      return;
    } catch {
      if (attempt < 2) {
        await injectLocalMode();
        await browser.refresh();
      }
    }
  }

  // Still no gist-list: dump what the webview actually contains so the CI log
  // tells us whether React mounted, what URL we're on, and what's rendered.
  const diag = await browser.execute(() => {
    const root = document.getElementById("root");
    const w = window as any;
    return {
      url: location.href,
      readyState: document.readyState,
      rootChildCount: root ? root.childElementCount : -1,
      bodyText: (document.body?.innerText || "").slice(0, 300),
      hasTauriInternals: typeof w.__TAURI_INTERNALS__ !== "undefined",
      hasSplash: !!document.querySelector(".splash"),
      hasOnboarding: !!document.querySelector('[data-testid="onboarding"]'),
      hasErrorBoundary: !!document.querySelector(".app-error, .error-boundary"),
      authLS: localStorage.getItem("gists-client-auth"),
    };
  });

  throw new Error(
    "gist-list never appeared after local-mode localStorage injection + 2 refreshes.\n" +
      "Webview diagnostics: " +
      JSON.stringify(diag, null, 2)
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
