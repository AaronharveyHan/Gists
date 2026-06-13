/**
 * Manual mock for src/api/tauri.ts.
 *
 * Usage in a test file — add exactly these two lines BEFORE any imports that
 * transitively touch api/tauri (vi.mock is hoisted so the call site doesn't
 * matter, but they must appear at the module's top level):
 *
 *   vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
 *   vi.mock("../api/tauri");            // ← resolves to this file
 *
 * Adjust the relative path to tauri if the test file sits deeper:
 *   vi.mock("../../api/tauri");
 *
 * Every export is a vi.fn() that resolves to a sensible empty default.
 * Override per-test with vi.mocked(fn).mockResolvedValueOnce(...).
 * Reset with beforeEach(() => vi.clearAllMocks()).
 *
 * RUNNABLE_EXTENSIONS is the only non-function export — it's a Set<string>
 * and is returned as-is from the real module.
 */
import { vi } from "vitest";

// ── Auth ──────────────────────────────────────────────────────────────────────
export const setToken = vi.fn().mockResolvedValue("");
export const getToken = vi.fn().mockResolvedValue(false);
export const getCurrentLogin = vi.fn().mockResolvedValue("testuser");
export const clearToken = vi.fn().mockResolvedValue(undefined);

// ── Sync ─────────────────────────────────────────────────────────────────────
export const syncGists = vi.fn().mockResolvedValue({ updated: 0, total: 0, incremental: true });

// ── Gists ─────────────────────────────────────────────────────────────────────
export const listGists = vi.fn().mockResolvedValue([]);
export const searchGists = vi.fn().mockResolvedValue([]);
export const getGist = vi.fn().mockResolvedValue(null);
export const saveGistDraft = vi.fn().mockResolvedValue(undefined);
export const fetchGistFromGitHub = vi.fn().mockResolvedValue(null);
export const pullGistRemote = vi.fn().mockResolvedValue(null);
export const createGist = vi.fn().mockResolvedValue(null);
export const updateGist = vi.fn().mockResolvedValue(undefined);
export const deleteGist = vi.fn().mockResolvedValue(undefined);
export const setGistCategory = vi.fn().mockResolvedValue(undefined);
export const togglePin = vi.fn().mockResolvedValue(false);
export const createLocalGist = vi.fn().mockResolvedValue(null);
export const publishLocalGist = vi.fn().mockResolvedValue(null);

// ── Tags ──────────────────────────────────────────────────────────────────────
export const listTags = vi.fn().mockResolvedValue([]);
export const createTag = vi.fn().mockResolvedValue({ id: 1, name: "tag", color: "#000" });
export const deleteTag = vi.fn().mockResolvedValue(undefined);
export const getGistTags = vi.fn().mockResolvedValue([]);
export const setGistTags = vi.fn().mockResolvedValue(undefined);
export const listGistsByTag = vi.fn().mockResolvedValue([]);
export const listTagCounts = vi.fn().mockResolvedValue([]);
export const listGistTagPairs = vi.fn().mockResolvedValue([]);

// ── Categories ────────────────────────────────────────────────────────────────
export const listGistsByCategory = vi.fn().mockResolvedValue([]);
export const listCategoryCounts = vi.fn().mockResolvedValue([]);

// ── Settings ──────────────────────────────────────────────────────────────────
export const getSetting = vi.fn().mockResolvedValue(null);
export const saveSetting = vi.fn().mockResolvedValue(undefined);

// ── Revisions / diff ──────────────────────────────────────────────────────────
export const computeGistDiff = vi.fn().mockResolvedValue("");
export const getGistRevisions = vi.fn().mockResolvedValue([]);
export const fetchRevDiff = vi.fn().mockResolvedValue("");
export const fetchGistAtRev = vi.fn().mockResolvedValue(null);

