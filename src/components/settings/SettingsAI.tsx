import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { useFlashFlag } from "../../hooks/useFlashFlag";
import {
  getAiConfig, saveAiConfig, getSetting, saveSetting,
  localEmbeddingStatus, downloadLocalEmbeddingModel,
  type LocalEmbeddingStatus,
} from "../../api/tauri";
import { useT, getT } from "../../store/useI18nStore";
import { AI_PROVIDERS, detectProvider } from "../../data/aiProviders";
import { notify } from "../../store/useNotificationStore";

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

/**
 * AI integration settings: provider preset, base URL, API key, chat/embedding
 * models, and the remote-vs-local embedding backend (incl. offline model
 * download). Self-contained — owns all its own state and persistence.
 */
export function SettingsAI() {
  const t = useT();

  const [aiBaseUrl, setAiBaseUrl] = useState(DASHSCOPE_URL);
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiModel, setAiModel] = useState("qwen-turbo");
  const [aiEmbeddingModel, setAiEmbeddingModel] = useState("text-embedding-v3");
  const [aiProviderId, setAiProviderId] = useState<string>(AI_PROVIDERS[0].id);
  const [aiHasKey, setAiHasKey] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiSaved, flashAiSaved] = useFlashFlag(2000);

  // Embedding provider: "remote" (default, uses the API above) | "local" (offline ONNX).
  const [embedProvider, setEmbedProvider] = useState<"remote" | "local">("remote");
  const [localDir, setLocalDir] = useState<string>("");
  const [localStatus, setLocalStatus] = useState<LocalEmbeddingStatus | null>(null);
  const [localDownloading, setLocalDownloading] = useState(false);

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
      flashAiSaved();
    } finally {
      setAiSaving(false);
    }
  };

  return (
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
  );
}
