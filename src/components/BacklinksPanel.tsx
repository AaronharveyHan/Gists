import { useState, useEffect } from "react";
import { getBacklinks } from "../api/tauri";
import type { Gist } from "../api/tauri";
import { useT } from "../store/useI18nStore";

interface Props {
  gistId: string;
  gistName: string;
  onOpen: (id: string) => void;
  onClose: () => void;
}

export function BacklinksPanel({ gistId, gistName, onOpen, onClose }: Props) {
  const t = useT();
  const [links, setLinks] = useState<Gist[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getBacklinks(gistId)
      .then(setLinks)
      .catch(() => setLinks([]))
      .finally(() => setLoading(false));
  }, [gistId]);

  const hint = t.backlinks.noBacklinksHint.replace("{{name}}", gistName);

  return (
    <div className="side-panel backlinks-panel" data-testid="backlinks-panel">
      <div className="side-panel__header">
        <span className="side-panel__title">
          {t.backlinks.panelTitle}
          {!loading && links.length > 0 && (
            <span className="backlinks-panel__count">{links.length}</span>
          )}
        </span>
        <button className="side-panel__close" onClick={onClose} title="Close">×</button>
      </div>
      <div className="side-panel__body">
        {loading ? (
          <div className="backlinks-panel__empty">{"…"}</div>
        ) : links.length === 0 ? (
          <div className="backlinks-panel__empty">
            <div className="backlinks-panel__empty-title">{t.backlinks.noBacklinks}</div>
            <div className="backlinks-panel__empty-hint">{hint}</div>
          </div>
        ) : (
          <ul className="backlinks-panel__list">
            {links.map((g) => {
              const name = g.description?.trim() || g.files[0]?.filename || g.id.slice(0, 8);
              const sub = g.description?.trim() ? g.files[0]?.filename : undefined;
              return (
                <li key={g.id} className="backlinks-panel__item">
                  <button
                    className="backlinks-panel__link"
                    title={t.backlinks.linkTooltip}
                    onClick={() => onOpen(g.id)}
                  >
                    <span className="backlinks-panel__link-name">{name}</span>
                    {sub && <span className="backlinks-panel__link-sub">{sub}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
