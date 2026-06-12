import { describe, it, expect, beforeEach, vi } from "vitest";
import * as api from "../api/tauri";
import { useGistStore } from "./useGistStore";
import { useRecentStore } from "./useRecentStore";
import { useNotificationStore } from "./useNotificationStore";
import {
  makeGist,
  makeTag,
  makeCollection,
  makeCollectionCount,
  makeSyncResult,
} from "../test/fixtures";

vi.mock("../api/tauri");
const mocked = vi.mocked(api);

// Pristine data slice (actions live on the store object and survive setState).
const INITIAL = {
  gists: [],
  selectedId: null,
  searchQuery: "",
  syncStatus: "idle" as const,
  syncError: null,
  lastSyncResult: null,
  isAuthenticated: false,
  githubLogin: null,
  allTags: [],
  activeTagId: null,
  gistTags: {},
  activeCategoryId: null,
  categoryCounts: [],
  allCollections: [],
  activeCollectionId: null,
  gistCollections: {},
  openTabIds: [],
  networkOnline: true,
};

/** Default stubs for the list APIs most actions re-fetch. */
function stubListApis() {
  mocked.listGists.mockResolvedValue([]);
  mocked.listTags.mockResolvedValue([]);
  mocked.listCategoryCounts.mockResolvedValue([]);
  mocked.listCollectionCounts.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  stubListApis();
  localStorage.clear();
  useGistStore.setState(INITIAL);
  useRecentStore.setState({ ids: [] });
  useNotificationStore.setState({ items: [] });
});

describe("auth", () => {
  it("setAuthenticated() stores the login", () => {
    useGistStore.getState().setAuthenticated("octocat");
    expect(useGistStore.getState().isAuthenticated).toBe(true);
    expect(useGistStore.getState().githubLogin).toBe("octocat");
  });

  it("logout() clears all user data", () => {
    useGistStore.setState({
      isAuthenticated: true,
      githubLogin: "octocat",
      gists: [makeGist("g1")],
      selectedId: "g1",
      allTags: [makeTag(1, "rust")],
      activeTagId: 1,
      gistTags: { g1: [makeTag(1, "rust")] },
      openTabIds: ["g1"],
    });

    useGistStore.getState().logout();

    const s = useGistStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.githubLogin).toBeNull();
    expect(s.gists).toEqual([]);
    expect(s.selectedId).toBeNull();
    expect(s.allTags).toEqual([]);
    expect(s.gistTags).toEqual({});
    expect(s.openTabIds).toEqual([]);
  });
});

describe("search and selection", () => {
  it("setSearch() with a query uses searchGists and clears all filters", async () => {
    useGistStore.setState({ activeTagId: 3, activeCategoryId: "script", activeCollectionId: "c1" });
    mocked.searchGists.mockResolvedValue([makeGist("hit")]);

    await useGistStore.getState().setSearch("rust");

    expect(mocked.searchGists).toHaveBeenCalledWith("rust");
    const s = useGistStore.getState();
    expect(s.gists.map((g) => g.id)).toEqual(["hit"]);
    expect(s.activeTagId).toBeNull();
    expect(s.activeCategoryId).toBeNull();
    expect(s.activeCollectionId).toBeNull();
  });

  it("setSearch('') falls back to listGists", async () => {
    mocked.listGists.mockResolvedValue([makeGist("all")]);
    await useGistStore.getState().setSearch("");
    expect(mocked.searchGists).not.toHaveBeenCalled();
    expect(useGistStore.getState().gists.map((g) => g.id)).toEqual(["all"]);
  });

  it("selectGist() records the id in the recent store", () => {
    useGistStore.getState().selectGist("g42");
    expect(useGistStore.getState().selectedId).toBe("g42");
    expect(useRecentStore.getState().ids).toContain("g42");
  });

  it("selectGist(null) clears selection without touching recents", () => {
    useGistStore.getState().selectGist(null);
    expect(useGistStore.getState().selectedId).toBeNull();
    expect(useRecentStore.getState().ids).toEqual([]);
  });
});

