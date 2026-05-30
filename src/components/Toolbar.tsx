import { useCallback, useState } from "react";
import { useGistStore } from "../store/useGistStore";
import { useAuthStore } from "../store/useAuthStore";
import { useKeyboard } from "../hooks/useKeyboard";
import { clearToken, exportGists } from "../api/tauri";
import { notify } from "../store/useNotificationStore";
import { useT } from "../store/useI18nStore";
import { AccountSwitcher } from "./AccountSwitcher";

export function Toolbar({
  onSettings, onPalette, onImport, onStats, onShortcuts, onTemplates, onGraph, onCleanup,
}: {
  onSettings: () => void; onPalette: () => void;
  onImport: (filePath: string) => void; onStats: () => void;
  onShortcuts: () => void; onTemplates: () => void; onGraph: () => void;
  onCleanup: () => void;
}) {
  const t = useT();
  const { githubLogin, logout, sync, syncStatus, syncError, lastSyncResult } =
    useGistStore();

  const isLocalMode = githubLogin === "local";

  const doSync = useCallback(() => sync(false), [sync]);
  useKeyboard("r", "meta", isLocalMode ? () => {} : doSync);

  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const dest = await save({
      title: t.toolbar.exportDialogTitle,
      defaultPath: "gists-backup.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!dest) return;
    setExporting(true);
    try {
      const count = await exportGists(dest);
      notify(t.toolbar.exportSuccess(count), "success");
    } catch (e) {
      notify(t.toolbar.exportFailed + " " + String(e));
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const file = await open({
      title: t.toolbar.importDialogTitle,
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!file || Array.isArray(file)) return;
    onImport(file);
  };

  const handleLogout = async () => {
    if (!confirm(t.toolbar.disconnectConfirm)) return;
    await clearToken();
    logout();
  };

  const handleConnectGitHub = () => {
    useAuthStore.getState().setLocalMode(false);
    logout();
    // isAuthenticated becomes false → App renders <Onboarding />
  };

  const syncLabel = () => {
    if (syncStatus === "syncing") return t.toolbar.syncing;
    if (syncStatus === "error") return t.toolbar.syncFailed;
    if (lastSyncResult) {
      const { updated, incremental } = lastSyncResult;
      if (updated === 0) return incremental ? t.toolbar.upToDate : t.toolbar.sync;
      return incremental ? t.toolbar.incrementalUpdated(updated) : t.toolbar.synced(updated);
    }
    return t.toolbar.sync;
  };

  return (
    <header className="toolbar">
      <span className="toolbar__title">{t.toolbar.title}</span>
      <div className="toolbar__actions">
        {!isLocalMode && syncStatus === "error" && syncError && (
          <span className="toolbar__sync-error" title={syncError}>
            {syncError.slice(0, 40)}
          </span>
        )}
        {!isLocalMode && (
          <>
            <button
              className={`toolbar__sync ${syncStatus === "syncing" ? "toolbar__sync--active" : ""} ${syncStatus === "error" ? "toolbar__sync--error" : ""}`}
              onClick={doSync}
              disabled={syncStatus === "syncing"}
              title={t.toolbar.incrementalTitle}
            >
              {syncLabel()}
            </button>
            <button
              className="toolbar__full-sync"
              onClick={() => sync(true)}
              disabled={syncStatus === "syncing"}
              title={t.toolbar.fullTitle}
            >
              {t.toolbar.full}
            </button>
          </>
        )}
        <button className="toolbar__palette" onClick={onPalette} title={t.toolbar.searchTitle}>
          {t.toolbar.search}
        </button>
        <button
          className="toolbar__export"
          onClick={handleExport}
          disabled={exporting}
          title={t.toolbar.exportTitle}
        >
          {exporting ? "…" : t.toolbar.export}
        </button>
        <button
          className="toolbar__export"
          onClick={handleImport}
          title={t.toolbar.importTitle}
        >
          {t.toolbar.import}
        </button>
        <button className="toolbar__export" onClick={onStats} title={t.toolbar.statsTitle}>
          {t.toolbar.stats}
        </button>
        <button className="toolbar__export" onClick={onTemplates} title={t.toolbar.templatesTitle}>
          {t.toolbar.templates}
        </button>
        <button className="toolbar__export" onClick={onGraph} title={t.toolbar.graphTitle}>
          {t.toolbar.graph}
        </button>
        <button className="toolbar__export" onClick={onCleanup} title={t.toolbar.cleanupTitle}>
          {t.toolbar.cleanup}
        </button>
        {isLocalMode ? (
          <span className="toolbar__user toolbar__user--local" title={t.toolbar.localModeTitle}>
            {t.toolbar.localMode}
          </span>
        ) : (
          <AccountSwitcher />
        )}
        <button className="toolbar__export" onClick={onShortcuts} title={t.toolbar.shortcutsTitle}>
          ?
        </button>
        <button className="toolbar__settings" data-testid="settings-btn" onClick={onSettings} title={t.toolbar.settings}>
          {t.toolbar.settings}
        </button>
        {isLocalMode ? (
          <button className="toolbar__logout" onClick={handleConnectGitHub}>
            {t.toolbar.connectGitHub}
          </button>
        ) : (
          <button className="toolbar__logout" onClick={handleLogout}>
            {t.toolbar.logout}
          </button>
        )}
      </div>
    </header>
  );
}
