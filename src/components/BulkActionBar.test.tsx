import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { BulkActionBar } from "./BulkActionBar";
import { useGistStore } from "../store/useGistStore";
import { useI18nStore } from "../store/useI18nStore";
import * as tauriApi from "../api/tauri";
import type { Gist, Tag } from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");

function gist(id: string, isPublic = false): Gist {
  return {
    id,
    description: "",
    public: isPublic,
    html_url: "",
    created_at: "",
    updated_at: "",
    files: [{ filename: "f.ts", language: null, type: "", content: "", size: 0 }],
    pending_push: false,
    local_only: false,
    category: "gist",
  };
}

const noTags: Tag[] = [];
const threeGists = [gist("g1"), gist("g2"), gist("g3")];

describe("BulkActionBar", () => {
  beforeEach(() => {
    useI18nStore.setState({ lang: "en" });
    vi.clearAllMocks();
    // Seed gistTags so loadGistTags is not triggered on mount.
    useGistStore.setState({
      gists: threeGists,
      gistTags: { g1: [], g2: [], g3: [] },
    });
    vi.mocked(tauriApi.deleteGist).mockResolvedValue(undefined);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows the count of selected gists", () => {
    render(
      <BulkActionBar
        selectedIds={new Set(["g1", "g2"])}
        allTags={noTags}
        sortedGists={threeGists}
        onClear={vi.fn()}
        onSelectAll={vi.fn()}
      />
    );
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy(); // total
  });

  it("shows 'Select all N' when not all are selected", () => {
    render(
      <BulkActionBar
        selectedIds={new Set(["g1"])}
        allTags={noTags}
        sortedGists={threeGists}
        onClear={vi.fn()}
        onSelectAll={vi.fn()}
      />
    );
    expect(screen.getByText("Select all 3")).toBeTruthy();
  });

  it("does not show 'Select all' when all are already selected", () => {
    render(
      <BulkActionBar
        selectedIds={new Set(["g1", "g2", "g3"])}
        allTags={noTags}
        sortedGists={threeGists}
        onClear={vi.fn()}
        onSelectAll={vi.fn()}
      />
    );
    expect(screen.queryByText(/Select all/)).toBeNull();
  });

  it("clicking 'Select all' calls onSelectAll", () => {
    const onSelectAll = vi.fn();
    render(
      <BulkActionBar
        selectedIds={new Set(["g1"])}
        allTags={noTags}
        sortedGists={threeGists}
        onClear={vi.fn()}
        onSelectAll={onSelectAll}
      />
    );
    fireEvent.click(screen.getByText("Select all 3"));
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });

  it("clicking 'Clear' calls onClear", () => {
    const onClear = vi.fn();
    render(
      <BulkActionBar
        selectedIds={new Set(["g1"])}
        allTags={noTags}
        sortedGists={threeGists}
        onClear={onClear}
        onSelectAll={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Clear"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("action buttons are hidden when no items are selected", () => {
    render(
      <BulkActionBar
        selectedIds={new Set()}
        allTags={noTags}
        sortedGists={threeGists}
        onClear={vi.fn()}
        onSelectAll={vi.fn()}
      />
    );
    expect(screen.queryByText(/Delete/)).toBeNull();
    expect(screen.queryByText("Export")).toBeNull();
  });

  it("delete button label reflects the count", () => {
    render(
      <BulkActionBar
        selectedIds={new Set(["g1", "g2"])}
        allTags={noTags}
        sortedGists={threeGists}
        onClear={vi.fn()}
        onSelectAll={vi.fn()}
      />
    );
    expect(screen.getByText("Delete 2")).toBeTruthy();
  });

  it("delete button triggers confirm dialog", () => {
    render(
      <BulkActionBar
        selectedIds={new Set(["g1"])}
        allTags={noTags}
        sortedGists={threeGists}
        onClear={vi.fn()}
        onSelectAll={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Delete 1"));
    expect(vi.mocked(window.confirm)).toHaveBeenCalledTimes(1);
  });

  it("does not call deleteGist when confirm is cancelled", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    render(
      <BulkActionBar
        selectedIds={new Set(["g1"])}
        allTags={noTags}
        sortedGists={threeGists}
        onClear={vi.fn()}
        onSelectAll={vi.fn()}
      />
    );
    await act(async () => { fireEvent.click(screen.getByText("Delete 1")); });
    expect(vi.mocked(tauriApi.deleteGist)).not.toHaveBeenCalled();
  });

  it("calls deleteGist for each selected ID when confirmed", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    render(
      <BulkActionBar
        selectedIds={new Set(["g1", "g2"])}
        allTags={noTags}
        sortedGists={threeGists}
        onClear={vi.fn()}
        onSelectAll={vi.fn()}
      />
    );
    await act(async () => { fireEvent.click(screen.getByText("Delete 2")); });
    expect(vi.mocked(tauriApi.deleteGist)).toHaveBeenCalledWith("g1");
    expect(vi.mocked(tauriApi.deleteGist)).toHaveBeenCalledWith("g2");
    expect(vi.mocked(tauriApi.deleteGist)).toHaveBeenCalledTimes(2);
  });
});
