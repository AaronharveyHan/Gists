/**
 * Settings modal — open, toggle options, close.
 */
import { skipOnboardingIfShown } from "./helpers/app";

describe("Settings Modal", () => {
  before(async () => {
    await skipOnboardingIfShown();
  });

  it("settings button is visible in the toolbar", async () => {
    const btn = await browser.$('[data-testid="settings-btn"]');
    await btn.waitForDisplayed({ timeout: 8000 });
    expect(await btn.isDisplayed()).toBe(true);
  });

  it("clicking settings button opens the modal", async () => {
    const btn = await browser.$('[data-testid="settings-btn"]');
    await btn.click();

    const modal = await browser.$('[data-testid="settings-modal"]');
    await modal.waitForDisplayed({ timeout: 5000 });
    expect(await modal.isDisplayed()).toBe(true);
  });

  it("modal contains the theme toggle section", async () => {
    const modal = await browser.$('[data-testid="settings-modal"]');
    const themeSection = await modal.$('.settings-modal__theme, select, input[type="radio"]');
    expect(await themeSection.isExisting()).toBe(true);
  });

  it("modal contains the AI Tab Completion checkbox", async () => {
    const modal = await browser.$('[data-testid="settings-modal"]');
    // The tab completion checkbox is in the editor section
    const checkbox = await modal.$('input[type="checkbox"]');
    expect(await checkbox.isExisting()).toBe(true);
  });

  it("modal closes when the overlay is clicked", async () => {
    const overlay = await browser.$('.modal-overlay');
    // Click the overlay outside the modal card
    await overlay.click({ x: 5, y: 5 });

    const modal = await browser.$('[data-testid="settings-modal"]');
    await browser.waitUntil(
      async () => !(await modal.isExisting()),
      { timeout: 3000, interval: 200 }
    );
    expect(await modal.isExisting()).toBe(false);
  });

  it("modal re-opens and can be closed with Escape", async () => {
    const btn = await browser.$('[data-testid="settings-btn"]');
    await btn.click();

    const modal = await browser.$('[data-testid="settings-modal"]');
    await modal.waitForDisplayed({ timeout: 5000 });

    await browser.keys(['Escape']);

    await browser.waitUntil(
      async () => !(await modal.isExisting()),
      { timeout: 3000, interval: 200 }
    );
    expect(await modal.isExisting()).toBe(false);
  });
});
