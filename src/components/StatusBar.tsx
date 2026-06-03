import { useSelectedGist } from "../store/useGistStore";
import { useGistStore } from "../store/useGistStore";
import { useEditorUIStore } from "../store/useEditorUIStore";
import { useThemeStore } from "../store/useThemeStore";
import { useT } from "../store/useI18nStore";

function detectLanguageLabel(filename: string | null, plainText: string): string {
  if (!filename) return plainText;
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
  return map[ext] ?? plainText;
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
  const t = useT();

  const { activeFilename } = useEditorUIStore();
  const activeFileObj = gist?.files.find((f) => f.filename === activeFilename) ?? gist?.files[0];
  const totalSize = gist?.files.reduce((sum, f) => sum + f.size, 0) ?? 0;

  return (
    <footer className="statusbar">
      <div className="statusbar__left">
        {gist && (
          <>
            <span className="statusbar__item" title={t.statusbar.language}>
              {detectLanguageLabel(activeFilename, t.statusbar.plainText)}
            </span>
            <span className="statusbar__sep" />
            <span className="statusbar__item">UTF-8</span>
            <span className="statusbar__sep" />
            <span className="statusbar__item">LF</span>
            {activeFileObj && (
              <>
                <span className="statusbar__sep" />
                <span className="statusbar__item" title={t.statusbar.fileSize}>
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
              {t.statusbar.lineCol(cursorLine, cursorColumn)}
            </span>
            {selectedChars > 0 && (
              <>
                <span className="statusbar__sep" />
                <span className="statusbar__item statusbar__item--accent">
                  {t.statusbar.selectedChars(selectedChars, selectedLines)}
                </span>
              </>
            )}
            <span className="statusbar__sep" />
            <span className="statusbar__item">
              {t.statusbar.filesCount(gist.files.length, totalSize > 0 ? formatBytes(totalSize) : "")}
            </span>
            <span className="statusbar__sep" />
            <span
              className={`statusbar__item ${gist.public ? "" : "statusbar__item--muted"}`}
              title={gist.public ? t.statusbar.publicGist : t.statusbar.secretGist}
            >
              {gist.public ? t.statusbar.public : t.statusbar.secret}
            </span>
          </>
        )}
        <span className="statusbar__sep" />
        <span className="statusbar__item" title={t.statusbar.fontSize}>
          {editorFontSize}px
        </span>
        <span className="statusbar__sep" />
        <span
          className={`statusbar__item ${syncStatus === "syncing" ? "statusbar__item--accent" : ""} ${syncStatus === "error" ? "statusbar__item--error" : ""}`}
        >
          {syncStatus === "syncing"
            ? t.statusbar.syncing
            : syncStatus === "error"
              ? t.statusbar.syncError
              : t.statusbar.gistsCount(gists.length)}
        </span>
      </div>
    </footer>
  );
}