describe("loadGists", () => {
  it("loads gists, tags, category counts, collections and selects the first gist", async () => {
    mocked.listGists.mockResolvedValue([makeGist("a"), makeGist("b")]);
    mocked.listTags.mockResolvedValue([makeTag(1, "rust")]);
    mocked.listCategoryCounts.mockResolvedValue([{ category: "script", count: 2 }]);
    mocked.listCollectionCounts.mockResolvedValue([makeCollectionCount("c1", 1)]);

    await useGistStore.getState().loadGists();

    const s = useGistStore.getState();
    expect(s.gists).toHaveLength(2);
    expect(s.selectedId).toBe("a");
    expect(s.allTags).toHaveLength(1);
    expect(s.categoryCounts).toHaveLength(1);
    expect(s.allCollections).toHaveLength(1);
  });

  it("selects null when the list is empty", async () => {
    await useGistStore.getState().loadGists();
    expect(useGistStore.getState().selectedId).toBeNull();
  });
});

describe("sync", () => {
  it("happy path: stores the result and refreshes via listGists", async () => {
    mocked.syncGists.mockResolvedValue(makeSyncResult({ updated: 3, total: 10 }));
    mocked.listGists.mockResolvedValue([makeGist("g1")]);

    await useGistStore.getState().sync();

    expect(mocked.syncGists).toHaveBeenCalledWith(false);
    const s = useGistStore.getState();
    expect(s.syncStatus).toBe("idle");
    expect(s.lastSyncResult?.updated).toBe(3);
    expect(s.gists.map((g) => g.id)).toEqual(["g1"]);
  });

  it("force=true requests a full sync", async () => {
    mocked.syncGists.mockResolvedValue(makeSyncResult({ incremental: false }));
    await useGistStore.getState().sync(true);
    expect(mocked.syncGists).toHaveBeenCalledWith(true);
  });

  it("a click event passed as `force` is treated as incremental", async () => {
    mocked.syncGists.mockResolvedValue(makeSyncResult());
    // Simulates onClick={sync}: React hands the handler a SyntheticEvent.
    const fakeEvent = { preventDefault: () => {} } as unknown as boolean;
    await useGistStore.getState().sync(fakeEvent);
    expect(mocked.syncGists).toHaveBeenCalledWith(false);
  });

  it("respects an active tag filter when refreshing", async () => {
    useGistStore.setState({ activeTagId: 7 });
    mocked.syncGists.mockResolvedValue(makeSyncResult());
    mocked.listGistsByTag.mockResolvedValue([makeGist("tagged")]);

    await useGistStore.getState().sync();

    expect(mocked.listGistsByTag).toHaveBeenCalledWith(7);
    expect(mocked.listGists).not.toHaveBeenCalled();
    expect(useGistStore.getState().gists.map((g) => g.id)).toEqual(["tagged"]);
  });

  it("respects an active collection filter (highest precedence)", async () => {
    useGistStore.setState({ activeCollectionId: "c1", activeTagId: 7, searchQuery: "q" });
    mocked.syncGists.mockResolvedValue(makeSyncResult());
    mocked.listCollectionGists.mockResolvedValue([makeGist("in-col")]);

    await useGistStore.getState().sync();

    expect(mocked.listCollectionGists).toHaveBeenCalledWith("c1");
    expect(mocked.listGistsByTag).not.toHaveBeenCalled();
    expect(mocked.searchGists).not.toHaveBeenCalled();
  });

  it("respects an active search query when refreshing", async () => {
    useGistStore.setState({ searchQuery: "vue" });
    mocked.syncGists.mockResolvedValue(makeSyncResult());
    mocked.searchGists.mockResolvedValue([makeGist("found")]);

    await useGistStore.getState().sync();

    expect(mocked.searchGists).toHaveBeenCalledWith("vue");
  });

  it("failure: sets error state and pushes a notification", async () => {
    mocked.syncGists.mockRejectedValue(new Error("network down"));

    await useGistStore.getState().sync();

    const s = useGistStore.getState();
    expect(s.syncStatus).toBe("error");
    expect(s.syncError).toContain("network down");
    const toasts = useNotificationStore.getState().items;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toContain("同步失败");
  });
});

