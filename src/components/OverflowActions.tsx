/**
 * Overflow toolbar: renders as many action items as fit in the available width.
 * Items that don't fit collapse into a "⋯" dropdown, ordered by priority.
 *
 * Measurement strategy:
 * - A hidden shadow row (position:absolute, visibility:hidden) always contains
 *   all items, giving accurate per-item widths without layout side-effects.
 * - A ResizeObserver on the visible container triggers recalculation whenever
 *   the container width changes.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface OverflowItem {
  key: string;
  /**
   * Lower number = higher priority = stays visible longer.
   * Items with priority 1 are never collapsed.
   */
  priority: number;
  /** Full interactive node rendered in the toolbar. */
  node: React.ReactNode;
  /** Label shown in the ⋯ dropdown. */
  menuLabel: string;
  menuOnClick?: () => void;
  menuDisabled?: boolean;
  menuDanger?: boolean;
  /** When true the item is not rendered at all (conditional items). */
  hidden?: boolean;
  /** Never shown in toolbar — always appears in ⋯ dropdown menu. */
  alwaysOverflow?: boolean;
  /** Visual separator — rendered as a 1px divider, not shown in dropdown. */
  isSeparator?: boolean;
}

export function OverflowActions({ items }: { items: OverflowItem[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const moreWrapRef = useRef<HTMLDivElement>(null);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);

  const activeItems = items.filter((i) => !i.hidden && !i.alwaysOverflow);

  // Ref so recalculate can read the latest list without being recreated on
  // every render. Without this, useCallback([activeItems]) would produce a new
  // function on every render (new array reference), causing the ResizeObserver
  // effect to re-run, call setHiddenKeys, trigger a re-render, and loop.
  const activeItemsRef = useRef(activeItems);
  activeItemsRef.current = activeItems;

  const recalculate = useCallback(() => {
    const container = containerRef.current;
    const shadow = shadowRef.current;
    if (!container || !shadow) return;

    const cur = activeItemsRef.current;
    const containerW = container.clientWidth;
    const shadowChildren = Array.from(shadow.children) as HTMLElement[];
    // Last child in shadow is always the ⋯ sentinel button.
    const moreW = shadowChildren[shadowChildren.length - 1]?.offsetWidth ?? 36;

    // Map key → measured width from the shadow row.
    const widths = new Map<string, number>();
    cur.forEach((item, i) => {
      widths.set(item.key, shadowChildren[i]?.offsetWidth ?? 0);
    });

    const totalW = cur.reduce((s, i) => s + (widths.get(i.key) ?? 0), 0);

    if (totalW <= containerW || containerW === 0) {
      // Only update state if it actually changed to avoid a spurious re-render.
      setHiddenKeys((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }

    // Collapse items from highest priority-number downward (never collapse priority 1).
    const collapsible = cur
      .filter((i) => i.priority > 1)
      .sort((a, b) => b.priority - a.priority);

    const newHidden = new Set<string>();
    // Reserve room for the ⋯ button.
    let used = totalW + moreW;

    for (const item of collapsible) {
      if (used <= containerW) break;
      newHidden.add(item.key);
      used -= widths.get(item.key) ?? 0;
    }

    setHiddenKeys((prev) => {
      // Bail out if hidden set didn't change — prevents unnecessary re-renders.
      if (prev.size === newHidden.size && [...newHidden].every((k) => prev.has(k)))
        return prev;
      return newHidden;
    });
  }, []); // stable — no deps; reads activeItems via ref

  // Wire up ResizeObserver once (recalculate is stable so this runs once).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(recalculate);
    ro.observe(container);
    recalculate();
    return () => ro.disconnect();
  }, [recalculate]);

  // Re-measure when the set of visible items changes. ResizeObserver only fires
  // on container-width changes, not on prop changes.
  const activeItemKeys = activeItems.map((i) => i.key).join("\0");
  useEffect(() => {
    recalculate();
  }, [activeItemKeys, recalculate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close dropdown on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!moreWrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Close dropdown on Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [menuOpen]);

  const overflowItems = [
    ...activeItems.filter((i) => hiddenKeys.has(i.key) && !i.isSeparator),
    ...items.filter((i) => !i.hidden && i.alwaysOverflow),
  ].sort((a, b) => a.priority - b.priority);

  return (
    <>
      {/* ── Shadow row for measurement (never visible to user) ── */}
      <div ref={shadowRef} className="overflow-actions__shadow" aria-hidden="true">
        {activeItems.map((item) => (
          <span key={`s_${item.key}`} className="overflow-actions__shadow-item">
            {item.node}
          </span>
        ))}
        {/* Sentinel to measure the ⋯ button width */}
        <button className="btn overflow-actions__more-btn" tabIndex={-1}>⋯</button>
      </div>

      {/* ── Visible toolbar ── */}
      <div ref={containerRef} className="overflow-actions">
        {activeItems.map((item) =>
          item.isSeparator ? (
            <span
              key={item.key}
              className="toolbar-sep"
              aria-hidden
              style={hiddenKeys.has(item.key) ? { display: "none" } : undefined}
            />
          ) : (
            <span
              key={item.key}
              style={hiddenKeys.has(item.key) ? { display: "none" } : undefined}
            >
              {item.node}
            </span>
          )
        )}

        {overflowItems.length > 0 && (
          <div ref={moreWrapRef} className="overflow-actions__more-wrap">
            <button
              className="btn overflow-actions__more-btn"
              onClick={() => setMenuOpen((o) => !o)}
              title="更多操作"
              aria-haspopup="true"
              aria-expanded={menuOpen}
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="overflow-actions__menu" role="menu">
                {overflowItems.map((item) => (
                  <button
                    key={item.key}
                    role="menuitem"
                    className={[
                      "overflow-actions__menu-item",
                      item.menuDanger ? "overflow-actions__menu-item--danger" : "",
                    ].join(" ").trim()}
                    onClick={() => { item.menuOnClick?.(); setMenuOpen(false); }}
                    disabled={item.menuDisabled}
                  >
                    {item.menuLabel}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
