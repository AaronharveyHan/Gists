import { useEffect, useState } from "react";
import { getToken, getCurrentLogin } from "./api/tauri";
import { useGistStore } from "./store/useGistStore";
import { useAuthStore } from "./store/useAuthStore";
import { Onboarding } from "./components/Onboarding";
import { Layout } from "./components/Layout";
import "./styles/global.css";

export default function App() {
  const { isAuthenticated, setAuthenticated } = useGistStore();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
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
  if (!isAuthenticated) return <Onboarding />;
  return <Layout />;
}
