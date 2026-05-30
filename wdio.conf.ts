import * as os from "os";
import * as path from "path";
import * as fs from "fs";

// Resolve debug binary path based on platform
function appBinaryPath(): string {
  const base = path.resolve(__dirname, "target/debug");
  if (process.platform === "win32") return path.join(base, "gists-client.exe");
  return path.join(base, "gists-client");
}

// On Windows, Edge ships msedgedriver alongside the browser.
// Prefer that over auto-install (which requires a PowerShell download script
// that often fails behind proxies or with strict execution policies).
function resolveWindowsDriver(): string | undefined {
  if (process.platform !== "win32") return undefined;
  const edgePaths = [
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
    process.env.LOCALAPPDATA,
  ]
    .filter(Boolean)
    .flatMap((base) => [
      path.join(base!, "Microsoft", "Edge", "Application"),
    ]);

  for (const dir of edgePaths) {
    if (!fs.existsSync(dir)) continue;
    const versions = fs.readdirSync(dir).sort().reverse();
    for (const v of versions) {
      const candidate = path.join(dir, v, "msedgedriver.exe");
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

// Unique temp dir per test run for SQLite DB isolation
const e2eTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gists-e2e-"));

// Env vars that redirect app data directory to temp location
function isolationEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (process.platform === "linux") {
    env.XDG_DATA_HOME = path.join(e2eTmpDir, "data");
    env.XDG_CONFIG_HOME = path.join(e2eTmpDir, "config");
  } else if (process.platform === "darwin") {
    env.HOME = e2eTmpDir;
  } else if (process.platform === "win32") {
    env.APPDATA = path.join(e2eTmpDir, "AppData", "Roaming");
    env.LOCALAPPDATA = path.join(e2eTmpDir, "AppData", "Local");
  }
  return env;
}

const windowsDriver = resolveWindowsDriver();

// The config object is exported without a strict type annotation so that
// platform-specific capability fields (tauri:options, wdio:tauriServiceOptions)
// don't trip up the @wdio/types strict checking.
export const config = {
  specs: ["./e2e/**/*.spec.ts"],
  exclude: [] as string[],
  maxInstances: 1,

  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": {
        application: appBinaryPath(),
      },
      "wdio:tauriServiceOptions": {
        env: isolationEnv(),
      },
    },
  ],

  logLevel: "warn" as const,

  baseUrl: "",

  waitforTimeout: 15000,
  connectionRetryTimeout: 90000,
  connectionRetryCount: 3,

  services: [
    [
      "@wdio/tauri-service",
      {
        driverProvider: "official" as const,
        // Disable broken PowerShell-based auto-install on Windows.
        // We find the driver that ships with Edge instead (see resolveWindowsDriver).
        autoInstallTauriDriver: !windowsDriver,
        // Point directly to the bundled msedgedriver when found.
        ...(windowsDriver ? { tauriDriverPath: windowsDriver } : {}),
        env: isolationEnv(),
      },
    ],
  ],

  framework: "mocha",

  reporters: ["spec"],

  mochaOpts: {
    ui: "bdd",
    timeout: 60000,
  },

  before() {
    const bin = appBinaryPath();
    if (!fs.existsSync(bin)) {
      throw new Error(
        `Tauri debug binary not found at ${bin}.\n` +
          `Run 'npm run test:e2e:build' to compile before testing.`
      );
    }
  },

  after() {
    try {
      fs.rmSync(e2eTmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  },
};
