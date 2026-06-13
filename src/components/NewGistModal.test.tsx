import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { NewGistModal } from "./Editor";
import { useGistStore } from "../store/useGistStore";
import { useI18nStore } from "../store/useI18nStore";
import type { Template } from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");

function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: 1,
    name: "My Template",
    description: "tmpl desc",
    is_public: false,
    files: [
      { id: 1, template_id: 1, filename: "tmpl.ts", content: "console.log(1)", sort_order: 0 },
    ],
    created_at: "",
    ...overrides,
  };
}

describe("NewGistModal", () => {
  let onClose: ReturnType<typeof vi.fn>;
  let onCreate: ReturnType<typeof vi.fn>;
  let onCreateLocal: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useI18nStore.setState({ lang: "en" });
    // Non-local account → both Save Draft and Publish buttons render.
    useGistStore.setState({ githubLogin: "testuser" });
    onClose = vi.fn();
    onCreate = vi.fn().mockResolvedValue(undefined);
    onCreateLocal = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  function renderModal(props: Partial<React.ComponentProps<typeof NewGistModal>> = {}) {
    return render(
      <NewGistModal
        onClose={onClose}
        onCreate={onCreate}
        onCreateLocal={onCreateLocal}
        {...props}
      />,
    );
  }

  it("renders the default title and filename/content fields", () => {
    renderModal();
    expect(screen.getByText("New Gist")).toBeTruthy();
    expect(screen.getByText("Filename")).toBeTruthy();
    expect(screen.getByText("Content")).toBeTruthy();
  });

  it("disables both create buttons when filename or content is empty", () => {
    renderModal();
    // Content starts empty → both disabled.
    expect(screen.getByRole("button", { name: "Save Draft" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Publish to GitHub" })).toHaveProperty("disabled", true);
  });

  it("enables the buttons once filename and content are filled", () => {
    renderModal();
    fireEvent.change(screen.getByDisplayValue("untitled.md"), { target: { value: "a.ts" } });
    // content textarea is the only textarea
    fireEvent.change(screen.getByRole("textbox", { name: "Content" }), {
      target: { value: "hello" },
    });
    expect(screen.getByRole("button", { name: "Save Draft" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "Publish to GitHub" })).toHaveProperty("disabled", false);
  });

  it("calls onCreate with description, public flag, and file pairs on submit", async () => {
    renderModal();
    fireEvent.change(screen.getByDisplayValue("untitled.md"), { target: { value: "main.ts" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Content" }), {
      target: { value: "code" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish to GitHub" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledOnce());
    expect(onCreate).toHaveBeenCalledWith("", false, [["main.ts", "code"]]);
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("calls onCreateLocal when Save Draft is clicked", async () => {
    renderModal();
    fireEvent.change(screen.getByDisplayValue("untitled.md"), { target: { value: "main.ts" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Content" }), {
      target: { value: "code" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(onCreateLocal).toHaveBeenCalledOnce());
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("passes the public flag through when the checkbox is ticked", async () => {
    renderModal();
    fireEvent.change(screen.getByDisplayValue("untitled.md"), { target: { value: "main.ts" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Content" }), {
      target: { value: "code" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Public gist/ }));
    fireEvent.click(screen.getByRole("button", { name: "Publish to GitHub" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("", true, [["main.ts", "code"]]));
  });

  it("shows an offline hint and disables Publish when offline", () => {
    renderModal({ networkOnline: false });
    expect(screen.getByText(/will save as local draft only/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish to GitHub" })).toHaveProperty("disabled", true);
  });

  it("hides the Publish button in local mode", () => {
    useGistStore.setState({ githubLogin: "local" });
    renderModal();
    expect(screen.queryByRole("button", { name: "Publish to GitHub" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save Draft" })).toBeTruthy();
  });

  it("Escape calls onClose", () => {
    renderModal();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("template mode hides filename/content fields and submits template files", async () => {
    const template = makeTemplate();
    renderModal({ template });
    expect(screen.getByText('New Gist from "My Template"')).toBeTruthy();
    expect(screen.queryByText("Filename")).toBeNull();
    expect(screen.queryByText("Content")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Publish to GitHub" }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith("tmpl desc", false, [["tmpl.ts", "console.log(1)"]])
    );
  });
});
