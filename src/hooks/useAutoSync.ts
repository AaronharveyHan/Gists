import { useEffect, useRef } from "react";
import { useGistStore } from "../store/useGistStore";
import { useThemeStore } from "../store/useThemeStore";

/**
 * Runs a background incremental sync on a fixed interval.
 * Only fires when a token is present and the interval is non-zero.
 * The interval restarts cleanly whenever the setting changes.
 */
export function useAutoSync() {
  const sync = useGistStore((s) => s.sync);
  const syncStatus = useGistStore((s) => s.syncStatus);
  const isAuthenticated = useGistStore((s) => s.isAuthenticated);
  const autoSyncMinutes = useThemeStore((s) => s.autoSyncMinutes);

  // Stable ref so the interval callback always sees the latest values
  // without needing to re-register the interval.
  const syncRef = useRef(sync);
  const syncStatusRef = useRef(syncStatus);
  const isAuthRef = useRef(isAuthenticated);
  useEffect(() => { syncRef.current = sync; }, [sync]);
  useEffect(() => { syncStatusRef.current = syncStatus; }, [syncStatus]);
  useEffect(() => { isAuthRef.current = isAuthenticated; }, [isAuthenticated]);

  useEffect(() => {
    if (autoSyncMinutes <= 0) return;
    const ms = autoSyncMinutes * 60 * 1000;
    const id = setInterval(() => {
      // Skip if already syncing or not authenticated
      if (!isAuthRef.current || syncStatusRef.current === "syncing") return;
      void syncRef.current(false);
    }, ms);
    return () => clearInterval(id);
  }, [autoSyncMinutes]);
}
