import { useEffect } from "react";
import { useT } from "../store/useI18nStore";
import type { Translations } from "../i18n/translations";

// ── Shortcut data ─────────────────────────────────────────────────────────────

interface ShortcutItem {
  keys: string[];   // Each string is one key badge, e.g. ["⌘", "K"]
  desc: string;
}

interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

// Key badges are language-agnostic; titles and descriptions resolve from `t`.
function buildGroups(t: Translations): ShortcutGroup[] {
  const g = t.shortcuts.groups;
  const d = t.shortcuts.desc;
  return [
    {
      title: g.navigation,
      items: [
        { keys: ["⌘", "K"],       desc: d.focusSearch },
        { keys: ["⌘", "N"],       desc: d.newGist },
        { keys: ["⌘", "P"],       desc: d.commandPalette },
        { keys: ["⌘", "R"],       desc: d.syncGists },
        { keys: ["↑ / ↓"],        desc: d.navigateList },
        { keys: ["Esc"],           desc: d.clearSearch },
      ],
    },
    {
      title: g.editor,
      items: [
        { keys: ["⌘", "F"],       desc: d.findInFile },
        { keys: ["⌘", "H"],       desc: d.findReplace },
        { keys: ["⌘", "⇧", "H"], desc: d.toggleHistory },
        { keys: ["Alt", "["],      desc: d.prevTab },
        { keys: ["Alt", "]"],      desc: d.nextTab },
        { keys: ["Double-click"],  desc: d.renameTab },
        { keys: ["Middle-click"],  desc: d.closeTab },
      ],
    },
    {
      title: g.view,
      items: [
        { keys: ["⌘", "⇧", "F"], desc: d.fullTextSearch },
        { keys: ["⌘", "\\"],      desc: d.toggleZen },
        { keys: ["⌘", "?"],       desc: d.thisPanel },
      ],
    },
    {
      title: g.sidebar,
      items: [
        { keys: ["Right-click"],   desc: d.ctxGist },
        { keys: ["Right-click"],   desc: d.ctxTab },
        { keys: ["Select button"], desc: d.bulkSelect },
      ],
    },
    {
      title: g.vim,
      items: [
        { keys: ["i"],             desc: d.insertMode },
        { keys: ["Esc"],           desc: d.normalMode },
        { keys: ["j / k"],         desc: d.moveDownUp },
        { keys: [":w"],            desc: d.write },
      ],
    },
    {
      title: g.markdown,
      items: [
        { keys: ["Source"],        desc: d.viewSource },
        { keys: ["Preview"],       desc: d.renderedPreview },
        { keys: ["Split"],         desc: d.splitEdit },
        { keys: ["Copy button"],   desc: d.copyCode },
      ],
    },
  ];
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KeyBadge({ k }: { k: string }) {
  const isWord = k.length > 2 && !["Esc", "Alt", "Tab", "↑ / ↓", "j / k", ":w"].includes(k);
  return (
    <span className={`shortcuts-kbd ${isWord ? "shortcuts-kbd--word" : ""}`}>{k}</span>
  );
}

function ShortcutRow({ item }: { item: ShortcutItem }) {
  return (
    <div className="shortcuts-row">
      <span className="shortcuts-keys">
        {item.keys.map((k, i) => (
          <span key={i} className="shortcuts-key-group">
            {i > 0 && <span className="shortcuts-plus">+</span>}
            <KeyBadge k={k} />
          </span>
        ))}
      </span>
      <span className="shortcuts-desc">{item.desc}</span>
    </div>
  );
}

function Group({ group }: { group: ShortcutGroup }) {
  return (
    <section className="shortcuts-group">
      <h3 className="shortcuts-group__title">{group.title}</h3>
      {group.items.map((item, i) => (
        <ShortcutRow key={i} item={item} />
      ))}
    </section>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const groups = buildGroups(t);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="modal shortcuts-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="shortcuts-modal__head">
          <h2>{t.shortcuts.title}</h2>
          <button className="shortcuts-modal__close" onClick={onClose} title={t.shortcuts.close}>✕</button>
        </div>

        <div className="shortcuts-modal__body">
          <div className="shortcuts-grid">
            {groups.map((g) => (
              <Group key={g.title} group={g} />
            ))}
          </div>

          <p className="shortcuts-modal__hint">
            {t.shortcuts.hintPre}<KeyBadge k="⌘" /><span className="shortcuts-plus">+</span><KeyBadge k="?" />{t.shortcuts.hintPost}
          </p>
        </div>
      </div>
    </div>
  );
}
