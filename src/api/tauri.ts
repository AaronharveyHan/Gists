/**
 * Tauri IPC wrapper — typed bindings for all Rust commands.
 * Centralises all invoke() calls so the rest of the app never
 * imports @tauri-apps/api directly.
 */
import { invoke } from "@tauri-apps/api/core";

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
  /** True for gists that live only in local SQLite and have never been pushed to GitHub. */
  local_only?: boolean;
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

/** Factory reset: erases every stored credential and all local gist data. */
export const resetApp = (): Promise<void> => invoke("reset_app");

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

export interface TagCount {
  id: number;
  name: string;
  color: string;
  count: number;
}

export const listTagCounts = (): Promise<TagCount[]> =>
  invoke("list_tag_counts");

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

/** Fetch the full gist snapshot at a specific revision SHA. Used for restore. */
export const fetchGistAtRev = (gistId: string, sha: string): Promise<Gist> =>
  invoke("fetch_gist_at_rev", { gistId, sha });

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

// ── AI ────────────────────────────────────────────────────────────────────────

export interface AiConfig {
  base_url: string;
  model: string;
  has_key: boolean;
  embedding_model: string;
  /** Empty string means "same as base_url". */
  embedding_base_url: string;
}

export const getAiConfig = (): Promise<AiConfig> => invoke("get_ai_config");

export const saveAiConfig = (
  base_url: string,
  api_key: string,
  model: string,
  embedding_model: string,
  embedding_base_url: string
): Promise<void> =>
  invoke("save_ai_config", {
    baseUrl: base_url,
    apiKey: api_key,
    model,
    embeddingModel: embedding_model,
    embeddingBaseUrl: embedding_base_url,
  });

// ── Semantic search ───────────────────────────────────────────────────────────

export interface SemanticResult {
  gist_id: string;
  score: number;
}

export interface EmbeddingProgress {
  indexed: number;
  total: number;
  running: boolean;
  error?: string;
}

export const semanticSearch = (
  query: string,
  limit = 20
): Promise<SemanticResult[]> =>
  invoke("semantic_search", { query, limit });

export const getEmbeddingStatus = (): Promise<EmbeddingProgress> =>
  invoke("get_embedding_status");

export const startEmbeddingIndexer = (): Promise<void> =>
  invoke("start_embedding_indexer");

// ── Local (offline) embeddings ─────────────────────────────────────────────────

export interface LocalEmbeddingStatus {
  /** Resolved directory where the model is/will be stored. */
  dir: string;
  /** Whether the model files already exist on disk. */
  downloaded: boolean;
  /** Whether the model is loaded into memory this session. */
  loaded: boolean;
}

export const localEmbeddingStatus = (): Promise<LocalEmbeddingStatus> =>
  invoke("local_embedding_status");

/** Download (if needed) and initialise the local ONNX embedding model. */
export const downloadLocalEmbeddingModel = (): Promise<void> =>
  invoke("download_local_embedding_model");

export interface AiMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export const aiChat = (streamId: string, messages: AiMessage[]): Promise<void> =>
  invoke("ai_chat", { streamId, messages });

/** One-shot (non-streaming) completion — returns the full assistant message. */
export const aiComplete = (messages: AiMessage[]): Promise<string> =>
  invoke("ai_complete", { messages });

export interface SimilarPair {
  a: string;
  b: string;
  score: number;
}

/** Near-duplicate gist pairs from stored embeddings (cosine ≥ threshold). */
export const findDuplicateGists = (threshold: number): Promise<SimilarPair[]> =>
  invoke("find_duplicate_gists", { threshold });

// ── Local draft / offline-first ───────────────────────────────────────────────

// ── Relation graph ────────────────────────────────────────────────────────────

/** Returns all [gist_id, tag_id] pairs for building the relation graph. */
export const listGistTagPairs = (): Promise<[string, number][]> =>
  invoke("list_gist_tag_pairs");

// ── Code runner ───────────────────────────────────────────────────────────────

/** File extensions the backend can execute. */
export const RUNNABLE_EXTENSIONS = new Set([
  "py", "js", "mjs", "cjs", "ts", "sh", "bash", "zsh", "rb", "php", "go",
]);

export interface RunLine {
  text: string;
  stream: "stdout" | "stderr";
}

export interface RunDone {
  exit_code: number;
  timed_out: boolean;
  killed: boolean;
  stdout: string;
  stderr: string;
  duration_ms: number;
  /** True if the archived stdout/stderr was clipped at the 100 KB cap. */
  truncated: boolean;
}

export interface RunRecord {
  id: number;
  gist_id: string;
  filename: string;
  ran_at: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  timed_out: boolean;
  killed: boolean;
  /** True if the archived stdout/stderr was clipped at the 100 KB cap. */
  truncated: boolean;
}

/** Start executing a file. Returns immediately; output arrives via run-line-{runId} events. */
export const runCode = (
  runId: string,
  gistId: string,
  filename: string,
  content: string
): Promise<void> => invoke("run_code", { runId, gistId, filename, content });

/** Send a kill signal to a running execution. */
export const killRun = (runId: string): Promise<void> =>
  invoke("kill_run", { runId });

export const listRunHistory = (gistId: string, filename: string): Promise<RunRecord[]> =>
  invoke("list_run_history", { gistId, filename });

export const diffRuns = (idA: number, idB: number): Promise<string> =>
  invoke("diff_runs", { idA, idB });

