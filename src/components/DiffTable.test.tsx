import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { DiffTable } from "./DiffTable";
import { useI18nStore } from "../store/useI18nStore";

const SAMPLE_DIFF = [
  "--- a/main.ts",
  "+++ b/main.ts",
  "@@ -1,3 +1,3 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  " const c = 4;",
].join("\n");

describe("DiffTable (render layer)", () => {
  beforeEach(() => {
    useI18nStore.setState({ lang: "en" });
  });
  afterEach(() => cleanup());

  it("shows the no-changes message for an empty diff", () => {
    render(<DiffTable diff="   " />);
    expect(screen.getByText("(no changes)")).toBeTruthy();
  });

  it("falls back to a raw <pre> for an unparseable diff", () => {
    render(<DiffTable diff="just some text with no headers" />);
    expect(document.querySelector(".git-diff-pre--raw")).toBeTruthy();
  });

  it("renders the file header for a parsed diff", () => {
    render(<DiffTable diff={SAMPLE_DIFF} />);
    expect(screen.getByText("main.ts")).toBeTruthy();
  });

  it("renders the Old/New/Change column headers", () => {
    render(<DiffTable diff={SAMPLE_DIFF} />);
    expect(screen.getByText("Old")).toBeTruthy();
    expect(screen.getByText("New")).toBeTruthy();
    expect(screen.getByText("Change")).toBeTruthy();
  });

  it("renders add/remove/context rows with the right classes", () => {
    render(<DiffTable diff={SAMPLE_DIFF} />);
    expect(document.querySelector(".diff-line--add")).toBeTruthy();
    expect(document.querySelector(".diff-line--remove")).toBeTruthy();
    expect(document.querySelector(".diff-line--ctx")).toBeTruthy();
    expect(document.querySelector(".diff-line--hunk")).toBeTruthy();
  });

  it("renders the hunk header text", () => {
    render(<DiffTable diff={SAMPLE_DIFF} />);
    expect(screen.getByText("@@ -1,3 +1,3 @@")).toBeTruthy();
  });

  it("renders the changed line contents", () => {
    render(<DiffTable diff={SAMPLE_DIFF} />);
    expect(screen.getByText("const b = 2;")).toBeTruthy();
    expect(screen.getByText("const b = 3;")).toBeTruthy();
  });
});
