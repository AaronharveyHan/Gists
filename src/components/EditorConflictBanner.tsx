import { useT } from "../store/useI18nStore";
import type { GistFile } from "../api/tauri";

export interface ConflictState {
  remoteFiles: GistFile[];
  remoteDescription: string;
  remoteUpdatedAt: string;
  /** Files after three-way merge (may contain <<<<<<< markers). */
  mergedFiles: GistFile[];
  /** Filenames that still contain conflict markers needing manual resolution. */
  conflictedFilenames: Set<string>;
  /** How many files were auto-merged without conflicts. */
  autoMergedCount: number;
}

interface EditorConflictBannerProps {
  conflict: ConflictState;
  remainingConflictFiles: string[];
  hasRemainingMarkers: boolean;
  saving: boolean;
  onResolve: () => void;
  onDiscard: () => void;
  onJumpToFile: (filename: string) => void;
}

export function EditorConflictBanner({
  conflict,
  remainingConflictFiles,
  hasRemainingMarkers,
  saving,
  onResolve,
  onDiscard,
  onJumpToFile,
}: EditorConflictBannerProps) {
  const t = useT();
  return (
    <div className="conflict-banner">
      <div className="conflict-banner__top">
        <span className="conflict-banner__msg">
          {t.editor.mergeConflictBanner(conflict.autoMergedCount)}
        </span>
        {remainingConflictFiles.length > 0 && (
          <span className="conflict-banner__files">
            {remainingConflictFiles.map((fn) => (
              <button
                key={fn}
                className="conflict-banner__file-chip"
                onClick={() => onJumpToFile(fn)}
                title={fn}
              >
                {fn}
              </button>
            ))}
            <span className="conflict-banner__remaining">
              {t.editor.conflictsRemaining(remainingConflictFiles.length)}
            </span>
          </span>
        )}
      </div>
      <div className="conflict-banner__actions">
        <button
          className="btn btn--primary conflict-banner__btn"
          onClick={onResolve}
          disabled={saving || hasRemainingMarkers}
          title={hasRemainingMarkers ? t.editor.conflictsRemaining(remainingConflictFiles.length) : undefined}
        >
          {t.editor.conflictsResolved}
        </button>
        <button
          className="btn conflict-banner__btn"
          onClick={onDiscard}
          disabled={saving}
        >
          {t.editor.discardMine}
        </button>
      </div>
    </div>
  );
}
