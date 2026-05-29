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
import { useEffect, useState } from "react";
import { useGistStore } from "../store/useGistStore";
import type { Gist } from "../api/tauri";

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
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
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <button
      className={`share-modal__copy-btn ${copied ? "share-modal__copy-btn--copied" : ""}`}
      onClick={handleCopy}
      title={copied ? "Copied!" : `Copy ${label}`}
    >
      {copied ? "✓ Copied" : label}
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
        <CopyButton value={value} label={copyLabel ?? "Copy"} />
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
          <h2 className="modal__title">Share / Embed</h2>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        {isLocal ? (
          <div className="share-modal__local-notice">
            <span className="share-modal__local-icon">✎</span>
            <p>
              This is a <strong>local draft</strong> — it hasn't been published to GitHub yet.
              Publish it first to get a shareable link.
            </p>
          </div>
        ) : (
          <div className="share-modal__body">

            {/* GitHub URL */}
            <section className="share-modal__section">
              <div className="share-modal__section-head">
                <span className="share-modal__section-title">GitHub URL</span>
                <button
                  className="share-modal__open-link"
                  onClick={() => openExternal(githubUrl)}
                  title="Open in browser"
                >
                  Open ↗
                </button>
              </div>
              <ShareRow label="" value={githubUrl} copyLabel="Copy URL" />
            </section>

            {/* HTML embed */}
            <section className="share-modal__section">
              <div className="share-modal__section-head">
                <span className="share-modal__section-title">Embed (HTML)</span>
                <span className="share-modal__section-hint">
                  Paste in any webpage to render the gist
                </span>
              </div>
              <ShareRow label="" value={embedHtml} monospace copyLabel="Copy embed" />
            </section>

            {/* Markdown */}
            <section className="share-modal__section">
              <div className="share-modal__section-head">
                <span className="share-modal__section-title">Markdown link</span>
              </div>
              <ShareRow label="" value={markdownLink} monospace copyLabel="Copy markdown" />
            </section>

            {/* Raw file URLs */}
            {rawFiles.length > 0 && (
              <section className="share-modal__section">
                <div className="share-modal__section-head">
                  <span className="share-modal__section-title">Raw file URLs</span>
                  <span className="share-modal__section-hint">
                    Direct link to file contents
                  </span>
                </div>
                {rawFiles.map((f) => (
                  <ShareRow
                    key={f.filename}
                    label={f.filename}
                    value={f.raw_url!}
                    monospace
                    copyLabel="Copy"
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
