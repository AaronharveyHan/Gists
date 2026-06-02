/**
 * Markdown preview — rendering and wiki-link buttons.
 */
import { skipOnboardingIfShown, invoke, countElements } from "./helpers/app";

describe("Markdown Preview", () => {
  let previewGistId: string;

  before(async () => {
    await skipOnboardingIfShown();
    // Create a gist with markdown content including a wiki-link
    const previewGist = await invoke<{ id: string }>("create_local_gist", {
      description: "MD Preview Test",
      public: false,
      files: [["preview.md", "# Hello\n\nThis links to [[Another Gist]].\n\n```js\nconsole.log('hi');\n```"]],
    });
    previewGistId = previewGist.id;
    // Create the target gist so the wiki-link resolves
    await invoke("create_local_gist", {
      description: "Another Gist",
      public: false,
      files: [["another.md", "# Another"]],
    });
    // invoke() writes directly to the DB; reload so the React app fetches the
    // newly-created gists on mount.
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

  it("selects the markdown gist and shows editor", async () => {
    // Find the MD Preview Test gist by its ID so we always get the right one
    // regardless of sort order (default is newest-updated-first).
    let found = false;
    for (const item of await browser.$$('.gist-item')) {
      const id = await item.getAttribute('data-gist-id');
      if (id === previewGistId) {
        await item.click();
        found = true;
        break;
      }
    }
    expect(found).toBe(true);

    // Monaco initialises asynchronously; give it extra time in CI environments
    // where CPU contention can slow the editor bundle's startup.
    const editor = await browser.$('.monaco-editor');
    await editor.waitForExist({ timeout: 15000 });
    expect(await editor.isExisting()).toBe(true);
  });

  it("toggling preview renders the markdown-preview article", async () => {
    // md-tab-preview is rendered only when isMdActive=true (a .md file is active).
    // Wait for the tab to appear; the editor component renders tabs before Monaco.
    const previewBtn = await browser.$('[data-testid="md-tab-preview"]');
    await previewBtn.waitForDisplayed({ timeout: 8000 });
    await previewBtn.click();
    // After switching to preview mode the preview pane becomes visible.
    const preview = await browser.$('.markdown-preview');
    await preview.waitForExist({ timeout: 8000 });
    await browser.waitUntil(
      () => preview.isDisplayed(),
      { timeout: 10000, interval: 200, timeoutMsg: '.markdown-preview did not become visible after preview tab click' }
    );
    expect(await preview.isDisplayed()).toBe(true);
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
