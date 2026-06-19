import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { useThemeStore, PRESETS } from "../store/useThemeStore";
import { getSetting, saveSetting, resetApp } from "../api/tauri";
import { useT, useI18nStore } from "../store/useI18nStore";
import { initErrorReporting } from "../lib/errorReporting";
import { notify } from "../store/useNotificationStore";
import { SettingsAI } from "./settings/SettingsAI";
import { SettingsAccounts } from "./settings/SettingsAccounts";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { lang, setLang } = useI18nStore();
  const {
    presetId, accentOverride, editorFontSize, autoSyncMinutes,
    vimMode, zenMode, tabCompletion,
    setPreset, setAccentOverride, setEditorFontSize, setAutoSyncMinutes,
    setVimMode, setZenMode, setTabCompletion,
  } = useThemeStore();

  const [crashReporting, setCrashReporting] = useState(false);
  const [resetting, setResetting] = useState(false);

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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  const handleResetApp = async () => {
    if (!confirm(t.settings.resetAppConfirm)) return;
    setResetting(true);
    try {
      await resetApp();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      console.error("[settings] reset_app failed:", e);
      notify(t.settings.resetAppFailed, "error");
      setResetting(false);
    }
  };

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
        <SettingsAI />

        {/* ── Accounts ─────────────────────────────────────────────── */}
        <SettingsAccounts />

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

        {/* ── Danger zone ──────────────────────────────────────────── */}
        <section className="settings-section">
          <h3 className="settings-section__title">{t.settings.dangerZoneSection}</h3>
          <p className="settings-hint">{t.settings.dangerZoneHint}</p>
          <div className="settings-row">
            <button
              type="button"
              className="btn btn--danger"
              onClick={handleResetApp}
              disabled={resetting}
            >
              {resetting ? t.common.loading : t.settings.resetAppButton}
            </button>
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
