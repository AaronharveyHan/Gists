import { useGistStore } from "../store/useGistStore";

export function EditorGistTabs() {
  const { openTabIds, gists, selectedId, selectGist, closeTab } = useGistStore();

  if (openTabIds.length === 0) return null;

  return (
    <div className="editor__gist-tabs">
      {openTabIds.map((tabId) => {
        const g = gists.find((x) => x.id === tabId);
        const label = g
          ? (g.description?.trim() || g.files[0]?.filename || tabId.slice(0, 8))
          : tabId.slice(0, 8);
        const isActive = tabId === selectedId;
        return (
          <div
            key={tabId}
            className={`editor__gist-tab${isActive ? " editor__gist-tab--active" : ""}`}
            onClick={() => selectGist(tabId)}
            title={g?.description || label}
          >
            <span className="editor__gist-tab-label">{label}</span>
            <button
              className="editor__gist-tab-close"
              onClick={(e) => { e.stopPropagation(); closeTab(tabId); }}
              title="Close tab"
            >×</button>
          </div>
        );
      })}
    </div>
  );
}
