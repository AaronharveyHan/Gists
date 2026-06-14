import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MarkdownPreview } from "./MarkdownPreview";
import { useGistStore } from "../store/useGistStore";
import { useI18nStore } from "../store/useI18nStore";
import * as api from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");

// MermaidBlock (rendered for ```mermaid fences) pulls in mermaid.
vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), render: vi.fn().mockResolvedValue({ svg: "<svg/>" }) },
}));

const writeText = vi.fn().mockResolvedValue(undefined);

describe("MarkdownPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    Object.assign(navigator, { clipboard: { writeText } });
  });
  afterEach(() => cleanup());

  it("renders headings and paragraphs", () => {
    render(<MarkdownPreview markdown={"# Title\n\nSome text here."} />);
    expect(screen.getByText("Title")).toBeTruthy();
    expect(screen.getByText("Some text here.")).toBeTruthy();
  });

  it("renders GFM tables", () => {
    render(<MarkdownPreview markdown={"| A | B |\n|---|---|\n| 1 | 2 |"} />);
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("A")).toBeTruthy();
  });

  it("renders a fenced code block with a copy button", () => {
    render(<MarkdownPreview markdown={"```js\nconst x = 1;\n```"} />);
    expect(document.querySelector(".md-pre-wrap")).toBeTruthy();
    expect(screen.getByText("Copy")).toBeTruthy();
  });

  it("the code copy button writes to the clipboard", async () => {
    render(<MarkdownPreview markdown={"```js\nconst x = 1;\n```"} />);
    fireEvent.click(screen.getByText("Copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("const x = 1;")));
  });

  it("renders a mermaid fence via MermaidBlock", () => {
    render(<MarkdownPreview markdown={"```mermaid\ngraph TD; A-->B\n```"} />);
    expect(document.querySelector(".markdown-preview__mermaid")).toBeTruthy();
  });

  it("renders [[wiki-links]] as in-app buttons", () => {
    render(<MarkdownPreview markdown={"See [[My Note]] for details."} />);
    const link = screen.getByRole("button", { name: "My Note" });
    expect(link.className).toContain("md-wiki-link");
  });

  it("clicking a wiki-link resolves and selects the target gist", async () => {
    const selectGist = vi.fn();
    useGistStore.setState({ selectGist } as never);
    vi.mocked(api.resolveWikiLink).mockResolvedValue({ id: "linked-gist" } as never);
    render(<MarkdownPreview markdown={"Go to [[Target]]."} />);
    fireEvent.click(screen.getByRole("button", { name: "Target" }));
    await waitFor(() => expect(api.resolveWikiLink).toHaveBeenCalledWith("Target"));
    expect(selectGist).toHaveBeenCalledWith("linked-gist");
  });

  it("renders external links with target=_blank", () => {
    render(<MarkdownPreview markdown={"[GitHub](https://github.com)"} />);
    const anchor = screen.getByRole("link", { name: "GitHub" }) as HTMLAnchorElement;
    expect(anchor.target).toBe("_blank");
  });

  it("shows a copy-all button when showCopyAll is set", () => {
    render(<MarkdownPreview markdown={"plain text"} showCopyAll />);
    expect(document.querySelector(".md-copy-all-wrap")).toBeTruthy();
  });

  it("does not transform [[links]] inside code spans", () => {
    render(<MarkdownPreview markdown={"`[[NotALink]]`"} />);
    expect(screen.queryByRole("button", { name: "NotALink" })).toBeNull();
  });
});
