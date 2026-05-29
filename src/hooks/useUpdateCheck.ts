import { useState, useEffect } from "react";

export interface UpdateInfo {
  version: string;
  install: () => Promise<void>;
}

export function useUpdateCheck(): UpdateInfo | null {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    import("@tauri-apps/plugin-updater")
      .then(({ check }) => check())
      .then((u) => {
        if (!u?.available || !u.version) return;
        setUpdate({
          version: u.version,
          install: async () => {
            await u.downloadAndInstall();
            const { relaunch } = await import("@tauri-apps/plugin-process");
            await relaunch();
          },
        });
      })
      .catch(() => {}); // silently ignore: updater inactive / no network / no update
  }, []);

  return update;
}
