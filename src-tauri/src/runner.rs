use anyhow::Result;
use once_cell::sync::Lazy;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Window};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use std::process::Stdio;

// Maps run_id → PID so kill_run can send a signal.
//
// All locks on this and the per-run output buffers use
// `.unwrap_or_else(|e| e.into_inner())` rather than `.unwrap()`: if a thread
// panics while holding the lock the mutex becomes poisoned, and a plain
// `.unwrap()` would turn that into a cascade of panics that permanently breaks
// the run feature. The data here (a PID map, line buffers) stays usable after
// such a panic, so recovering the inner value is the safe, non-fatal choice.
static RUNNING_PIDS: Lazy<Mutex<HashMap<String, u32>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Serialize, Clone)]
pub struct RunLine {
    pub text: String,
    pub stream: String, // "stdout" | "stderr"
}

#[derive(Serialize, Clone)]
pub struct RunDone {
    pub exit_code: i32,
    pub timed_out: bool,
    pub killed: bool,
    /// Full captured stdout (≤100 KB, truncated with marker if exceeded).
    pub stdout: String,
    /// Full captured stderr (≤100 KB, truncated with marker if exceeded).
    pub stderr: String,
    /// Wall-clock duration in milliseconds.
    pub duration_ms: i64,
    /// True if either stdout or stderr was clipped at the 100 KB cap.
    pub truncated: bool,
}

struct Runner {
    program: &'static str,
    pre_args: Vec<&'static str>,
}

fn detect_runner(filename: &str) -> Option<Runner> {
    let ext = filename.rsplit('.').next()?.to_lowercase();
    match ext.as_str() {
        "py"                 => Some(Runner { program: "python3",  pre_args: vec![] }),
        "js" | "mjs" | "cjs" => Some(Runner { program: "node",    pre_args: vec![] }),
        "sh"                 => Some(Runner { program: "bash",     pre_args: vec![] }),
        "bash"               => Some(Runner { program: "bash",     pre_args: vec![] }),
        "zsh"                => Some(Runner { program: "zsh",      pre_args: vec![] }),
        "rb"                 => Some(Runner { program: "ruby",     pre_args: vec![] }),
        "php"                => Some(Runner { program: "php",      pre_args: vec![] }),
        "go"                 => Some(Runner { program: "go",       pre_args: vec!["run"] }),
        // TypeScript via npx ts-node (installed on-demand)
        "ts"                 => Some(Runner {
            program: "npx",
            pre_args: vec!["--yes", "ts-node", "--transpile-only"],
        }),
        _ => None,
    }
}

