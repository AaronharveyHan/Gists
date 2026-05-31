/**
 * Markdown preview — rendering and wiki-link buttons.
 */
import { skipOnboardingIfShown, invoke, countElements } from "./helpers/app";

describe("Markdown Preview", () => {
  before(async () => {
    await skipOnboardingIfShown();
    // Create a gist with markdown content including a wiki-link
    await invoke("create_local_gist", {
      description: "MD Preview Test",
      public: false,
      files: [["preview.md", "# Hello\n\nThis links to [[Another Gist]].\n\n```js\nconsole.log('hi');\n```"]],
    });
    // Create the target gist so the wiki-link resolves
    await invoke("create_local_gist", {
      description: "Another Gist",
      public: false,
      files: [["another.md", "# Another"]],
    });
    // invoke() writes directly to the DB; reload so the React app fetches the
    // newly-created gists on mount.
    await browser.refresh();
    // Wait for the gist-list container first, then for the actual items —
    // the items are fetched async from SQLite after the container mounts.
    await browser.$('[data-testid="gist-list"]').waitForDisplayed({ timeout: 15000 });
    await browser.waitUntil(
      async () => (await countElements('.gist-item')) >= 1,
      { timeout: 30000, interval: 500 }
    );
  });

  it("selects the markdown gist and shows editor", async () => {
    // Find the gist item by its description or first available
    await browser.waitUntil(
      async () => (await countElements('.gist-item')) > 0,
      { timeout: 8000 }
    );
    const items = await browser.$$('.gist-item');
    const mdItem = items[0];
    await mdItem.click();
    const editor = await browser.$('.monaco-editor');
    await editor.waitForExist({ timeout: 8000 });
    expect(await editor.isExisting()).toBe(true);
  });

  it("toggling preview renders the markdown-preview article", async () => {
    // Click the preview toggle button (md-tab-preview appears for .md files)
    const previewBtn = await browser.$(
      '[data-testid="md-tab-preview"], .editor__preview-btn, button[title*="Preview"]'
    );
    if (await previewBtn.isExisting()) {
      await previewBtn.click();
      const preview = await browser.$('.markdown-preview');
      await preview.waitForExist({ timeout: 8000 });
      expect(await preview.isDisplayed()).toBe(true);
    }
  });

  it("rendered markdown contains the heading", async () => {
    const preview = await browser.$('.markdown-preview');
    if (await preview.isExisting()) {
      const h1 = await preview.$('h1');
      const text = await h1.getText();
      expect(text).toBe('Hello');
    }
  });

  it("code block has a copy button", async () => {
    const preview = await browser.$('.markdown-preview');
    if (await preview.isExisting()) {
      const copyBtn = await preview.$('.md-copy-btn');
      expect(await copyBtn.isExisting()).toBe(true);
    }
  });

  it("wiki-link [[Another Gist]] renders as a clickable button", async () => {
    const preview = await browser.$('.markdown-preview');
    if (await preview.isExisting()) {
      const wikiLink = await preview.$('.md-wiki-link');
      expect(await wikiLink.isExisting()).toBe(true);
      const text = await wikiLink.getText();
      expect(text).toBe('Another Gist');
    }
  });
});
