import { useEffect, useState } from "react";
import { getToken, getCurrentLogin } from "./api/tauri";
import { useGistStore } from "./store/useGistStore";
import { TokenSetup } from "./components/TokenSetup";
import { Layout } from "./components/Layout";
import "./styles/global.css";

export default function App() {
  const { isAuthenticated, setAuthenticated } = useGistStore();
  const [checking, setChecking] = useState(true);

  // On startup: check if a token is already saved in the DB, then resolve login.
  // get_current_login: reads cached gh_login from DB; if absent, calls GitHub
  // API once and caches it — handles tokens saved before gh_login caching.
  useEffect(() => {
    getToken()
      .then((hasToken) => {
        if (hasToken) {
          return getCurrentLogin()
            .then((login) => { if (login.trim()) setAuthenticated(login); })
            .catch(() => { /* token exists but login fetch failed — stay on TokenSetup */ });
        }
      })
      .finally(() => setChecking(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (checking) return <div className="splash">Loading…</div>;
  if (!isAuthenticated) return <TokenSetup />;
  return <Layout />;
}
