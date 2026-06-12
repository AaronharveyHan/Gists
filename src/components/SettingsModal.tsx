import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { useThemeStore, PRESETS } from "../store/useThemeStore";
import {
  getAiConfig, saveAiConfig, getSetting, saveSetting,
  localEmbeddingStatus, downloadLocalEmbeddingModel,
  type LocalEmbeddingStatus,
} from "../api/tauri";
import { useT, useI18nStore, getT } from "../store/useI18nStore";
import { AI_PROVIDERS, detectProvider } from "../data/aiProviders";
import { initErrorReporting } from "../lib/errorReporting";
import { listAccounts, addAccount, removeAccount, switchAccount, type Account } from "../api/tauri";
import { notify } from "../store/useNotificationStore";

const DASHSCOPE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

/** Returns true if the model name looks like a chat/completion model, not an embedding model. */
function looksLikeChatModel(name: string): boolean {
  if (!name.trim()) return false;
  if (/embedding/i.test(name)) return false;
  return /turbo|plus|max|mini|gpt|llama|mistral|mixtral|qwen\d|claude|gemini/i.test(name);
}

const MODEL_SUGGESTIONS = [
  // DashScope / Qwen
  "qwen-turbo", "qwen-plus", "qwen-max", "qwen-long",
  // OpenAI
  "gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo",
  // Groq
  "llama-3.1-70b-versatile", "mixtral-8x7b-32768",
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { lang, setLang } = useI18nStore();
  const {
    presetId, accentOverride, editorFontSize, autoSyncMinutes,
    vimMode, zenMode, tabCompletion,
    setPreset, setAccentOverride, setEditorFontSize, setAutoSyncMinutes,
    setVimMode, setZenMode, setTabCompletion,
  } = useThemeStore();

  const [aiBaseUrl, setAiBaseUrl] = useState(DASHSCOPE_URL);
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiModel, setAiModel] = useState("qwen-turbo");
  const [aiEmbeddingModel, setAiEmbeddingModel] = useState("text-embedding-v3");
  const [aiProviderId, setAiProviderId] = useState<string>(AI_PROVIDERS[0].id);
  const [aiHasKey, setAiHasKey] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiSaved, setAiSaved] = useState(false);

  // Embedding provider: "remote" (default, uses the API above) | "local" (offline ONNX).
  const [embedProvider, setEmbedProvider] = useState<"remote" | "local">("remote");
  const [localDir, setLocalDir] = useState<string>("");
  const [localStatus, setLocalStatus] = useState<LocalEmbeddingStatus | null>(null);
  const [localDownloading, setLocalDownloading] = useState(false);

  const [crashReporting, setCrashReporting] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [addingAccount, setAddingAccount] = useState(false);
  const [newAcctName, setNewAcctName] = useState("");
  const [newAcctToken, setNewAcctToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [acctSaving, setAcctSaving] = useState(false);

  useEffect(() => {
    // get_setting returns Ok(None) when absent, so a rejection here is a real
    // DB/IPC failure, not an "unconfigured" state. A bad read just leaves the
    // toggle at its default, so log it for diagnostics rather than toasting.
    getSetting("error_reporting_enabled").then((v) => {
      setCrashReporting(v === "true");
    }).catch((e) => console.error("[settings] load error_reporting_enabled failed:", e));
  }, []);

  const handleCrashReportingToggle = (enabled: boolean) => {
    setCrashReporting(enabled);
    // Persisting is an explicit user action — surface failure so they know the
    // choice may not stick.
    saveSetting("error_reporting_enabled", enabled ? "true" : "false")
      .catch((e) => {
        console.error("[settings] save error_reporting_enabled failed:", e);
        notify(t.settings.saveSettingError, "error");
      });
    // Reinit frontend Sentry immediately
    initErrorReporting(enabled);
    // Backend Sentry picks up the setting on next app launch
    notify(t.settings.privacyRestartHint, "info");
  };

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

  useEffect(() => {
    // get_ai_config returns defaults for unset keys and only rejects on a real
    // DB/IPC failure — so a rejection here is a genuine load failure, not an
    // "unconfigured" state. Surface it instead of silently showing defaults.
    getAiConfig().then((cfg) => {
      setAiBaseUrl(cfg.base_url);
      setAiModel(cfg.model);
      setAiEmbeddingModel(cfg.embedding_model);
      setAiHasKey(cfg.has_key);
      setAiProviderId(detectProvider(cfg.base_url).id);
    }).catch((e) => {
      console.error("[settings] load AI config failed:", e);
      // getT(): mount-only effect — the reactive `t` would force a reload on
      // language change just to keep this toast string fresh.
      notify(getT().settings.loadConfigError, "error");
    });
  }, []);

  const refreshLocalStatus = () =>
    localEmbeddingStatus()
      .then((s) => { setLocalStatus(s); if (!localDir) setLocalDir(s.dir); })
      .catch((e) => console.error("[settings] load local embedding status failed:", e));

  useEffect(() => {
    // These two reads share one failure toast: a DB failure breaks both, and we
    // don't want to stack duplicate toasts on mount.
    let embeddingLoadFailed = false;
    getSetting("embedding_provider").then((v) => {
      setEmbedProvider(v === "local" ? "local" : "remote");
    }).catch((e) => {
      console.error("[settings] load embedding_provider failed:", e);
      embeddingLoadFailed = true;
    });
    getSetting("local_embedding_dir").then((v) => {
      if (v) setLocalDir(v);
    }).catch((e) => {
      console.error("[settings] load local_embedding_dir failed:", e);
      if (!embeddingLoadFailed) notify(t.settings.loadEmbeddingError, "error");
    });
    refreshLocalStatus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEmbedProviderChange = (next: "remote" | "local") => {
    setEmbedProvider(next);
    saveSetting("embedding_provider", next).catch((e) => {
      console.error("[settings] save embedding_provider failed:", e);
      notify(t.settings.saveSettingError, "error");
    });
    if (next === "local") refreshLocalStatus();
  };

  const handleLocalDirSave = (dir: string) => {
    setLocalDir(dir);
    saveSetting("local_embedding_dir", dir).catch((e) => {
      console.error("[settings] save local_embedding_dir failed:", e);
      notify(t.settings.saveSettingError, "error");
    });
  };

  const handleDownloadModel = async () => {
    setLocalDownloading(true);
    try {
      await downloadLocalEmbeddingModel();
      notify(t.settings.localModelReady, "success");
      await refreshLocalStatus();
    } catch (e) {
      notify(t.settings.localModelError + " " + String(e), "error");
    } finally {
      setLocalDownloading(false);
    }
  };

  const handleProviderPick = (id: string) => {
    const p = AI_PROVIDERS.find((x) => x.id === id);
    if (!p) return;
    setAiProviderId(id);
    if (p.url) setAiBaseUrl(p.url);
    if (p.chatModel) setAiModel(p.chatModel);
    if (p.embedModel) setAiEmbeddingModel(p.embedModel);
  };

  const currentProvider = AI_PROVIDERS.find((p) => p.id === aiProviderId) ?? AI_PROVIDERS[0];

  const handleSaveAi = async () => {
    setAiSaving(true);
    try {
      await saveAiConfig(aiBaseUrl, aiApiKey, aiModel, aiEmbeddingModel, "");
      setAiHasKey(aiHasKey || aiApiKey.length > 0);
      setAiApiKey("");
      setAiSaved(true);
      setTimeout(() => setAiSaved(false), 2000);
    } finally {
      setAiSaving(false);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  const preset = PRESETS[presetId];
  const showAccent = presetId !== "system";
  const accentValue = accentOverride ?? preset?.vars?.["--accent"] ?? "#58a6ff";

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal settings-modal" data-testid="settings-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{t.settings.title}</h2>

        <div className="settings-modal__body">
        {/* ── Language ────────────────────────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section__title">{t.settings.languageSection}</div>
          <div className="settings-row" style={{ gap: 8 }}>
            <button
              type="button"
              className={`btn${lang === "zh" ? " btn--primary" : ""}`}
              onClick={() => setLang("zh")}
            >
              {t.settings.langZh}
            </button>
            <button
              type="button"
              className={`btn${lang === "en" ? " btn--primary" : ""}`}
              onClick={() => setLang("en")}
            >
              {t.settings.langEn}
            </button>
          </div>
        </section>

        {/* ── Theme ─────────────────────────────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section__title">{t.settings.themeSection}</div>
          <div className="settings-theme-grid">
            {Object.entries(PRESETS).map(([id, def]) => (
              <button
                key={id}
                type="button"
                className={`settings-theme-card ${presetId === id ? "settings-theme-card--active" : ""}`}
                onClick={() => setPreset(id)}
              >
                {id === "system" ? (
                  <div className="settings-theme-card__swatch settings-theme-card__swatch--system">
                    <span className="swatch-system-half swatch-system-half--dark" />
                    <span className="swatch-system-half swatch-system-half--light" />
                    <span className="swatch-system-label">Auto</span>
                  </div>
                ) : (
                  <div
                    className="settings-theme-card__swatch"
                    style={{
                      background: def.vars!["--bg-0"],
                      borderColor: def.vars!["--border"],
                    }}
                  >
                    <span
                      className="swatch-sidebar"
                      style={{ background: def.vars!["--bg-1"] }}
                    />
                    <span
                      className="swatch-accent-bar"
                      style={{ background: def.vars!["--accent"] }}
                    />
                    {/* Mini "code lines" to hint at the palette */}
                    <span className="swatch-lines">
                      <span style={{ background: def.vars!["--text-0"], width: "55%", opacity: 0.7 }} />
                      <span style={{ background: def.vars!["--text-1"], width: "35%", opacity: 0.5 }} />
                      <span style={{ background: def.vars!["--accent"],  width: "45%", opacity: 0.6 }} />
                    </span>
                  </div>
                )}
                <span className="settings-theme-card__name">{def.name}</span>
              </button>
            ))}
          </div>
        </section>

        {/* ── Accent color ───────────────────────────────────────────── */}
        {showAccent && (
          <section className="settings-section">
            <div className="settings-section__title">{t.settings.accentColor}</div>
            <div className="settings-row">
              <input
                type="color"
                value={accentValue}
                onChange={(e) => setAccentOverride(e.target.value)}
                className="settings-color-picker"
                title={t.settings.pickAccent}
              />
              <span
                className="settings-accent-preview"
                style={{ background: accentValue }}
              />
              <code className="settings-row__label">{accentValue}</code>
              {accentOverride && (
                <button
                  type="button"
                  className="settings-reset-btn"
                  onClick={() => setAccentOverride(null)}
                  title={t.settings.resetToDefault}
                >
                  {t.settings.reset}
                </button>
              )}
            </div>
          </section>
        )}

        {/* ── Auto-sync ──────────────────────────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section__title">{t.settings.autoSync}</div>
          <div className="settings-row">
            <select
              className="settings-select"
              value={autoSyncMinutes}
              onChange={(e) => setAutoSyncMinutes(Number(e.target.value))}
            >
              <option value={0}>{t.settings.syncDisabled}</option>
              <option value={5}>{t.settings.sync5}</option>
              <option value={15}>{t.settings.sync15}</option>
              <option value={30}>{t.settings.sync30}</option>
              <option value={60}>{t.settings.sync60}</option>
            </select>
          </div>
        </section>

        {/* ── Editor font size ───────────────────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section__title">{t.settings.editorFontSize}</div>
          <div className="settings-row">
            <input
              type="range"
              min={10}
              max={24}
              step={1}
              value={editorFontSize}
              onChange={(e) => setEditorFontSize(Number(e.target.value))}
              className="settings-slider"
            />
            <span className="settings-row__label">{editorFontSize}px</span>
          </div>
          <div className="settings-row settings-row--hint">
            <span className="settings-hint" style={{ fontSize: editorFontSize }}>
              {t.settings.fontPreview}
            </span>
          </div>
        </section>

        {/* ── Editor mode ─────────────────────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section__title">{t.settings.editorSection}</div>
          <label className="modal__checkbox">
            <input
              type="checkbox"
              checked={vimMode}
              onChange={(e) => setVimMode(e.target.checked)}
            />
            {t.settings.vimMode}
          </label>
          <label className="modal__checkbox">
            <input
              type="checkbox"
              checked={zenMode}
              onChange={(e) => setZenMode(e.target.checked)}
            />
            {t.settings.zenMode}
            <kbd style={{ marginLeft: 6 }}>&#8984;\</kbd>
          </label>
          <label className="modal__checkbox">
            <input
              type="checkbox"
              checked={tabCompletion}
              onChange={(e) => setTabCompletion(e.target.checked)}
            />
            <span>
              {t.settings.tabCompletion}
              <span className="settings-hint" style={{ display: "block", whiteSpace: "normal", fontSize: "0.8em", marginTop: 2 }}>{t.settings.tabCompletionHint}</span>
            </span>
          </label>
        </section>

        {/* ── AI Integration ─────────────────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section__title">{t.settings.aiSection}</div>

          {/* Provider preset grid — picking one fills URL + chat model + embed model */}
          <div className="settings-row settings-row--col">
            <label className="settings-label">{t.settings.aiProviderPreset}</label>
            <div className="ai-preset-grid">
              {AI_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`ai-preset-card${aiProviderId === p.id ? " ai-preset-card--active" : ""}`}
                  onClick={() => handleProviderPick(p.id)}
                  title={p.tagline}
                >
                  <div className="ai-preset-card__label">
                    {p.label}
                    {p.local && <span className="ai-offline-badge">{t.settings.localBadge}</span>}
                  </div>
                  <div className="ai-preset-card__tagline">{p.tagline}</div>
                </button>
              ))}
            </div>
            {currentProvider.local && (
              <div className="local-callout">{t.settings.localCallout}</div>
            )}
            {currentProvider.docsUrl && !currentProvider.local && (
              <button
                type="button"
                className="settings-link"
                onClick={() => open(currentProvider.docsUrl)}
                style={{ alignSelf: "flex-start", marginTop: 4 }}
              >
                ↗ {t.settings.getApiKeyFrom(currentProvider.label)}
              </button>
            )}
            {currentProvider.docsUrl && currentProvider.local && (
              <button
                type="button"
                className="settings-link"
                onClick={() => open(currentProvider.docsUrl)}
                style={{ alignSelf: "flex-start", marginTop: 4 }}
              >
                ↗ {t.settings.setupOllama}
              </button>
            )}
          </div>

          <div className="settings-row settings-row--col">
            <label className="settings-label">{t.settings.providerUrl}</label>
            <input
              type="text"
              className="settings-input"
              value={aiBaseUrl}
              onChange={(e) => setAiBaseUrl(e.target.value)}
              placeholder={DASHSCOPE_URL}
            />
          </div>
          <div className="settings-row settings-row--col">
            <label className="settings-label">
              {t.settings.apiKey}
              {aiHasKey && <span className="settings-badge settings-badge--ok">{t.settings.keySaved}</span>}
            </label>
            <input
              type="password"
              className="settings-input"
              value={aiApiKey}
              onChange={(e) => setAiApiKey(e.target.value)}
              placeholder={aiHasKey ? t.settings.keyReplacePlaceholder : currentProvider.local ? t.settings.keyOptionalPlaceholder : t.settings.keyNewPlaceholder}
              autoComplete="new-password"
            />
          </div>
          <div className="settings-row settings-row--col">
            <label className="settings-label">{t.settings.chatModel}</label>
            <input
              type="text"
              className="settings-input"
              list="ai-models"
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              placeholder="qwen-turbo"
            />
            <datalist id="ai-models">
              {MODEL_SUGGESTIONS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
          <div className="settings-row settings-row--col">
            <label className="settings-label">
              {t.settings.embeddingModel}
              <span className="settings-hint" style={{ marginLeft: 6 }}>
                {t.settings.embeddingHint}
              </span>
            </label>
            <input
              type="text"
              className={`settings-input${looksLikeChatModel(aiEmbeddingModel) ? " settings-input--warn" : ""}`}
              list="ai-embed-models"
              value={aiEmbeddingModel}
              onChange={(e) => setAiEmbeddingModel(e.target.value)}
              placeholder="text-embedding-v3"
            />
            {looksLikeChatModel(aiEmbeddingModel) && (
              <div className="settings-warn">{t.settings.chatModelWarn}</div>
            )}
            <datalist id="ai-embed-models">
              <option value="text-embedding-v3" />
              <option value="text-embedding-v2" />
              <option value="text-embedding-3-small" />
              <option value="text-embedding-3-large" />
              <option value="text-embedding-ada-002" />
            </datalist>
          </div>
          <div className="settings-row">
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleSaveAi}
              disabled={aiSaving}
            >
              {aiSaving ? t.settings.saving : aiSaved ? t.settings.savedCheck : t.settings.saveAiConfig}
            </button>
          </div>

          {/* ── Embedding backend: remote API vs local offline model ─────── */}
          <div className="settings-row settings-row--col">
            <label className="settings-label">
              {t.settings.embedProviderLabel}
              <span className="settings-hint" style={{ marginLeft: 6 }}>
                {t.settings.embedProviderHint}
              </span>
            </label>
            <div className="settings-segmented">
              <button
                type="button"
                className={`settings-segmented__btn${embedProvider === "remote" ? " is-active" : ""}`}
                onClick={() => handleEmbedProviderChange("remote")}
              >
                {t.settings.embedRemote}
              </button>
              <button
                type="button"
                className={`settings-segmented__btn${embedProvider === "local" ? " is-active" : ""}`}
                onClick={() => handleEmbedProviderChange("local")}
              >
                {t.settings.embedLocal}
              </button>
            </div>
          </div>

          {embedProvider === "local" && (
            <div className="settings-row settings-row--col">
              <label className="settings-label">
                {t.settings.localModelDir}
                <span className="settings-hint" style={{ marginLeft: 6 }}>
                  {t.settings.localModelDirHint}
                </span>
              </label>
              <input
                type="text"
                className="settings-input"
                value={localDir}
                placeholder={localStatus?.dir ?? ""}
                onChange={(e) => setLocalDir(e.target.value)}
                onBlur={(e) => handleLocalDirSave(e.target.value.trim())}
              />
              <div className="settings-local-model">
                <span className={`settings-local-model__badge${localStatus?.downloaded ? " is-ready" : ""}`}>
                  {localStatus?.downloaded
                    ? t.settings.localModelDownloaded
                    : t.settings.localModelMissing}
                </span>
                {!localStatus?.downloaded && (
                  <button
                    type="button"
                    className="btn"
                    onClick={handleDownloadModel}
                    disabled={localDownloading}
                  >
                    {localDownloading ? t.settings.localModelDownloading : t.settings.localModelDownload}
                  </button>
                )}
              </div>
              <div className="settings-warn settings-warn--info">
                {t.settings.localModelNote}
              </div>
            </div>
          )}
        </section>

        {/* ── Accounts ─────────────────────────────────────────────── */}
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

        {/* ── Privacy ──────────────────────────────────────────────── */}
        <section className="settings-section">
          <h3 className="settings-section__title">{t.settings.privacySection}</h3>
          <div className="settings-row settings-row--toggle">
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={crashReporting}
                onChange={(e) => handleCrashReportingToggle(e.target.checked)}
              />
              <span className="settings-toggle__label">{t.settings.crashReporting}</span>
            </label>
            <div className="settings-hint">
              {t.settings.crashReportingHint}
              {" "}
              <button
                type="button"
                className="settings-link"
                onClick={() => open("https://sentry.io/privacy/")}
              >
                {t.settings.learnWhatIsSent}
              </button>
            </div>
          </div>
        </section>

        </div>{/* end settings-modal__body */}

        <div className="modal__actions">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {t.settings.done}
          </button>
        </div>
      </div>
    </div>
  );
}
