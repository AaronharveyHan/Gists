import { useEffect, useState } from "react";
import { useGistStore } from "../store/useGistStore";
import { listTagCounts } from "../api/tauri";
import type { TagCount } from "../api/tauri";
import { useT } from "../store/useI18nStore";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function pct(n: number, total: number) {
  if (total === 0) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, accent,
}: {
  label: string; value: string | number; sub?: string; accent?: boolean;
}) {
  return (
    <div className={`stats-card ${accent ? "stats-card--accent" : ""}`}>
      <span className="stats-card__value">{value}</span>
      <span className="stats-card__label">{label}</span>
      {sub && <span className="stats-card__sub">{sub}</span>}
    </div>
  );
}

function BarRow({
  label, count, max, color, pctLabel,
}: {
  label: string; count: number; max: number; color?: string; pctLabel: string;
}) {
  const w = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="stats-bar-row">
      <span className="stats-bar-row__label">{label}</span>
      <div className="stats-bar-row__track">
        <div
          className="stats-bar-row__fill"
          style={{ width: `${w}%`, background: color ?? "var(--accent)" }}
        />
      </div>
      <span className="stats-bar-row__count">{count}</span>
      <span className="stats-bar-row__pct">{pctLabel}</span>
    </div>
  );
}

function ActivityChart({ gists, locale, barTooltip }: {
  gists: { created_at: string }[];
  locale: string;
  barTooltip: (label: string, n: number) => string;
}) {
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString(locale, { month: "short" }),
      count: 0,
    };
  });
  for (const g of gists) {
    const m = months.find((x) => x.key === g.created_at.slice(0, 7));
    if (m) m.count++;
  }
  const maxCount = Math.max(1, ...months.map((m) => m.count));
  const W = 600, H = 80, gap = 4;
  const barW = (W - gap * 11) / 12;

  return (
    <div className="stats-activity">
      <svg
        viewBox={`0 0 ${W} ${H + 20}`}
        className="stats-activity__svg"
        aria-label="Gists created per month"
      >
        {months.map((m, i) => {
          const barH = Math.max(3, (m.count / maxCount) * H);
          const x = i * (barW + gap);
          const y = H - barH;
          const opacity = 0.25 + 0.75 * (m.count / maxCount);
          return (
            <g key={m.key}>
              <rect
                x={x} y={y} width={barW} height={barH}
                rx={2}
                fill="var(--accent)"
                opacity={m.count === 0 ? 0.1 : opacity}
              >
                <title>{barTooltip(m.label, m.count)}</title>
              </rect>
              {/* Month label — show every 3rd to avoid crowding */}
              {i % 3 === 0 && (
                <text
                  x={x + barW / 2} y={H + 14}
                  textAnchor="middle"
                  fontSize={9}
                  fill="var(--text-2)"
                >
                  {m.label}
                </text>
              )}
            </g>
          );
        })}
        {/* Inline count label on tallest bar */}
        {(() => {
          const peak = months.reduce((a, b) => b.count > a.count ? b : a, months[0]);
          const i = months.indexOf(peak);
          if (peak.count === 0) return null;
          const barH = Math.max(3, (peak.count / maxCount) * H);
          const x = i * (barW + gap) + barW / 2;
          const y = H - barH - 4;
          return (
            <text x={x} y={y} textAnchor="middle" fontSize={9} fill="var(--accent)" fontWeight={700}>
              {peak.count}
            </text>
          );
        })()}
      </svg>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6", JavaScript: "#f1e05a", Python: "#3572A5",
  Rust: "#dea584", Go: "#00ADD8", Ruby: "#701516", CSS: "#563d7c",
  HTML: "#e34c26", Shell: "#89e051", Markdown: "#083fa1",
  Java: "#b07219", "C#": "#178600", "C++": "#f34b7d",
  Swift: "#F05138", Kotlin: "#A97BFF", PHP: "#4F5D95",
};

