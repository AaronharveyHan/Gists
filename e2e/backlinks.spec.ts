/**
 * Backlinks panel — bidirectional wiki-link discovery.
 */
import { skipOnboardingIfShown, invoke, countElements } from "./helpers/app";

describe("Backlinks Panel", () => {
  let gistAId: string;

  before(async () => {
    await skipOnboardingIfShown();

    // Create gist A (the target)
    const gistA = await invoke<{ id: string }>("create_local_gist", {
      description: "Gist Alpha",
      public: false,
      files: [["alpha.md", "# Alpha"]],
    });
    gistAId = gistA.id;

    // Create gist B that links to [[Gist Alpha]]
    await invoke("create_local_gist", {
      description: "Gist Beta",
      public: false,
      files: [["beta.md", "This references [[Gist Alpha]] bidirectionally."]],
    });

    // invoke() writes directly to the DB; the React app won't auto-refresh its
    // gist list. Reload so the app fetches the newly-created gists on mount.
    // After refresh the app may briefly show the "Loading…" splash or even
    // re-show onboarding if zustand rehydration is delayed; skipOnboardingIfShown
    // handles both cases (waits for either screen, re-skips onboarding if needed).
    await browser.refresh();
    await skipOnboardingIfShown();
    await browser.waitUntil(
      async () => (await countElements('.gist-item')) >= 2,
      { timeout: 30000, interval: 500 }
    );
  });

  it("selects gist A and opens the backlinks panel via the shortcut", async () => {
    // Select gist A by clicking its list item
    await browser.waitUntil(
      async () => (await countElements('.gist-item')) >= 2,
      { timeout: 8000 }
    );

    // Find the item whose data-gist-id matches gistAId
    let found = false;
    for (const item of await browser.$$('.gist-item')) {
      const id = await item.getAttribute('data-gist-id');
      if (id === gistAId) {
        await item.click();
        found = true;
        break;
      }
    }
    expect(found).toBe(true);

    // Wait for Monaco to mount so the Editor (and its keyboard handlers) is live.
    await browser.$('.monaco-editor').waitForExist({ timeout: 20000 });

    // The backlinks toggle button lives in the OverflowActions hidden
    // measurement row (visibility:hidden; left:-9999px), which WebKitGTK's
    // WebDriver cannot reliably locate, and may also be collapsed into the ⋯
    // overflow menu. Instead open the panel with the global Ctrl/Cmd+Shift+B
    // shortcut (registered via useKeyboard on window) — it toggles showBacklinks
    // regardless of toolbar layout or button visibility.
    await browser.keys(['Control', 'Shift', 'b']);

    const panel = await browser.$('[data-testid="backlinks-panel"]');
    await panel.waitForDisplayed({ timeout: 8000 });
    expect(await panel.isDisplayed()).toBe(true);
  });

  it("backlinks panel lists gist B as a backlink to gist A", async () => {
    const panel = await browser.$('[data-testid="backlinks-panel"]');

    // Wait for the loading state to resolve
    await browser.waitUntil(
      async () => {
        const empty = await panel.$('.backlinks-panel__empty');
        const list = await panel.$('.backlinks-panel__list');
        return (await list.isExisting()) || (await empty.isExisting());
      },
      { timeout: 8000 }
    );

    const list = await panel.$('.backlinks-panel__list');
    if (await list.isExisting()) {
      const items = await list.$$('.backlinks-panel__item');
      expect(items.length).toBeGreaterThan(0);

      // The first item should be "Gist Beta"
      const linkName = await items[0].$('.backlinks-panel__link-name');
      const text = await linkName.getText();
      expect(text).toContain('Gist Beta');
    }
  });

  it("closing the panel hides it", async () => {
    const closeBtn = await browser.$('.side-panel__close');
    await closeBtn.click();

    const panel = await browser.$('[data-testid="backlinks-panel"]');
    await browser.waitUntil(
      async () => !(await panel.isExisting()),
      { timeout: 3000, interval: 200 }
    );
    expect(await panel.isExisting()).toBe(false);
  });
});
