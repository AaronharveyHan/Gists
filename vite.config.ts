import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  optimizeDeps: {
    // Monaco ships its own ESM workers; exclude from pre-bundling.
    // monaco-vim is UMD and uses require('monaco-editor') internally —
    // also exclude so Vite doesn't wrap it with a CJS shim that breaks require.
    exclude: ["monaco-editor", "monaco-vim"],
    // Dependency pre-bundling is a SEPARATE esbuild pass from the source
    // transform below, with its own (default 'modules') target. esbuild 0.28+
    // hard-errors trying to lower destructuring for it (mermaid/katex use it
    // heavily), so apply the same override here.
    esbuildOptions: {
      supported: { destructuring: true },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  // Set VITE_SENTRY_DSN at build time to enable frontend error reporting.
  // Example: VITE_SENTRY_DSN="https://<key>@<org>.ingest.sentry.io/<project>" npm run tauri build
  // Leave unset (default) to disable Sentry entirely — no SDK code is bundled.
  // Also set SENTRY_DSN for the Rust backend crash reporter.
  envPrefix: ["VITE_", "TAURI_"],
  // esbuild 0.28+ errors when it thinks a target needs destructuring lowering
  // (it can't fully lower `for (const [a,b] of x)`). All our real webview
  // targets support destructuring natively, so tell esbuild not to transform it.
  esbuild: {
    supported: { destructuring: true },
  },
  build: {
    target: ["es2021", "chrome105", "safari13"],
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
