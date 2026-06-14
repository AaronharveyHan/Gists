import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { AccountSwitcher } from "./AccountSwitcher";
import { useGistStore } from "../store/useGistStore";
import { useI18nStore } from "../store/useI18nStore";
import * as api from "../api/tauri";
import type { Account } from "../api/tauri";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../api/tauri");

function acc(over: Partial<Account> = {}): Account {
  return {
    id: 1, name: "Octo Cat", login: "octocat", avatar_url: null,
    token_key: "k1", is_active: true, ...over,
  };
}

const setAuthenticated = vi.fn();
const loadGists = vi.fn().mockResolvedValue(undefined);
const sync = vi.fn();

async function renderSwitcher(accounts: Account[] = []) {
  vi.mocked(api.listAccounts).mockResolvedValue(accounts);
  render(<AccountSwitcher />);
  // let the on-mount load() resolve
  await waitFor(() => {});
}

describe("AccountSwitcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useI18nStore.setState({ lang: "en" });
    useGistStore.setState({ githubLogin: "octocat", setAuthenticated, loadGists, sync } as never);
    vi.mocked(api.switchAccount).mockResolvedValue(undefined);
  });
  afterEach(() => cleanup());

  it("renders a plain @login when there are no multiple accounts", async () => {
    await renderSwitcher([]);
    expect(screen.getByText("@octocat")).toBeTruthy();
  });

  it("renders the active account trigger when accounts exist", async () => {
    await renderSwitcher([acc({ id: 1, login: "octocat", is_active: true })]);
    await waitFor(() => expect(screen.getByText("@octocat")).toBeTruthy());
  });

  it("opens the dropdown listing all accounts", async () => {
    await renderSwitcher([
      acc({ id: 1, name: "Octo Cat", login: "octocat", is_active: true }),
      acc({ id: 2, name: "Hub Bot", login: "hubbot", is_active: false }),
    ]);
    await waitFor(() => expect(screen.getByText("@octocat")).toBeTruthy());
    fireEvent.click(screen.getByTitle("Switch to this account"));
    expect(screen.getByText("Hub Bot")).toBeTruthy();
  });

  it("switching to another account calls switchAccount and reloads", async () => {
    await renderSwitcher([
      acc({ id: 1, login: "octocat", is_active: true }),
      acc({ id: 2, name: "Hub Bot", login: "hubbot", is_active: false }),
    ]);
    await waitFor(() => expect(screen.getByText("@octocat")).toBeTruthy());
    fireEvent.click(screen.getByTitle("Switch to this account"));
    fireEvent.click(screen.getByText("Hub Bot"));
    await waitFor(() => expect(api.switchAccount).toHaveBeenCalledWith(2));
    expect(setAuthenticated).toHaveBeenCalledWith("hubbot");
    expect(loadGists).toHaveBeenCalled();
  });

  it("clicking the already-active account does not switch", async () => {
    await renderSwitcher([acc({ id: 1, login: "octocat", is_active: true })]);
    await waitFor(() => expect(screen.getByText("@octocat")).toBeTruthy());
    fireEvent.click(screen.getByTitle("Switch to this account"));
    // the active item in the dropdown
    fireEvent.click(screen.getByText("Active"));
    expect(api.switchAccount).not.toHaveBeenCalled();
  });

  it("shows the Active badge on the current account", async () => {
    await renderSwitcher([acc({ id: 1, login: "octocat", is_active: true })]);
    await waitFor(() => expect(screen.getByText("@octocat")).toBeTruthy());
    fireEvent.click(screen.getByTitle("Switch to this account"));
    expect(screen.getByText("Active")).toBeTruthy();
  });
});
