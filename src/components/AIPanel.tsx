import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import type { GistFile } from "../api/tauri";
import { aiChat, listTags, createTag, setGistTags, getGistTags } from "../api/tauri";
import { PromptLibrary } from "./PromptLibrary";
import { useT } from "../store/useI18nStore";
import { useChatStore } from "../store/useChatStore";
import { useGistStore } from "../store/useGistStore";
import { notify } from "../store/useNotificationStore";

const SYSTEM_PROMPT =
  "You are a helpful coding assistant integrated into a GitHub Gists manager. " +
  "Help users understand, improve, and organize their code snippets. " +
  "Be concise and practical.";

const TAG_PALETTE = [
  "#6366f1","#f59e0b","#10b981","#ef4444",
  "#3b82f6","#8b5cf6","#ec4899","#14b8a6",
];

const PRESETS = [
  {
    id: "explain",
    label: "Explain",
    build: (ctx: string) =>
      `Explain what this code does in clear, simple terms:\n\n${ctx}`,
  },
  {
    id: "optimize",
    label: "Optimize",
    build: (ctx: string) =>
      `Review this code and suggest concrete improvements for readability, ` +
      `performance, and best practices:\n\n${ctx}`,
  },
  {
    id: "tags",
    label: "Tags",
    build: (ctx: string) =>
      `Suggest 3-5 concise tags to categorize this code snippet. ` +
      `Return ONLY the tag names, one per line, no explanations:\n\n${ctx}`,
  },
  {
    id: "describe",
    label: "Description",
    build: (ctx: string) =>
      `Write a concise one-line description (under 80 chars) for this gist. ` +
      `Return ONLY the description text, nothing else:\n\n${ctx}`,
  },
] as const;

type PresetId = typeof PRESETS[number]["id"];

type Msg = import("../store/useChatStore").ChatMsg;

interface Props {
  gistId: string;
  files: GistFile[];
  description: string;
  onApplyDescription: (desc: string) => void;
  onClose: () => void;
}