// ── Collections ───────────────────────────────────────────────────────────────

export interface Collection {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  created_at: string;
  updated_at: string;
}

export interface CollectionCount {
  id: string;
  name: string;
  color: string;
  icon: string;
  count: number;
}

export const listCollections = (): Promise<Collection[]> =>
  invoke("list_collections");

export const listCollectionCounts = (): Promise<CollectionCount[]> =>
  invoke("list_collection_counts");

export const createCollection = (
  name: string,
  description: string,
  color: string,
  icon: string
): Promise<Collection> =>
  invoke("create_collection", { name, description, color, icon });

export const updateCollection = (
  id: string,
  name: string,
  description: string,
  color: string,
  icon: string
): Promise<Collection> =>
  invoke("update_collection", { id, name, description, color, icon });

export const deleteCollection = (id: string): Promise<void> =>
  invoke("delete_collection", { id });

export const addGistToCollection = (
  collectionId: string,
  gistId: string
): Promise<void> => invoke("add_gist_to_collection", { collectionId, gistId });

export const removeGistFromCollection = (
  collectionId: string,
  gistId: string
): Promise<void> =>
  invoke("remove_gist_from_collection", { collectionId, gistId });

export const listCollectionGists = (collectionId: string): Promise<Gist[]> =>
  invoke("list_collection_gists", { collectionId });

export const getGistCollections = (gistId: string): Promise<Collection[]> =>
  invoke("get_gist_collections", { gistId });

// ── Templates ─────────────────────────────────────────────────────────────────

export interface TemplateFile {
  id: number;
  template_id: number;
  filename: string;
  content: string;
  sort_order: number;
}

export interface Template {
  id: number;
  name: string;
  description: string;
  is_public: boolean;
  files: TemplateFile[];
  created_at: string;
}

export const listTemplates = (): Promise<Template[]> => invoke("list_templates");

export const createTemplate = (
  name: string,
  description: string,
  isPublic: boolean,
  files: [string, string][]
): Promise<Template> =>
  invoke("create_template", { name, description, isPublic, files });

export const updateTemplate = (
  id: number,
  name: string,
  description: string,
  isPublic: boolean,
  files: [string, string][]
): Promise<Template> =>
  invoke("update_template", { id, name, description, isPublic, files });

export const deleteTemplate = (id: number): Promise<void> =>
  invoke("delete_template", { id });

export const saveGistAsTemplate = (gistId: string, name: string): Promise<Template> =>
  invoke("save_gist_as_template", { gistId, name });

// ── VS Code snippets import ───────────────────────────────────────────────────

export interface VscodeSnippet {
  name: string;
  description: string;
  prefix: string;
  language: string;
  filename: string;
  body: string;
  source: string;
}

export const vscodeSnippetsDefaultPath = (): Promise<string | null> =>
  invoke("vscode_snippets_default_path");

export const vscodeSnippetsPreview = (path: string | null): Promise<VscodeSnippet[]> =>
  invoke("vscode_snippets_preview", { path });

export const vscodeSnippetsImport = (items: VscodeSnippet[]): Promise<number> =>
  invoke("vscode_snippets_import", { items });

// ── Local draft / offline-first ───────────────────────────────────────────────

/** Create a gist stored only in local SQLite. Never contacts GitHub. */
export const createLocalGist = (
  description: string,
  pub: boolean,
  files: [string, string][]
): Promise<Gist> =>
  invoke("create_local_gist", { description, public: pub, files });

/** Publish a local-only draft to GitHub, migrating its ID to the real GitHub ID. */
export const publishLocalGist = (localId: string): Promise<Gist> =>
  invoke("publish_local_gist", { localId });

// ── Wiki-links ([[gist-name]]) ────────────────────────────────────────────────

/** Gists that contain [[link_text]] pointing at this gist (by description or filename). */
export const getBacklinks = (gistId: string): Promise<Gist[]> =>
  invoke("get_backlinks", { gistId });

/** Resolve a [[link_text]] to the gist it refers to. Returns null if nothing matches. */
export const resolveWikiLink = (linkText: string): Promise<Gist | null> =>
  invoke("resolve_wiki_link", { linkText });

// ── Error reporting ───────────────────────────────────────────────────────────

/** Fire-and-forget: send an error message to the Rust telemetry layer. */
export const captureError = (message: string, context?: string): Promise<void> =>
  invoke("capture_error", { message, context });

// ── Multi-account ─────────────────────────────────────────────────────────────

export interface Account {
  id: number;
  name: string;
  login: string | null;
  avatar_url: string | null;
  token_key: string;
  is_active: boolean;
}

export const listAccounts = (): Promise<Account[]> =>
  invoke("list_accounts");

export const addAccount = (name: string, token: string): Promise<Account> =>
  invoke("add_account", { name, token });

export const removeAccount = (id: number): Promise<void> =>
  invoke("remove_account", { id });

export const switchAccount = (id: number): Promise<void> =>
  invoke("switch_account", { id });

// ── Three-way merge ───────────────────────────────────────────────────────────

export interface MergedFile {
  filename: string;
  content: string;
  had_conflict: boolean;
}

export interface MergeOutcome {
  files: MergedFile[];
  any_conflict: boolean;
}

export const mergeGistConflict = (
  gistId: string,
  localFiles: [string, string][],
  remoteFiles: [string, string][]
): Promise<MergeOutcome> =>
  invoke("merge_gist_conflict", { gistId, localFiles, remoteFiles });
