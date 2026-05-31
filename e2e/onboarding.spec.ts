/**
 * Onboarding flow — first-run experience.
 *
 * The app is launched with a fresh temp data dir (no settings, no token),
 * so it always starts on the onboarding screen.
 */
import { countElements } from "./helpers/app";

describe("Onboarding", () => {
  before(async () => {
    // All spec files share the same temp dir (and thus the same localStorage).
    // If any earlier spec navigated to local mode, 'localMode:true' is persisted
    // and the app skips onboarding on the next launch.
    // Clear the auth key and reload so this suite always starts at the onboarding screen.
    await browser.execute(() => {
      localStorage.removeItem("gists-client-auth");
    });
    await browser.refresh();
    // Wait for the onboarding screen to appear after the reload
    await browser.$('[data-testid="onboarding"]').waitForDisplayed({ timeout: 12000 });
  });

  it("displays the onboarding screen on first launch", async () => {
    const onboarding = await browser.$('[data-testid="onboarding"]');
    await onboarding.waitForDisplayed({ timeout: 10000 });
    expect(await onboarding.isDisplayed()).toBe(true);
  });

  it("shows the GitHub connect button and local-mode skip link", async () => {
    const connectBtn = await browser.$('.ob__cta');
    await connectBtn.waitForDisplayed({ timeout: 5000 });

    const skipLink = await browser.$('.ob__ghost-link');
    await skipLink.waitForDisplayed({ timeout: 5000 });

    expect(await connectBtn.isDisplayed()).toBe(true);
    expect(await skipLink.isDisplayed()).toBe(true);
  });

  it("step dots render the correct count", async () => {
    // Wait for at least one dot to be in the DOM before counting
    await browser.$('.ob__step-dot').waitForExist({ timeout: 5000 });
    // Use document.querySelectorAll to get an accurate count ($$() may return stale state)
    const count = await countElements('.ob__step-dot');
    expect(count).toBe(4);
  });

  it("clicking 'Use locally' skips to the main UI", async () => {
    // Re-query and wait for the element to be interactable (React may have re-rendered)
    const skipLink = await browser.$('.ob__ghost-link');
    await skipLink.waitForDisplayed({ timeout: 5000 });
    await skipLink.click();

    // Onboarding should disappear and the gist list should appear
    const gistList = await browser.$('[data-testid="gist-list"]');
    await gistList.waitForExist({ timeout: 10000 });
    expect(await gistList.isExisting()).toBe(true);

    // Onboarding wrapper should no longer be in the DOM
    const onboarding = await browser.$('[data-testid="onboarding"]');
    expect(await onboarding.isExisting()).toBe(false);
  });
});
