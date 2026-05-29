//! `gist` — command-line companion for Gists Client.
//!
//! Shares the same SQLite database and OS keychain entry as the desktop app,
//! so anything you save from the terminal shows up in the app and vice-versa.
//!
//! Build:   cargo build --release --features cli --bin gist
//! Install: copy target/release/gist into your PATH
//!
//! Usage:
//!   gist save <file>...        Create a gist from one or more files
//!   gist save -                Create a gist from stdin
//!   gist list                  List recent gists
//!   gist search <query>        Full-text search your gists
//!   gist view <id>             Print a gist's files to stdout
//!   gist open <id>             Open a gist in the browser
//!   gist whoami                Show the authenticated GitHub login
//!
//! Flags for `save`:
//!   -p, --public               Make the gist public (default: secret)
//!   -d, --desc <text>          Set the description
//!   -l, --local                Save as a local draft only (don't push to GitHub)
//!       --name <filename>      Filename to use when reading from stdin

use anyhow::{anyhow, bail, Result};
use gists_client::{auth, cache, db, github};
use gists_client::models::Gist;
use std::io::Read;
use std::path::Path;

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let code = match run(args).await {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("gist: {e}");
            1
        }
    };
    std::process::exit(code);
}

async fn run(args: Vec<String>) -> Result<()> {
    let (cmd, rest) = match args.split_first() {
        Some((c, r)) => (c.as_str(), r.to_vec()),
        None => {
            print_help();
            return Ok(());
        }
    };

    match cmd {
        "save" | "new" | "create" => cmd_save(rest).await,
        "list" | "ls" => cmd_list(rest),
        "search" | "find" => cmd_search(rest),
        "view" | "cat" => cmd_view(rest),
        "open" => cmd_open(rest),
        "whoami" => cmd_whoami().await,
        "help" | "--help" | "-h" => {
            print_help();
            Ok(())
        }
        "version" | "--version" | "-V" => {
            println!("gist {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        other => bail!("unknown command '{other}'. Run `gist help` for usage."),
    }
}

// ── Database bootstrap ──────────────────────────────────────────────────────

/// Resolve the shared app-data dir and open the SQLite database.
fn init_db() -> Result<()> {
    let dir = auth::app_data_dir().ok_or_else(|| anyhow!("could not resolve app data directory"))?;
    std::fs::create_dir_all(&dir)?;
    db::init_db(&dir.to_string_lossy()).map_err(|e| anyhow!("open database: {e}"))?;
    Ok(())
}

// ── save ────────────────────────────────────────────────────────────────────

async fn cmd_save(args: Vec<String>) -> Result<()> {
    let mut public = false;
    let mut local = false;
    let mut json = false;
    let mut description = String::new();
    let mut stdin_name = String::from("snippet.txt");
    let mut paths: Vec<String> = Vec::new();

    let mut it = args.into_iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "-p" | "--public" => public = true,
            "-l" | "--local" => local = true,
            "--json" => json = true,
            "-d" | "--desc" | "--description" => {
                description = it.next().ok_or_else(|| anyhow!("--desc needs a value"))?;
            }
            "--name" => {
                stdin_name = it.next().ok_or_else(|| anyhow!("--name needs a value"))?;
            }
            other => paths.push(other.to_string()),
        }
    }

    if paths.is_empty() {
        bail!("nothing to save — pass one or more files, or `-` to read stdin");
    }

    // Collect (filename, content) pairs.
    let mut files: Vec<(String, String)> = Vec::new();
    for p in &paths {
        if p == "-" {
            let mut buf = String::new();
            std::io::stdin().read_to_string(&mut buf)?;
            if buf.is_empty() {
                bail!("stdin was empty");
            }
            files.push((stdin_name.clone(), buf));
        } else {
            let content = std::fs::read_to_string(p).map_err(|e| anyhow!("read {p}: {e}"))?;
            let name = Path::new(p)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("file.txt")
                .to_string();
            files.push((name, content));
        }
    }

    init_db()?;

    // Push to GitHub when authenticated; otherwise fall back to a local draft.
    let token = if local { None } else { auth::load_token() };

    match token {
        Some(token) => {
            let (gist, etag) = github::create_gist(&token, &description, public, files)
                .await
                .map_err(|e| anyhow!("create gist: {e}"))?;
            cache::upsert_gist_from_remote_with_etag(&gist, etag.as_deref())
                .map_err(|e| anyhow!("cache gist: {e}"))?;
            if json {
                print_save_json(&gist);
            } else {
                println!("✓ {} gist created", if public { "public" } else { "secret" });
                println!("  {}", gist.html_url);
            }
        }
        None => {
            if !local && !json {
                eprintln!("• Not logged in — saved as a local draft (publish later from the app).");
            }
            let gist = cache::create_local_draft(&description, public, &files)
                .map_err(|e| anyhow!("save draft: {e}"))?;
            if json {
                print_save_json(&gist);
            } else {
                println!("✓ local draft saved");
                println!("  id: {}", gist.id);
            }
        }
    }
    Ok(())
}

