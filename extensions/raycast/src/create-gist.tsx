import { Clipboard, showHUD, showToast, Toast } from "@raycast/api";
import { createGistFromText } from "./gist";

/**
 * No-view command: turn whatever is on the clipboard into a new gist.
 * Pushes to GitHub when the app is logged in; otherwise saves a local draft.
 */
export default async function Command() {
  try {
    const text = await Clipboard.readText();
    if (!text || !text.trim()) {
      await showHUD("Clipboard is empty");
      return;
    }
    const res = await createGistFromText(text, "snippet.txt", false);
    if (res.local) {
      await showHUD("Saved as local draft (not logged in)");
    } else {
      await Clipboard.copy(res.url);
      await showHUD("✓ Gist created — URL copied");
    }
  } catch (e) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Create failed",
      message: String(e),
    });
  }
}
