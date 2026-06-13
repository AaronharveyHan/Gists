import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { TemplatesModal, SaveAsTemplateModal } from "./TemplatesModal";
import { useTemplateStore } from "../store/useTemplateStore";
import { useI18nStore } from "../store/useI18nStore";
import * as api from "../api/tauri";
import type { Template, TemplateFile } from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");
vi.mock("./VscodeSnippetsImportModal", () => ({
  VscodeSnippetsImportModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="vscode-import">
      <button onClick={onClose}>Close Import</button>
    </div>
  ),
}));

function makeTemplateFile(overrides: Partial<TemplateFile> = {}): TemplateFile {
  return { id: 1, template_id: 1, filename: "main.ts", content: "console.log(1)", sort_order: 0, ...overrides };
}

function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: 1,
    name: "My Template",
    description: "A test template",
    is_public: false,
    files: [makeTemplateFile()],
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Render and flush the on-mount loadTemplates() promise. */
async function renderModal(
  props: Partial<React.ComponentProps<typeof TemplatesModal>> = {},
  templates: Template[] = [],
) {
  vi.mocked(api.listTemplates).mockResolvedValue(templates);
  const onClose = vi.fn();
  const onUseTemplate = vi.fn();
  render(
    <TemplatesModal onClose={onClose} onUseTemplate={onUseTemplate} {...props} />,
  );
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { onClose, onUseTemplate };
}

describe("TemplatesModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    vi.mocked(api.listTemplates).mockResolvedValue([]);
  });
  afterEach(() => cleanup());

  it("renders the modal title", async () => {
    await renderModal();
    expect(screen.getByText("Templates")).toBeTruthy();
  });

  it("shows empty message when no templates exist", async () => {
    await renderModal();
    expect(screen.getByText(/No templates yet/)).toBeTruthy();
  });

  it("lists templates with name, description and file count", async () => {
    await renderModal({}, [makeTemplate({ name: "My Template", description: "A test template" })]);
    expect(screen.getByText("My Template")).toBeTruthy();
    expect(screen.getByText("A test template")).toBeTruthy();
    expect(screen.getByText("1 file")).toBeTruthy();
  });

  it("shows the primary filename in the template card", async () => {
    await renderModal({}, [makeTemplate({ files: [makeTemplateFile({ filename: "index.tsx" })] })]);
    expect(screen.getByText("index.tsx")).toBeTruthy();
  });

  it("shows public/secret badge", async () => {
    await renderModal({}, [
      makeTemplate({ id: 1, is_public: true }),
      makeTemplate({ id: 2, is_public: false }),
    ]);
    expect(screen.getByText("● Public")).toBeTruthy();
    expect(screen.getByText("○ Secret")).toBeTruthy();
  });

  it("Use button calls onUseTemplate and onClose", async () => {
    const tmpl = makeTemplate();
    const { onClose, onUseTemplate } = await renderModal({}, [tmpl]);
    fireEvent.click(screen.getByText("Use"));
    expect(onUseTemplate).toHaveBeenCalledWith(tmpl);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Edit button switches to the edit form", async () => {
    await renderModal({}, [makeTemplate()]);
    fireEvent.click(screen.getByText("Edit"));
    expect(screen.getByText("Edit template")).toBeTruthy();
    expect(screen.getByPlaceholderText("e.g. React Component")).toBeTruthy();
  });

  it("+ New Template button shows new-template form", async () => {
    await renderModal();
    fireEvent.click(screen.getByText("+ New Template"));
    expect(screen.getByText("New template")).toBeTruthy();
    expect(screen.getByPlaceholderText("e.g. React Component")).toBeTruthy();
  });

  it("Cancel in edit form returns to list", async () => {
    await renderModal({}, [makeTemplate()]);
    fireEvent.click(screen.getByText("Edit"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Edit template")).toBeNull();
    expect(screen.getByText("My Template")).toBeTruthy();
  });

  it("creates a template via store.createTemplate", async () => {
    const created = makeTemplate({ id: 99, name: "New Tpl" });
    vi.mocked(api.createTemplate).mockResolvedValue(created);
    await renderModal();
    fireEvent.click(screen.getByText("+ New Template"));

    fireEvent.change(screen.getByPlaceholderText("e.g. React Component"), { target: { value: "New Tpl" } });
    fireEvent.change(screen.getByPlaceholderText("filename.ext"), { target: { value: "index.ts" } });
    fireEvent.change(screen.getByPlaceholderText("File content…"), { target: { value: "export {}" } });

    await act(async () => {
      fireEvent.click(screen.getByText("Create Template"));
    });

    expect(api.createTemplate).toHaveBeenCalledWith("New Tpl", "", false, [["index.ts", "export {}"]]);
  });

  it("shows delete confirm, then calls deleteTemplate", async () => {
    vi.mocked(api.deleteTemplate).mockResolvedValue(undefined);
    await renderModal({}, [makeTemplate({ id: 5 })]);

    fireEvent.click(screen.getByText("Delete"));
    expect(screen.getByText("Confirm")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText("Confirm"));
    });

    expect(api.deleteTemplate).toHaveBeenCalledWith(5);
  });

  it("cancels delete when Cancel is clicked after Delete", async () => {
    await renderModal({}, [makeTemplate({ id: 5 })]);
    fireEvent.click(screen.getByText("Delete"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Confirm")).toBeNull();
  });

  it("Import from VS Code button shows VscodeSnippetsImportModal", async () => {
    await renderModal();
    fireEvent.click(screen.getByText("⇣ Import from VS Code"));
    expect(screen.getByTestId("vscode-import")).toBeTruthy();
  });

  it("Escape calls onClose", async () => {
    const { onClose } = await renderModal();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking the overlay calls onClose", async () => {
    const { onClose } = await renderModal();
    const overlay = document.querySelector(".modal-overlay") as HTMLElement;
    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("SaveAsTemplateModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
  });
  afterEach(() => cleanup());

  function renderSave(defaultName = "My Gist") {
    const onClose = vi.fn();
    useTemplateStore.setState({
      saveGistAsTemplate: vi.fn().mockResolvedValue(makeTemplate()),
    } as never);
    render(<SaveAsTemplateModal gistId="g1" defaultName={defaultName} onClose={onClose} />);
    return { onClose };
  }

  it("renders with the default name pre-filled", () => {
    renderSave("React Hook");
    const input = screen.getByPlaceholderText("e.g. React Component") as HTMLInputElement;
    expect(input.value).toBe("React Hook");
  });

  it("Save Template is disabled when name is cleared", () => {
    renderSave("React Hook");
    const input = screen.getByPlaceholderText("e.g. React Component") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    const btn = screen.getByText("Save Template") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("calls saveGistAsTemplate and onClose on save", async () => {
    const { onClose } = renderSave("My Gist");
    await act(async () => {
      fireEvent.click(screen.getByText("Save Template"));
    });
    const { saveGistAsTemplate } = useTemplateStore.getState();
    expect(saveGistAsTemplate).toHaveBeenCalledWith("g1", "My Gist");
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("Escape closes the modal", () => {
    const { onClose } = renderSave();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Cancel button calls onClose", () => {
    const { onClose } = renderSave();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
