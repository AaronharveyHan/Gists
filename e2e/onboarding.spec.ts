/**
 * Onboarding flow — first-run experience.
 *
 * The app is launched with a fresh temp data dir (no settings, no token),
 * so it always starts on the onboarding screen.
 */

describe("Onboarding", () => {
  it("displays the onboarding screen on first launch", async () => {
    const onboarding = await browser.$('[data-testid="onboarding"]');
    await onboarding.waitForDisplayed({ timeout: 10000 });
    expect(await onboarding.isDisplayed()).toBe(true);
  });

  it("shows the GitHub connect button and local-mode skip link", async () => {
    const connectBtn = await browser.$('.ob__cta');
    const skipLink = await browser.$('.ob__ghost-link');

    expect(await connectBtn.isDisplayed()).toBe(true);
    expect(await skipLink.isDisplayed()).toBe(true);
  });

  it("step dots render the correct count", async () => {
    const dots = await browser.$$('.ob__step-dot');
    // Four steps in the onboarding flow
    expect(dots.length).toBe(4);
  });

  it("clicking 'Use locally' skips to the main UI", async () => {
    const skipLink = await browser.$('.ob__ghost-link');
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