// ── Export / Import ───────────────────────────────────────────────────────────
export const exportGists = vi.fn().mockResolvedValue(0);
export const importPreview = vi.fn().mockResolvedValue([]);
export const importExecute = vi.fn().mockResolvedValue(undefined);

// ── AI ────────────────────────────────────────────────────────────────────────
export const getAiConfig = vi.fn().mockResolvedValue({
  base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  model: "qwen-turbo",
  embedding_model: "text-embedding-v3",
  embedding_base_url: "",
  has_key: false,
});
export const saveAiConfig = vi.fn().mockResolvedValue(undefined);
export const aiChat = vi.fn().mockResolvedValue(undefined);
export const aiComplete = vi.fn().mockResolvedValue("");

// ── Embeddings / semantic search ──────────────────────────────────────────────
export const semanticSearch = vi.fn().mockResolvedValue([]);
export const getEmbeddingStatus = vi.fn().mockResolvedValue({ indexed: 0, total: 0, running: false });
export const startEmbeddingIndexer = vi.fn().mockResolvedValue(undefined);
export const localEmbeddingStatus = vi.fn().mockResolvedValue({
  dir: "",
  downloaded: false,
  loaded: false,
});
export const downloadLocalEmbeddingModel = vi.fn().mockResolvedValue(undefined);

// ── Library cleanup / duplicates ──────────────────────────────────────────────
export const findDuplicateGists = vi.fn().mockResolvedValue([]);

// ── Collections ───────────────────────────────────────────────────────────────
export const listCollectionCounts = vi.fn().mockResolvedValue([]);
export const createCollection = vi.fn().mockResolvedValue(null);
export const updateCollection = vi.fn().mockResolvedValue(undefined);
export const deleteCollection = vi.fn().mockResolvedValue(undefined);
export const addGistToCollection = vi.fn().mockResolvedValue(undefined);
export const removeGistFromCollection = vi.fn().mockResolvedValue(undefined);
export const listCollectionGists = vi.fn().mockResolvedValue([]);
export const getGistCollections = vi.fn().mockResolvedValue([]);

// ── Templates ─────────────────────────────────────────────────────────────────
export const listTemplates = vi.fn().mockResolvedValue([]);
export const createTemplate = vi.fn().mockResolvedValue(null);
export const updateTemplate = vi.fn().mockResolvedValue(undefined);
export const deleteTemplate = vi.fn().mockResolvedValue(undefined);
export const saveGistAsTemplate = vi.fn().mockResolvedValue(null);

// ── VSCode snippets ───────────────────────────────────────────────────────────
export const vscodeSnippetsDefaultPath = vi.fn().mockResolvedValue(null);
export const vscodeSnippetsPreview = vi.fn().mockResolvedValue([]);
export const vscodeSnippetsImport = vi.fn().mockResolvedValue(0);

// ── Backlinks / wiki ──────────────────────────────────────────────────────────
export const getBacklinks = vi.fn().mockResolvedValue([]);
export const resolveWikiLink = vi.fn().mockResolvedValue(null);

// ── Accounts ──────────────────────────────────────────────────────────────────
export const listAccounts = vi.fn().mockResolvedValue([]);
export const addAccount = vi.fn().mockResolvedValue({
  id: 1, name: "test", login: null, avatar_url: null, token_key: "k", is_active: true,
});
export const removeAccount = vi.fn().mockResolvedValue(undefined);
export const switchAccount = vi.fn().mockResolvedValue(undefined);

// ── Merge ─────────────────────────────────────────────────────────────────────
export const mergeGistConflict = vi.fn().mockResolvedValue({ any_conflict: false, files: [] });

// ── Error capture ─────────────────────────────────────────────────────────────
export const captureError = vi.fn().mockResolvedValue(undefined);

// ── Non-function exports ──────────────────────────────────────────────────────
export const RUNNABLE_EXTENSIONS = new Set([
  "py", "js", "mjs", "cjs", "ts", "sh", "bash", "zsh", "rb", "php", "go",
]);
