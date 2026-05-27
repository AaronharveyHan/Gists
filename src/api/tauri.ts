/**
 * Tauri IPC wrapper — typed bindings for all Rust commands.
 * Centralises all invoke() calls so the rest of the app never
 * imports @tauri-apps/api directly.
 */
import { invoke } from "@tauri-apps/api/tauri";

export interface GistFile {
  filename: string;
  language: string | null;
  content: string;
  size: number;
  raw_url: string | null;
}

export interface Gist {
  id: string;
  description: string;
  public: boolean;
  html_url: string;
  created_at: string;
  updated_at: string;
  files: GistFile[];
  pending_push?: boolean;
  /** Heuristic bucket: config | script | document | media | data | multi | snippet | library | test | gist */
  category?: string;
  /** Coarse language group: web | systems | scripting | data | docs | other */
  lang_group?: string;
  pinned?: boolean;
}

export interface CategoryCount {
  category: string;
  count: number;
}

export interface GistRevisionView {
  sha: string;
  short_sha: string;
  author_login: string;
  committed_at: string;
  files_changed: number;
  additions: number;
  deletions: number;
}

export interface Tag {
  id: number;
  name: string;
  color: string;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

/** Save token and validate it. Returns the GitHub login name. */
export const setToken = (token: string): Promise<string> =>
  invoke("set_token", { token });

export const getToken = (): Promise<boolean> => invoke("get_token");

/** Returns the GitHub login. Uses cached DB value; falls back to API call. */
export const getCurrentLogin = (): Promise<string> =>
  invoke("get_current_login");

export const clearToken = (): Promise<void> => invoke("clear_token");

// ── Sync ──────────────────────────────────────────────────────────────────────

export interface SyncResult {
  /** How many gists were fetched/updated in this pass. */
  updated: number;
  /** Total gists in local cache after sync. */
  total: number;
  /** true = incremental (?since=); false = full pull. */
  incremental: boolean;
}

/**
 * Sync gists from GitHub.
 * force=false (default): incremental — only gists changed since last sync.
 * force=true:            full pull  — fetch everything (user-triggered).
 */
export const syncGists = (force = false): Promise<SyncResult> =>
  invoke("sync_gists", { force });

// ── CRUD ──────────────────────────────────────────────────────────────────────

export const listGists = (): Promise<Gist[]> => invoke("list_gists");

export const searchGists = (query: string): Promise<Gist[]> =>
  invoke("search_gists", { query });

export const getGist = (gistId: string): Promise<Gist | null> =>
  invoke("get_gist", { gistId });

export const saveGistDraft = (
  gistId: string,
  description: string,
  files: [string, string][]
): Promise<Gist> => invoke("save_gist_draft", { gistId, description, files });

/** Latest gist JSON from GitHub (does not write local DB). */
export const fetchGistFromGitHub = (gistId: string): Promise<Gist> =>
  invoke("fetch_gist_from_github", { gistId });

/** Fetch from GitHub and replace local cache (clears pending_push). */
export const pullGistRemote = (gistId: string): Promise<Gist> =>
  invoke("pull_gist_remote", { gistId });

export const createGist = (
  description: string,
  isPublic: boolean,
  files: [string, string][] // [filename, content]
): Promise<Gist> =>
  invoke("create_gist", { description, public: isPublic, files });

/**
 * Update a gist.
 * files: { [oldFilename]: [content, newFilename | null] | null }
 * Pass null as value to delete a file.
 */
export const updateGist = (
  gistId: string,
  description: string,
  files: Record<string, [string, string | null] | null>
): Promise<Gist> =>
  invoke("update_gist", { gistId, description, files });

export const deleteGist = (gistId: string): Promise<void> =>
  invoke("delete_gist", { gistId });

// ── Tags ──────────────────────────────────────────────────────────────────────

export const listTags = (): Promise<Tag[]> => invoke("list_tags");

export const createTag = (name: string, color: string): Promise<Tag> =>
  invoke("create_tag", { name, color });

export const deleteTag = (tagId: number): Promise<void> =>
  invoke("delete_tag", { tagId });

export const getGistTags = (gistId: string): Promise<Tag[]> =>
  invoke("get_gist_tags", { gistId });

export const setGistTags = (gistId: string, tagIds: number[]): Promise<void> =>
  invoke("set_gist_tags", { gistId, tagIds });

export const listGistsByTag = (tagId: number): Promise<Gist[]> =>
  invoke("list_gists_by_tag", { tagId });

export const listGistsByCategory = (category: string): Promise<Gist[]> =>
  invoke("list_gists_by_category", { category });

export const listCategoryCounts = (): Promise<CategoryCount[]> =>
  invoke("list_category_counts");

export const setGistCategory = (
  gistId: string,
  category: string
): Promise<void> => invoke("set_gist_category", { gistId, category });

export const togglePin = (gistId: string): Promise<boolean> =>
  invoke("toggle_pin", { gistId });

// ── Settings ──────────────────────────────────────────────────────────────────

export const getSetting = (key: string): Promise<string | null> =>
  invoke("get_setting", { key });

export const saveSetting = (key: string, value: string): Promise<void> =>
  invoke("save_setting", { key, value });

// ── Diff ──────────────────────────────────────────────────────────────────────

/**
 * Diff the current editor snapshot against the last-synced remote baseline.
 * Returns a unified diff string; empty string means no changes vs remote.
 */
export const computeGistDiff = (
  gistId: string,
  files: [string, string][]
): Promise<string> => invoke("compute_gist_diff", { gistId, files });

/**
 * Fetch the commit history for a gist from the GitHub API.
 * Returns metadata only (no diff content embedded).
 */
export const getGistRevisions = (
  gistId: string
): Promise<GistRevisionView[]> => invoke("get_gist_revisions", { gistId });

/**
 * Fetch two gist revisions from GitHub and return the unified diff between them.
 * Pass prevSha=null for the initial commit (diffs against empty).
 */
export const fetchRevDiff = (
  gistId: string,
  sha: string,
  prevSha: string | null
): Promise<string> => invoke("fetch_rev_diff", { gistId, sha, prevSha });

/** Export all cached gists (with tags/pins/categories) to a single JSON file. */
export const exportGists = (destPath: string): Promise<number> =>
  invoke("export_gists", { destPath });

export interface ImportPreviewItem {
  id: string;
  description: string;
  file_count: number;
  primary_filename: string;
  public: boolean;
  pinned: boolean;
  tags: string[];
  status: "new" | "exists";
}

/** Preview an import: parse backup file and check each gist against local DB. */
export const importPreview = (filePath: string): Promise<ImportPreviewItem[]> =>
  invoke("import_preview", { filePath });

/** Execute import for selected gist IDs. Returns the count imported. */
export const importExecute = (
  filePath: string,
  gistIds: string[]
): Promise<number> => invoke("import_execute", { filePath, gistIds });
