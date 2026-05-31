/**
 * Sidebar gist list — rendering and basic interactions.
 */
import { skipOnboardingIfShown, invoke } from "./helpers/app";

describe("Gist List", () => {
  before(async () => {
    await skipOnboardingIfShown();
  });

  it("renders the gist list (empty state)", async () => {
    const list = await browser.$('[data-testid="gist-list"]');
    await list.waitForExist({ timeout: 10000 });
    expect(await list.isDisplayed()).toBe(true);
  });

  it("shows the new-gist button in the sidebar header", async () => {
    const newBtn = await browser.$('[data-testid="new-gist-btn"]');
    await newBtn.waitForDisplayed({ timeout: 5000 });
    expect(await newBtn.isDisplayed()).toBe(true);
  });

  it("clicking new-gist button opens the creation form", async () => {
    const newBtn = await browser.$('[data-testid="new-gist-btn"]');
    await newBtn.waitForDisplayed({ timeout: 5000 });
    await newBtn.click();

    // A form / input for naming the new gist should appear
    const formOrInput = await browser.$('.sidebar__new-form, input.sidebar__new-gist-desc, textarea');
    await formOrInput.waitForDisplayed({ timeout: 5000 });
    expect(await formOrInput.isDisplayed()).toBe(true);
  });

  it("new gist appears in the list after creation", async () => {
    // Create a gist via the backend IPC so we have a deterministic state
    await invoke("create_local_gist", {
      description: "E2E-test gist",
      public: false,
      files: [["test.md", "# E2E"]],
    });

    // Reload the list by waiting for a list item to appear
    const item = await browser.$('.gist-item');
    await item.waitForExist({ timeout: 8000 });
    expect(await item.isExisting()).toBe(true);
  });

  it("clicking a gist item selects it", async () => {
    const items = await browser.$$('.gist-item');
    expect(items.length).toBeGreaterThan(0);

    await items[0].click();

    // The clicked item should gain the --selected modifier class
    const selected = await browser.$('.gist-item--selected');
    await selected.waitForExist({ timeout: 5000 });
    expect(await selected.isExisting()).toBe(true);
  });
});
