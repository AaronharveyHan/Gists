import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { aiChat, getAiConfig } from "../api/tauri";
import { useT } from "../store/useI18nStore";
import { notify } from "../store/useNotificationStore";

export type AIAction = "rewrite" | "translate" | "tests";

const SYSTEM_PROMPT =
  "You are an expert programmer integrated into a code-snippet editor. " +
  "Follow the instruction exactly and return only what is asked, with no preamble.";

const TARGET_LANGS = [
  "Python", "JavaScript", "TypeScript", "Rust", "Go", "Java",
  "C++", "C#", "Ruby", "PHP", "Shell", "Swift", "Kotlin", "SQL",
];

/** Pull the first fenced code block out of the AI output; fall back to trimmed text. */
function extractCode(text: string): string {
  const m = text.match(/```[^\n]*\n([\s\S]*?)```/);
  return (m ? m[1] : text).trim();
}

interface Props {
  action: AIAction;
  /** Selected source text. */
  code: string;
  /** Monaco language id of the active file, e.g. "python". */
  language: string;
  onReplace: (text: string) => void;
  onInsertBelow: (text: string) => void;
  onClose: () => void;
}

export function AISelectionModal({
  action,
  code,
  language,
  onReplace,
  onInsertBelow,
  onClose,
}: Props) {
  const t = useT();
  const [target, setTarget] = useState(
    TARGET_LANGS.find((l) => l.toLowerCase() !== (language || "").toLowerCase()) ?? "Python",
  );
  const [streaming, setStreaming] = useState(false);
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const buildPrompt = useCallback(
    (tgt: string): string => {
      const lang = language || "text";
      const fence = lang.toLowerCase();
      const block = `\`\`\`${fence}\n${code}\n\`\`\``;
      switch (action) {
        case "rewrite":
          return (
            `Rewrite the following ${lang} code to improve readability, naming and ` +
            `best practices. Keep the same behavior and the same language. ` +
            `Return ONLY the rewritten code in a single code block, no explanation.\n\n${block}`
          );
        case "translate":
          return (
            `Translate the following ${lang} code to ${tgt}. Preserve behavior and use ` +
            `idiomatic ${tgt}. Return ONLY the translated code in a single code block, ` +
            `no explanation.\n\n${block}`
          );
        case "tests":
          return (
            `Write thorough unit tests for the following ${lang} code using the ` +
            `conventional ${lang} testing framework. Return ONLY the test code in a ` +
            `single code block, no explanation.\n\n${block}`
          );
      }
    },
    [action, code, language],
  );

  const start = useCallback(
    async (tgt: string) => {
      cleanupRef.current?.();
      setStreaming(true);
      setText("");
      setDone(false);
      setError(null);
      setStarted(true);

      const streamId = `sel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      let acc = "";
      const ulChunk = await listen<string>(`ai-chunk-${streamId}`, (e) => {
        acc += e.payload;
        setText(acc);
      });
      const ulDone = await listen(`ai-done-${streamId}`, () => {
        setStreaming(false);
        setDone(true);
        ulChunk();
        ulDone();
        cleanupRef.current = null;
      });
      cleanupRef.current = () => {
        ulChunk();
        ulDone();
      };

      try {
        await aiChat(streamId, [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildPrompt(tgt) },
        ]);
      } catch (err) {
        setError(String(err));
        setStreaming(false);
        ulChunk();
        ulDone();
        cleanupRef.current = null;
      }
    },
    [buildPrompt],
  );

  // Check config, then auto-start for rewrite/tests (translate waits for a target).
  useEffect(() => {
    let cancelled = false;
    getAiConfig()
      .then((cfg) => {
        if (cancelled) return;
        if (!cfg.has_key) {
          setError(t.ai.notConfigured);
          return;
        }
        if (action !== "translate") void start(target);
      })
      .catch(() => {
        if (!cancelled) setError(t.ai.notConfigured);
      });
    return () => {
      cancelled = true;
      cleanupRef.current?.();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc closes (capture phase so it doesn't bubble into editor shortcuts).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose]);

  const result = extractCode(text);
  const canApply = done && result.length > 0;
  const titleMap: Record<AIAction, string> = {
    rewrite: t.ai.actionRewrite,
    translate: t.ai.actionTranslate,
    tests: t.ai.actionTests,
  };

  const handleCopy = async () => {
    await writeText(result);
    notify(t.ai.copied, "success");
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="ai-sel-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ai-sel-modal__head">
          <span className="ai-sel-modal__title">{titleMap[action]}</span>
          <button className="btn ai-sel-modal__close" onClick={onClose}>
            ×
          </button>
        </div>

        {action === "translate" && (
          <div className="ai-sel-modal__bar">
            <label className="ai-sel-modal__bar-label">{t.ai.translateTo}</label>
            <select
              className="ai-sel-modal__select"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={streaming}
            >
              {TARGET_LANGS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <button
              className="btn btn--primary"
              onClick={() => void start(target)}
              disabled={streaming}
            >
              {started && !streaming ? t.ai.regenerate : t.ai.translateGo}
            </button>
          </div>
        )}

        {error ? (
          <div className="ai-sel-modal__error">{error}</div>
        ) : (
          <pre className="ai-sel-modal__output">
            {result ||
              (!streaming && action === "translate" ? t.ai.pickLanguageHint : "")}
            {streaming && <span className="ai-cursor" />}
          </pre>
        )}

        <div className="ai-sel-modal__actions">
          <span className="ai-sel-modal__hint">{streaming ? t.ai.generating : ""}</span>
          <button className="btn" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button className="btn" disabled={!canApply} onClick={handleCopy}>
            {t.ai.copy}
          </button>
          <button
            className="btn"
            disabled={!canApply}
            onClick={() => {
              onInsertBelow(result);
              onClose();
            }}
          >
            {t.ai.insertBelow}
          </button>
          <button
            className="btn btn--primary"
            disabled={!canApply}
            onClick={() => {
              onReplace(result);
              onClose();
            }}
          >
            {t.ai.replaceSelection}
          </button>
        </div>
      </div>
    </div>
  );
}
