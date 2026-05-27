/**
 * Renders a ```mermaid fenced block as SVG (lazy-loads mermaid).
 */
import { useEffect, useRef, useState } from "react";

let mermaidInitialized = false;

export function MermaidBlock({ chart }: { chart: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const host = hostRef.current;
    if (!host) return;

    const run = async () => {
      const mermaid = (await import("mermaid")).default;

      if (!mermaidInitialized) {
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "strict",
          fontFamily: "inherit",
        });
        mermaidInitialized = true;
      }

      const src = chart.trim();
      if (!src) {
        if (!cancelled && hostRef.current) hostRef.current.innerHTML = "";
        return;
      }

      const id = `mmd_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      try {
        const { svg, bindFunctions } = await mermaid.render(id, src);
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = svg;
        bindFunctions?.(hostRef.current);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          host.innerHTML = "";
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (hostRef.current) hostRef.current.innerHTML = "";
    };
  }, [chart]);

  if (error) {
    return (
      <div className="markdown-preview__mermaid-error" role="alert">
        Mermaid：{error}
      </div>
    );
  }

  return <div className="markdown-preview__mermaid" ref={hostRef} />;
}
