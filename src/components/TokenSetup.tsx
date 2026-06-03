import { useState } from "react";
import { setToken } from "../api/tauri";
import { useGistStore } from "../store/useGistStore";
import { useT } from "../store/useI18nStore";
import { open } from "@tauri-apps/plugin-shell";

export function TokenSetup() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { setAuthenticated, sync } = useGistStore();
  const t = useT();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const login = await setToken(value.trim());
      setAuthenticated(login);
      // Kick off background sync immediately after auth
      sync();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="token-setup">
      <div className="token-setup__card">
        <div className="token-setup__logo">
          <svg viewBox="0 0 16 16" width="40" height="40" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
                 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
                 -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87
                 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95
                 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82
                 .64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82
                 .44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65
                 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38
                 A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
            />
          </svg>
        </div>
        <h1>{t.tokenSetup.appName}</h1>
        <p>{t.tokenSetup.scopePre}<code>gist</code>{t.tokenSetup.scopePost}</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            placeholder="ghp_xxxxxxxxxxxx"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            disabled={loading}
          />
          <button type="submit" disabled={loading || !value.trim()}>
            {loading ? t.tokenSetup.verifying : t.tokenSetup.connect}
          </button>
        </form>
        {error && <p className="token-setup__error">{error}</p>}
        <button
          className="token-setup__link"
          onClick={() =>
            open("https://github.com/settings/tokens/new?scopes=gist")
          }
        >
          {t.tokenSetup.generateToken}
        </button>
      </div>
    </div>
  );
}
