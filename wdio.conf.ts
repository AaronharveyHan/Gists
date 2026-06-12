import * as os from "os";
import * as path from "path";
import * as fs from "fs";

// Resolve debug binary path based on platform
function appBinaryPath(): string {
  const base = path.resolve(__dirname, "src-tauri/target/debug");
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
    // WebKitGTK's DMABUF renderer crashes the WebKitWebProcess on GPU-less
    // CI runners; a dead web process means the embedded WebDriver server
    // never starts listening on its port and the session times out.
    env.WEBKIT_DISABLE_DMABUF_RENDERER = "1";
    env.WEBKIT_DISABLE_COMPOSITING_MODE = "1";
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
      maxInstances: 1,
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
        // Use the embedded WebDriver server provided by tauri-plugin-wdio (compiled
        // into every debug build via cfg(debug_assertions)). This is the correct
        // driver for Tauri v2: the plugin starts a server inside the app process and
        // the service connects to it.
        //
        // "official" (WebKitWebDriver) was tried but conflicts with the embedded
        // server — both try to own the WebKit instance simultaneously, which locks
        // up all DOM commands.  With the frontend properly served by vite-preview the
        // embedded server initialises correctly, making "official" unnecessary.
        driverProvider: "embedded" as const,
        // Embedded mode manages its own WebDriver server (tauri-plugin-wdio-webdriver);
        // no external tauri-driver needed on any platform.
        autoInstallTauriDriver: false,
        // CI runners (cold Rust cache, software rendering) can need well over
        // the 60s default for the app + embedded server to come up.
        startTimeout: 120000,
        // Write the app's stdout/stderr to outputDir so CI can upload them as
        // artifacts — without this a startup crash leaves no trace.
        captureBackendLogs: true,
        captureFrontendLogs: true,
        // Point directly to the bundled msedgedriver when found (Windows only).
        ...(windowsDriver ? { tauriDriverPath: windowsDriver } : {}),
        env: isolationEnv(),
      },
    ],
  ],

  outputDir: "logs",

  framework: "mocha",

  reporters: ["spec"],

  mochaOpts: {
    ui: "bdd",
    timeout: 300000,
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
