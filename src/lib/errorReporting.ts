/**
 * Optional Sentry error reporting — off by default.
 *
 * Nothing is imported or initialized unless the user explicitly opts in
 * AND a DSN is present (VITE_SENTRY_DSN build-time env var).
 *
 * Build-time setup:
 *   export VITE_SENTRY_DSN="https://<key>@<org>.ingest.sentry.io/<project>"
 *   npm run build
 *
 * If VITE_SENTRY_DSN is empty the feature is a no-op even when opted in.
 *
 * CSP: the Sentry SDK POSTs events via fetch() to https://<org>.ingest.sentry.io/...
 * connect-src in src-tauri/tauri.conf.json already includes https://*.ingest.sentry.io
 * so Sentry requests are allowed.  When no DSN is set, Sentry never initialises and
 * no requests are made, so the extra CSP directive is harmless.
 */

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

let initialized = false;

/** Call once on app start (and again on settings toggle) with the persisted opt-in value. */
export async function initErrorReporting(enabled: boolean): Promise<void> {
  if (!enabled || !DSN) {
    if (initialized) {
      // User just disabled — close the existing client.
      const { getCurrentScope, getClient } = await import("@sentry/react");
      void Promise.resolve(getClient()?.close(2000)).catch(() => {});
      getCurrentScope().setUser(null);
      initialized = false;
    }
    return;
  }
  if (initialized) return;

  try {
    const Sentry = await import("@sentry/react");
    Sentry.init({
      dsn: DSN,
      release: import.meta.env.VITE_APP_VERSION ?? "unknown",
      environment: import.meta.env.DEV ? "development" : "production",
      // Scrub sensitive fields before sending
      beforeSend(event) {
        scrubEvent(event);
        return event;
      },
      // Don't send local-dev noise
      tracesSampleRate: 0,
    });
    // Capture unhandled promise rejections
    window.addEventListener("unhandledrejection", (e) => {
      Sentry.captureException(e.reason ?? new Error("Unhandled rejection"));
    });
    initialized = true;
  } catch {
    // Sentry init failure must never crash the app
  }
}

/** Report an error. Fire-and-forget; safe to call even when reporting is disabled. */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized || !DSN) return;
  import("@sentry/react").then(({ captureException, withScope }) => {
    if (context) {
      withScope((scope) => {
        scope.setExtras(context);
        captureException(err);
      });
    } else {
      captureException(err);
    }
  }).catch(() => {});
}

// ── PII scrubber ──────────────────────────────────────────────────────────────

// Key names whose values are always redacted.
// \bkey\b matches standalone "key" but NOT "keyboard"/"keyCode".
// api[_-]key / apikey cover compound forms without a word boundary.
const SENSITIVE_KEY_RE = /token|secret|password|passwd|auth|apikey|api[_-]key|\bkey\b/i;

// Value-level: redact strings that look like GitHub PATs or OpenAI keys,
// even when the containing field has an innocuous name (e.g. "message", "url").
const SENSITIVE_VAL_RE =
  /gh[pousrh]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|sk-[A-Za-z0-9]{20,}/;

function scrubEvent(event: object): void {
  scrubValue(event);
}

function scrubValue(obj: unknown): void {
  if (!obj || typeof obj !== "object") return;
  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      record[key] = "[Filtered]";
    } else if (typeof record[key] === "string" && SENSITIVE_VAL_RE.test(record[key] as string)) {
      record[key] = "[Filtered]";
    } else {
      scrubValue(record[key]);
    }
  }
}
