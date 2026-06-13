import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { EditorGistTabs } from "./EditorGistTabs";
import { useGistStore } from "../store/useGistStore";
import type { Gist } from "../api/tauri";

// Pattern #1 — a component whose render is driven entirely by the gist store.
// We seed openTabIds + gists directly and assert against the rendered tabs and
// the store mutations its buttons trigger (selectGist / closeTab).

function makeGist(id: string, description: string, filename = "file.txt"): Gist {
  return {
    id,
    description,
    public: false,
    html_url: `https://gist.github.com/${id}`,
    created_at: "",
    updated_at: "",
    files: [{ filename, language: null, content: "", size: 0, raw_url: null }],
  };
}

describe("EditorGistTabs", () => {
  beforeEach(() => {
    useGistStore.setState({ openTabIds: [], gists: [], selectedId: null });
  });
  afterEach(() => cleanup());

  it("renders nothing when no tabs are open", () => {
    const { container } = render(<EditorGistTabs />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one tab per open id, labelled by description then filename", () => {
    useGistStore.setState({
      openTabIds: ["a", "b"],
      gists: [makeGist("a", "First gist"), makeGist("b", "  ", "lonely.md")],
      selectedId: "a",
    });
    render(<EditorGistTabs />);

    // 'a' has a description; 'b' is whitespace-only so it falls back to filename.
    expect(screen.getByText("First gist")).toBeTruthy();
    expect(screen.getByText("lonely.md")).toBeTruthy();
  });

  it("marks the selected tab as active", () => {
    useGistStore.setState({
      openTabIds: ["a", "b"],
      gists: [makeGist("a", "Alpha"), makeGist("b", "Beta")],
      selectedId: "b",
    });
    render(<EditorGistTabs />);

    expect(screen.getByText("Alpha").closest(".editor__gist-tab")?.className).not.toContain("--active");
    expect(screen.getByText("Beta").closest(".editor__gist-tab")?.className).toContain("editor__gist-tab--active");
  });

  it("clicking a tab selects that gist", () => {
    useGistStore.setState({
      openTabIds: ["a", "b"],
      gists: [makeGist("a", "Alpha"), makeGist("b", "Beta")],
      selectedId: "a",
    });
    render(<EditorGistTabs />);

    act(() => { fireEvent.click(screen.getByText("Beta")); });
    expect(useGistStore.getState().selectedId).toBe("b");
  });

  it("clicking the × closes only that tab without selecting it", () => {
    useGistStore.setState({
      openTabIds: ["a", "b"],
      gists: [makeGist("a", "Alpha"), makeGist("b", "Beta")],
      selectedId: "a",
    });
    render(<EditorGistTabs />);

    const betaClose = screen.getByText("Beta").closest(".editor__gist-tab")!.querySelector(".editor__gist-tab-close")!;
    act(() => { fireEvent.click(betaClose); });

    expect(useGistStore.getState().openTabIds).toEqual(["a"]);
    // Closing a non-selected tab leaves the selection untouched.
    expect(useGistStore.getState().selectedId).toBe("a");
  });
});
