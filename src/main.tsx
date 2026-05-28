import React from "react";
import ReactDOM from "react-dom/client";

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
