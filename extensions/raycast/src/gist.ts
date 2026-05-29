/**
 * Thin wrapper around the `gist` CLI binary.
 * Everything goes through the CLI so Raycast reads the exact same local
 * SQLite database as the desktop app.
 */
import { execFile } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { getPreferenceValues } from "@raycast/api";

export interface Gist {
  id: string;
  description: string;
  public: boolean;
  local: boolean;
  url: string;
  files: string[];
  language: string | null;
}

interface Prefs {
  gistPath?: string;
}

/** Resolve the gist binary: user preference first, then common install dirs. */
function resolveBin(): string {
  const { gistPath } = getPreferenceValues<Prefs>();
  const candidates = [
    gistPath,
    "/opt/homebrew/bin/gist",
    "/usr/local/bin/gist",
    `${homedir()}/.cargo/bin/gist`,
  ].filter((c): c is string => !!c);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Last resort: rely on PATH.
  return gistPath || "gist";
}

/** Run the CLI, optionally piping `input` to stdin, and resolve with stdout. */
function run(args: string[], input?: string): Promise<string> {
  const bin = resolveBin();
  return new Promise((resolve, reject) => {
    const child = execFile(
      bin,
      args,
      { maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr?.trim() || err.message));
        else resolve(stdout);
      },
    );
    if (input !== undefined && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

/** Empty query → recent list; otherwise full-text search. */
export async function searchGists(query: string): Promise<Gist[]> {
  const args = query.trim()
    ? ["search", query, "--json"]
    : ["list", "--json", "-n", "50"];
  const out = await run(args);
  return JSON.parse(out || "[]") as Gist[];
}

export async function viewGist(id: string): Promise<string> {
  return run(["view", id]);
}

export async function openGist(id: string): Promise<void> {
  await run(["open", id]);
}

export async function createGistFromText(
  text: string,
  name: string,
  isPublic: boolean,
): Promise<{ id: string; url: string; local: boolean }> {
  const args = ["save", "-", "--name", name, "--json"];
  if (isPublic) args.push("--public");
  const out = await run(args, text);
  return JSON.parse(out || "{}");
}
