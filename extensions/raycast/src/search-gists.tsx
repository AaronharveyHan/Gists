import { useEffect, useState } from "react";
import {
  List,
  ActionPanel,
  Action,
  Icon,
  Clipboard,
  showToast,
  Toast,
} from "@raycast/api";
import { searchGists, viewGist, Gist } from "./gist";

export default function Command() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Gist[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    searchGists(query)
      .then((gs) => active && setItems(gs))
      .catch((e) =>
        showToast({
          style: Toast.Style.Failure,
          title: "gist CLI failed",
          message: String(e),
        }),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [query]);

  return (
    <List
      isLoading={loading}
      onSearchTextChange={setQuery}
      searchBarPlaceholder="Search gists — try tag: lang: is: …"
      throttle
    >
      {items.map((g) => (
        <List.Item
          key={g.id}
          icon={g.local ? Icon.HardDrive : g.public ? Icon.Globe : Icon.Lock}
          title={g.description || g.files[0] || "(untitled)"}
          subtitle={g.files.join(", ")}
          accessories={g.language ? [{ tag: g.language }] : []}
          actions={
            <ActionPanel>
              {!g.local && <Action.OpenInBrowser url={g.url} />}
              <Action
                title="Copy Content"
                icon={Icon.Clipboard}
                onAction={async () => {
                  try {
                    const content = await viewGist(g.id);
                    await Clipboard.copy(content);
                    await showToast({ title: "Copied gist content" });
                  } catch (e) {
                    await showToast({
                      style: Toast.Style.Failure,
                      title: "Copy failed",
                      message: String(e),
                    });
                  }
                }}
              />
              {!g.local && (
                <Action.CopyToClipboard
                  title="Copy URL"
                  content={g.url}
                  shortcut={{ modifiers: ["cmd"], key: "." }}
                />
              )}
            </ActionPanel>
          }
        />
      ))}
      {!loading && items.length === 0 && (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title="No gists found"
          description="Save one from the app or with `gist save <file>`."
        />
      )}
    </List>
  );
}
