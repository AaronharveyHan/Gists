import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuAction {
  label: string;
  icon?: string;
  shortcut?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}
export interface ContextMenuSep { separator: true }
export type ContextMenuEntry = ContextMenuAction | ContextMenuSep;

function isSep(e: ContextMenuEntry): e is ContextMenuSep {
  return "separator" in e;
}

export function ContextMenu({
  x, y, items, onClose,
}: {
  x: number; y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, visible: false });
  const [activeIdx, setActiveIdx] = useState(-1);

  // After first paint, flip the menu if it overflows the viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setPos({
      left: x + width > vw - 8 ? Math.max(8, x - width) : x,
      top:  y + height > vh - 8 ? Math.max(8, y - height) : y,
      visible: true,
    });
  }, [x, y]);

  // Close on outside click, second right-click, or scroll.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onCtx  = () => onClose();
    const onScroll = () => onClose();
    const tid = setTimeout(() => {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("contextmenu", onCtx);
      window.addEventListener("scroll", onScroll, true);
    }, 0);
    return () => {
      clearTimeout(tid);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("contextmenu", onCtx);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  // Arrow-key + Enter + Escape navigation.
  useEffect(() => {
    const actionItems = items
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => !isSep(e) && !(e as ContextMenuAction).disabled);

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((prev) => {
          const cur = actionItems.findIndex(({ i }) => i === prev);
          const next = (cur + 1) % actionItems.length;
          return actionItems[next].i;
        });
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((prev) => {
          const cur = actionItems.findIndex(({ i }) => i === prev);
          const next = (cur - 1 + actionItems.length) % actionItems.length;
          return actionItems[next].i;
        });
      }
      if (e.key === "Enter") {
        const item = items[activeIdx];
        if (item && !isSep(item) && !(item as ContextMenuAction).disabled) {
          (item as ContextMenuAction).onClick();
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [items, activeIdx, onClose]);

  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.left, top: pos.top, visibility: pos.visible ? "visible" : "hidden" }}
      role="menu"
    >
      {items.map((item, i) =>
        isSep(item) ? (
          <div key={i} className="ctx-menu__sep" role="separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`ctx-menu__item${item.danger ? " ctx-menu__item--danger" : ""}${activeIdx === i ? " ctx-menu__item--active" : ""}`}
            onMouseEnter={() => setActiveIdx(i)}
            onMouseLeave={() => setActiveIdx(-1)}
            onClick={() => { item.onClick(); onClose(); }}
            disabled={item.disabled}
          >
            {item.icon && <span className="ctx-menu__icon" aria-hidden>{item.icon}</span>}
            <span className="ctx-menu__label">{item.label}</span>
            {item.shortcut && <kbd className="ctx-menu__kbd">{item.shortcut}</kbd>}
          </button>
        )
      )}
    </div>,
    document.body
  );
}
