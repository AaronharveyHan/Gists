/**
 * Configure Monaco Editor to use Vite-bundled local workers.
 *
 * Without this, @monaco-editor/react spawns workers from blob URLs derived
 * from the CDN or from cross-origin scripts that WebView2's tracking
 * prevention blocks when they attempt storage access.  Bundling the workers
 * locally via Vite's ?worker syntax keeps everything same-origin and avoids
 * all "Tracking Prevention blocked access to storage" warnings.
 *
 * Must be imported before any Monaco / @monaco-editor/react code runs.
 */
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

(self as Window & typeof globalThis).MonacoEnvironment = {
  getWorker(_: string, label: string): Worker {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

// Tell @monaco-editor/react to use the locally-installed monaco-editor
// package rather than fetching it from the CDN at runtime.
loader.config({ monaco });
