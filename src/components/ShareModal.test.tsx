import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ShareModal } from "./ShareModal";
import { useGistStore } from "../store/useGistStore";
import { useI18nStore } from "../store/useI18nStore";
import type { Gist } from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("../api/tauri");

function remoteGist(overrides: Partial<Gist> = {}): Gist {
  return {
    id: "abc123",
    description: "my test gist",
    public: false,
    html_url: "https://gist.github.com/testuser/abc123",
    created_at: "",
    updated_at: "",
    files: [{ filename: "main.ts", language: "TypeScript", type: "text/plain", content: "", size: 10 }],
    pending_push: false,
    local_only: false,
    category: "gist",
    ...overrides,
  };
}

describe("ShareModal", () => {
  beforeEach(() => {
    useI18nStore.setState({ lang: "en" });
    useGistStore.setState({ githubLogin: "testuser" });
  });
  afterEach(() => cleanup());

  it("renders the modal title", () => {
    render(<ShareModal gist={remoteGist()} onClose={vi.fn()} />);
    expect(screen.getByText("Share / Embed")).toBeTruthy();
  });

  it("shows local-draft notice for local_only gists", () => {
    render(<ShareModal gist={remoteGist({ local_only: true })} onClose={vi.fn()} />);
    expect(screen.getByText(/local draft/i)).toBeTruthy();
  });

  it("shows GitHub URL section for remote gists", () => {
    render(<ShareModal gist={remoteGist()} onClose={vi.fn()} />);
    expect(screen.getByText("GitHub URL")).toBeTruthy();
  });

  it("does not show GitHub URL section for local_only gists", () => {
    render(<ShareModal gist={remoteGist({ local_only: true })} onClose={vi.fn()} />);
    expect(screen.queryByText("GitHub URL")).toBeNull();
  });

  it("shows embed and markdown sections for remote gists", () => {
    render(<ShareModal gist={remoteGist()} onClose={vi.fn()} />);
    expect(screen.getByText("Embed (HTML)")).toBeTruthy();
    expect(screen.getByText("Markdown link")).toBeTruthy();
  });

  it("✕ button calls onClose", () => {
    const onClose = vi.fn();
    render(<ShareModal gist={remoteGist()} onClose={onClose} />);
    fireEvent.click(screen.getByText("✕"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape key calls onClose", () => {
    const onClose = vi.fn();
    render(<ShareModal gist={remoteGist()} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("overlay mousedown calls onClose, modal body mousedown does not", () => {
    const onClose = vi.fn();
    const { container } = render(<ShareModal gist={remoteGist()} onClose={onClose} />);
    const modal = container.querySelector(".share-modal") as HTMLElement;
    const overlay = container.querySelector(".modal-overlay") as HTMLElement;

    fireEvent.mouseDown(modal);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows raw file URLs section when files have raw_url", () => {
    const gist = remoteGist({
      files: [
        { filename: "readme.md", language: null, type: "text/plain", content: "", size: 5, raw_url: "https://gist.githubusercontent.com/raw/readme.md" },
      ],
    });
    render(<ShareModal gist={gist} onClose={vi.fn()} />);
    expect(screen.getByText("Raw file URLs")).toBeTruthy();
  });
});
