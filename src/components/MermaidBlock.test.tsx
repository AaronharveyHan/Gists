import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { MermaidBlock } from "./MermaidBlock";

// ── Mermaid mock ──────────────────────────────────────────────────────────────

const mockRender = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: mockRender,
  },
}));

describe("MermaidBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRender.mockResolvedValue({ svg: "<svg><text>chart</text></svg>", bindFunctions: undefined });
  });
  afterEach(() => cleanup());

  it("renders the mermaid container div", () => {
    render(<MermaidBlock chart="graph TD; A-->B" />);
    expect(document.querySelector(".markdown-preview__mermaid")).toBeTruthy();
  });

  it("injects SVG into the host div after mermaid.render resolves", async () => {
    render(<MermaidBlock chart="graph TD; A-->B" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const host = document.querySelector(".markdown-preview__mermaid") as HTMLElement;
    expect(host.innerHTML).toContain("<svg>");
  });

  it("calls mermaid.render with the chart text", async () => {
    render(<MermaidBlock chart="flowchart LR; X-->Y" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(mockRender).toHaveBeenCalledWith(
      expect.stringMatching(/^mmd_/),
      "flowchart LR; X-->Y",
    );
  });

  it("shows nothing (empty host) when chart is an empty string", async () => {
    render(<MermaidBlock chart="" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    // mermaid.render should NOT be called for empty input
    expect(mockRender).not.toHaveBeenCalled();
    const host = document.querySelector(".markdown-preview__mermaid") as HTMLElement;
    expect(host.innerHTML).toBe("");
  });

  it("shows the error alert when mermaid.render throws", async () => {
    mockRender.mockRejectedValue(new Error("Parse error"));
    render(<MermaidBlock chart="invalid diagram" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Parse error");
  });

  it("shows the stringified error for non-Error thrown values", async () => {
    mockRender.mockRejectedValue("bad syntax");
    render(<MermaidBlock chart="bad" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("bad syntax");
  });

  it("calls bindFunctions on the host when provided", async () => {
    const bindFunctions = vi.fn();
    mockRender.mockResolvedValue({ svg: "<svg></svg>", bindFunctions });
    render(<MermaidBlock chart="graph TD; A-->B" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(bindFunctions).toHaveBeenCalledWith(expect.any(HTMLDivElement));
  });

  it("re-renders the chart when the chart prop changes", async () => {
    const { rerender } = render(<MermaidBlock chart="graph TD; A-->B" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(mockRender).toHaveBeenCalledTimes(1);

    rerender(<MermaidBlock chart="flowchart LR; X-->Y" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(mockRender).toHaveBeenCalledTimes(2);
    expect(mockRender.mock.calls[1][1]).toBe("flowchart LR; X-->Y");
  });
});
