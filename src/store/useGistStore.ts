/**
 * Global state via Zustand.
 * Design: flat, minimal — no nested reducers.
 * Side-effects (API calls) live in action functions, not React effects.
 */
import { create } from "zustand";
import * as api from "../api/tauri";
import type { CategoryCount, Collection, CollectionCount, Gist, SyncResult, Tag } from "../api/tauri";
import { notify } from "./useNotificationStore";
import { useRecentStore } from "./useRecentStore";

export type SyncStatus = "idle" | "syncing" | "error";

interface GistState {
  // Data
  gists: Gist[];
  selectedId: string | null;
  searchQuery: string;
  syncStatus: SyncStatus;
  syncError: string | null;
  lastSyncResult: SyncResult | null;
  isAuthenticated: boolean;
  githubLogin: string | null;

  // Tag data
  allTags: Tag[];
  activeTagId: number | null;
  /** Cache of per-gist tags: gistId → Tag[]. Populated lazily on gist open. */
  gistTags: Record<string, Tag[]>;

  /** Filter by auto/user category slug (mutually exclusive with tag filter & search). */
  activeCategoryId: string | null;
  categoryCounts: CategoryCount[];

  // Collection data
  allCollections: CollectionCount[];
  activeCollectionId: string | null;
  /** Cache of per-gist collection memberships: gistId → Collection[]. Populated lazily. */
  gistCollections: Record<string, Collection[]>;

  // Actions
  setAuthenticated: (login: string) => void;
  logout: () => void;
  setSearch: (q: string) => void;
  selectGist: (id: string | null) => void;
  loadGists: () => Promise<void>;
  /** force=false → incremental sync; force=true → full pull */
  sync: (force?: boolean) => Promise<void>;
  createGist: (
    description: string,
    isPublic: boolean,
    files: [string, string][]
  ) => Promise<Gist>;
  updateGist: (
    id: string,
    description: string,
    files: Record<string, [string, string | null] | null>
  ) => Promise<Gist>;
  saveGistDraft: (
    id: string,
    description: string,
    files: [string, string][]
  ) => Promise<Gist>;
  /** Pull from GitHub into cache + store (discards pending). */
  pullGistRemote: (id: string) => Promise<Gist>;
  deleteGist: (id: string) => Promise<void>;

  // Tag actions
  loadTags: () => Promise<void>;
  createTag: (name: string, color: string) => Promise<Tag>;
  deleteTag: (id: number) => Promise<void>;
  /** Select a tag to filter the gist list. Pass null to show all. */
  setActiveTag: (id: number | null) => Promise<void>;
  loadGistTags: (gistId: string) => Promise<void>;
  setGistTags: (gistId: string, tagIds: number[]) => Promise<void>;

  setActiveCategory: (category: string | null) => Promise<void>;
  togglePin: (gistId: string) => Promise<void>;

  // Collection actions
  loadCollections: () => Promise<void>;
  createCollection: (name: string, description: string, color: string, icon: string) => Promise<Collection>;
  updateCollection: (id: string, name: string, description: string, color: string, icon: string) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  setActiveCollection: (id: string | null) => Promise<void>;
  loadGistCollections: (gistId: string) => Promise<void>;
  addGistToCollection: (collectionId: string, gistId: string) => Promise<void>;
  removeGistFromCollection: (collectionId: string, gistId: string) => Promise<void>;

  // Open gist tabs (editor tab bar)
  openTabIds: string[];
  openInTab: (id: string) => void;
  closeTab: (id: string) => void;

  // Offline-first
  networkOnline: boolean;
  setNetworkOnline: (online: boolean) => void;
  createLocalGist: (
    description: string,
    isPublic: boolean,
    files: [string, string][]
  ) => Promise<Gist>;
  publishGist: (localId: string) => Promise<Gist>;
}

