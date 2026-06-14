import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { SettingsAccounts } from "./SettingsAccounts";
import { useI18nStore } from "../../store/useI18nStore";
import * as tauriApi from "../../api/tauri";
import type { Account } from "../../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../api/tauri"); // resolves to src/api/__mocks__/tauri.ts

function acc(over: Partial<Account> = {}): Account {
  return {
    id: 1, name: "alice", login: null, avatar_url: null,
    token_key: "k", is_active: true, ...over,
  };
}

async function renderAccounts(accounts: Account[] = []) {
  vi.mocked(tauriApi.listAccounts).mockResolvedValue(accounts);
  render(<SettingsAccounts />);
  await waitFor(() => screen.getByText("Accounts"));
}

describe("SettingsAccounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
  });
  afterEach(() => cleanup());

  it("renders the accounts section title", async () => {
    await renderAccounts([]);
    expect(screen.getByText("Accounts")).toBeTruthy();
  });

  it("shows 'No accounts configured.' when the list is empty", async () => {
    await renderAccounts([]);
    await waitFor(() => expect(screen.getByText("No accounts configured.")).toBeTruthy());
  });

  it("lists loaded accounts", async () => {
    await renderAccounts([acc({ id: 1, name: "alice", is_active: true }), acc({ id: 2, name: "bob", is_active: false })]);
    await waitFor(() => {
      expect(screen.getByText("alice")).toBeTruthy();
      expect(screen.getByText("bob")).toBeTruthy();
    });
  });

  it("marks the active account and offers Switch on the inactive one", async () => {
    await renderAccounts([acc({ id: 1, name: "alice", is_active: true }), acc({ id: 2, name: "bob", is_active: false })]);
    await waitFor(() => screen.getByText("bob"));
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch to this account" })).toBeTruthy();
  });

  it("Switch button calls switchAccount with the account id", async () => {
    vi.mocked(tauriApi.switchAccount).mockResolvedValue(undefined);
    await renderAccounts([acc({ id: 1, name: "alice", is_active: true }), acc({ id: 2, name: "bob", is_active: false })]);
    await waitFor(() => screen.getByText("bob"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Switch to this account" }));
    });
    expect(vi.mocked(tauriApi.switchAccount)).toHaveBeenCalledWith(2);
  });

  it("Add account form calls addAccount with name and token", async () => {
    vi.mocked(tauriApi.addAccount).mockResolvedValue(acc({ id: 3, name: "charlie", is_active: false }));
    await renderAccounts([]);
    fireEvent.click(screen.getByText("Add account"));
    fireEvent.change(screen.getByPlaceholderText("Account name"), { target: { value: "charlie" } });
    fireEvent.change(screen.getByPlaceholderText("GitHub token"), { target: { value: "tok_abc" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(vi.mocked(tauriApi.addAccount)).toHaveBeenCalledWith("charlie", "tok_abc");
  });

  it("Save is disabled until both name and token are filled", async () => {
    await renderAccounts([]);
    fireEvent.click(screen.getByText("Add account"));
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Account name"), { target: { value: "charlie" } });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("GitHub token"), { target: { value: "tok" } });
    expect(save.disabled).toBe(false);
  });

  it("toggles the token field between password and text", async () => {
    await renderAccounts([]);
    fireEvent.click(screen.getByText("Add account"));
    const tokenInput = screen.getByPlaceholderText("GitHub token") as HTMLInputElement;
    expect(tokenInput.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(tokenInput.type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(tokenInput.type).toBe("password");
  });

  it("remove button is shown only with 2+ accounts and calls removeAccount", async () => {
    vi.mocked(tauriApi.removeAccount).mockResolvedValue(undefined);
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    await renderAccounts([acc({ id: 1, name: "alice", is_active: true }), acc({ id: 2, name: "bob", is_active: false })]);
    await waitFor(() => screen.getByText("alice"));
    const removeBtn = screen.getAllByTitle("Remove account")[0];
    await act(async () => { fireEvent.click(removeBtn); });
    expect(vi.mocked(tauriApi.removeAccount)).toHaveBeenCalledWith(1);
    vi.unstubAllGlobals();
  });

  it("does not render a remove button when there is a single account", async () => {
    await renderAccounts([acc({ id: 1, name: "alice", is_active: true })]);
    await waitFor(() => screen.getByText("alice"));
    expect(screen.queryByTitle("Remove account")).toBeNull();
  });

  it("Cancel hides the add-account form", async () => {
    await renderAccounts([]);
    fireEvent.click(screen.getByText("Add account"));
    expect(screen.getByPlaceholderText("Account name")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByPlaceholderText("Account name")).toBeNull();
  });
});
