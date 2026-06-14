import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useRef } from "react";
import { SidebarSearchBar } from "./SidebarSearchBar";
import { useI18nStore } from "../store/useI18nStore";

function Harness(props: Partial<React.ComponentProps<typeof SidebarSearchBar>>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const base: React.ComponentProps<typeof SidebarSearchBar> = {
    searchMode: "keyword",
    onToggleSearchMode: vi.fn(),
    searchQuery: "",
    onSearchChange: vi.fn(),
    onSearchKeyDown: vi.fn(),
    semanticBusy: false,
    syncStatus: "idle",
    onSync: vi.fn(),
    onNewGist: vi.fn(),
    inputRef: inputRef as React.RefObject<HTMLInputElement>,
    ...props,
  };
  return <SidebarSearchBar {...base} />;
}

function renderBar(props: Partial<React.ComponentProps<typeof SidebarSearchBar>> = {}) {
  return render(<Harness {...props} />);
}

describe("SidebarSearchBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
  });
  afterEach(() => cleanup());

  it("renders the keyword placeholder in keyword mode", () => {
    renderBar({ searchMode: "keyword" });
    expect((screen.getByRole("textbox") as HTMLInputElement).placeholder).toContain("Search");
  });

  it("renders the semantic placeholder in semantic mode", () => {
    renderBar({ searchMode: "semantic" });
    expect(screen.getByPlaceholderText("Semantic search…")).toBeTruthy();
  });

  it("typing fires onSearchChange", () => {
    const onSearchChange = vi.fn();
    renderBar({ onSearchChange });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "abc" } });
    expect(onSearchChange).toHaveBeenCalledWith("abc");
  });

  it("forwards key events via onSearchKeyDown", () => {
    const onSearchKeyDown = vi.fn();
    renderBar({ onSearchKeyDown });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSearchKeyDown).toHaveBeenCalled();
  });

  it("the clear button appears with a query and clears it", () => {
    const onSearchChange = vi.fn();
    renderBar({ searchQuery: "hello", onSearchChange });
    const clear = screen.getByText("✕");
    fireEvent.click(clear);
    expect(onSearchChange).toHaveBeenCalledWith("");
  });

  it("hides the clear button when the query is empty", () => {
    renderBar({ searchQuery: "" });
    expect(screen.queryByText("✕")).toBeNull();
  });

  it("the mode toggle fires onToggleSearchMode", () => {
    const onToggleSearchMode = vi.fn();
    renderBar({ searchMode: "keyword", onToggleSearchMode });
    fireEvent.click(screen.getByTitle("Switch to semantic search (AI)"));
    expect(onToggleSearchMode).toHaveBeenCalled();
  });

  it("shows the spinner while semantic search is busy", () => {
    renderBar({ searchMode: "semantic", semanticBusy: true, searchQuery: "q" });
    expect(screen.getByTitle("Searching…")).toBeTruthy();
  });

  it("the refresh button triggers onSync and is disabled while syncing", () => {
    const onSync = vi.fn();
    const { rerender } = renderBar({ onSync, syncStatus: "idle" });
    fireEvent.click(screen.getByText("↻"));
    expect(onSync).toHaveBeenCalled();
    rerender(<Harness onSync={onSync} syncStatus="syncing" />);
    expect((screen.getByText("↻") as HTMLButtonElement).disabled).toBe(true);
  });

  it("the new-gist button fires onNewGist", () => {
    const onNewGist = vi.fn();
    renderBar({ onNewGist });
    fireEvent.click(screen.getByTestId("new-gist-btn"));
    expect(onNewGist).toHaveBeenCalled();
  });
});
