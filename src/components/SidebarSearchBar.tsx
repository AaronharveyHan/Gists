import { useT } from "../store/useI18nStore";

interface SidebarSearchBarProps {
  searchMode: "keyword" | "semantic";
  onToggleSearchMode: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  semanticBusy: boolean;
  syncStatus: string;
  onSync: () => void;
  onNewGist: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
}

export function SidebarSearchBar({
  searchMode,
  onToggleSearchMode,
  searchQuery,
  onSearchChange,
  onSearchKeyDown,
  semanticBusy,
  syncStatus,
  onSync,
  onNewGist,
  inputRef,
}: SidebarSearchBarProps) {
  const t = useT();

  return (
    <div className="sidebar__top">
      <div className="sidebar__search-wrap">
        {searchMode === "semantic" ? (
          <span className="sidebar__search-icon sidebar__search-icon--semantic" title={t.sidebar.semanticActive}>≈</span>
        ) : (
          <svg className="sidebar__search-icon" viewBox="0 0 16 16" width="14" height="14">
            <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zm-5.242 1.656a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z" />
          </svg>
        )}
        <input
          ref={inputRef}
          className="sidebar__search"
          type="text"
          placeholder={searchMode === "semantic" ? t.sidebar.semanticPlaceholder : t.sidebar.searchPlaceholder}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={onSearchKeyDown}
        />
        {searchMode === "semantic" && semanticBusy && (
          <span className="sidebar__search-spinner" title={t.sidebar.searching}>⋯</span>
        )}
        {searchQuery && !semanticBusy && (
          <button className="sidebar__clear" onClick={() => onSearchChange("")}>
            ✕
          </button>
        )}
        <button
          className={`sidebar__mode-toggle ${searchMode === "semantic" ? "sidebar__mode-toggle--active" : ""}`}
          onClick={onToggleSearchMode}
          title={searchMode === "semantic" ? t.sidebar.switchToKeyword : t.sidebar.switchToSemantic}
        >
          {searchMode === "semantic" ? "⌨" : "≈"}
        </button>
      </div>
      <button
        className={`sidebar__refresh ${syncStatus === "syncing" ? "sidebar__refresh--spinning" : ""}`}
        onClick={onSync}
        title={t.sidebar.sync}
        disabled={syncStatus === "syncing"}
      >
        ↻
      </button>
      <button
        className="sidebar__new"
        data-testid="new-gist-btn"
        onClick={onNewGist}
        title={t.sidebar.newGist}
      >
        ＋
      </button>
    </div>
  );
}