// ── list / search ─────────────────────────────────────────────────────────────

fn cmd_list(args: Vec<String>) -> Result<()> {
    let mut limit = 20usize;
    let mut json = false;
    let mut it = args.into_iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "-n" | "--limit" => {
                limit = it
                    .next()
                    .ok_or_else(|| anyhow!("-n needs a value"))?
                    .parse()
                    .map_err(|_| anyhow!("-n expects a number"))?;
            }
            "-a" | "--all" => limit = usize::MAX,
            "--json" => json = true,
            other => bail!("unexpected argument '{other}'"),
        }
    }
    init_db()?;
    let gists: Vec<Gist> = cache::list_gists()
        .map_err(|e| anyhow!("list: {e}"))?
        .into_iter()
        .take(limit)
        .collect();
    if json {
        print_gists_json(&gists);
    } else {
        print_gist_table(gists);
    }
    Ok(())
}

fn cmd_search(args: Vec<String>) -> Result<()> {
    // Pull out --json; everything else forms the query.
    let mut json = false;
    let terms: Vec<String> = args
        .into_iter()
        .filter(|a| {
            if a == "--json" {
                json = true;
                false
            } else {
                true
            }
        })
        .collect();
    let query = terms.join(" ");
    if query.trim().is_empty() {
        bail!("search needs a query, e.g. `gist search async rust`");
    }
    init_db()?;
    let gists = cache::search_gists(&query).map_err(|e| anyhow!("search: {e}"))?;
    if json {
        print_gists_json(&gists);
    } else if gists.is_empty() {
        println!("No gists match \"{query}\".");
    } else {
        print_gist_table(gists);
    }
    Ok(())
}

// ── view / open ───────────────────────────────────────────────────────────────

fn cmd_view(args: Vec<String>) -> Result<()> {
    let id = args.first().ok_or_else(|| anyhow!("view needs a gist id"))?;
    init_db()?;
    let gist = resolve_gist(id)?;
    let multi = gist.files.len() > 1;
    for f in &gist.files {
        if multi {
            println!("===== {} =====", f.filename);
        }
        print!("{}", f.content);
        if !f.content.ends_with('\n') {
            println!();
        }
        if multi {
            println!();
        }
    }
    Ok(())
}

fn cmd_open(args: Vec<String>) -> Result<()> {
    let id = args.first().ok_or_else(|| anyhow!("open needs a gist id"))?;
    init_db()?;
    let gist = resolve_gist(id)?;
    if gist.local_only || gist.html_url.is_empty() {
        bail!("'{}' is a local draft — not yet on GitHub", short_id(&gist.id));
    }
    println!("{}", gist.html_url);
    open_in_browser(&gist.html_url);
    Ok(())
}

// ── whoami ────────────────────────────────────────────────────────────────────

