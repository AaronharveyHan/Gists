import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { EditorFileTabs } from "./EditorFileTabs";
import { useI18nStore } from "../store/useI18nStore";
import type { GistFile } from "../api/tauri";

// Pattern #2 — a pure interactive component that owns its own drag / rename /
// context-menu UI state but delegates every mutation to callback props. We pin
// the language for stable strings and drive interactions directly.

function file(filename: string): GistFile {
  return { filename, language: null, content: "", size: 0, raw_url: null };
}

function setup(over: Partial<React.ComponentProps<typeof EditorFileTabs>> = {}) {
  const props = {
    files: [file("a.ts"), file("b.ts")],
    activeFile: "a.ts",
    isDirty: false,
    onActivate: vi.fn(),
    onAdd: vi.fn(() => "untitled"),
    onDelete: vi.fn(),
    onCommitRename: vi.fn(() => true),
    onReorder: vi.fn(),
    onCloseOthers: vi.fn(),
    onCloseToRight: vi.fn(),
    ...over,
  };
  render(<EditorFileTabs {...props} />);
  return props;
}

describe("EditorFileTabs", () => {
  beforeEach(() => {
    useI18nStore.setState({ lang: "en" });
  });
  afterEach(() => cleanup());

  it("renders one tab per file plus the add button", () => {
    setup();
    expect(screen.getByText("a.ts")).toBeTruthy();
    expect(screen.getByText("b.ts")).toBeTruthy();
    expect(screen.getByTitle("New file")).toBeTruthy();
  });

  it("marks the active tab and shows the dirty dot only there", () => {
    setup({ activeFile: "b.ts", isDirty: true });
    expect(screen.getByText("b.ts").closest(".editor__tab")?.className).toContain("editor__tab--active");
    // The dirty dot lives in the active tab.
    const activeTab = screen.getByText("b.ts").closest(".editor__tab")!;
    expect(activeTab.querySelector(".editor__tab-dot")).toBeTruthy();
    expect(screen.getByText("a.ts").closest(".editor__tab")!.querySelector(".editor__tab-dot")).toBeNull();
  });

  it("clicking a tab activates it", () => {
    const props = setup();
    fireEvent.click(screen.getByText("b.ts"));
    expect(props.onActivate).toHaveBeenCalledWith("b.ts");
  });

  it("clicking a tab's × deletes it", () => {
    const props = setup();
    const close = screen.getByText("a.ts").closest(".editor__tab")!.querySelector(".editor__tab-close")!;
    fireEvent.click(close);
    expect(props.onDelete).toHaveBeenCalledWith("a.ts");
  });

  it("hides the per-tab close button when only one file remains", () => {
    setup({ files: [file("only.ts")], activeFile: "only.ts" });
    expect(screen.getByText("only.ts").closest(".editor__tab")!.querySelector(".editor__tab-close")).toBeNull();
  });

  it("middle-click closes a tab", () => {
    const props = setup();
    fireEvent.mouseDown(screen.getByText("a.ts"), { button: 1 });
    expect(props.onDelete).toHaveBeenCalledWith("a.ts");
  });

  it("clicking + adds a file and immediately opens its rename input", () => {
    // onAdd returns a name that the parent would render into files; we simulate
    // that by returning an existing filename so the input attaches to it.
    const props = setup({ onAdd: vi.fn(() => "a.ts") });
    act(() => { fireEvent.click(screen.getByTitle("New file")); });
    expect(props.onAdd).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue("a.ts")).toBeTruthy();
  });

  it("double-click enters rename mode; Enter commits the trimmed value", () => {
    const onCommitRename = vi.fn(() => true);
    setup({ onCommitRename });

    fireEvent.doubleClick(screen.getByText("a.ts"));
    const input = screen.getByDisplayValue("a.ts") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "renamed.ts" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCommitRename).toHaveBeenCalledWith("a.ts", "renamed.ts");
  });

  it("a rejected rename keeps the input open", () => {
    // onCommitRename returns false (e.g. duplicate name) → input stays.
    setup({ onCommitRename: vi.fn(() => false) });

    fireEvent.doubleClick(screen.getByText("a.ts"));
    const input = screen.getByDisplayValue("a.ts") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "b.ts" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByDisplayValue("b.ts")).toBeTruthy();
  });

  it("Escape cancels a rename without committing", () => {
    const onCommitRename = vi.fn(() => true);
    setup({ onCommitRename });

    fireEvent.doubleClick(screen.getByText("a.ts"));
    const input = screen.getByDisplayValue("a.ts") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "nope.ts" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onCommitRename).not.toHaveBeenCalled();
    expect(screen.getByText("a.ts")).toBeTruthy();
  });

  it("right-click opens a context menu whose actions fire the matching callbacks", () => {
    const props = setup();

    fireEvent.contextMenu(screen.getByText("a.ts"));

    fireEvent.click(screen.getByText("Close Others"));
    expect(props.onCloseOthers).toHaveBeenCalledWith("a.ts");
  });

  it("context menu 'Close to the Right' is disabled on the last tab", () => {
    const props = setup({ activeFile: "b.ts" });

    fireEvent.contextMenu(screen.getByText("b.ts"));
    const item = screen.getByText("Close to the Right").closest("button") as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    fireEvent.click(item);
    expect(props.onCloseToRight).not.toHaveBeenCalled();
  });
});
