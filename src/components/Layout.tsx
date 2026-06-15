import { useCallback, useEffect, useRef, useState } from "react";
import { Toolbar } from "./Toolbar";
import { Sidebar } from "./Sidebar";
import { Editor } from "./Editor";
import { ToastContainer } from "./ToastContainer";
import { StatusBar } from "./StatusBar";
import { SettingsModal } from "./SettingsModal";
import { CommandPalette } from "./CommandPalette";
import { ImportModal } from "./ImportModal";
import { ContentSearch } from "./ContentSearch";
import { StatsPanel } from "./StatsPanel";
import { LibraryCleanup } from "./LibraryCleanup";
import { ShortcutsModal } from "./ShortcutsModal";
import { TemplatesModal } from "./TemplatesModal";
import { NewGistModal } from "./NewGistModal";
import { GraphView } from "./GraphView";
import { useGistStore } from "../store/useGistStore";
import type { Template } from "../api/tauri";
import { useKeyboard } from "../hooks/useKeyboard";
import { useAutoSync } from "../hooks/useAutoSync";
import { useThemeStore } from "../store/useThemeStore";
import { useUpdateCheck } from "../hooks/useUpdateCheck";
import { useT } from "../store/useI18nStore";
import { listen } from "@tauri-apps/api/event";
import { notify } from "../store/useNotificationStore";

const MIN_SIDEBAR = 180;
const MAX_SIDEBAR = 600;

export function Layout() {
  const t = useT();
  const {
    loadGists, sync, selectGist, setNetworkOnline,
    createGist, createLocalGist, networkOnline,
  } = useGistStore();
  const update = useUpdateCheck();
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showCleanup, setShowCleanup] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<Template | null>(null);
  const [showGraph, setShowGraph] = useState(false);
  const [importPath, setImportPath] = useState<string | null>(null);
  const [showContentSearch, setShowContentSearch] = useState(false);
  const { sidebarWidth, setSidebarWidth, zenMode } = useThemeStore();
  const dragging = useRef(false);

  useEffect(() => {
    loadGists().then(() => {
      if (useGistStore.getState().githubLogin !== "local") sync();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for gist-open requests from the quick-search window.
  useEffect(() => {
    const unlisten = listen<{ id: string }>("open-gist", (e) => {
      selectGist(e.payload.id);
    });
    return () => { unlisten.then((f) => f()); };
  }, [selectGist]);

  // Track network status; notify when coming back online with pending local drafts.
  useEffect(() => {
    const handleOnline = () => {
      setNetworkOnline(true);
      const drafts = useGistStore.getState().gists.filter((g) => g.local_only);
      if (drafts.length > 0) {
        notify(
          `Back online — ${drafts.length} local draft${drafts.length > 1 ? "s" : ""} ready to publish.`,
          "success"
        );
      }
    };
    const handleOffline = () => {
      setNetworkOnline(false);
      notify("You're offline — new gists will be saved as local drafts.", "error");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [setNetworkOnline]); // eslint-disable-line react-hooks/exhaustive-deps

  useAutoSync();

  const openPalette = useCallback(() => setShowPalette(true), []);
  useKeyboard("p", "meta", openPalette);

  const toggleContentSearch = useCallback(
    () => setShowContentSearch((v) => !v),
    []
  );
  useKeyboard("f", "meta+shift", toggleContentSearch);

  const toggleZen = useCallback(() => {
    useThemeStore.getState().setZenMode(!useThemeStore.getState().zenMode);
  }, []);
  useKeyboard("\\", "meta", toggleZen);

  const openShortcuts = useCallback(() => setShowShortcuts(true), []);
  useKeyboard("?", "meta+shift", openShortcuts);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const startX = e.clientX;
      const startW = sidebarWidth;
      const onMove = (ev: MouseEvent) => {
        const w = Math.max(MIN_SIDEBAR, Math.min(MAX_SIDEBAR, startW + ev.clientX - startX));
        setSidebarWidth(w);
      };
      const onUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [sidebarWidth, setSidebarWidth]
  );

  return (
    <div className={`layout ${zenMode ? "layout--zen" : ""}`}>
      {!zenMode && (
        <Toolbar
          onSettings={() => setShowSettings(true)}
          onPalette={() => setShowPalette(true)}
          onImport={(path) => setImportPath(path)}
          onStats={() => setShowStats(true)}
          onShortcuts={() => setShowShortcuts(true)}
          onTemplates={() => setShowTemplates(true)}
          onGraph={() => setShowGraph(true)}
          onCleanup={() => setShowCleanup(true)}
        />
      )}
      {update && !updateDismissed && (
        <div className="update-banner">
          <span>{t.common.updateAvailable(update.version)}</span>
          <div className="update-banner__actions">
            <button className="update-banner__install" onClick={update.install}>
              {t.common.installAndRestart}
            </button>
            <button
              className="update-banner__dismiss"
              onClick={() => setUpdateDismissed(true)}
              title="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}
      <div className="layout__body">
        {!zenMode && (
          <>
            <Sidebar style={{ width: sidebarWidth }} />
            <div className="layout__resize-handle" onMouseDown={handleResizeStart} />
          </>
        )}
        <main className="layout__main">
          {showContentSearch && (
            <ContentSearch onClose={() => setShowContentSearch(false)} />
          )}
          {showGraph ? (
            <GraphView
              onClose={() => setShowGraph(false)}
              onSelectGist={(id) => { setShowGraph(false); selectGist(id); }}
            />
          ) : (
            <Editor />
          )}
        </main>
      </div>
      {!zenMode && <StatusBar />}
      <ToastContainer />
      {showPalette && (
        <CommandPalette onClose={() => setShowPalette(false)} />
      )}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
      {importPath && (
        <ImportModal filePath={importPath} onClose={() => setImportPath(null)} />
      )}
      {showStats && <StatsPanel onClose={() => setShowStats(false)} />}
      {showCleanup && (
        <LibraryCleanup
          onClose={() => setShowCleanup(false)}
          onOpenGist={(id) => { setShowCleanup(false); selectGist(id); }}
        />
      )}
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
      {showTemplates && (
        <TemplatesModal
          onClose={() => setShowTemplates(false)}
          onUseTemplate={(t) => {
            setShowTemplates(false);
            setPendingTemplate(t);
          }}
        />
      )}
      {pendingTemplate && (
        <NewGistModal
          onClose={() => setPendingTemplate(null)}
          onCreate={createGist}
          onCreateLocal={createLocalGist}
          networkOnline={networkOnline}
          template={pendingTemplate}
        />
      )}
    </div>
  );
}
