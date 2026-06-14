/**
 * Share / Embed modal.
 *
 * Shows four shareable formats for the selected gist:
 *   1. GitHub URL          — direct link to gist.github.com
 *   2. HTML embed          — <script src="…"> tag for embedding in web pages
 *   3. Markdown link       — [description](url) shorthand
 *   4. Raw file URLs       — per-file raw content links
 *
 * For local-only drafts the embed / raw sections are hidden because the
 * gist has no real GitHub identity yet.
 */
import { useEffect } from "react";
import { useGistStore } from "../store/useGistStore";
import { useFlashFlag } from "../hooks/useFlashFlag";
import type { Gist } from "../api/tauri";
import { useT } from "../store/useI18nStore";

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, flashCopied] = useFlashFlag(1800);
  const t = useT();
  const displayLabel = label ?? t.share.copy;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      flashCopied();
    } catch {
      // Fallback for environments where clipboard API is restricted
      const el = document.createElement("textarea");
      el.value = value;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      flashCopied();
    }
  };

  return (
    <button
      className={`share-modal__copy-btn ${copied ? "share-modal__copy-btn--copied" : ""}`}
      onClick={handleCopy}
      title={copied ? t.share.copiedTitle : t.share.copyTitle(displayLabel)}
    >
      {copied ? t.share.copied : displayLabel}
    </button>
  );
}

// ── Share row ─────────────────────────────────────────────────────────────────

function ShareRow({
  label,
  value,
  monospace = false,
  copyLabel,
}: {
  label: string;
  value: string;
  monospace?: boolean;
  copyLabel?: string;
}) {
  return (
    <div className="share-modal__row">
      <div className="share-modal__row-label">{label}</div>
      <div className="share-modal__row-value-wrap">
        <code
          className={`share-modal__row-value ${monospace ? "share-modal__row-value--mono" : ""}`}
          title={value}
        >
          {value}
        </code>
        <CopyButton value={value} label={copyLabel} />
      </div>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function ShareModal({
  gist,
  onClose,
}: {
  gist: Gist;
  onClose: () => void;
}) {
  const { githubLogin } = useGistStore();
  const t = useT();

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  const isLocal = gist.local_only === true;
  const description = gist.description || gist.files[0]?.filename || gist.id.slice(0, 8);

  // GitHub URL — always available for real gists
  const githubUrl = gist.html_url;

  // Embed script — https://gist.github.com/{login}/{id}.js
  const embedHtml = `<script src="https://gist.github.com/${githubLogin}/${gist.id}.js"></script>`;

  // Markdown
  const markdownLink = `[${description}](${githubUrl})`;

  // Raw file URLs
  const rawFiles = gist.files.filter((f) => f.raw_url);

  // Open link in external browser (Tauri)
  const openExternal = (url: string) => {
    import("@tauri-apps/plugin-shell").then(({ open }) => open(url)).catch(() => {});
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal share-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2 className="modal__title">{t.share.title}</h2>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        {isLocal ? (
          <div className="share-modal__local-notice">
            <span className="share-modal__local-icon">✎</span>
            <p>{t.share.localDraftNotice}</p>
          </div>
        ) : (
          <div className="share-modal__body">

            {/* GitHub URL */}
            <section className="share-modal__section">
              <div className="share-modal__section-head">
                <span className="share-modal__section-title">{t.share.githubUrl}</span>
                <button
                  className="share-modal__open-link"
                  onClick={() => openExternal(githubUrl)}
                  title={t.share.openInBrowser}
                >
                  {t.share.openLink}
                </button>
              </div>
              <ShareRow label="" value={githubUrl} copyLabel={t.share.copyUrl} />
            </section>

            {/* HTML embed */}
            <section className="share-modal__section">
              <div className="share-modal__section-head">
                <span className="share-modal__section-title">{t.share.embedHtml}</span>
                <span className="share-modal__section-hint">{t.share.embedHint}</span>
              </div>
              <ShareRow label="" value={embedHtml} monospace copyLabel={t.share.copyEmbed} />
            </section>

            {/* Markdown */}
            <section className="share-modal__section">
              <div className="share-modal__section-head">
                <span className="share-modal__section-title">{t.share.markdownLink}</span>
              </div>
              <ShareRow label="" value={markdownLink} monospace copyLabel={t.share.copyMarkdown} />
            </section>

            {/* Raw file URLs */}
            {rawFiles.length > 0 && (
              <section className="share-modal__section">
                <div className="share-modal__section-head">
                  <span className="share-modal__section-title">{t.share.rawUrls}</span>
                  <span className="share-modal__section-hint">{t.share.rawHint}</span>
                </div>
                {rawFiles.map((f) => (
                  <ShareRow
                    key={f.filename}
                    label={f.filename}
                    value={f.raw_url!}
                    monospace
                  />
                ))}
              </section>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