export function StatsPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { gists, categoryCounts } = useGistStore();

  const categoryLabels: Record<string, string> = {
    config: t.sidebar.catConfig,
    script: t.sidebar.catScript,
    document: t.sidebar.catDocs,
    media: t.sidebar.catMedia,
    data: t.sidebar.catData,
    multi: t.sidebar.catMultiFile,
    snippet: t.sidebar.catSnippet,
    library: t.sidebar.catLibrary,
    test: t.sidebar.catTest,
    gist: t.sidebar.catGeneral,
  };
  const [tagCounts, setTagCounts] = useState<TagCount[]>([]);

  useEffect(() => {
    listTagCounts().then(setTagCounts).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  // ── Derived stats ────────────────────────────────────────────────────────

  const total = gists.length;
  const publicCount = gists.filter((g) => g.public).length;
  const secretCount = total - publicCount;
  const pinnedCount = gists.filter((g) => g.pinned).length;

  const allFiles = gists.flatMap((g) => g.files);
  const totalFiles = allFiles.length;
  const totalSize = allFiles.reduce((s, f) => s + f.size, 0);

  // Language distribution from file objects
  const langMap = new Map<string, number>();
  for (const f of allFiles) {
    if (f.language) langMap.set(f.language, (langMap.get(f.language) ?? 0) + 1);
  }
  const topLangs = [...langMap.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);
  const maxLang = topLangs[0]?.[1] ?? 1;

  // Category distribution (already in store)
  const topCats = [...categoryCounts]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const maxCat = topCats[0]?.count ?? 1;

  // Top tags
  const topTags = tagCounts.slice(0, 10);
  const maxTag = topTags[0]?.count ?? 1;

  // Avg files per gist
  const avgFiles = total > 0 ? (totalFiles / total).toFixed(1) : "0";

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="modal stats-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="stats-modal__head">
          <h2>{t.stats.title}</h2>
          <button className="stats-modal__close" onClick={onClose} title={t.stats.close}>✕</button>
        </div>

        {/* ── Summary cards ──────────────────────────────────────────── */}
        <div className="stats-cards">
          <StatCard label={t.stats.totalGists} value={total} accent />
          <StatCard label={t.stats.public} value={publicCount} sub={pct(publicCount, total)} />
          <StatCard label={t.stats.secret} value={secretCount} sub={pct(secretCount, total)} />
          <StatCard label={t.stats.pinned} value={pinnedCount} />
          <StatCard label={t.stats.files} value={totalFiles} sub={t.stats.avgPerGist(avgFiles)} />
          <StatCard label={t.stats.totalSize} value={fmtBytes(totalSize)} />
        </div>

        {/* ── Activity timeline ───────────────────────────────────────── */}
        <section className="stats-section">
          <div className="stats-section__title">{t.stats.createdLast12}</div>
          <ActivityChart gists={gists} locale={t.stats.locale} barTooltip={t.stats.barTooltip} />
        </section>

        {/* ── Languages + Categories side by side ─────────────────────── */}
        <div className="stats-two-col">
          <section className="stats-section">
            <div className="stats-section__title">
              {t.stats.languages}
              <span className="stats-section__hint">{t.stats.byFileCount}</span>
            </div>
            {topLangs.length > 0 ? (
              topLangs.map(([lang, count]) => (
                <BarRow
                  key={lang}
                  label={lang}
                  count={count}
                  max={maxLang}
                  color={LANG_COLORS[lang] ?? "var(--accent)"}
                  pctLabel={pct(count, totalFiles)}
                />
              ))
            ) : (
              <p className="stats-empty">{t.stats.noLanguageData}</p>
            )}
          </section>

          <section className="stats-section">
            <div className="stats-section__title">{t.stats.categories}</div>
            {topCats.map((c) => (
              <BarRow
                key={c.category}
                label={categoryLabels[c.category] ?? c.category}
                count={c.count}
                max={maxCat}
                pctLabel={pct(c.count, total)}
              />
            ))}
          </section>
        </div>

        {/* ── Tags ────────────────────────────────────────────────────── */}
        {topTags.length > 0 && (
          <section className="stats-section">
            <div className="stats-section__title">
              {t.stats.tags}
              <span className="stats-section__hint">({t.stats.tagsTotal(tagCounts.length)})</span>
            </div>
            <div className="stats-tags">
              {topTags.map((t) => (
                <div key={t.id} className="stats-tag">
                  <span
                    className="stats-tag__dot"
                    style={{ background: t.color }}
                  />
                  <span className="stats-tag__name">{t.name}</span>
                  <span className="stats-tag__bar-wrap">
                    <span
                      className="stats-tag__bar"
                      style={{
                        width: `${(t.count / maxTag) * 100}%`,
                        background: t.color,
                        opacity: 0.45,
                      }}
                    />
                  </span>
                  <span className="stats-tag__count">{t.count}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
