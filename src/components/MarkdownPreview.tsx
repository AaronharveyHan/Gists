/**
 * Renders Markdown as React elements (no raw HTML by default).
 * remark-gfm: tables, strikethrough, task lists, autolinks, etc.
 * Fenced ```mermaid blocks → SVG via mermaid (lazy-loaded).
 */
import { Children, isValidElement, useState, type ReactNode } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidBlock } from "./MermaidBlock";

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

const markdownComponents: Partial<Components> = {
  pre: MarkdownPre,
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
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
