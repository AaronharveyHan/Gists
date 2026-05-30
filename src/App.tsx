import { useEffect, useState } from "react";
import { getToken, getCurrentLogin, getSetting } from "./api/tauri";
import { useGistStore } from "./store/useGistStore";
import { useAuthStore } from "./store/useAuthStore";
import { Onboarding } from "./components/Onboarding";
import { Layout } from "./components/Layout";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { initErrorReporting } from "./lib/errorReporting";
import "./styles/global.css";

export default function App() {
  const { isAuthenticated, setAuthenticated } = useGistStore();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Initialise optional crash reporting from persisted preference.
    getSetting("error_reporting_enabled")
      .then((v) => initErrorReporting(v === "true"))
      .catch(() => {});

    // Local mode persists across restarts — restore it immediately.
    if (useAuthStore.getState().localMode) {
      setAuthenticated("local");
      setChecking(false);
      return;
    }
    // GitHub mode: verify token is still in keychain and resolve login.
    getToken()
      .then((hasToken) => {
        if (hasToken) {
          return getCurrentLogin()
            .then((login) => { if (login.trim()) setAuthenticated(login); })
            .catch(() => {});
        }
      })
      .finally(() => setChecking(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (checking) return <div className="splash">Loading…</div>;
  return (
    <AppErrorBoundary>
      {!isAuthenticated ? <Onboarding /> : <Layout />}
    </AppErrorBoundary>
  );
}
