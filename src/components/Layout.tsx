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
import { useGistStore } from "../store/useGistStore";
import { useKeyboard } from "../hooks/useKeyboard";
import { useAutoSync } from "../hooks/useAutoSync";
import { useThemeStore } from "../store/useThemeStore";

const MIN_SIDEBAR = 180;
const MAX_SIDEBAR = 600;

export function Layout() {
  const { loadGists, sync } = useGistStore();
  const [showSettings, setShowSettings] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [importPath, setImportPath] = useState<string | null>(null);
  const [showContentSearch, setShowContentSearch] = useState(false);
  const { sidebarWidth, setSidebarWidth, zenMode } = useThemeStore();
  const dragging = useRef(false);

  useEffect(() => {
    loadGists().then(() => sync());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        />
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
          <Editor />
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
    </div>
  );
}
