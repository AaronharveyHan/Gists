import { describe, it, expect, beforeEach } from "vitest";
import { useEditorUIStore } from "./useEditorUIStore";

const INITIAL = {
  cursorLine: 1,
  cursorColumn: 1,
  selectedChars: 0,
  selectedLines: 0,
  activeFilename: null,
};

describe("useEditorUIStore", () => {
  beforeEach(() => {
    useEditorUIStore.setState(INITIAL);
  });

  it("starts with cursor at line 1, column 1", () => {
    const { cursorLine, cursorColumn } = useEditorUIStore.getState();
    expect(cursorLine).toBe(1);
    expect(cursorColumn).toBe(1);
  });

  it("starts with zero selection", () => {
    const { selectedChars, selectedLines } = useEditorUIStore.getState();
    expect(selectedChars).toBe(0);
    expect(selectedLines).toBe(0);
  });

  it("starts with no active filename", () => {
    expect(useEditorUIStore.getState().activeFilename).toBeNull();
  });

  it("setCursor() updates line and column", () => {
    useEditorUIStore.getState().setCursor(42, 10);
    expect(useEditorUIStore.getState().cursorLine).toBe(42);
    expect(useEditorUIStore.getState().cursorColumn).toBe(10);
  });

  it("setSelection() updates chars and lines", () => {
    useEditorUIStore.getState().setSelection(150, 5);
    expect(useEditorUIStore.getState().selectedChars).toBe(150);
    expect(useEditorUIStore.getState().selectedLines).toBe(5);
  });

  it("setActiveFilename() stores the filename", () => {
    useEditorUIStore.getState().setActiveFilename("main.py");
    expect(useEditorUIStore.getState().activeFilename).toBe("main.py");
  });

  it("setActiveFilename(null) clears the filename", () => {
    useEditorUIStore.getState().setActiveFilename("main.py");
    useEditorUIStore.getState().setActiveFilename(null);
    expect(useEditorUIStore.getState().activeFilename).toBeNull();
  });

  it("cursor updates do not affect selection state", () => {
    useEditorUIStore.getState().setSelection(50, 2);
    useEditorUIStore.getState().setCursor(5, 3);
    expect(useEditorUIStore.getState().selectedChars).toBe(50);
    expect(useEditorUIStore.getState().selectedLines).toBe(2);
  });
});