describe("gist CRUD", () => {
  it("createGist() prepends, selects, and records as recent", async () => {
    useGistStore.setState({ gists: [makeGist("old")] });
    mocked.createGist.mockResolvedValue(makeGist("new"));

    await useGistStore.getState().createGist("d", true, [["a.py", "x"]]);

    const s = useGistStore.getState();
    expect(s.gists.map((g) => g.id)).toEqual(["new", "old"]);
    expect(s.selectedId).toBe("new");
    expect(useRecentStore.getState().ids).toContain("new");
  });

  it("updateGist() replaces only the matching gist", async () => {
    useGistStore.setState({ gists: [makeGist("a"), makeGist("b")] });
    mocked.updateGist.mockResolvedValue(makeGist("a", { description: "updated" }));

    await useGistStore.getState().updateGist("a", "updated", {});

    const s = useGistStore.getState();
    expect(s.gists.find((g) => g.id === "a")?.description).toBe("updated");
    expect(s.gists.find((g) => g.id === "b")?.description).toBe("gist b");
  });

  it("deleteGist() removes the gist, its tag cache, and reselects the first remaining", async () => {
    useGistStore.setState({
      gists: [makeGist("a"), makeGist("b")],
      selectedId: "a",
      gistTags: { a: [makeTag(1, "rust")], b: [] },
    });
    mocked.deleteGist.mockResolvedValue(undefined);

    await useGistStore.getState().deleteGist("a");

    const s = useGistStore.getState();
    expect(s.gists.map((g) => g.id)).toEqual(["b"]);
    expect(s.selectedId).toBe("b");
    expect(s.gistTags).not.toHaveProperty("a");
    expect(useRecentStore.getState().ids).not.toContain("a");
  });

  it("deleteGist() keeps the selection when a different gist was selected", async () => {
    useGistStore.setState({ gists: [makeGist("a"), makeGist("b")], selectedId: "b" });
    mocked.deleteGist.mockResolvedValue(undefined);

    await useGistStore.getState().deleteGist("a");

    expect(useGistStore.getState().selectedId).toBe("b");
  });

  it("togglePin() re-sorts pinned gists to the front", async () => {
    useGistStore.setState({
      gists: [
        makeGist("a", { updated_at: "2026-03-01" }),
        makeGist("b", { updated_at: "2026-01-01" }),
      ],
    });
    mocked.togglePin.mockResolvedValue(true);

    await useGistStore.getState().togglePin("b");

    const s = useGistStore.getState();
    expect(s.gists[0].id).toBe("b");
    expect(s.gists[0].pinned).toBe(true);
  });
});

