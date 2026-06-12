import { describe, it, expect, beforeEach } from "vitest";
import { useAuthStore } from "./useAuthStore";

describe("useAuthStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ localMode: false });
  });

  it("defaults to localMode: false", () => {
    expect(useAuthStore.getState().localMode).toBe(false);
  });

  it("setLocalMode(true) enables local mode", () => {
    useAuthStore.getState().setLocalMode(true);
    expect(useAuthStore.getState().localMode).toBe(true);
  });

  it("setLocalMode(false) disables local mode", () => {
    useAuthStore.getState().setLocalMode(true);
    useAuthStore.getState().setLocalMode(false);
    expect(useAuthStore.getState().localMode).toBe(false);
  });
});
