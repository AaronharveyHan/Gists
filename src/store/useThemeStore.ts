import { create } from "zustand";
import { persist } from "zustand/middleware";

const CSS_VARS = [
  "--bg-0", "--bg-1", "--bg-2", "--bg-3",
  "--border",
  "--text-0", "--text-1", "--text-2",
  "--accent", "--accent-hover",
  "--danger", "--success",
] as const;

type CssVarName = typeof CSS_VARS[number];

export interface ThemeVars extends Record<CssVarName, string> {
  monacoTheme: "vs-dark" | "vs";
}

export interface ThemePresetDef {
  name: string;
  /** null = "System": clear overrides and respect OS preference */
  vars: ThemeVars | null;
}

export const PRESETS: Record<string, ThemePresetDef> = {
  system: { name: "System", vars: null },
  "github-dark": {
    name: "GitHub Dark",
    vars: {
      "--bg-0": "#0d1117", "--bg-1": "#161b22", "--bg-2": "#21262d", "--bg-3": "#30363d",
      "--border": "#30363d",
      "--text-0": "#e6edf3", "--text-1": "#8b949e", "--text-2": "#6e7681",
      "--accent": "#58a6ff", "--accent-hover": "#79c0ff",
      "--danger": "#f85149", "--success": "#3fb950",
      monacoTheme: "vs-dark",
    },
  },
  "github-light": {
    name: "GitHub Light",
    vars: {
      "--bg-0": "#ffffff", "--bg-1": "#f6f8fa", "--bg-2": "#eaeef2", "--bg-3": "#d0d7de",
      "--border": "#d0d7de",
      "--text-0": "#1f2328", "--text-1": "#656d76", "--text-2": "#9198a1",
      "--accent": "#0969da", "--accent-hover": "#218bff",
      "--danger": "#d1242f", "--success": "#1a7f37",
      monacoTheme: "vs",
    },
  },
  "tokyo-night": {
    name: "Tokyo Night",
    vars: {
      "--bg-0": "#1a1b26", "--bg-1": "#16161e", "--bg-2": "#1f2335", "--bg-3": "#292e42",
      "--border": "#3b4261",
      "--text-0": "#c0caf5", "--text-1": "#787c99", "--text-2": "#565f89",
      "--accent": "#7aa2f7", "--accent-hover": "#89b4fa",
      "--danger": "#f7768e", "--success": "#9ece6a",
      monacoTheme: "vs-dark",
    },
  },
  nord: {
    name: "Nord",
    vars: {
      "--bg-0": "#2e3440", "--bg-1": "#3b4252", "--bg-2": "#434c5e", "--bg-3": "#4c566a",
      "--border": "#4c566a",
      "--text-0": "#eceff4", "--text-1": "#d8dee9", "--text-2": "#adb5c7",
      "--accent": "#88c0d0", "--accent-hover": "#8fbcbb",
      "--danger": "#bf616a", "--success": "#a3be8c",
      monacoTheme: "vs-dark",
    },
  },
  dracula: {
    name: "Dracula",
    vars: {
      "--bg-0": "#282a36", "--bg-1": "#21222c", "--bg-2": "#343746", "--bg-3": "#44475a",
      "--border": "#44475a",
      "--text-0": "#f8f8f2", "--text-1": "#bd93f9", "--text-2": "#6272a4",
      "--accent": "#bd93f9", "--accent-hover": "#d6acff",
      "--danger": "#ff5555", "--success": "#50fa7b",
      monacoTheme: "vs-dark",
    },
  },
  "one-dark": {
    name: "One Dark",
    vars: {
      "--bg-0": "#282c34", "--bg-1": "#21252b", "--bg-2": "#2c313c", "--bg-3": "#3e4451",
      "--border": "#3e4451",
      "--text-0": "#abb2bf", "--text-1": "#828997", "--text-2": "#5c6370",
      "--accent": "#61afef", "--accent-hover": "#7dbfff",
      "--danger": "#e06c75", "--success": "#98c379",
      monacoTheme: "vs-dark",
    },
  },
  monokai: {
    name: "Monokai",
    vars: {
      "--bg-0": "#272822", "--bg-1": "#1e1f1c", "--bg-2": "#3e3d32", "--bg-3": "#49483e",
      "--border": "#49483e",
      "--text-0": "#f8f8f2", "--text-1": "#a59f85", "--text-2": "#75715e",
      "--accent": "#66d9e8", "--accent-hover": "#a1efe4",
      "--danger": "#f92672", "--success": "#a6e22e",
      monacoTheme: "vs-dark",
    },
  },
  "solarized-dark": {
    name: "Solarized",
    vars: {
      "--bg-0": "#002b36", "--bg-1": "#073642", "--bg-2": "#094652", "--bg-3": "#0a5060",
      "--border": "#1d5665",
      "--text-0": "#fdf6e3", "--text-1": "#93a1a1", "--text-2": "#657b83",
      "--accent": "#268bd2", "--accent-hover": "#4ba3e3",
      "--danger": "#dc322f", "--success": "#859900",
      monacoTheme: "vs-dark",
    },
  },
};

