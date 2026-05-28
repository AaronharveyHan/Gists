import { useState, useEffect } from "react";
import { open } from "@tauri-apps/api/shell";
import { setToken, saveAiConfig } from "../api/tauri";
import { useGistStore } from "../store/useGistStore";
import { useT } from "../store/useI18nStore";

// ── Step indicators ───────────────────────────────────────────────────────────

function Steps({ current, total }: { current: number; total: number }) {
  return (
    <div className="ob__steps">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`ob__step-dot${i === current ? " ob__step-dot--active" : i < current ? " ob__step-dot--done" : ""}`}
        />
      ))}
    </div>
  );
}

// ── Feature icon shapes (SVG paths only, titles/descs come from i18n) ─────────

const FEATURE_ICONS = [
  <svg key="search" viewBox="0 0 16 16" fill="currentColor" width="18" height="18">
    <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zM6.5 12a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z"/>
  </svg>,
  <svg key="ai" viewBox="0 0 16 16" fill="currentColor" width="18" height="18">
    <path d="M0 1.75A.75.75 0 0 1 .75 1h4.253c1.227 0 2.317.59 3 1.501A3.743 3.743 0 0 1 11.006 1h4.245a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.507a2.25 2.25 0 0 0-1.591.659l-.622.621a.75.75 0 0 1-1.06 0l-.622-.621A2.25 2.25 0 0 0 5.258 13H.75a.75.75 0 0 1-.75-.75Z"/>
  </svg>,
  <svg key="collections" viewBox="0 0 16 16" fill="currentColor" width="18" height="18">
    <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1Z"/>
  </svg>,
  <svg key="prompt" viewBox="0 0 16 16" fill="currentColor" width="18" height="18">
    <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5Zm8 0A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5Zm-8 8A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5Zm8 0A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5Z"/>
  </svg>,
  <svg key="capture" viewBox="0 0 16 16" fill="currentColor" width="18" height="18">
    <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/>
  </svg>,
  <svg key="local" viewBox="0 0 16 16" fill="currentColor" width="18" height="18">
    <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z"/>
  </svg>,
];

// ── STEP 0: Welcome ───────────────────────────────────────────────────────────

