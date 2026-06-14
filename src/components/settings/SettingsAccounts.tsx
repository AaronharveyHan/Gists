import { useEffect, useState } from "react";
import { useT } from "../../store/useI18nStore";
import { listAccounts, addAccount, removeAccount, switchAccount, type Account } from "../../api/tauri";
import { notify } from "../../store/useNotificationStore";

/**
 * Multi-account management: list accounts, switch the active one, add a new
 * account (name + token), and remove non-active accounts. Self-contained —
 * owns its own state and persistence.
 */
export function SettingsAccounts() {
  const t = useT();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [addingAccount, setAddingAccount] = useState(false);
  const [newAcctName, setNewAcctName] = useState("");
  const [newAcctToken, setNewAcctToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [acctSaving, setAcctSaving] = useState(false);

  const loadAccounts = () =>
    listAccounts()
      .then(setAccounts)
      .catch((e) => {
        console.error("[settings] load accounts failed:", e);
        notify(t.settings.loadAccountsError, "error");
      });

  useEffect(() => { loadAccounts(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddAccount = async () => {
    setAcctSaving(true);
    try {
      await addAccount(newAcctName.trim(), newAcctToken.trim());
      notify(t.settings.addAccountSuccess(newAcctName.trim()), "success");
      setNewAcctName("");
      setNewAcctToken("");
      setAddingAccount(false);
      await loadAccounts();
    } catch (e) {
      notify(t.settings.addAccountError + " " + String(e), "error");
    } finally {
      setAcctSaving(false);
    }
  };

  const handleRemoveAccount = async (id: number) => {
    if (accounts.length <= 1) {
      notify(t.settings.lastAccountWarning, "error");
      return;
    }
    if (!confirm(t.settings.removeAccountConfirm)) return;
    try {
      await removeAccount(id);
      await loadAccounts();
    } catch (e) {
      notify(String(e), "error");
    }
  };

  return (
    <section className="settings-section">
      <div className="settings-section__title">{t.settings.accountsSection}</div>

      {accounts.length === 0 && (
        <p className="settings-hint">{t.settings.noAccounts}</p>
      )}

      {accounts.map((acc) => (
        <div key={acc.id} className={`acct-row${acc.is_active ? " acct-row--active" : ""}`}>
          {acc.avatar_url && (
            <img className="acct-row__avatar" src={acc.avatar_url} alt="" />
          )}
          <span className="acct-row__info">
            <span className="acct-row__name">{acc.name}</span>
            {acc.login && (
              <span className="acct-row__login">@{acc.login}</span>
            )}
          </span>
          {acc.is_active && (
            <span className="acct-row__badge">{t.settings.activeAccount}</span>
          )}
          {!acc.is_active && (
            <button
              type="button"
              className="btn"
              onClick={async () => {
                try {
                  await switchAccount(acc.id);
                  await loadAccounts();
                  notify(t.settings.accountSwitchedTo(acc.name), "success");
                } catch (e) { notify(String(e), "error"); }
              }}
            >
              {t.settings.switchTo}
            </button>
          )}
          {accounts.length > 1 && (
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => handleRemoveAccount(acc.id)}
              title={t.settings.removeAccount}
            >
              ✕
            </button>
          )}
        </div>
      ))}

      {addingAccount ? (
        <div className="acct-add-form">
          <input
            type="text"
            className="input"
            placeholder={t.settings.accountName}
            value={newAcctName}
            onChange={(e) => setNewAcctName(e.target.value)}
          />
          <div className="acct-add-form__token-row">
            <input
              type={showToken ? "text" : "password"}
              className="input"
              placeholder={t.settings.tokenLabel}
              value={newAcctToken}
              onChange={(e) => setNewAcctToken(e.target.value)}
            />
            <button
              type="button"
              className="btn"
              onClick={() => setShowToken((v) => !v)}
            >
              {showToken ? t.common.hide : t.common.show}
            </button>
          </div>
          <div className="settings-row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleAddAccount}
              disabled={acctSaving || !newAcctName.trim() || !newAcctToken.trim()}
            >
              {acctSaving ? t.common.saving : t.common.save}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => { setAddingAccount(false); setNewAcctName(""); setNewAcctToken(""); }}
            >
              {t.common.cancel}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn"
          onClick={() => setAddingAccount(true)}
          style={{ marginTop: 8 }}
        >
          {t.settings.addAccount}
        </button>
      )}
    </section>
  );
}
