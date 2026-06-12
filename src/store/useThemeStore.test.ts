import { describe, it, expect, beforeEach } from "vitest";
import {
  useThemeStore,
  PRESETS,
  applyTheme,
  resolveMonacoTheme,
} from "./useThemeStore";

const INITIAL_STATE = {
  presetId: "system",
  accentOverride: null,
  editorFontSize: 14,
  autoSyncMinutes: 0,
  sidebarWidth: 260,
  zenMode: false,
  vimMode: false,
  tabCompletion: true,
  sortOrder: "updated" as const,
};

describe("useThemeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useThemeStore.setState(INITIAL_STATE);
    document.documentElement.removeAttribute("style");
    delete document.documentElement.dataset.themeType;
  });

  it("defaults to the system preset with no accent override", () => {
    expect(useThemeStore.getState().presetId).toBe("system");
    expect(useThemeStore.getState().accentOverride).toBeNull();
  });

  it("setPreset() updates presetId and resets accent override", () => {
    useThemeStore.getState().setAccentOverride("#ff0000");
    useThemeStore.getState().setPreset("github-dark");
    expect(useThemeStore.getState().presetId).toBe("github-dark");
    expect(useThemeStore.getState().accentOverride).toBeNull();
  });

  it("setAccentOverride() stores the color without changing presetId", () => {
    useThemeStore.getState().setPreset("nord");
    useThemeStore.getState().setAccentOverride("#88c0d0");
    expect(useThemeStore.getState().accentOverride).toBe("#88c0d0");
    expect(useThemeStore.getState().presetId).toBe("nord");
  });

  it("setEditorFontSize() persists the size", () => {
    useThemeStore.getState().setEditorFontSize(18);
    expect(useThemeStore.getState().editorFontSize).toBe(18);
  });

  it("setAutoSyncMinutes() persists the interval", () => {
    useThemeStore.getState().setAutoSyncMinutes(15);
    expect(useThemeStore.getState().autoSyncMinutes).toBe(15);
  });

  it("setSidebarWidth() persists the width", () => {
    useThemeStore.getState().setSidebarWidth(320);
    expect(useThemeStore.getState().sidebarWidth).toBe(320);
  });

  it("setZenMode() toggles zen mode", () => {
    useThemeStore.getState().setZenMode(true);
    expect(useThemeStore.getState().zenMode).toBe(true);
    useThemeStore.getState().setZenMode(false);
    expect(useThemeStore.getState().zenMode).toBe(false);
  });

  it("setVimMode() toggles vim mode", () => {
    useThemeStore.getState().setVimMode(true);
    expect(useThemeStore.getState().vimMode).toBe(true);
  });

  it("setTabCompletion() disables tab completion", () => {
    useThemeStore.getState().setTabCompletion(false);
    expect(useThemeStore.getState().tabCompletion).toBe(false);
  });

  it("setSortOrder() accepts all valid orders", () => {
    for (const order of ["updated", "created", "name", "files"] as const) {
      useThemeStore.getState().setSortOrder(order);
      expect(useThemeStore.getState().sortOrder).toBe(order);
    }
  });
});

describe("PRESETS", () => {
  it("system preset has null vars (clear overrides)", () => {
    expect(PRESETS.system.vars).toBeNull();
  });

  it("all non-system presets declare a monacoTheme", () => {
    for (const [id, preset] of Object.entries(PRESETS)) {
      if (id === "system") continue;
      expect(
        preset.vars?.monacoTheme,
        `${id} missing monacoTheme`
      ).toMatch(/^vs(-dark)?$/);
    }
  });

  it("github-light uses the light (vs) Monaco theme", () => {
    expect(PRESETS["github-light"].vars?.monacoTheme).toBe("vs");
  });

  it("all dark presets use vs-dark", () => {
    for (const id of [
      "github-dark",
      "tokyo-night",
      "nord",
      "dracula",
      "one-dark",
      "monokai",
      "solarized-dark",
    ]) {
      expect(PRESETS[id].vars?.monacoTheme, id).toBe("vs-dark");
    }
  });
});

describe("applyTheme()", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("style");
    delete document.documentElement.dataset.themeType;
  });

  it("sets CSS custom properties on <html> for a known dark preset", () => {
    applyTheme("github-dark", null);
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--bg-0")).toBe("#0d1117");
    expect(root.dataset.themeType).toBe("dark");
  });

  it("sets themeType to light for the light preset", () => {
    applyTheme("github-light", null);
    expect(document.documentElement.dataset.themeType).toBe("light");
  });

  it("overrides --accent with the accent override", () => {
    applyTheme("github-dark", "#ff0000");
    expect(
      document.documentElement.style.getPropertyValue("--accent")
    ).toBe("#ff0000");
    expect(
      document.documentElement.style.getPropertyValue("--accent-hover")
    ).toBe("#ff0000");
  });

  it("clears CSS vars when preset is system (null vars)", () => {
    applyTheme("github-dark", null);
    applyTheme("system", null);
    expect(
      document.documentElement.style.getPropertyValue("--bg-0")
    ).toBe("");
    expect(document.documentElement.dataset.themeType).toBeUndefined();
  });
});

describe("resolveMonacoTheme()", () => {
  it("returns vs-dark for dark presets", () => {
    expect(resolveMonacoTheme("github-dark")).toBe("vs-dark");
    expect(resolveMonacoTheme("tokyo-night")).toBe("vs-dark");
    expect(resolveMonacoTheme("nord")).toBe("vs-dark");
  });

  it("returns vs for the github-light preset", () => {
    expect(resolveMonacoTheme("github-light")).toBe("vs");
  });

  it("falls back to matchMedia for the system preset (mocked to non-dark)", () => {
    // setup.ts mocks matchMedia to return { matches: false }
    expect(resolveMonacoTheme("system")).toBe("vs");
  });
});
