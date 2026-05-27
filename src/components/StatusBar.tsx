import { useSelectedGist } from "../store/useGistStore";
import { useGistStore } from "../store/useGistStore";
import { useEditorUIStore } from "../store/useEditorUIStore";
import { useThemeStore } from "../store/useThemeStore";

function detectLanguageLabel(filename: string | null): string {
  if (!filename) return "Plain Text";
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "TypeScript", tsx: "TypeScript (JSX)",
    js: "JavaScript", jsx: "JavaScript (JSX)",
    py: "Python", rb: "Ruby", rs: "Rust",
    go: "Go", java: "Java", cs: "C#",
    cpp: "C++", c: "C", h: "C Header",
    html: "HTML", css: "CSS", scss: "SCSS",
    json: "JSON", yaml: "YAML", yml: "YAML",
    toml: "TOML", md: "Markdown", sh: "Shell",
    sql: "SQL", xml: "XML", php: "PHP",
    swift: "Swift", kt: "Kotlin", r: "R",
  };
  return map[ext] ?? "Plain Text";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function StatusBar() {
  const gist = useSelectedGist();
  const { syncStatus, gists } = useGistStore();
  const { cursorLine, cursorColumn, selectedChars, selectedLines } =
    useEditorUIStore();
  const { editorFontSize } = useThemeStore();

  const { activeFilename } = useEditorUIStore();
  const activeFileObj = gist?.files.find((f) => f.filename === activeFilename) ?? gist?.files[0];
  const totalSize = gist?.files.reduce((sum, f) => sum + f.size, 0) ?? 0;

  return (
    <footer className="statusbar">
      <div className="statusbar__left">
        {gist && (
          <>
            <span className="statusbar__item" title="Language">
              {detectLanguageLabel(activeFilename)}
            </span>
            <span className="statusbar__sep" />
            <span className="statusbar__item">UTF-8</span>
            <span className="statusbar__sep" />
            <span className="statusbar__item">LF</span>
            {activeFileObj && (
              <>
                <span className="statusbar__sep" />
                <span className="statusbar__item" title="File size">
                  {formatBytes(activeFileObj.size)}
                </span>
              </>
            )}
          </>
        )}
      </div>
      <div className="statusbar__right">
        {gist && (
          <>
            <span className="statusbar__item">
              Ln {cursorLine}, Col {cursorColumn}
            </span>
            {selectedChars > 0 && (
              <>
                <span className="statusbar__sep" />
                <span className="statusbar__item statusbar__item--accent">
                  {selectedChars} selected
                  {selectedLines > 1 && ` (${selectedLines} lines)`}
                </span>
              </>
            )}
            <span className="statusbar__sep" />
            <span className="statusbar__item">
              {gist.files.length} file{gist.files.length !== 1 ? "s" : ""}
              {totalSize > 0 && ` (${formatBytes(totalSize)})`}
            </span>
            <span className="statusbar__sep" />
            <span
              className={`statusbar__item ${gist.public ? "" : "statusbar__item--muted"}`}
              title={gist.public ? "Public gist" : "Secret gist"}
            >
              {gist.public ? "Public" : "Secret"}
            </span>
          </>
        )}
        <span className="statusbar__sep" />
        <span className="statusbar__item" title="Font size">
          {editorFontSize}px
        </span>
        <span className="statusbar__sep" />
        <span
          className={`statusbar__item ${syncStatus === "syncing" ? "statusbar__item--accent" : ""} ${syncStatus === "error" ? "statusbar__item--error" : ""}`}
        >
          {syncStatus === "syncing"
            ? "Syncing..."
            : syncStatus === "error"
              ? "Sync error"
              : `${gists.length} gists`}
        </span>
      </div>
    </footer>
  );
}
