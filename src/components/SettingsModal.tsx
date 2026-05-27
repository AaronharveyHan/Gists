import { useEffect } from "react";
import { useThemeStore, PRESETS } from "../store/useThemeStore";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const {
    presetId, accentOverride, editorFontSize, autoSyncMinutes,
    vimMode, zenMode,
    setPreset, setAccentOverride, setEditorFontSize, setAutoSyncMinutes,
    setVimMode, setZenMode,
  } = useThemeStore();

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
      <div className="modal settings-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        {/* ── Theme ─────────────────────────────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section__title">Theme</div>
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
            <div className="settings-section__title">Accent Color</div>
            <div className="settings-row">
              <input
                type="color"
                value={accentValue}
                onChange={(e) => setAccentOverride(e.target.value)}
                className="settings-color-picker"
                title="Pick a custom accent color"
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
                  title="Reset to theme default"
                >
                  Reset
                </button>
              )}
            </div>
          </section>
        )}

        {/* ── Auto-sync ──────────────────────────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section__title">Auto Sync</div>
          <div className="settings-row">
            <select
              className="settings-select"
              value={autoSyncMinutes}
              onChange={(e) => setAutoSyncMinutes(Number(e.target.value))}
            >
              <option value={0}>Disabled</option>
              <option value={5}>Every 5 minutes</option>
              <option value={15}>Every 15 minutes</option>
              <option value={30}>Every 30 minutes</option>
              <option value={60}>Every hour</option>
            </select>
          </div>
        </section>

        {/* ── Editor font size ───────────────────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section__title">Editor Font Size</div>
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
              The quick brown fox
            </span>
          </div>
        </section>

        {/* ── Editor mode ─────────────────────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section__title">Editor</div>
          <label className="modal__checkbox">
            <input
              type="checkbox"
              checked={vimMode}
              onChange={(e) => setVimMode(e.target.checked)}
            />
            Vim keybindings
          </label>
          <label className="modal__checkbox">
            <input
              type="checkbox"
              checked={zenMode}
              onChange={(e) => setZenMode(e.target.checked)}
            />
            Zen mode (hide sidebar &amp; toolbar)
            <kbd style={{ marginLeft: 6 }}>&#8984;\</kbd>
          </label>
        </section>

        <div className="modal__actions">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