/// Cross-platform: kill a process by PID.
fn kill_pid(pid: u32) {
    #[cfg(unix)]
    { let _ = std::process::Command::new("kill").arg(pid.to_string()).status(); }

    #[cfg(windows)]
    { let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/F"]).status(); }
}

pub async fn run_code(
    window: Window,
    run_id: String,
    filename: String,
    content: String,
) -> Result<RunDone> {
    let runner = detect_runner(&filename)
        .ok_or_else(|| anyhow::anyhow!("No runner available for '{}'", filename))?;

    // Write content to a temp file (same name → correct extension for the interpreter).
    let tmp_dir = std::env::temp_dir().join(format!("gists-run-{}", run_id));
    tokio::fs::create_dir_all(&tmp_dir).await?;
    let tmp_path = tmp_dir.join(&filename);
    tokio::fs::write(&tmp_path, content.as_bytes()).await?;

    let mut cmd = Command::new(runner.program);
    cmd.args(&runner.pre_args);
    cmd.arg(&tmp_path);
    cmd.stdout(Stdio::piped())
       .stderr(Stdio::piped())
       .stdin(Stdio::null());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let msg = if e.kind() == std::io::ErrorKind::NotFound {
                format!("Interpreter '{}' not found — is it installed?", runner.program)
            } else {
                format!("Failed to start '{}': {}", runner.program, e)
            };
            let _ = window.emit(
                &format!("run-line-{}", run_id),
                RunLine { text: msg.clone(), stream: "stderr".into() },
            );
            return Ok(RunDone {
                exit_code: -1, timed_out: false, killed: false,
                stdout: String::new(), stderr: msg, duration_ms: 0,
                truncated: false,
            });
        }
    };

    let pid = child.id().unwrap_or(0);
    if pid != 0 {
        RUNNING_PIDS.lock().unwrap_or_else(|e| e.into_inner()).insert(run_id.clone(), pid);
    }

    let start = std::time::Instant::now();

    // Shared buffers for archiving — filled alongside live event emission.
    let stdout_buf: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let stderr_buf: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));

    // Stream stdout/stderr from background tasks.
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    let w1 = window.clone();
    let id1 = run_id.clone();
    let buf1 = stdout_buf.clone();
    let t1 = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = w1.emit(
                &format!("run-line-{}", id1),
                RunLine { text: line.clone(), stream: "stdout".into() },
            );
            buf1.lock().unwrap_or_else(|e| e.into_inner()).push(line);
        }
    });

    let w2 = window.clone();
    let id2 = run_id.clone();
    let buf2 = stderr_buf.clone();
    let t2 = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = w2.emit(
                &format!("run-line-{}", id2),
                RunLine { text: line.clone(), stream: "stderr".into() },
            );
            buf2.lock().unwrap_or_else(|e| e.into_inner()).push(line);
        }
    });

    // Wait with a 30-second timeout.
    let (exit_code, timed_out, killed) =
        match tokio::time::timeout(Duration::from_secs(30), child.wait()).await {
            Ok(Ok(status)) => {
                let ec = status.code().unwrap_or(-1);
                // code() is None on Unix when killed by signal
                let kl = status.code().is_none();
                (ec, false, kl)
            }
            Ok(Err(_)) => (-1, false, false),
            Err(_) => {
                // Timed out: kill the process, then wait for it to exit.
                if pid != 0 { kill_pid(pid); }
                let _ = child.wait().await;
                (-1, true, false)
            }
        };

    // Wait for I/O tasks to drain any buffered output.
    let _ = tokio::join!(t1, t2);

    let duration_ms = start.elapsed().as_millis() as i64;

    const MAX_BYTES: usize = 102_400;
    let mut stdout_str = stdout_buf.lock().unwrap_or_else(|e| e.into_inner()).join("\n");
    let mut stderr_str = stderr_buf.lock().unwrap_or_else(|e| e.into_inner()).join("\n");
    let stdout_clipped = clip_to(&mut stdout_str, MAX_BYTES);
    let stderr_clipped = clip_to(&mut stderr_str, MAX_BYTES);
    let truncated = stdout_clipped || stderr_clipped;

    RUNNING_PIDS.lock().unwrap_or_else(|e| e.into_inner()).remove(&run_id);

    // Best-effort cleanup of the temp directory.
    let _ = tokio::fs::remove_dir_all(&tmp_dir).await;

    Ok(RunDone { exit_code, timed_out, killed, stdout: stdout_str, stderr: stderr_str, duration_ms, truncated })
}

/// Clip `s` to at most `max_bytes`, snapping to a UTF-8 char boundary so we
/// never panic mid-codepoint, then append a marker. Returns true if clipped.
fn clip_to(s: &mut String, max_bytes: usize) -> bool {
    if s.len() <= max_bytes {
        return false;
    }
    let mut cut = max_bytes;
    while cut > 0 && !s.is_char_boundary(cut) {
        cut -= 1;
    }
    s.truncate(cut);
    s.push_str("\n…[truncated]");
    true
}

/// Signal a running process to stop. The run_code future will detect the exit
/// and emit run-done naturally.
pub fn kill_run(run_id: &str) {
    if let Some(pid) = RUNNING_PIDS.lock().unwrap_or_else(|e| e.into_inner()).get(run_id).copied() {
        if pid != 0 { kill_pid(pid); }
    }
}

/// List language extensions this runner supports.
pub const SUPPORTED_EXTS: &[&str] = &[
    "py", "js", "mjs", "cjs", "ts", "sh", "bash", "zsh", "rb", "php", "go",
];
