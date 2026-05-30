/// Optional Sentry crash reporting for the Rust backend.
///
/// Set SENTRY_DSN at build time (or in the environment at runtime) to enable.
/// The guard must live for the entire process lifetime — it is stored in a
/// OnceLock so it is never dropped while the app is running.
///
/// Build-time setup:
///   export SENTRY_DSN="https://<key>@<org>.ingest.sentry.io/<project>"
///   cargo tauri build

use once_cell::sync::OnceCell;

static _GUARD: OnceCell<sentry::ClientInitGuard> = OnceCell::new();

/// Initialise Sentry if `enabled` is true and `SENTRY_DSN` env var is set.
/// Safe to call multiple times — subsequent calls are no-ops.
pub fn init(enabled: bool) {
    if !enabled {
        return;
    }
    let dsn = match std::env::var("SENTRY_DSN").ok().filter(|s| !s.is_empty()) {
        Some(d) => d,
        None => return,
    };
    // Already initialised from a previous call
    if _GUARD.get().is_some() {
        return;
    }
    let guard = sentry::init((
        dsn,
        sentry::ClientOptions {
            release: sentry::release_name!(),
            // Scrub token-like values from all envelopes before sending.
            before_send: Some(std::sync::Arc::new(|mut event| {
                scrub_event(&mut event);
                Some(event)
            })),
            ..Default::default()
        },
    ));
    // Store the guard so it is never dropped.
    let _ = _GUARD.set(guard);
}

/// Capture an error string. Fire-and-forget; never panics.
pub fn capture_message(message: &str) {
    if _GUARD.get().is_none() {
        return;
    }
    sentry::capture_message(message, sentry::Level::Error);
}

// ── PII scrubber ─────────────────────────────────────────────────────────────

fn scrub_event(event: &mut sentry::protocol::Event) {
    // Remove the user field entirely — no GitHub username or email.
    event.user = None;
    // Strip tag values that look like secrets.
    event.tags.retain(|k, v| {
        let sensitive = k.to_lowercase().contains("token")
            || k.to_lowercase().contains("key")
            || k.to_lowercase().contains("secret");
        if sensitive {
            *v = "[Filtered]".into();
        }
        true
    });
}