async fn cmd_whoami() -> Result<()> {
    init_db()?;
    match auth::load_token() {
        Some(token) => {
            let login = github::validate_token(&token)
                .await
                .map_err(|e| anyhow!("validate token: {e}"))?;
            println!("Logged in as @{login}");
        }
        None => println!("Not logged in (local mode). Connect GitHub in the app to enable sync."),
    }
    Ok(())
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/// Find a gist whose id starts with `prefix`; errors on no/ambiguous match.
fn resolve_gist(prefix: &str) -> Result<Gist> {
    let all = cache::list_gists().map_err(|e| anyhow!("list: {e}"))?;
    let mut matches: Vec<Gist> = all.into_iter().filter(|g| g.id.starts_with(prefix)).collect();
    match matches.len() {
        0 => bail!("no gist with id starting '{prefix}' — run `gist list`"),
        1 => Ok(matches.remove(0)),
        n => bail!("'{prefix}' matches {n} gists — use a longer id"),
    }
}

fn short_id(id: &str) -> String {
    id.chars().take(12).collect()
}

/// Emit a gist list as a compact JSON array — consumed by Raycast / Alfred / jq.
fn print_gists_json(gists: &[Gist]) {
    let arr: Vec<serde_json::Value> = gists
        .iter()
        .map(|g| {
            serde_json::json!({
                "id": g.id,
                "description": g.description,
                "public": g.public,
                "local": g.local_only,
                "url": g.html_url,
                "files": g.files.iter().map(|f| f.filename.clone()).collect::<Vec<_>>(),
                "language": g.files.first().and_then(|f| f.language.clone()),
            })
        })
        .collect();
    println!("{}", serde_json::to_string(&arr).unwrap_or_else(|_| "[]".into()));
}

/// Emit a single just-created gist as JSON.
fn print_save_json(g: &Gist) {
    let v = serde_json::json!({
        "id": g.id,
        "url": g.html_url,
        "public": g.public,
        "local": g.local_only,
    });
    println!("{}", serde_json::to_string(&v).unwrap_or_else(|_| "{}".into()));
}

fn print_gist_table(gists: Vec<Gist>) {
    if gists.is_empty() {
        println!("No gists yet. Save one with `gist save <file>`.");
        return;
    }
    for g in gists {
        let vis = if g.local_only {
            "draft "
        } else if g.public {
            "public"
        } else {
            "secret"
        };
        let desc = if g.description.trim().is_empty() {
            first_filename(&g)
        } else {
            g.description.clone()
        };
        let nfiles = g.files.len();
        println!(
            "{:<12}  {}  {}  ({} file{})",
            short_id(&g.id),
            vis,
            truncate(&desc, 60),
            nfiles,
            if nfiles == 1 { "" } else { "s" },
        );
    }
}

fn first_filename(g: &Gist) -> String {
    g.files
        .first()
        .map(|f| f.filename.clone())
        .unwrap_or_else(|| "(empty)".into())
}

fn truncate(s: &str, max: usize) -> String {
    let s = s.replace('\n', " ");
    if s.chars().count() <= max {
        s
    } else {
        let cut: String = s.chars().take(max.saturating_sub(1)).collect();
        format!("{cut}…")
    }
}

fn open_in_browser(url: &str) {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("cmd").args(["/C", "start", "", url]).spawn();
}

fn print_help() {
    println!(
        r#"gist — command-line companion for Gists Client

USAGE:
    gist <command> [args]

COMMANDS:
    save <file>...        Create a gist from one or more files
    save -                Create a gist from stdin (use --name to set filename)
    list [-n N] [--all]   List recent gists (default 20)
    search <query>        Full-text search your gists
    view <id>             Print a gist's files to stdout
    open <id>             Open a gist in the browser
    whoami                Show the authenticated GitHub login
    version               Print version

SAVE FLAGS:
    -p, --public          Make the gist public (default: secret)
    -d, --desc <text>     Set the description
    -l, --local           Save as a local draft only (don't push to GitHub)
        --name <file>     Filename to use when reading from stdin

OUTPUT:
    --json                Machine-readable JSON (for save / list / search;
                          used by the Raycast & Alfred integrations)

EXAMPLES:
    gist save foo.py
    gist save foo.py bar.js --public -d "two snippets"
    cat notes.md | gist save - --name notes.md
    gist list -n 5
    gist search "tag:work lang:python"
    gist view 1a2b3c

Shares the same database as the desktop app — ids come from `gist list`."#
    );
}
