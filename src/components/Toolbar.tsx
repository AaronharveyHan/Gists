import { useCallback, useState } from "react";
import { useGistStore } from "../store/useGistStore";
import { useKeyboard } from "../hooks/useKeyboard";
import { clearToken, exportGists } from "../api/tauri";
import { notify } from "../store/useNotificationStore";

export function Toolbar({
  onSettings, onPalette, onImport,
}: {
  onSettings: () => void; onPalette: () => void;
  onImport: (filePath: string) => void;
}) {
  const { githubLogin, logout, sync, syncStatus, syncError, lastSyncResult } =
    useGistStore();

  const doSync = useCallback(() => sync(false), [sync]);
  useKeyboard("r", "meta", doSync);

  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    const { save } = await import("@tauri-apps/api/dialog");
    const dest = await save({
      title: "Export gists",
      defaultPath: "gists-backup.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!dest) return;
    setExporting(true);
    try {
      const count = await exportGists(dest);
      notify(`Exported ${count} gist${count !== 1 ? "s" : ""}`, "success");
    } catch (e) {
      notify("Export failed: " + String(e));
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    const { open } = await import("@tauri-apps/api/dialog");
    const file = await open({
      title: "Import gists backup",
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!file || Array.isArray(file)) return;
    onImport(file);
  };

  const handleLogout = async () => {
    if (!confirm("Disconnect your GitHub account?")) return;
    await clearToken();
    logout();
  };

  const syncLabel = () => {
    if (syncStatus === "syncing") return "Syncing...";
    if (syncStatus === "error") return "Sync failed";
    if (lastSyncResult) {
      const { updated, incremental } = lastSyncResult;
      if (updated === 0) return incremental ? "Up to date" : "Sync";
      return incremental ? `+${updated} updated` : `Synced ${updated}`;
    }
    return "Sync";
  };

  return (
    <header className="toolbar">
      <span className="toolbar__title">Gists</span>
      <div className="toolbar__actions">
        {syncStatus === "error" && syncError && (
          <span className="toolbar__sync-error" title={syncError}>
            {syncError.slice(0, 40)}
          </span>
        )}
        <button
          className={`toolbar__sync ${syncStatus === "syncing" ? "toolbar__sync--active" : ""} ${syncStatus === "error" ? "toolbar__sync--error" : ""}`}
          onClick={doSync}
          disabled={syncStatus === "syncing"}
          title="Incremental sync"
        >
          {syncLabel()}
        </button>
        <button
          className="toolbar__full-sync"
          onClick={() => sync(true)}
          disabled={syncStatus === "syncing"}
          title="Full sync (re-fetch all gists)"
        >
          Full
        </button>
        <button className="toolbar__palette" onClick={onPalette} title="Quick open (⌘P)">
          Search
        </button>
        <button
          className="toolbar__export"
          onClick={handleExport}
          disabled={exporting}
          title="Export all gists to a JSON backup file"
        >
          {exporting ? "..." : "Export"}
        </button>
        <button
          className="toolbar__export"
          onClick={handleImport}
          title="Import gists from a backup file"
        >
          Import
        </button>
        <span className="toolbar__user">@{githubLogin}</span>
        <button className="toolbar__settings" onClick={onSettings} title="Settings">
          Settings
        </button>
        <button className="toolbar__logout" onClick={handleLogout}>
          Logout
        </button>
      </div>
    </header>
  );
}