export const useGistStore = create<GistState>((set, get) => ({
  gists: [],
  selectedId: null,
  searchQuery: "",
  syncStatus: "idle",
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
  networkOnline: typeof navigator !== "undefined" ? navigator.onLine : true,

  setAuthenticated: (login) =>
    set({ isAuthenticated: true, githubLogin: login }),

  logout: () =>
    set({
      isAuthenticated: false,
      githubLogin: null,
      gists: [],
      selectedId: null,
      lastSyncResult: null,
      allTags: [],
      activeTagId: null,
      gistTags: {},
      activeCategoryId: null,
      categoryCounts: [],
      allCollections: [],
      activeCollectionId: null,
      gistCollections: {},
      openTabIds: [],
    }),

  setSearch: async (q) => {
    set({ searchQuery: q, activeTagId: null, activeCategoryId: null, activeCollectionId: null });
    const gists = q ? await api.searchGists(q) : await api.listGists();
    set({ gists });
  },

  selectGist: (id) => {
    if (id) useRecentStore.getState().push(id);
    set({ selectedId: id });
  },

  loadGists: async () => {
    const [gists, allTags, categoryCounts, allCollections] = await Promise.all([
      api.listGists(),
      api.listTags(),
      api.listCategoryCounts(),
      api.listCollectionCounts(),
    ]);
    set({ gists, selectedId: gists[0]?.id ?? null, allTags, categoryCounts, allCollections });
  },

  sync: async (force = false) => {
    // Only literal `true` means full sync — avoids React passing a click event here
    // when a button uses `onClick={sync}` (SyntheticEvent has cyclic refs → JSON.stringify throws).
    const fullSync = force === true;
    set({ syncStatus: "syncing", syncError: null });
    try {
      const result = await api.syncGists(fullSync);
      const { searchQuery, activeTagId, activeCategoryId, activeCollectionId } = get();
      let gists: Gist[];
      const [categoryCounts, allCollections] = await Promise.all([
        api.listCategoryCounts(),
        api.listCollectionCounts(),
      ]);
      if (activeCollectionId !== null) {
        gists = await api.listCollectionGists(activeCollectionId);
      } else if (activeCategoryId !== null) {
        gists = await api.listGistsByCategory(activeCategoryId);
      } else if (activeTagId !== null) {
        gists = await api.listGistsByTag(activeTagId);
      } else if (searchQuery) {
        gists = await api.searchGists(searchQuery);
      } else {
        gists = await api.listGists();
      }
      set({ gists, syncStatus: "idle", lastSyncResult: result, categoryCounts, allCollections });
    } catch (e) {
      set({ syncStatus: "error", syncError: String(e) });
      notify("同步失败: " + String(e));
    }
  },

  createGist: async (description, isPublic, files) => {
    const gist = await api.createGist(description, isPublic, files);
    useRecentStore.getState().push(gist.id);
    set((s) => ({
      gists: [gist, ...s.gists],
      selectedId: gist.id,
    }));
    return gist;
  },

  updateGist: async (id, description, files) => {
    const updated = await api.updateGist(id, description, files);
    set((s) => ({
      gists: s.gists.map((g) => (g.id === id ? updated : g)),
    }));
    return updated;
  },

  saveGistDraft: async (id, description, files) => {
    const g = await api.saveGistDraft(id, description, files);
    set((s) => ({
      gists: s.gists.map((x) => (x.id === id ? g : x)),
    }));
    return g;
  },

  pullGistRemote: async (id) => {
    const g = await api.pullGistRemote(id);
    set((s) => ({
      gists: s.gists.map((x) => (x.id === id ? g : x)),
    }));
    return g;
  },

  deleteGist: async (id) => {
    await api.deleteGist(id);
    useRecentStore.getState().remove(id);
    set((s) => {
      const gists = s.gists.filter((g) => g.id !== id);
      // Also drop cached tags for the deleted gist
      const gistTags = { ...s.gistTags };
      delete gistTags[id];
      return {
        gists,
        gistTags,
        selectedId:
          s.selectedId === id ? (gists[0]?.id ?? null) : s.selectedId,
      };
    });
  },

  // ── Tag actions ──────────────────────────────────────────────────────────

  loadTags: async () => {
    const allTags = await api.listTags();
    set({ allTags });
  },

  createTag: async (name, color) => {
    const tag = await api.createTag(name, color);
    set((s) => ({
      allTags: [...s.allTags.filter((t) => t.id !== tag.id), tag].sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    }));
    return tag;
  },

  deleteTag: async (id) => {
    await api.deleteTag(id);
    set((s) => {
      // Remove from allTags; remove from every gist's cached tags
      const gistTags: Record<string, Tag[]> = {};
      for (const [gistId, tags] of Object.entries(s.gistTags)) {
        gistTags[gistId] = tags.filter((t) => t.id !== id);
      }
      return {
        allTags: s.allTags.filter((t) => t.id !== id),
        activeTagId: s.activeTagId === id ? null : s.activeTagId,
        gistTags,
      };
    });
    // If we just deleted the active tag filter, reset gist list
    const { activeTagId } = get();
    if (activeTagId === null && get().activeCategoryId === null) {
      const gists = await api.listGists();
      set({ gists });
    } else if (get().activeCategoryId !== null) {
      const gists = await api.listGistsByCategory(get().activeCategoryId!);
      set({ gists });
    }
  },

  setActiveTag: async (id) => {
    set({ activeTagId: id, searchQuery: "", activeCategoryId: null, activeCollectionId: null });
    const gists =
      id !== null ? await api.listGistsByTag(id) : await api.listGists();
    set({ gists });
  },

  loadGistTags: async (gistId) => {
    try {
      const tags = await api.getGistTags(gistId);
      set((s) => ({ gistTags: { ...s.gistTags, [gistId]: tags } }));
    } catch (e) {
      console.error("loadGistTags failed", gistId, e);
      set((s) => ({ gistTags: { ...s.gistTags, [gistId]: [] } }));
    }
  },

  setGistTags: async (gistId, tagIds) => {
    await api.setGistTags(gistId, tagIds);
    // Re-fetch the actual tag objects so colors/names stay in sync
    const tags = await api.getGistTags(gistId);
    set((s) => ({ gistTags: { ...s.gistTags, [gistId]: tags } }));
  },

  setActiveCategory: async (category) => {
    const categoryCounts = await api.listCategoryCounts();
    if (category === null) {
      set({ activeCategoryId: null, categoryCounts });
      const { activeTagId, searchQuery } = get();
      let gists: Gist[];
      if (activeTagId !== null) {
        gists = await api.listGistsByTag(activeTagId);
      } else if (searchQuery) {
        gists = await api.searchGists(searchQuery);
      } else {
        gists = await api.listGists();
      }
      set({ gists });
      return;
    }
    set({
      activeCategoryId: category,
      searchQuery: "",
      activeTagId: null,
      activeCollectionId: null,
      categoryCounts,
    });
    const gists = await api.listGistsByCategory(category);
    set({ gists });
  },

  togglePin: async (gistId) => {
    const pinned = await api.togglePin(gistId);
    set((s) => {
      const updated = s.gists.map((g) =>
        g.id === gistId ? { ...g, pinned } : g
      );
      // Re-sort: pinned first, then by updated_at descending
      updated.sort((a, b) => {
        const pa = a.pinned ? 1 : 0;
        const pb = b.pinned ? 1 : 0;
        if (pa !== pb) return pb - pa;
        return b.updated_at.localeCompare(a.updated_at);
      });
      return { gists: updated };
    });
  },

  // ── Offline-first ────────────────────────────────────────────────────────────

  setNetworkOnline: (online) => set({ networkOnline: online }),

  createLocalGist: async (description, isPublic, files) => {
    const gist = await api.createLocalGist(description, isPublic, files);
    useRecentStore.getState().push(gist.id);
    set((s) => ({ gists: [gist, ...s.gists], selectedId: gist.id }));
    return gist;
  },

  publishGist: async (localId) => {
    const published = await api.publishLocalGist(localId);
    useRecentStore.getState().push(published.id);
    set((s) => ({
      gists: s.gists.map((g) => (g.id === localId ? published : g)),
      selectedId: s.selectedId === localId ? published.id : s.selectedId,
    }));
    return published;
  },

  // ── Collection actions ────────────────────────────────────────────────────

  loadCollections: async () => {
    const allCollections = await api.listCollectionCounts();
    set({ allCollections });
  },

  createCollection: async (name, description, color, icon) => {
    const col = await api.createCollection(name, description, color, icon);
    const allCollections = await api.listCollectionCounts();
    set({ allCollections });
    return col;
  },

  updateCollection: async (id, name, description, color, icon) => {
    await api.updateCollection(id, name, description, color, icon);
    const allCollections = await api.listCollectionCounts();
    set({ allCollections });
  },

  deleteCollection: async (id) => {
    await api.deleteCollection(id);
    set((s) => {
      const allCollections = s.allCollections.filter((c) => c.id !== id);
      // Drop per-gist cache entries for this collection
      const gistCollections: Record<string, Collection[]> = {};
      for (const [gistId, cols] of Object.entries(s.gistCollections)) {
        gistCollections[gistId] = cols.filter((c) => c.id !== id);
      }
      return {
        allCollections,
        gistCollections,
        activeCollectionId: s.activeCollectionId === id ? null : s.activeCollectionId,
      };
    });
    if (get().activeCollectionId === null && get().activeCategoryId === null && get().activeTagId === null) {
      const gists = await api.listGists();
      set({ gists });
    }
  },

  setActiveCollection: async (id) => {
    set({ activeCollectionId: id, searchQuery: "", activeTagId: null, activeCategoryId: null });
    const gists = id !== null ? await api.listCollectionGists(id) : await api.listGists();
    set({ gists });
  },

  loadGistCollections: async (gistId) => {
    try {
      const cols = await api.getGistCollections(gistId);
      set((s) => ({ gistCollections: { ...s.gistCollections, [gistId]: cols } }));
    } catch {
      set((s) => ({ gistCollections: { ...s.gistCollections, [gistId]: [] } }));
    }
  },

  addGistToCollection: async (collectionId, gistId) => {
    await api.addGistToCollection(collectionId, gistId);
    // Refresh gist collections cache + counts
    const [cols, allCollections] = await Promise.all([
      api.getGistCollections(gistId),
      api.listCollectionCounts(),
    ]);
    set((s) => ({
      allCollections,
      gistCollections: { ...s.gistCollections, [gistId]: cols },
    }));
    // If currently viewing this collection, refresh the list
    if (get().activeCollectionId === collectionId) {
      const gists = await api.listCollectionGists(collectionId);
      set({ gists });
    }
  },

  removeGistFromCollection: async (collectionId, gistId) => {
    await api.removeGistFromCollection(collectionId, gistId);
    const [cols, allCollections] = await Promise.all([
      api.getGistCollections(gistId),
      api.listCollectionCounts(),
    ]);
    set((s) => ({
      allCollections,
      gistCollections: { ...s.gistCollections, [gistId]: cols },
    }));
    if (get().activeCollectionId === collectionId) {
      const gists = await api.listCollectionGists(collectionId);
      set({ gists });
    }
  },

  openInTab: (id) => {
    const { openTabIds, selectGist } = get();
    if (!openTabIds.includes(id)) set({ openTabIds: [...openTabIds, id] });
    selectGist(id);
  },

  closeTab: (id) => {
    const { openTabIds, selectedId, selectGist } = get();
    const next = openTabIds.filter((t) => t !== id);
    set({ openTabIds: next });
    if (selectedId === id) {
      const idx = openTabIds.indexOf(id);
      const fallback = next[idx] ?? next[idx - 1] ?? null;
      selectGist(fallback);
    }
  },
}));

// ── Derived selectors ─────────────────────────────────────────────────────────

export const useSelectedGist = () =>
  useGistStore((s) => s.gists.find((g) => g.id === s.selectedId) ?? null);
