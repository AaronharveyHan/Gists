import { useEffect, useRef } from "react";
import { aiComplete, getAiConfig } from "../api/tauri";

const MAX_PREFIX_CHARS = 2000;
const DEBOUNCE_MS = 450;

/**
 * Registers a Monaco InlineCompletionsProvider (ghost-text, Copilot-style).
 *
 * @param monacoRef - ref that holds the Monaco namespace (set in handleEditorMount)
 * @param enabled   - whether the feature is currently on
 * @param ready     - true once Monaco has been mounted and monacoRef.current is set
 */
export function useAiInlineCompletion(
  monacoRef: React.MutableRefObject<any>,
  enabled: boolean,
  ready: boolean
) {
  const dispRef = useRef<{ dispose: () => void } | null>(null);

  useEffect(() => {
    dispRef.current?.dispose();
    dispRef.current = null;

    if (!ready || !enabled) return;
    const monaco = monacoRef.current;
    if (!monaco) return;

    dispRef.current = monaco.languages.registerInlineCompletionsProvider("*", {
      provideInlineCompletions: async (
        model: any,
        position: any,
        _ctx: any,
        token: any
      ) => {
        try {
          // Debounce: let the user finish typing before firing the AI request.
          await new Promise<void>((resolve, reject) => {
            const id = setTimeout(resolve, DEBOUNCE_MS);
            token.onCancellationRequested(() => {
              clearTimeout(id);
              reject(new Error("cancelled"));
            });
          });
          if (token.isCancellationRequested) return { items: [] };

          const cfg = await getAiConfig().catch(() => null);
          if (!cfg?.has_key) return { items: [] };
          if (token.isCancellationRequested) return { items: [] };

          const offset = model.getOffsetAt(position);
          const text = model.getValue();
          const prefix = text.slice(Math.max(0, offset - MAX_PREFIX_CHARS), offset);
          // Skip trivially short prefixes (e.g. just whitespace).
          if (prefix.trim().length < 3) return { items: [] };

          const lang = model.getLanguageId?.() ?? "plaintext";
          const completion = await aiComplete([
            {
              role: "system",
              content:
                `You are a code completion assistant integrated in a code editor. ` +
                `Continue the code from exactly where it cuts off. ` +
                `Return ONLY the text to insert — no explanation, no markdown, no code fences. ` +
                `Typically 1–5 lines. Language: ${lang}.`,
            },
            { role: "user", content: prefix },
          ]).catch(() => null);

          if (!completion || token.isCancellationRequested) return { items: [] };

          return {
            items: [
              {
                insertText: completion,
                range: new monaco.Range(
                  position.lineNumber,
                  position.column,
                  position.lineNumber,
                  position.column
                ),
              },
            ],
          };
        } catch {
          return { items: [] };
        }
      },
      freeInlineCompletions: () => {},
    });

    return () => {
      dispRef.current?.dispose();
      dispRef.current = null;
    };
  }, [ready, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  // monacoRef is a stable ref object — its .current changes won't cause re-runs,
  // but `ready` transitions false→true exactly when .current is populated.
}
