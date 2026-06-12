import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useI18nStore, useT, getT } from "./useI18nStore";

describe("useI18nStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useI18nStore.setState({ lang: "zh" });
  });

  it("defaults to zh", () => {
    expect(useI18nStore.getState().lang).toBe("zh");
  });

  it("setLang('en') switches language to English", () => {
    useI18nStore.getState().setLang("en");
    expect(useI18nStore.getState().lang).toBe("en");
  });

  it("setLang('zh') switches back to Chinese", () => {
    useI18nStore.getState().setLang("en");
    useI18nStore.getState().setLang("zh");
    expect(useI18nStore.getState().lang).toBe("zh");
  });
});

describe("getT()", () => {
  beforeEach(() => {
    localStorage.clear();
    useI18nStore.setState({ lang: "en" });
  });

  it("returns English strings when lang is en", () => {
    useI18nStore.getState().setLang("en");
    expect(getT().common.create).toBe("Create");
    expect(getT().common.cancel).toBe("Cancel");
    expect(getT().common.save).toBe("Save");
  });

  it("returns different strings for zh vs en", () => {
    useI18nStore.getState().setLang("en");
    const en = getT().common.create;
    useI18nStore.getState().setLang("zh");
    const zh = getT().common.create;
    expect(zh).not.toBe(en); // zh translation is not the English word
  });

  it("every common key resolves to a non-empty string or a function", () => {
    for (const lang of ["en", "zh"] as const) {
      useI18nStore.getState().setLang(lang);
      const t = getT();
      for (const [key, val] of Object.entries(t.common)) {
        const kind = typeof val;
        expect(["string", "function"], `common.${key} in ${lang}`).toContain(kind);
        if (kind === "string") {
          expect((val as string).length, `common.${key} in ${lang}`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("useT() hook", () => {
  beforeEach(() => {
    localStorage.clear();
    useI18nStore.setState({ lang: "en" });
  });

  it("returns translations matching the current language", () => {
    useI18nStore.getState().setLang("en");
    const { result } = renderHook(() => useT());
    expect(result.current.common.create).toBe("Create");
  });
});