function StepWelcome({ onNext, onLocalMode }: { onNext: () => void; onLocalMode: () => void }) {
  const t = useT();
  const features = [
    { icon: FEATURE_ICONS[0], title: t.onboarding.featureSearch, desc: t.onboarding.featureSearchDesc },
    { icon: FEATURE_ICONS[1], title: t.onboarding.featureAI, desc: t.onboarding.featureAIDesc },
    { icon: FEATURE_ICONS[2], title: t.onboarding.featureCollections, desc: t.onboarding.featureCollectionsDesc },
    { icon: FEATURE_ICONS[3], title: t.onboarding.featurePromptLib, desc: t.onboarding.featurePromptLibDesc },
    { icon: FEATURE_ICONS[4], title: t.onboarding.featureCapture, desc: t.onboarding.featureCaptureDesc },
    { icon: FEATURE_ICONS[5], title: t.onboarding.featureLocal, desc: t.onboarding.featureLocalDesc },
  ];
  return (
    <div className="ob__step">
      <div className="ob__hero">
        <div className="ob__hero-icon">
          <svg viewBox="0 0 16 16" width="36" height="36" fill="currentColor">
            <path fillRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
        </div>
        <h1 className="ob__hero-title">{t.onboarding.appTitle}</h1>
        <p className="ob__hero-sub">{t.onboarding.appSubtitle}</p>
      </div>

      <div className="ob__features">
        {features.map((f) => (
          <div key={f.title} className="ob__feature-card">
            <div className="ob__feature-icon">{f.icon}</div>
            <div>
              <div className="ob__feature-title">{f.title}</div>
              <div className="ob__feature-desc">{f.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="ob__actions ob__actions--col">
        <button className="btn btn--primary ob__cta" onClick={onNext}>
          {t.onboarding.connectGitHub}
        </button>
        <button className="ob__ghost-link" onClick={onLocalMode}>
          {t.onboarding.skipLocal}
        </button>
      </div>
    </div>
  );
}

// ── STEP 1: GitHub Token ──────────────────────────────────────────────────────

function StepGitHub({
  onNext,
  onBack,
  onLocalMode,
  setLogin,
}: {
  onNext: () => void;
  onBack: () => void;
  onLocalMode: () => void;
  setLogin: (l: string) => void;
}) {
  const t = useT();
  const { setAuthenticated, sync } = useGistStore();
  const [token, setToken_] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);

  const handleConnect = async () => {
    const t = token.trim();
    if (!t) return;
    setLoading(true);
    setError(null);
    try {
      const login = await setToken(t);
      setAuthenticated(login);
      setLogin(login);
      sync();          // kick off background sync
      onNext();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ob__step">
      <h2 className="ob__step-title">{t.onboarding.githubTitle}</h2>
      <p className="ob__step-sub">{t.onboarding.githubSub}</p>

      <ol className="ob__instructions">
        <li>
          {t.onboarding.step1_1}
          <button
            className="ob__inline-link"
            onClick={() => open("https://github.com/settings/tokens/new?scopes=gist&description=Gists+Client")}
          >
            {t.onboarding.openInBrowser}
          </button>
        </li>
        <li>{t.onboarding.step1_2}</li>
        <li>{t.onboarding.step1_3}</li>
        <li>{t.onboarding.step1_4}</li>
      </ol>

      <div className="ob__field">
        <label className="ob__label">{t.onboarding.patLabel}</label>
        <div className="ob__token-wrap">
          <input
            className="ob__input ob__input--mono"
            type={showToken ? "text" : "password"}
            placeholder={t.onboarding.patPlaceholder}
            value={token}
            onChange={(e) => { setToken_(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleConnect(); }}
            autoFocus
            disabled={loading}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className="ob__show-toggle"
            type="button"
            onClick={() => setShowToken((v) => !v)}
            tabIndex={-1}
            title={showToken ? t.onboarding.hideToken : t.onboarding.showToken}
          >
            {showToken ? t.onboarding.hide : t.onboarding.show}
          </button>
        </div>
        {error && <div className="ob__error">{error}</div>}
      </div>

      <div className="ob__actions">
        <button className="btn ob__back-btn" onClick={onBack}>{t.onboarding.back}</button>
        <button
          className="btn btn--primary"
          onClick={handleConnect}
          disabled={loading || !token.trim()}
        >
          {loading ? t.onboarding.verifying : t.onboarding.connectSync}
        </button>
      </div>
      <button className="ob__ghost-link" onClick={onLocalMode}>
        {t.onboarding.skipLocalMode}
      </button>
    </div>
  );
}

// ── STEP 2: AI Setup ──────────────────────────────────────────────────────────

const PROVIDERS = [
  {
    label: "DashScope (Aliyun)",
    url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    chatModel: "qwen-turbo",
    embedModel: "text-embedding-v3",
    keyHint: "sk-… (DashScope API Key)",
    docsUrl: "https://dashscope.aliyuncs.com",
  },
  {
    label: "OpenAI",
    url: "https://api.openai.com/v1",
    chatModel: "gpt-4o-mini",
    embedModel: "text-embedding-3-small",
    keyHint: "sk-… (OpenAI API Key)",
    docsUrl: "https://platform.openai.com/api-keys",
  },
  {
    label: "SiliconFlow",
    url: "https://api.siliconflow.cn/v1",
    chatModel: "Qwen/Qwen2.5-7B-Instruct",
    embedModel: "BAAI/bge-m3",
    keyHint: "sk-… (SiliconFlow API Key)",
    docsUrl: "https://siliconflow.cn",
  },
  {
    label: "Ollama (local)",
    url: "http://localhost:11434/v1",
    chatModel: "llama3.2",
    embedModel: "nomic-embed-text",
    keyHint: "ollama (or leave empty)",
    docsUrl: "https://ollama.com",
  },
  {
    label: "Custom / Other",
    url: "",
    chatModel: "",
    embedModel: "",
    keyHint: "API key",
    docsUrl: "",
  },
];

function StepAI({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const t = useT();
  const [providerIdx, setProviderIdx] = useState(0);
  const [baseUrl, setBaseUrl] = useState(PROVIDERS[0].url);
  const [apiKey, setApiKey] = useState("");
  const [chatModel, setChatModel] = useState(PROVIDERS[0].chatModel);
  const [embedModel, setEmbedModel] = useState(PROVIDERS[0].embedModel);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const handleProvider = (idx: number) => {
    const p = PROVIDERS[idx];
    setProviderIdx(idx);
    if (p.url) setBaseUrl(p.url);
    if (p.chatModel) setChatModel(p.chatModel);
    if (p.embedModel) setEmbedModel(p.embedModel);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveAiConfig(baseUrl, apiKey, chatModel, embedModel, "");
      onNext();
    } finally {
      setSaving(false);
    }
  };

  const prov = PROVIDERS[providerIdx];

  return (
    <div className="ob__step">
      <h2 className="ob__step-title">
        {t.onboarding.aiTitle}
        <span className="ob__optional-badge">{t.onboarding.optional}</span>
      </h2>
      <p className="ob__step-sub">{t.onboarding.aiSub}</p>

      {/* Provider selector */}
      <div className="ob__field">
        <label className="ob__label">{t.onboarding.provider}</label>
        <div className="ob__provider-grid">
          {PROVIDERS.map((p, i) => (
            <button
              key={p.label}
              className={`ob__provider-btn${providerIdx === i ? " ob__provider-btn--active" : ""}`}
              onClick={() => handleProvider(i)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {prov.docsUrl && (
        <button
          className="ob__inline-link ob__inline-link--block"
          onClick={() => open(prov.docsUrl)}
        >
          {t.onboarding.getApiKeyFrom(prov.label)}
        </button>
      )}

      <div className="ob__field">
        <label className="ob__label">{t.onboarding.apiKey}</label>
        <div className="ob__token-wrap">
          <input
            className="ob__input ob__input--mono"
            type={showKey ? "text" : "password"}
            placeholder={prov.keyHint}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="new-password"
          />
          <button className="ob__show-toggle" type="button" onClick={() => setShowKey((v) => !v)} tabIndex={-1}>
            {showKey ? t.onboarding.hide : t.onboarding.show}
          </button>
        </div>
      </div>

      <div className="ob__field-row">
        <div className="ob__field">
          <label className="ob__label">{t.onboarding.chatModel}</label>
          <input
            className="ob__input"
            value={chatModel}
            onChange={(e) => setChatModel(e.target.value)}
            placeholder="qwen-turbo"
          />
        </div>
        <div className="ob__field">
          <label className="ob__label">{t.onboarding.embedModel}</label>
          <input
            className="ob__input"
            value={embedModel}
            onChange={(e) => setEmbedModel(e.target.value)}
            placeholder="text-embedding-v3"
          />
        </div>
      </div>

      {providerIdx < PROVIDERS.length - 1 && (
        <div className="ob__field">
          <label className="ob__label">{t.onboarding.apiUrl}</label>
          <input
            className="ob__input ob__input--mono"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </div>
      )}
      {providerIdx === PROVIDERS.length - 1 && (
        <div className="ob__field">
          <label className="ob__label">{t.onboarding.apiUrl}</label>
          <input
            className="ob__input ob__input--mono"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={t.onboarding.customUrlPlaceholder}
          />
        </div>
      )}

      <div className="ob__actions">
        <button className="btn ob__back-btn ob__ghost-link" onClick={onSkip}>
          {t.onboarding.skipForNow}
        </button>
        <button
          className="btn btn--primary"
          onClick={handleSave}
          disabled={saving || !apiKey.trim()}
        >
          {saving ? t.onboarding.saving : t.onboarding.saveContinue}
        </button>
      </div>
    </div>
  );
}

// ── STEP 3: Ready ─────────────────────────────────────────────────────────────

function StepReady({
  login,
  aiEnabled,
  onDone,
}: {
  login: string;
  aiEnabled: boolean;
  onDone: () => void;
}) {
  const t = useT();
  const { gists } = useGistStore();
  const shortcuts = [
    { key: "⌘P", label: t.onboarding.shortcutPalette },
    { key: "Alt+Space", label: t.onboarding.shortcutSearch },
    { key: "Alt+⇧+Space", label: t.onboarding.shortcutCapture },
    { key: "⌘⇧A", label: t.onboarding.shortcutAI },
    { key: "⌘⇧H", label: t.onboarding.shortcutHistory },
    { key: "⌘⇧F", label: t.onboarding.shortcutSearchFiles },
  ];
  return (
    <div className="ob__step ob__step--ready">
      <div className="ob__ready-check">✓</div>
      <h2 className="ob__step-title">{t.onboarding.allSet}</h2>

      <div className="ob__ready-summary">
        {login && login !== "local" && (
          <div className="ob__ready-item">
            <span className="ob__ready-dot ob__ready-dot--green" />
            <strong>{t.onboarding.connectedAs(login)}</strong>
            {gists.length > 0 && <span className="ob__ready-count">{t.onboarding.gistsSynced(gists.length)}</span>}
          </div>
        )}
        {login === "local" && (
          <div className="ob__ready-item">
            <span className="ob__ready-dot ob__ready-dot--blue" />
            {t.onboarding.localMode}
          </div>
        )}
        <div className="ob__ready-item">
          <span className={`ob__ready-dot ${aiEnabled ? "ob__ready-dot--green" : "ob__ready-dot--gray"}`} />
          {aiEnabled ? t.onboarding.aiEnabled : t.onboarding.aiNotConfigured}
        </div>
      </div>

      <div className="ob__shortcuts">
        <div className="ob__shortcuts-title">{t.onboarding.shortcuts}</div>
        <div className="ob__shortcuts-grid">
          {shortcuts.map(({ key, label }) => (
            <div key={key} className="ob__shortcut-row">
              <kbd className="ob__kbd">{key}</kbd>
              <span className="ob__shortcut-label">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <button className="btn btn--primary ob__cta" onClick={onDone}>
        {t.onboarding.startUsing}
      </button>
    </div>
  );
}

// ── Root Onboarding component ─────────────────────────────────────────────────

export function Onboarding() {
  const { setAuthenticated } = useGistStore();
  const [step, setStep] = useState(0);
  const [login, setLogin] = useState("");
  const [aiEnabled, setAiEnabled] = useState(false);

  // If the user configured AI in step 2, mark it
  useEffect(() => {
    if (step === 3) {
      import("../api/tauri").then(({ getAiConfig }) =>
        getAiConfig().then((cfg) => setAiEnabled(cfg.has_key))
      );
    }
  }, [step]);

  const goLocalMode = () => {
    setAuthenticated("local");
    setLogin("local");
    setStep(2); // skip GitHub step, go straight to AI
  };

  const handleDone = () => {
    // If they went local mode, setAuthenticated was already called.
    // If GitHub was connected it was done in StepGitHub.
    // Just ensure the store has isAuthenticated=true (no-op if already set).
    if (!login) setAuthenticated("local");
  };

  const TOTAL_STEPS = 4;

  return (
    <div className="ob">
      <div className="ob__card">
        <Steps current={step} total={TOTAL_STEPS} />

        {step === 0 && (
          <StepWelcome
            onNext={() => setStep(1)}
            onLocalMode={goLocalMode}
          />
        )}
        {step === 1 && (
          <StepGitHub
            onNext={() => setStep(2)}
            onBack={() => setStep(0)}
            onLocalMode={goLocalMode}
            setLogin={setLogin}
          />
        )}
        {step === 2 && (
          <StepAI
            onNext={() => setStep(3)}
            onSkip={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <StepReady
            login={login}
            aiEnabled={aiEnabled}
            onDone={handleDone}
          />
        )}
      </div>
    </div>
  );
}