describe("tags", () => {
  it("createTag() inserts sorted by name and dedups by id", async () => {
    useGistStore.setState({ allTags: [makeTag(1, "zebra"), makeTag(2, "alpha")] });
    mocked.createTag.mockResolvedValue(makeTag(1, "middle")); // same id 1 → replace

    await useGistStore.getState().createTag("middle", "#fff");

    const names = useGistStore.getState().allTags.map((t) => t.name);
    expect(names).toEqual(["alpha", "middle"]);
  });

  it("deleteTag() removes it everywhere and resets the active filter", async () => {
    useGistStore.setState({
      allTags: [makeTag(1, "rust"), makeTag(2, "go")],
      activeTagId: 1,
      gistTags: { g1: [makeTag(1, "rust"), makeTag(2, "go")] },
    });
    mocked.deleteTag.mockResolvedValue(undefined);
    mocked.listGists.mockResolvedValue([makeGist("fresh")]);

    await useGistStore.getState().deleteTag(1);

    const s = useGistStore.getState();
    expect(s.allTags.map((t) => t.id)).toEqual([2]);
    expect(s.activeTagId).toBeNull();
    expect(s.gistTags.g1.map((t) => t.id)).toEqual([2]);
    // active filter was deleted → list refreshed
    expect(s.gists.map((g) => g.id)).toEqual(["fresh"]);
  });

  it("setActiveTag() filters the list and clears competing filters", async () => {
    useGistStore.setState({ searchQuery: "old", activeCategoryId: "script" });
    mocked.listGistsByTag.mockResolvedValue([makeGist("tagged")]);

    await useGistStore.getState().setActiveTag(5);

    const s = useGistStore.getState();
    expect(s.activeTagId).toBe(5);
    expect(s.searchQuery).toBe("");
    expect(s.activeCategoryId).toBeNull();
    expect(s.gists.map((g) => g.id)).toEqual(["tagged"]);
  });

  it("loadGistTags() caches an empty array when the IPC call fails", async () => {
    mocked.getGistTags.mockRejectedValue(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await useGistStore.getState().loadGistTags("g1");

    expect(useGistStore.getState().gistTags.g1).toEqual([]);
    errSpy.mockRestore();
  });
});

describe("offline-first", () => {
  it("publishGist() swaps the local id for the GitHub id, including selection", async () => {
    useGistStore.setState({
      gists: [makeGist("local-1", { local_only: true })],
      selectedId: "local-1",
    });
    mocked.publishLocalGist.mockResolvedValue(makeGist("gh-99"));

    await useGistStore.getState().publishGist("local-1");

    const s = useGistStore.getState();
    expect(s.gists.map((g) => g.id)).toEqual(["gh-99"]);
    expect(s.selectedId).toBe("gh-99");
    expect(useRecentStore.getState().ids).toContain("gh-99");
  });

  it("createLocalGist() prepends and selects without contacting GitHub APIs", async () => {
    mocked.createLocalGist.mockResolvedValue(makeGist("draft-1", { local_only: true }));

    await useGistStore.getState().createLocalGist("d", false, []);

    expect(useGistStore.getState().selectedId).toBe("draft-1");
    expect(mocked.createGist).not.toHaveBeenCalled();
  });
});

describe("collections", () => {
  it("deleteCollection() drops it from per-gist caches and clears the active filter", async () => {
    useGistStore.setState({
      allCollections: [makeCollectionCount("c1"), makeCollectionCount("c2")],
      activeCollectionId: "c1",
      gistCollections: { g1: [makeCollection("c1"), makeCollection("c2")] },
    });
    mocked.deleteCollection.mockResolvedValue(undefined);
    mocked.listGists.mockResolvedValue([makeGist("fresh")]);

    await useGistStore.getState().deleteCollection("c1");

    const s = useGistStore.getState();
    expect(s.allCollections.map((c) => c.id)).toEqual(["c2"]);
    expect(s.activeCollectionId).toBeNull();
    expect(s.gistCollections.g1.map((c) => c.id)).toEqual(["c2"]);
    expect(s.gists.map((g) => g.id)).toEqual(["fresh"]);
  });

  it("addGistToCollection() refreshes the visible list only when viewing that collection", async () => {
    useGistStore.setState({ activeCollectionId: "c1" });
    mocked.addGistToCollection.mockResolvedValue(undefined);
    mocked.getGistCollections.mockResolvedValue([makeCollection("c1")]);
    mocked.listCollectionGists.mockResolvedValue([makeGist("member")]);

    await useGistStore.getState().addGistToCollection("c1", "g1");

    expect(mocked.listCollectionGists).toHaveBeenCalledWith("c1");
    expect(useGistStore.getState().gists.map((g) => g.id)).toEqual(["member"]);
  });
});

describe("editor tabs", () => {
  it("openInTab() appends once and selects", () => {
    useGistStore.getState().openInTab("a");
    useGistStore.getState().openInTab("b");
    useGistStore.getState().openInTab("a"); // duplicate
    const s = useGistStore.getState();
    expect(s.openTabIds).toEqual(["a", "b"]);
    expect(s.selectedId).toBe("a");
  });

  it("closeTab() of the selected tab falls back to the right neighbour", () => {
    useGistStore.setState({ openTabIds: ["a", "b", "c"], selectedId: "b" });
    useGistStore.getState().closeTab("b");
    const s = useGistStore.getState();
    expect(s.openTabIds).toEqual(["a", "c"]);
    expect(s.selectedId).toBe("c");
  });

  it("closeTab() of the last tab falls back to the left neighbour", () => {
    useGistStore.setState({ openTabIds: ["a", "b"], selectedId: "b" });
    useGistStore.getState().closeTab("b");
    expect(useGistStore.getState().selectedId).toBe("a");
  });

  it("closing the only tab clears selection", () => {
    useGistStore.setState({ openTabIds: ["a"], selectedId: "a" });
    useGistStore.getState().closeTab("a");
    const s = useGistStore.getState();
    expect(s.openTabIds).toEqual([]);
    expect(s.selectedId).toBeNull();
  });

  it("closing an unselected tab keeps the current selection", () => {
    useGistStore.setState({ openTabIds: ["a", "b"], selectedId: "a" });
    useGistStore.getState().closeTab("b");
    expect(useGistStore.getState().selectedId).toBe("a");
  });
});
