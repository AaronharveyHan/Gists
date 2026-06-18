import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { useT } from "../store/useI18nStore";

type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date" }
  | { status: "error" }
  | { status: "installing" }
  | { status: "available"; version: string; install: () => Promise<void> };

const REPO_URL = "https://github.com/AaronharveyHan/Gists";

export function AboutModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ status: "idle" });

  useEffect(() => {
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setVersion)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onClose]);

  const openExternal = (url: string) => {
    open(url).catch(() => {});
  };

  const checkForUpdates = async () => {
    setUpdate({ status: "checking" });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const u = await check();
      if (u?.available && u.version) {
        setUpdate({
          status: "available",
          version: u.version,
          install: async () => {
            setUpdate({ status: "installing" });
            await u.downloadAndInstall();
            const { relaunch } = await import("@tauri-apps/plugin-process");
            await relaunch();
          },
        });
      } else {
        setUpdate({ status: "up-to-date" });
      }
    } catch {
      setUpdate({ status: "error" });
    }
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal about-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{t.about.title}</h2>

        <div className="about-modal__body">
          <p className="about-modal__version">{version ? t.about.version(version) : "…"}</p>
          <p className="modal__muted">{t.about.tagline}</p>

          <div className="about-modal__update">
            {update.status === "idle" && (
              <button type="button" className="btn" onClick={checkForUpdates}>
                {t.about.checkForUpdates}
              </button>
            )}
            {update.status === "checking" && (
              <span className="modal__muted">{t.about.checking}</span>
            )}
            {update.status === "up-to-date" && (
              <span className="modal__muted">{t.about.upToDate}</span>
            )}
            {update.status === "error" && (
              <span className="modal__error">{t.about.checkFailed}</span>
            )}
            {update.status === "installing" && (
              <span className="modal__muted">{t.common.loading}</span>
            )}
            {update.status === "available" && (
              <button type="button" className="btn btn--primary" onClick={() => update.install()}>
                {t.about.updateAvailable(update.version)} {t.about.installAndRestart}
              </button>
            )}
          </div>

          <div className="about-modal__links">
            <button type="button" className="settings-link" onClick={() => openExternal(REPO_URL)}>
              {t.about.repo}
            </button>
            <button type="button" className="settings-link" onClick={() => openExternal(`${REPO_URL}/issues`)}>
              {t.about.reportIssue}
            </button>
            <button type="button" className="settings-link" onClick={() => openExternal(`${REPO_URL}/blob/main/LICENSE`)}>
              {t.about.license}
            </button>
          </div>
        </div>

        <div className="modal__actions">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {t.about.close}
          </button>
        </div>
      </div>
    </div>
  );
}
