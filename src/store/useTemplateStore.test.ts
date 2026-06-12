import { describe, it, expect, beforeEach, vi } from "vitest";
import * as api from "../api/tauri";
import { useTemplateStore } from "./useTemplateStore";
import { makeTemplate } from "../test/fixtures";

vi.mock("../api/tauri");
const mocked = vi.mocked(api);

describe("useTemplateStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTemplateStore.setState({ templates: [], loaded: false });
  });

  it("loadTemplates() stores the list and flips loaded", async () => {
    mocked.listTemplates.mockResolvedValue([makeTemplate(1), makeTemplate(2)]);

    await useTemplateStore.getState().loadTemplates();

    expect(useTemplateStore.getState().templates).toHaveLength(2);
    expect(useTemplateStore.getState().loaded).toBe(true);
  });

  it("createTemplate() prepends the new template", async () => {
    useTemplateStore.setState({ templates: [makeTemplate(1)], loaded: true });
    mocked.createTemplate.mockResolvedValue(makeTemplate(2, { name: "New" }));

    const t = await useTemplateStore
      .getState()
      .createTemplate("New", "", false, [["a.py", "x"]]);

    expect(t.name).toBe("New");
    expect(mocked.createTemplate).toHaveBeenCalledWith("New", "", false, [["a.py", "x"]]);
    const { templates } = useTemplateStore.getState();
    expect(templates.map((x) => x.id)).toEqual([2, 1]);
  });

  it("updateTemplate() replaces only the matching template", async () => {
    useTemplateStore.setState({
      templates: [makeTemplate(1, { name: "old" }), makeTemplate(2)],
      loaded: true,
    });
    mocked.updateTemplate.mockResolvedValue(makeTemplate(1, { name: "renamed" }));

    await useTemplateStore.getState().updateTemplate(1, "renamed", "", false, []);

    const { templates } = useTemplateStore.getState();
    expect(templates.find((t) => t.id === 1)?.name).toBe("renamed");
    expect(templates.find((t) => t.id === 2)?.name).toBe("template 2");
  });

  it("deleteTemplate() removes the template", async () => {
    useTemplateStore.setState({
      templates: [makeTemplate(1), makeTemplate(2)],
      loaded: true,
    });
    mocked.deleteTemplate.mockResolvedValue(undefined);

    await useTemplateStore.getState().deleteTemplate(1);

    expect(useTemplateStore.getState().templates.map((t) => t.id)).toEqual([2]);
  });

  it("saveGistAsTemplate() prepends the created template", async () => {
    useTemplateStore.setState({ templates: [makeTemplate(1)], loaded: true });
    mocked.saveGistAsTemplate.mockResolvedValue(makeTemplate(9, { name: "From Gist" }));

    const t = await useTemplateStore.getState().saveGistAsTemplate("g1", "From Gist");

    expect(t.id).toBe(9);
    expect(useTemplateStore.getState().templates[0].id).toBe(9);
  });

  it("a rejected API call propagates and leaves state untouched", async () => {
    useTemplateStore.setState({ templates: [makeTemplate(1)], loaded: true });
    mocked.deleteTemplate.mockRejectedValue(new Error("db locked"));

    await expect(useTemplateStore.getState().deleteTemplate(1)).rejects.toThrow("db locked");
    expect(useTemplateStore.getState().templates).toHaveLength(1);
  });
});
