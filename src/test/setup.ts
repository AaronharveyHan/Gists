import { vi } from "vitest";

// jsdom does not implement matchMedia; stub it for resolveMonacoTheme and any
// media-query-based logic. Default to non-dark so tests get deterministic results.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
