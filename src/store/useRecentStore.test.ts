import { describe, it, expect, beforeEach } from "vitest";
import { useRecentStore } from "./useRecentStore";

describe("useRecentStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useRecentStore.setState({ ids: [] });
  });

  it("push() prepends an id", () => {
    useRecentStore.getState().push("a");
    useRecentStore.getState().push("b");
    expect(useRecentStore.getState().ids).toEqual(["b", "a"]);
  });

  it("push() deduplicates — moves existing id to front", () => {
    useRecentStore.getState().push("a");
    useRecentStore.getState().push("b");
    useRecentStore.getState().push("a");
    expect(useRecentStore.getState().ids).toEqual(["a", "b"]);
  });

  it("push() caps the list at 15 items", () => {
    for (let i = 0; i < 20; i++) useRecentStore.getState().push(String(i));
    const { ids } = useRecentStore.getState();
    expect(ids).toHaveLength(15);
    expect(ids[0]).toBe("19"); // most recently pushed is at front
  });

  it("remove() deletes an id", () => {
    useRecentStore.getState().push("a");
    useRecentStore.getState().push("b");
    useRecentStore.getState().remove("a");
    expect(useRecentStore.getState().ids).toEqual(["b"]);
  });

  it("remove() is a no-op for an unknown id", () => {
    useRecentStore.getState().push("a");
    useRecentStore.getState().remove("zzz");
    expect(useRecentStore.getState().ids).toEqual(["a"]);
  });

  it("clear() empties the list", () => {
    useRecentStore.getState().push("a");
    useRecentStore.getState().push("b");
    useRecentStore.getState().clear();
    expect(useRecentStore.getState().ids).toEqual([]);
  });
});
