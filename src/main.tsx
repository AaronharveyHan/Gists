import React from "react";
import ReactDOM from "react-dom/client";

// E2E test bridge — activated when localStorage.__e2e__ === '1'.
//
// WebDriver's browser.execute() runs in an isolated JS world that shares Web
// APIs (localStorage, document) but cannot see custom window globals set by
// page scripts, including __TAURI_INTERNALS__.  This bridge runs in the main
// world where __TAURI_INTERNALS__ IS accessible.
//
// @tauri-apps/api/core uses window.__TAURI_INTERNALS__.invoke() directly.
// Some versions / tauri-service also expose it under .core.invoke — try both.
//
// Protocol:
//   test  → localStorage.__e2e_req_<id> = JSON { cmd, args }
//   bridge reads req, removes it, calls __TAURI_INTERNALS__.invoke(cmd, args)
//   bridge → localStorage.__e2e_res_<id> = JSON { ok } | JSON { err }
//   test  polls __e2e_res_<id>, reads result, removes it
if (typeof localStorage !== "undefined" && localStorage.getItem("__e2e__") === "1") {
  setInterval(async () => {
    const w = window as any;
    // Try .invoke (current @tauri-apps/api path) then .core.invoke (older/service path)
    const inv: ((cmd: string, args: unknown) => Promise<unknown>) | undefined =
      w.__TAURI_INTERNALS__?.invoke ?? w.__TAURI_INTERNALS__?.core?.invoke;
    if (!inv) return; // not ready yet — retry next tick

    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("__e2e_req_")) keys.push(k);
    }
    for (const reqKey of keys) {
      const raw = localStorage.getItem(reqKey);
      if (!raw) continue;
      localStorage.removeItem(reqKey);
      const id = reqKey.slice("__e2e_req_".length);
      try {
        const { cmd, args } = JSON.parse(raw) as { cmd: string; args: unknown };
        const result = await inv(cmd, args);
        localStorage.setItem(`__e2e_res_${id}`, JSON.stringify({ ok: result }));
      } catch (err) {
        localStorage.setItem(`__e2e_res_${id}`, JSON.stringify({ err: String(err) }));
      }
    }
  }, 50);
}

const isQuickSearch =
  new URLSearchParams(window.location.search).get("window") === "quick-search";

if (isQuickSearch) {
  import("./styles/quick-search.css");
  import("./components/QuickSearch").then(({ QuickSearch }) => {
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <QuickSearch />
      </React.StrictMode>
    );
  });
} else {
  // Monaco worker setup must run before any Monaco import.
  import("./monacoSetup").then(() =>
    import("./App").then(({ default: App }) => {
      ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
        <React.StrictMode>
          <App />
        </React.StrictMode>
      );
    })
  );
}
