import { useEffect, useRef, useState } from "react";
import { listAccounts, switchAccount, type Account } from "../api/tauri";
import { useGistStore } from "../store/useGistStore";
import { notify } from "../store/useNotificationStore";
import { useT } from "../store/useI18nStore";

export function AccountSwitcher() {
  const t = useT();
  const { githubLogin, setAuthenticated, loadGists, sync } = useGistStore();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = () =>
    listAccounts()
      .then(setAccounts)
      .catch(() => {});

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (accounts.length === 0) {
    return <span className="toolbar__user">@{githubLogin}</span>;
  }

  const active = accounts.find((a) => a.is_active) ?? accounts[0];

  const handleSwitch = async (acc: Account) => {
    setOpen(false);
    if (acc.is_active) return;
    try {
      await switchAccount(acc.id);
      setAuthenticated(acc.login ?? acc.name);
      await loadGists();
      sync(true);
      notify(t.settings.accountSwitchedTo(acc.name), "success");
    } catch (e) {
      notify(String(e), "error");
    }
  };

  return (
    <div className="acct-switcher" ref={ref}>
      <button
        className="acct-switcher__trigger"
        onClick={() => setOpen((v) => !v)}
        title={t.settings.switchTo}
      >
        {active.avatar_url && (
          <img
            className="acct-switcher__avatar"
            src={active.avatar_url}
            alt=""
          />
        )}
        <span className="acct-switcher__name">
          {active.login ? `@${active.login}` : active.name}
        </span>
        <span className="acct-switcher__chevron">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="acct-switcher__dropdown">
          {accounts.map((acc) => (
            <button
              key={acc.id}
              className={`acct-switcher__item${acc.is_active ? " acct-switcher__item--active" : ""}`}
              onClick={() => handleSwitch(acc)}
            >
              {acc.avatar_url && (
                <img
                  className="acct-switcher__item-avatar"
                  src={acc.avatar_url}
                  alt=""
                />
              )}
              <span className="acct-switcher__item-info">
                <span className="acct-switcher__item-name">{acc.name}</span>
                {acc.login && (
                  <span className="acct-switcher__item-login">@{acc.login}</span>
                )}
              </span>
              {acc.is_active && (
                <span className="acct-switcher__item-badge">
                  {t.settings.activeAccount}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
