import { create } from "zustand";
import * as api from "../api/tauri";
import type { Template } from "../api/tauri";

interface TemplateState {
  templates: Template[];
  loaded: boolean;
  loadTemplates: () => Promise<void>;
  createTemplate: (
    name: string,
    description: string,
    isPublic: boolean,
    files: [string, string][]
  ) => Promise<Template>;
  updateTemplate: (
    id: number,
    name: string,
    description: string,
    isPublic: boolean,
    files: [string, string][]
  ) => Promise<Template>;
  deleteTemplate: (id: number) => Promise<void>;
  saveGistAsTemplate: (gistId: string, name: string) => Promise<Template>;
}

export const useTemplateStore = create<TemplateState>((set) => ({
  templates: [],
  loaded: false,

  loadTemplates: async () => {
    const templates = await api.listTemplates();
    set({ templates, loaded: true });
  },

  createTemplate: async (name, description, isPublic, files) => {
    const t = await api.createTemplate(name, description, isPublic, files);
    set((s) => ({ templates: [t, ...s.templates] }));
    return t;
  },

  updateTemplate: async (id, name, description, isPublic, files) => {
    const t = await api.updateTemplate(id, name, description, isPublic, files);
    set((s) => ({ templates: s.templates.map((x) => (x.id === id ? t : x)) }));
    return t;
  },

  deleteTemplate: async (id) => {
    await api.deleteTemplate(id);
    set((s) => ({ templates: s.templates.filter((t) => t.id !== id) }));
  },

  saveGistAsTemplate: async (gistId, name) => {
    const t = await api.saveGistAsTemplate(gistId, name);
    set((s) => ({ templates: [t, ...s.templates] }));
    return t;
  },
}));
