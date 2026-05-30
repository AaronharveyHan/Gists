/**
 * Renders Markdown as React elements (no raw HTML by default).
 * remark-gfm: tables, strikethrough, task lists, autolinks, etc.
 * Fenced ```mermaid blocks → SVG via mermaid (lazy-loaded).
 * [[gist-name]] wiki-links → clickable, navigate to that gist.
 */
import { Children, isValidElement, useState, type ReactNode } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidBlock } from "./MermaidBlock";
import { resolveWikiLink } from "../api/tauri";
import { useGistStore } from "../store/useGistStore";

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) return extractText(node.props.children);
  return "";
}

function isMermaidPre(children: ReactNode): string | null {
  const nodes = Children.toArray(children);
  const first = nodes[0];
  if (!isValidElement(first)) return null;
  const cls =
    typeof first.props.className === "string" ? first.props.className : "";
  if (!cls.split(/\s+/).includes("language-mermaid")) return null;
  const raw = first.props.children;
  const text =
    typeof raw === "string"
      ? raw
      : Array.isArray(raw)
        ? raw.map((c) => (typeof c === "string" ? c : "")).join("")
        : String(raw ?? "");
  return text.replace(/\n$/, "");
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      className={`md-copy-btn ${copied ? "md-copy-btn--copied" : ""}`}
      onClick={handleCopy}
      title="Copy to clipboard"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function MarkdownPre({
  children,
  ...rest
}: React.ComponentPropsWithoutRef<"pre">) {
  const mermaidSrc = isMermaidPre(children);
  if (mermaidSrc !== null) {
    return <MermaidBlock chart={mermaidSrc} />;
  }
  const text = extractText(children);
  return (
    <div className="md-pre-wrap">
      <CopyButton text={text} />
      <pre {...rest}>{children}</pre>
    </div>
  );
}

/** Intercept gist:// links (from [[name]] preprocessing) to navigate in-app. */
function MarkdownAnchor({
  href,
  children,
  ...rest
}: React.ComponentPropsWithoutRef<"a">) {
  if (href?.startsWith("gist://")) {
    const linkText = decodeURIComponent(href.slice("gist://".length));
    const handleClick = async (e: React.MouseEvent) => {
      e.preventDefault();
      const gist = await resolveWikiLink(linkText).catch(() => null);
      if (gist) {
        useGistStore.getState().selectGist(gist.id);
      }
    };
    return (
      <button className="md-wiki-link" onClick={handleClick} title={`Open [[${linkText}]]`}>
        {children}
      </button>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  );
}

/**
 * Convert [[gist-name]] into markdown links `[name](gist://name)` so
 * react-markdown can parse them. Code spans and fenced blocks are skipped.
 */
function preprocessWikiLinks(text: string): string {
  // Temporarily hide fenced code blocks so we don't transform [[...]] inside them.
  const fences: string[] = [];
  const hideFenced = text.replace(
    /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm,
    (m) => { fences.push(m); return `\x00FENCE${fences.length - 1}\x00`; }
  );

  // Also hide inline code spans.
  const inlines: string[] = [];
  const hideInline = hideFenced.replace(/`[^`\n]+`/g, (m) => {
    inlines.push(m);
    return `\x00INLINE${inlines.length - 1}\x00`;
  });

  // Replace [[name]] with markdown link notation.
  const linked = hideInline.replace(/\[\[([^\][\n]{1,200})\]\]/g, (_, name) => {
    const trimmed = name.trim();
    if (!trimmed) return `[[${name}]]`;
    return `[${trimmed}](gist://${encodeURIComponent(trimmed)})`;
  });

  // Restore hidden blocks.
  const restored = linked
    .replace(/\x00FENCE(\d+)\x00/g, (_, i) => fences[parseInt(i)])
    .replace(/\x00INLINE(\d+)\x00/g, (_, i) => inlines[parseInt(i)]);

  return restored;
}

const markdownComponents: Partial<Components> = {
  pre: MarkdownPre,
  a: MarkdownAnchor,
};

export function MarkdownPreview({
  markdown,
  showCopyAll,
}: {
  markdown: string;
  showCopyAll?: boolean;
}) {
  return (
    <article className="markdown-preview">
      {showCopyAll && (
        <div className="md-copy-all-wrap">
          <CopyButton text={markdown} />
        </div>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
        skipHtml={true}
      >
        {preprocessWikiLinks(markdown)}
      </ReactMarkdown>
    </article>
  );
}