// ── Apply / clear helpers ─────────────────────────────────────────────────────

function applyVars(vars: ThemeVars) {
  const root = document.documentElement;
  for (const key of CSS_VARS) {
    root.style.setProperty(key, vars[key]);
  }
  root.dataset.themeType = vars.monacoTheme === "vs" ? "light" : "dark";
}

function clearVars() {
  const root = document.documentElement;
  for (const key of CSS_VARS) {
    root.style.removeProperty(key);
  }
  delete root.dataset.themeType;
}

export function applyTheme(presetId: string, accentOverride: string | null) {
  const preset = PRESETS[presetId];
  if (!preset?.vars) { clearVars(); return; }
  const vars = accentOverride
    ? { ...preset.vars, "--accent": accentOverride, "--accent-hover": accentOverride }
    : preset.vars;
  applyVars(vars);
}

export function resolveMonacoTheme(presetId: string): "vs-dark" | "vs" {
  const preset = PRESETS[presetId];
  return preset?.vars?.monacoTheme ??
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "vs-dark" : "vs");
}

// ── Store ─────────────────────────────────────────────────────────────────────

export type SortOrder = "updated" | "created" | "name" | "files";

interface ThemeState {
  presetId: string;
  accentOverride: string | null;
  editorFontSize: number;
  autoSyncMinutes: number;
  sidebarWidth: number;
  zenMode: boolean;
  vimMode: boolean;
  tabCompletion: boolean;
  sortOrder: SortOrder;
  setPreset: (id: string) => void;
  setAccentOverride: (color: string | null) => void;
  setEditorFontSize: (size: number) => void;
  setAutoSyncMinutes: (n: number) => void;
  setSidebarWidth: (w: number) => void;
  setZenMode: (on: boolean) => void;
  setVimMode: (on: boolean) => void;
  setTabCompletion: (on: boolean) => void;
  setSortOrder: (order: SortOrder) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      presetId: "system",
      accentOverride: null,
      editorFontSize: 14,
      autoSyncMinutes: 0,
      sidebarWidth: 260,
      zenMode: false,
      vimMode: false,
      tabCompletion: true,
      sortOrder: "updated",

      setPreset: (id) => {
        applyTheme(id, null);
        set({ presetId: id, accentOverride: null });
      },

      setAccentOverride: (color) => {
        set((s) => {
          applyTheme(s.presetId, color);
          return { accentOverride: color };
        });
      },

      setEditorFontSize: (size) => set({ editorFontSize: size }),
      setAutoSyncMinutes: (n) => set({ autoSyncMinutes: n }),
      setSidebarWidth: (w) => set({ sidebarWidth: w }),
      setZenMode: (on) => set({ zenMode: on }),
      setVimMode: (on) => set({ vimMode: on }),
      setTabCompletion: (on) => set({ tabCompletion: on }),
      setSortOrder: (order) => set({ sortOrder: order }),
    }),
    {
      name: "gist-theme",
      partialize: (s) => ({
        presetId: s.presetId,
        accentOverride: s.accentOverride,
        editorFontSize: s.editorFontSize,
        autoSyncMinutes: s.autoSyncMinutes,
        sidebarWidth: s.sidebarWidth,
        vimMode: s.vimMode,
        tabCompletion: s.tabCompletion,
        sortOrder: s.sortOrder,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.presetId, state.accentOverride);
      },
    }
  )
);
