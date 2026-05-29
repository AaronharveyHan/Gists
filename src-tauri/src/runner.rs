use anyhow::Result;
use once_cell::sync::Lazy;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Window};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use std::process::Stdio;

// Maps run_id → PID so kill_run can send a signal.
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
) -> Result<()> {
    let runner = detect_runner(&filename)
        .ok_or_else(|| anyhow::anyhow!("No runner available for '{}'", filename))?;

    // Write content to a temp file (same name → correct extension for the interpreter).
    let tmp_dir = std::env::temp_dir().join(format!("gists-run-{}", &run_id[..8]));
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
                RunLine { text: msg, stream: "stderr".into() },
            );
            let _ = window.emit(
                &format!("run-done-{}", run_id),
                RunDone { exit_code: -1, timed_out: false, killed: false },
            );
            return Ok(());
        }
    };

    let pid = child.id().unwrap_or(0);
    if pid != 0 {
        RUNNING_PIDS.lock().unwrap().insert(run_id.clone(), pid);
    }

    // Stream stdout/stderr from background tasks.
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    let w1 = window.clone();
    let id1 = run_id.clone();
    let t1 = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = w1.emit(
                &format!("run-line-{}", id1),
                RunLine { text: line, stream: "stdout".into() },
            );
        }
    });

    let w2 = window.clone();
    let id2 = run_id.clone();
    let t2 = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = w2.emit(
                &format!("run-line-{}", id2),
                RunLine { text: line, stream: "stderr".into() },
            );
        }
    });

    // Wait with a 30-second timeout.
    let done = match tokio::time::timeout(Duration::from_secs(30), child.wait()).await {
        Ok(Ok(status)) => {
            let exit_code = status.code().unwrap_or(-1);
            // code() is None on Unix when killed by signal
            let killed = status.code().is_none();
            RunDone { exit_code, timed_out: false, killed }
        }
        Ok(Err(_)) => RunDone { exit_code: -1, timed_out: false, killed: false },
        Err(_) => {
            // Timed out: kill the process, then wait for it to exit.
            if pid != 0 { kill_pid(pid); }
            let _ = child.wait().await;
            RunDone { exit_code: -1, timed_out: true, killed: false }
        }
    };

    // Wait for I/O tasks to drain any buffered output.
    let _ = tokio::join!(t1, t2);

    RUNNING_PIDS.lock().unwrap().remove(&run_id);
    let _ = window.emit(&format!("run-done-{}", run_id), done);

    // Best-effort cleanup of the temp directory.
    let _ = tokio::fs::remove_dir_all(&tmp_dir).await;

    Ok(())
}

/// Signal a running process to stop. The run_code future will detect the exit
/// and emit run-done naturally.
pub fn kill_run(run_id: &str) {
    if let Some(pid) = RUNNING_PIDS.lock().unwrap().get(run_id).copied() {
        if pid != 0 { kill_pid(pid); }
    }
}

/// List language extensions this runner supports.
pub const SUPPORTED_EXTS: &[&str] = &[
    "py", "js", "mjs", "cjs", "ts", "sh", "bash", "zsh", "rb", "php", "go",
];
