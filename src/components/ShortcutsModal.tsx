import { useEffect } from "react";

// ── Shortcut data ─────────────────────────────────────────────────────────────

interface ShortcutItem {
  keys: string[];   // Each string is one key badge, e.g. ["⌘", "K"]
  desc: string;
}

interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

const GROUPS: ShortcutGroup[] = [
  {
    title: "Navigation",
    items: [
      { keys: ["⌘", "K"],       desc: "Focus search" },
      { keys: ["⌘", "N"],       desc: "New gist" },
      { keys: ["⌘", "P"],       desc: "Command palette" },
      { keys: ["⌘", "R"],       desc: "Sync gists" },
      { keys: ["↑ / ↓"],        desc: "Navigate gist list" },
      { keys: ["Esc"],           desc: "Clear search / close panel" },
    ],
  },
  {
    title: "Editor",
    items: [
      { keys: ["⌘", "F"],       desc: "Find in file" },
      { keys: ["⌘", "H"],       desc: "Find & Replace" },
      { keys: ["⌘", "⇧", "H"], desc: "Toggle history panel" },
      { keys: ["Alt", "["],      desc: "Switch to previous tab" },
      { keys: ["Alt", "]"],      desc: "Switch to next tab" },
      { keys: ["Double-click"],  desc: "Rename file tab" },
      { keys: ["Middle-click"],  desc: "Close file tab" },
    ],
  },
  {
    title: "View",
    items: [
      { keys: ["⌘", "⇧", "F"], desc: "Full-text content search" },
      { keys: ["⌘", "\\"],      desc: "Toggle Zen mode" },
      { keys: ["⌘", "?"],       desc: "This keyboard shortcuts panel" },
    ],
  },
  {
    title: "Sidebar",
    items: [
      { keys: ["Right-click"],   desc: "Context menu on a gist" },
      { keys: ["Right-click"],   desc: "Context menu on a file tab" },
      { keys: ["Select button"], desc: "Enter bulk-select mode" },
    ],
  },
  {
    title: "Vim mode (when enabled)",
    items: [
      { keys: ["i"],             desc: "Insert mode" },
      { keys: ["Esc"],           desc: "Normal mode" },
      { keys: ["j / k"],         desc: "Move down / up" },
      { keys: [":w"],            desc: "Write (auto-save triggers)" },
    ],
  },
  {
    title: "Markdown",
    items: [
      { keys: ["Source"],        desc: "View raw Markdown source" },
      { keys: ["Preview"],       desc: "Rendered preview" },
      { keys: ["Split"],         desc: "Side-by-side editing" },
      { keys: ["Copy button"],   desc: "Copy code block" },
    ],
  },
];

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
          <h2>Keyboard Shortcuts</h2>
          <button className="shortcuts-modal__close" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="shortcuts-modal__body">
          <div className="shortcuts-grid">
            {GROUPS.map((g) => (
              <Group key={g.title} group={g} />
            ))}
          </div>

          <p className="shortcuts-modal__hint">
            Tip: press <KeyBadge k="⌘" /><span className="shortcuts-plus">+</span><KeyBadge k="?" /> anytime to open this panel.
          </p>
        </div>
      </div>
    </div>
  );
}