export function AIPanel({ gistId, files, description, onApplyDescription, onClose }: Props) {
  const t = useT();
  const { createLocalGist } = useGistStore();
  const { history, setHistory, clearHistory } = useChatStore();
  const [msgs, setMsgs] = useState<Msg[]>(() => history[gistId] ?? []);
  const [streaming, setStreaming] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [input, setInput] = useState("");
  const [lastPreset, setLastPreset] = useState<PresetId | null>(null);
  const [applyingTags, setApplyingTags] = useState(false);
  const [showPromptLib, setShowPromptLib] = useState(false);
  const [exporting, setExporting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load history when gistId changes (e.g. switching gists with panel open)
  useEffect(() => {
    setMsgs(history[gistId] ?? []);
    setLastPreset(null);
  }, [gistId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist whenever msgs change
  useEffect(() => {
    setHistory(gistId, msgs);
  }, [msgs]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, liveText]);

  const buildContext = useCallback((): string => {
    const parts: string[] = [];
    if (description.trim()) parts.push(`Description: ${description}`);
    for (const f of files) {
      const lang = f.language ?? "text";
      const body =
        f.content.length > 4000
          ? f.content.slice(0, 4000) + "\n[…truncated]"
          : f.content;
      parts.push(`File: ${f.filename} (${lang})\n\`\`\`${lang.toLowerCase()}\n${body}\n\`\`\``);
    }
    return parts.join("\n\n");
  }, [files, description]);

  const runChat = useCallback(
    async (
      userContent: string,
      historyForApi: Msg[],
      actionLabel?: string
    ) => {
      setStreaming(true);
      setLiveText("");

      const apiMessages = [
        { role: "system" as const, content: SYSTEM_PROMPT },
        ...historyForApi.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: userContent },
      ];

      const streamId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      let accumulated = "";

      const ulChunk = await listen<string>(`ai-chunk-${streamId}`, (e) => {
        accumulated += e.payload;
        setLiveText(accumulated);
      });

      const ulDone = await listen(`ai-done-${streamId}`, () => {
        const finalAcc = accumulated;
        setMsgs((prev) => [
          ...prev,
          { role: "user", content: userContent, actionLabel },
          { role: "assistant", content: finalAcc },
        ]);
        setLiveText("");
        setStreaming(false);
        ulChunk();
        ulDone();
      });

      try {
        await aiChat(streamId, apiMessages);
      } catch (err) {
        const errText = `Error: ${String(err)}`;
        setMsgs((prev) => [
          ...prev,
          { role: "user", content: userContent, actionLabel },
          { role: "assistant", content: errText },
        ]);
        setLiveText("");
        setStreaming(false);
        ulChunk();
        ulDone();
      }
    },
    []
  );

  const handlePreset = useCallback(
    (presetId: PresetId) => {
      if (streaming) return;
      const preset = PRESETS.find((p) => p.id === presetId)!;
      const ctx = buildContext();
      setMsgs([]);
      setLastPreset(presetId);
      runChat(preset.build(ctx), [], preset.label);
    },
    [streaming, buildContext, runChat]
  );

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    const ctx = buildContext();
    const fullContent = `Context:\n${ctx}\n\n${text}`;
    // Use real text as the visible user message, but send full context to API.
    const historyForApi = msgs.map((m) => ({ ...m, content: m.content }));
    runChat(fullContent, historyForApi);
    // Immediately append the readable user message.
    setMsgs((prev) => [...prev, { role: "user", content: text }]);
  }, [input, streaming, buildContext, msgs, runChat]);

  // Derived: last assistant message for action-specific widgets.
  const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");

  const suggestedTags: string[] | null = (() => {
    if (lastPreset !== "tags" || !lastAssistant) return null;
    const lines = lastAssistant.content
      .split(/[\n,]/)
      .map((t) => t.trim().replace(/^[-*•·`]+/, "").replace(/`+$/, "").trim())
      .filter((t) => t.length > 0 && t.length < 32 && !t.includes(":"))
      .slice(0, 6);
    return lines.length ? lines : null;
  })();

  const suggestedDesc: string | null =
    lastPreset === "describe" && lastAssistant
      ? lastAssistant.content.trim().slice(0, 120)
      : null;

  const handleApplyTags = async () => {
    if (!suggestedTags) return;
    setApplyingTags(true);
    try {
      const [all, existing] = await Promise.all([listTags(), getGistTags(gistId)]);
      const ids = new Set(existing.map((t) => t.id));
      let colorIdx = all.length;
      for (const name of suggestedTags) {
        const found = all.find((t) => t.name.toLowerCase() === name.toLowerCase());
        if (found) {
          ids.add(found.id);
        } else {
          const newTag = await createTag(
            name,
            TAG_PALETTE[colorIdx++ % TAG_PALETTE.length]
          );
          ids.add(newTag.id);
        }
      }
      await setGistTags(gistId, [...ids]);
    } finally {
      setApplyingTags(false);
    }
  };

  const handleClear = () => {
    if (msgs.length === 0) return;
    if (!confirm(t.ai.clearHistoryConfirm)) return;
    setMsgs([]);
    clearHistory(gistId);
    setLastPreset(null);
  };

  const handleExportToGist = async () => {
    if (msgs.length === 0) { notify(t.ai.noHistoryToExport); return; }
    setExporting(true);
    try {
      const gistName = description.trim() || files[0]?.filename || gistId.slice(0, 8);
      const header = t.ai.chatHeader(gistName);
      const date = new Date().toISOString().slice(0, 10);
      const lines: string[] = [`# ${header}`, `_${date}_`, ""];
      for (const m of msgs) {
        if (m.role === "user") {
          const label = m.actionLabel ?? "You";
          lines.push(`**${label}**`, "");
        } else {
          lines.push("**Assistant**", "");
          lines.push(m.content, "");
        }
        lines.push("---", "");
      }
      const filename = `ai-chat-${date}.md`;
      await createLocalGist(header, false, [[filename, lines.join("\n")]]);
      notify(t.ai.exportSuccess, "success");
    } finally {
      setExporting(false);
    }
  };

  const presetLabels: Record<string, string> = {
    explain: t.ai.explain,
    optimize: t.ai.optimize,
    tags: t.ai.tags,
    describe: t.ai.description,
  };

  return (
    <div className="ai-panel">
      <div className="ai-panel__head">
        <span className="ai-panel__title">{t.ai.title}</span>
        <div className="ai-panel__head-actions">
          {msgs.length > 0 && (
            <button
              className="ai-panel__head-btn"
              onClick={handleExportToGist}
              disabled={exporting || streaming}
              title={t.ai.exportChatTitle}
            >
              {exporting ? "…" : t.ai.exportChat}
            </button>
          )}
          {msgs.length > 0 && (
            <button
              className="ai-panel__head-btn ai-panel__head-btn--danger"
              onClick={handleClear}
              disabled={streaming}
              title={t.ai.clearHistory}
            >
              {t.ai.clearHistory}
            </button>
          )}
          <button className="ai-panel__close" onClick={onClose} title={t.ai.closeTitle}>
            ×
          </button>
        </div>
      </div>

      {/* Quick action chips */}
      <div className="ai-panel__chips">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            className={`ai-chip${lastPreset === p.id ? " ai-chip--active" : ""}`}
            onClick={() => handlePreset(p.id)}
            disabled={streaming}
            title={presetLabels[p.id] ?? p.label}
          >
            {presetLabels[p.id] ?? p.label}
          </button>
        ))}
        <button
          className="ai-chip ai-chip--prompts"
          onClick={() => setShowPromptLib(true)}
          title={t.ai.promptsTitle}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style={{ marginRight: 4 }}>
            <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8Z"/>
          </svg>
          {t.ai.prompts}
        </button>
      </div>

      {showPromptLib && (
        <PromptLibrary
          onInsert={(text) => {
            setInput((prev) => prev ? prev + "\n\n" + text : text);
            setTimeout(() => textareaRef.current?.focus(), 50);
          }}
          onClose={() => setShowPromptLib(false)}
        />
      )}

      {/* Conversation */}
      <div className="ai-panel__messages">
        {msgs.length === 0 && !streaming && (
          <div className="ai-panel__empty">
            {t.ai.defaultPrompt}
          </div>
        )}

        {msgs.map((m, i) => {
          if (m.role === "user") {
            return (
              <div key={i} className="ai-msg ai-msg--user">
                {m.actionLabel ? (
                  <span className="ai-msg__action-label">{m.actionLabel}</span>
                ) : (
                  <span className="ai-msg__user-text">{m.content}</span>
                )}
              </div>
            );
          }
          return (
            <div key={i} className="ai-msg ai-msg--assistant">
              <div className="ai-msg__body">{m.content}</div>
            </div>
          );
        })}

        {streaming && liveText && (
          <div className="ai-msg ai-msg--assistant ai-msg--live">
            <div className="ai-msg__body">
              {liveText}
              <span className="ai-cursor" />
            </div>
          </div>
        )}
        {streaming && !liveText && (
          <div className="ai-msg ai-msg--assistant">
            <span className="ai-dots">
              <span /><span /><span />
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Apply Tags widget */}
      {suggestedTags && !streaming && (
        <div className="ai-panel__action-row">
          <div className="ai-panel__tag-list">
            {suggestedTags.map((t) => (
              <span key={t} className="ai-tag">{t}</span>
            ))}
          </div>
          <button
            className="btn btn--primary"
            onClick={handleApplyTags}
            disabled={applyingTags}
          >
            {applyingTags ? t.ai.applying : t.ai.applyTags}
          </button>
        </div>
      )}

      {/* Apply Description widget */}
      {suggestedDesc && !streaming && lastPreset === "describe" && (
        <div className="ai-panel__action-row ai-panel__action-row--desc">
          <span className="ai-panel__desc-preview">{suggestedDesc}</span>
          <button className="btn btn--primary" onClick={() => onApplyDescription(suggestedDesc)}>
            {t.ai.use}
          </button>
        </div>
      )}

      {/* Chat input */}
      <div className="ai-panel__footer">
        <textarea
          ref={textareaRef}
          className="ai-panel__textarea"
          rows={2}
          placeholder={t.ai.inputPlaceholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={streaming}
        />
        <button
          className="btn btn--primary ai-panel__send-btn"
          onClick={handleSend}
          disabled={streaming || !input.trim()}
        >
          {streaming ? "…" : t.ai.send}
        </button>
      </div>
    </div>
  );
}
