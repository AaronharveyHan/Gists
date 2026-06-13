/**
 * Pure file-manipulation helpers for the Editor.
 *
 * Extracted from Editor.tsx so the filename/language derivation, the
 * tab-close/reorder transforms, the GitHub file-map construction, and the
 * conflict-marker scan can be unit-tested without mounting Monaco or wiring
 * the gist store. Several of these also de-duplicate logic that previously
 * appeared in two places inside the component (buildFileMap, mergeOutcomeToFiles,
 * the "<<<<<<<" scan).
 *
 * None of these touch React, the stores, the DOM, or Tauri IPC.
 */
import type { GistFile, MergedFile } from "../api/tauri";

/** The line prefix that marks the start of an unresolved merge hunk. */
export const CONFLICT_MARKER = "<<<<<<<";

// ── Filename / language ─────────────────────────────────────────────────────

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript",
  py: "python", rb: "ruby", rs: "rust",
  go: "go", java: "java", cs: "csharp",
  cpp: "cpp", c: "c", h: "c",
  html: "html", css: "css", scss: "scss",
  json: "json", yaml: "yaml", yml: "yaml",
  toml: "toml", md: "markdown", sh: "shell",
  sql: "sql", xml: "xml", php: "php",
};

/** Monaco language id for a filename's extension; "plaintext" if unknown. */
export function detectLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_BY_EXT[ext] ?? "plaintext";
}

/** True only for *.md filenames (null-safe). */
export function isMarkdownFilename(filename: string | null): boolean {
  if (!filename) return false;
  return filename.split(".").pop()?.toLowerCase() === "md";
}

// ── File-array transforms (all return new arrays; never mutate input) ────────

/** Shallow-clone each file so editor edits don't mutate the store's objects. */
export function cloneFiles(files: GistFile[]): GistFile[] {
  return files.map((f) => ({ ...f }));
}

/**
 * First "untitled" name not already taken: "untitled", then "untitled_1",
 * "untitled_2", … Used when adding a blank file.
 */
export function nextUntitledName(existing: string[], base = "untitled"): string {
  const taken = new Set(existing);
  let name = base;
  let i = 1;
  while (taken.has(name)) {
    name = `${base}_${i}`;
    i++;
  }
  return name;
}

/** A blank, locally-added file (raw_url null → never pushed to GitHub yet). */
export function emptyFile(filename: string): GistFile {
  return { filename, language: null, content: "", size: 0, raw_url: null };
}

/**
 * Move the file named `fromName` to the position currently held by `toName`.
 * Returns the input unchanged if either name is missing or they're equal.
 */
export function reorderFiles(files: GistFile[], fromName: string, toName: string): GistFile[] {
  if (fromName === toName) return files;
  const next = [...files];
  const fromIdx = next.findIndex((f) => f.filename === fromName);
  const toIdx = next.findIndex((f) => f.filename === toName);
  if (fromIdx === -1 || toIdx === -1) return files;
  const [item] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, item);
  return next;
}

/**
 * "Close other tabs": keep only `filename`. Returns the kept files plus the
 * filenames that were removed (so the caller can track them for GitHub deletion).
 * If `filename` doesn't exist or is the only file, nothing is removed.
 */
export function closeOthers(
  files: GistFile[],
  filename: string,
): { keep: GistFile[]; removed: string[] } {
  const target = files.find((f) => f.filename === filename);
  if (!target || files.length <= 1) return { keep: files, removed: [] };
  const removed = files.filter((f) => f.filename !== filename).map((f) => f.filename);
  return { keep: [target], removed };
}

/**
 * "Close tabs to the right" of `filename`. Returns the kept prefix plus the
 * removed filenames. No-op when `filename` is last or missing.
 */
export function closeToRight(
  files: GistFile[],
  filename: string,
): { keep: GistFile[]; removed: string[] } {
  const idx = files.findIndex((f) => f.filename === filename);
  if (idx === -1 || idx >= files.length - 1) return { keep: files, removed: [] };
  const keep = files.slice(0, idx + 1);
  const removed = files.slice(idx + 1).map((f) => f.filename);
  return { keep, removed };
}

// ── GitHub push file-map ────────────────────────────────────────────────────

/**
 * Build the `updateGist` file map: every current file maps to [content, null]
 * (rename handled server-side via content), and every tracked deletion that is
 * no longer present maps to null (signals "delete this file" to the API).
 */
export function buildFileMap(
  localFiles: GistFile[],
  deletedFiles: Iterable<string>,
): Record<string, [string, string | null] | null> {
  const fileMap: Record<string, [string, string | null] | null> = {};
  for (const f of localFiles) {
    fileMap[f.filename] = [f.content, null];
  }
  for (const name of deletedFiles) {
    if (!localFiles.some((f) => f.filename === name)) {
      fileMap[name] = null;
    }
  }
  return fileMap;
}

// ── Three-way merge mapping ─────────────────────────────────────────────────

/**
 * Convert a three-way merge outcome's files back into GistFile[], carrying the
 * language hint from the matching remote file and recomputing size from content.
 */
export function mergeOutcomeToFiles(
  outcomeFiles: MergedFile[],
  remoteFiles: GistFile[],
): GistFile[] {
  return outcomeFiles.map((mf) => ({
    filename: mf.filename,
    language: remoteFiles.find((f) => f.filename === mf.filename)?.language ?? null,
    content: mf.content,
    size: mf.content.length,
    raw_url: null,
  }));
}

// ── Conflict markers ────────────────────────────────────────────────────────

/** Filenames whose content still contains an unresolved "<<<<<<<" marker. */
export function filesWithConflictMarkers(files: GistFile[]): string[] {
  return files.filter((f) => f.content.includes(CONFLICT_MARKER)).map((f) => f.filename);
}

/** True if any file still contains an unresolved conflict marker. */
export function hasConflictMarkers(files: GistFile[]): boolean {
  return files.some((f) => f.content.includes(CONFLICT_MARKER));
}

// ── Rename ──────────────────────────────────────────────────────────────────

/** True when renaming `oldName` → `newName` would collide with another file. */
export function isRenameCollision(files: GistFile[], oldName: string, newName: string): boolean {
  return files.some((f) => f.filename !== oldName && f.filename === newName);
}
