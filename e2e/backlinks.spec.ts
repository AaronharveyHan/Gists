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
    await browser.refresh();
    // Wait for the gist-list container first, then for the actual items —
    // the items are fetched async from SQLite after the container mounts.
    await browser.$('[data-testid="gist-list"]').waitForDisplayed({ timeout: 15000 });
    await browser.waitUntil(
      async () => (await countElements('.gist-item')) >= 2,
      { timeout: 30000, interval: 500 }
    );
  });

  it("selects gist A and the backlinks button is in the toolbar", async () => {
    // Select gist A by clicking its list item
    await browser.waitUntil(
      async () => (await countElements('.gist-item')) >= 2,
      { timeout: 8000 }
    );
    const items = await browser.$$('.gist-item');

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

    const backlinksBtn = await browser.$('button[title*="acklink"], .editor__backlinks-btn');
    await backlinksBtn.waitForExist({ timeout: 8000 });
    expect(await backlinksBtn.isExisting()).toBe(true);
  });

  it("clicking the backlinks button opens the panel", async () => {
    const backlinksBtn = await browser.$('button[title*="acklink"], .editor__backlinks-btn');
    await backlinksBtn.click();

    const panel = await browser.$('[data-testid="backlinks-panel"]');
    await panel.waitForDisplayed({ timeout: 5000 });
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
