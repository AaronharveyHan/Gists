/**
 * Shared test fixtures — minimal valid objects for the api/tauri.ts types.
 * Each factory accepts overrides so tests only state what they care about.
 */
import type {
  Collection,
  CollectionCount,
  Gist,
  SyncResult,
  Tag,
  Template,
} from "../api/tauri";

export const makeGist = (id: string, overrides: Partial<Gist> = {}): Gist => ({
  id,
  description: `gist ${id}`,
  public: true,
  html_url: `https://gist.github.com/${id}`,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  files: [],
  ...overrides,
});

export const makeTag = (id: number, name: string, overrides: Partial<Tag> = {}): Tag => ({
  id,
  name,
  color: "#8b949e",
  ...overrides,
});

export const makeCollection = (
  id: string,
  overrides: Partial<Collection> = {}
): Collection => ({
  id,
  name: `collection ${id}`,
  description: "",
  color: "#58a6ff",
  icon: "folder",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

export const makeCollectionCount = (
  id: string,
  count = 0,
  overrides: Partial<CollectionCount> = {}
): CollectionCount => ({
  id,
  name: `collection ${id}`,
  color: "#58a6ff",
  icon: "folder",
  count,
  ...overrides,
});

export const makeTemplate = (id: number, overrides: Partial<Template> = {}): Template => ({
  id,
  name: `template ${id}`,
  description: "",
  is_public: false,
  files: [],
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

export const makeSyncResult = (overrides: Partial<SyncResult> = {}): SyncResult => ({
  updated: 0,
  total: 0,
  incremental: true,
  ...overrides,
});
