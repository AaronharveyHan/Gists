/**
 * Shared unified-diff renderer + parser.
 *
 * Extracted verbatim from DiffModal.tsx / RevisionBrowser.tsx, which carried
 * identical copies of this logic. Both now import from here. The parser is the
 * most logic-dense, regression-prone code in the diff views, so it lives in its
 * own module with exhaustive unit tests (diffParse.test.ts).
 *
 * Input format: the `similar` Rust crate's unified diff — "--- a/…" / "+++ b/…"
 * file headers (NOT git's "diff --git a/… b/…" header), "@@ … @@" hunks, and
 * +/-/space line prefixes.
 */
import { useT } from "../store/useI18nStore";

export type DiffLineKind = "hunk" | "add" | "remove" | "context" | "meta";

export interface ParsedDiffLine {
  oldNum: number | null;
  newNum: number | null;
  kind: DiffLineKind;
  text: string;
}

export interface ParsedDiffFile {
  path: string;
  lines: ParsedDiffLine[];
}

export function parseUnifiedDiff(diff: string): ParsedDiffFile[] {
  const rawLines = diff.split(/\r?\n/);
  const files: ParsedDiffFile[] = [];
  let file: ParsedDiffFile | null = null;
  let i = 0;

  while (i < rawLines.length) {
    const raw = rawLines[i];

    // File boundary: "--- a/path" (or "--- /dev/null" for new files)
    if (raw.startsWith("--- ")) {
      const next = rawLines[i + 1] ?? "";
      let path: string;
      if (next.startsWith("+++ b/")) {
        path = next.slice("+++ b/".length);
        i += 2; // consume both --- and +++ lines
      } else if (next.startsWith("+++ /dev/null")) {
        path = raw.startsWith("--- a/") ? raw.slice("--- a/".length) : raw.slice(4);
        i += 2;
      } else {
        path = raw.startsWith("--- a/") ? raw.slice("--- a/".length) : raw.slice(4);
        i += 1;
      }
      file = { path, lines: [] };
      files.push(file);
      continue;
    }

    if (!file) { i++; continue; }

    if (raw.startsWith("+++ ")) { i++; continue; } // already consumed in --- branch

    if (raw.startsWith("@@")) {
      file.lines.push({ oldNum: null, newNum: null, kind: "hunk", text: raw });
      i++; continue;
    }

    const c = raw[0] ?? " ";
    const rest = raw.slice(1);
    if (c === "+") {
      file.lines.push({ oldNum: null, newNum: 0, kind: "add", text: rest });
    } else if (c === "-") {
      file.lines.push({ oldNum: 0, newNum: null, kind: "remove", text: rest });
    } else if (c === " ") {
      file.lines.push({ oldNum: 0, newNum: 0, kind: "context", text: rest });
    } else {
      file.lines.push({ oldNum: null, newNum: null, kind: "meta", text: raw });
    }
    i++;
  }

  // Assign actual line numbers from hunk headers.
  for (const f of files) {
    let oldLine = 0;
    let newLine = 0;
    for (const row of f.lines) {
      if (row.kind === "hunk") {
        const m = row.text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (m) { oldLine = parseInt(m[1], 10); newLine = parseInt(m[2], 10); }
        continue;
      }
      if (row.kind === "context") { row.oldNum = oldLine++; row.newNum = newLine++; }
      else if (row.kind === "remove") { row.oldNum = oldLine++; }
      else if (row.kind === "add") { row.newNum = newLine++; }
    }
  }

  return files;
}

export function lineClass(kind: DiffLineKind): string {
  if (kind === "add") return "diff-line diff-line--add";
  if (kind === "remove") return "diff-line diff-line--remove";
  if (kind === "context") return "diff-line diff-line--ctx";
  if (kind === "hunk") return "diff-line diff-line--hunk";
  return "diff-line diff-line--meta";
}

export function DiffTable({ diff }: { diff: string }) {
  const t = useT();
  const trimmed = diff.trim();
  if (!trimmed) return <p className="modal__muted">{t.diff.noChanges}</p>;

  const files = parseUnifiedDiff(diff);
  if (files.length === 0) {
    return <pre className="git-diff-pre git-diff-pre--raw">{diff}</pre>;
  }

  return (
    <div className="diff-table-wrap">
      {files.map((f) => (
        <div key={f.path} className="diff-file">
          <div className="diff-file__header">{f.path}</div>
          <table className="diff-table">
            <thead>
              <tr>
                <th className="diff-table__col-old">{t.diff.colOld}</th>
                <th className="diff-table__col-new">{t.diff.colNew}</th>
                <th className="diff-table__col-code">{t.diff.colChange}</th>
              </tr>
            </thead>
            <tbody>
              {f.lines.map((row, i) => (
                <tr key={i} className={lineClass(row.kind)}>
                  <td className="diff-table__num">
                    {row.oldNum != null && row.oldNum > 0 ? row.oldNum : ""}
                  </td>
                  <td className="diff-table__num">
                    {row.newNum != null && row.newNum > 0 ? row.newNum : ""}
                  </td>
                  <td className="diff-table__code">
                    {row.kind === "hunk" ? (
                      <code className="diff-table__hunk">{row.text}</code>
                    ) : row.kind === "meta" ? (
                      <span className="diff-table__meta">{row.text}</span>
                    ) : (
                      <span className="diff-table__text">{row.text}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
