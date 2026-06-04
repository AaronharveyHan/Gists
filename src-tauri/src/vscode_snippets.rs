/// VS Code snippet import.
///
/// VS Code snippets live in:
///   macOS:   ~/Library/Application Support/Code/User/snippets/*.json
///   Linux:   ~/.config/Code/User/snippets/*.json
///   Windows: %APPDATA%\Code\User\snippets\*.json
///
/// File format (per-language `<lang>.json` or global `*.code-snippets`):
/// ```json
/// {
///   "Print to console": {
///     "scope": "javascript,typescript",
///     "prefix": "log",
///     "body": ["console.log('$1');", "$2"],
///     "description": "Log output to console"
///   }
/// }
/// ```
///
/// We treat each top-level entry as one template:
///   - name        = the JSON key
///   - description = `description` field, or `prefix` if absent
///   - language    = `scope` (first one) or filename stem (e.g. `python.json` → python)
///   - files       = single file with extension inferred from language
///   - body        = joined with "\n" (tabstops preserved as-is)
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VscodeSnippet {
    /// Top-level JSON key — used as template name.
    pub name: String,
    /// Snippet description (or prefix if missing).
    pub description: String,
    /// Trigger prefix (informational; not used in template).
    pub prefix: String,
    /// Inferred language, e.g. "python", "javascript". May be empty.
    pub language: String,
    /// Filename we'll save as, e.g. "snippet.py".
    pub filename: String,
    /// Joined body content with tabstops preserved.
    pub body: String,
    /// Source file path (for the user to see where it came from).
    pub source: String,
}

/// Detect the default VS Code user snippets directory for the current OS.
/// Returns None when the directory does not exist.
pub fn default_snippets_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    let p = dirs::home_dir()?
        .join("Library/Application Support/Code/User/snippets");
    #[cfg(target_os = "linux")]
    let p = dirs::config_dir()?.join("Code/User/snippets");
    #[cfg(target_os = "windows")]
    let p = dirs::config_dir()?.join("Code/User/snippets");

    if p.exists() { Some(p) } else { None }
}

/// Map common VS Code language identifiers → file extensions.
fn lang_to_ext(lang: &str) -> &'static str {
    match lang.to_lowercase().as_str() {
        "python" => "py",
        "javascript" | "javascriptreact" => "js",
        "typescript" | "typescriptreact" => "ts",
        "rust" => "rs",
        "go" => "go",
        "ruby" => "rb",
        "shellscript" | "bash" | "shell" | "sh" => "sh",
        "html" => "html",
        "css" => "css",
        "scss" => "scss",
        "less" => "less",
        "markdown" => "md",
        "json" => "json",
        "yaml" => "yaml",
        "sql" => "sql",
        "php" => "php",
        "java" => "java",
        "cpp" | "c++" => "cpp",
        "c" => "c",
        "csharp" | "c#" => "cs",
        "swift" => "swift",
        "kotlin" => "kt",
        "lua" => "lua",
        "dart" => "dart",
        "vue" => "vue",
        "svelte" => "svelte",
        "dockerfile" => "Dockerfile",
        "toml" => "toml",
        "xml" => "xml",
        _ => "txt",
    }
}

/// Parse one snippet JSON file and emit a list of snippet entries.
fn parse_file(path: &Path) -> Result<Vec<VscodeSnippet>> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| anyhow!("read {:?}: {}", path, e))?;

    // VS Code snippet files often contain `// comments` (JSONC).
    // Strip them with a tolerant pre-pass before parsing.
    let cleaned = strip_jsonc_comments(&raw);

    let json: Value = serde_json::from_str(&cleaned)
        .map_err(|e| anyhow!("parse {:?}: {}", path, e))?;

    let obj = json.as_object().ok_or_else(|| anyhow!("not a JSON object"))?;

    // Filename like `python.json` → language hint "python".
    // `.code-snippets` files have no language hint at the filename level.
    let file_lang_hint = path
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.ends_with(".code-snippets"))
        .map(|s| s.to_lowercase());

    let source = path.to_string_lossy().to_string();
    let mut out = Vec::new();

    for (name, value) in obj {
        let Some(entry) = value.as_object() else { continue };

        // Extract body — string or array of strings.
        let body = match entry.get("body") {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Array(arr)) => arr
                .iter()
                .filter_map(|v| v.as_str())
                .collect::<Vec<_>>()
                .join("\n"),
            _ => continue, // skip entries without a body
        };

        let prefix = match entry.get("prefix") {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Array(arr)) => arr
                .iter()
                .filter_map(|v| v.as_str())
                .next()
                .unwrap_or("")
                .to_string(),
            _ => String::new(),
        };

        let description = entry
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                if prefix.is_empty() { String::new() } else { format!("Prefix: {}", prefix) }
            });

        // Resolve language: explicit scope > filename stem > unknown.
        let scope_lang = entry
            .get("scope")
            .and_then(|v| v.as_str())
            .and_then(|s| s.split(',').next())
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty());
        let language = scope_lang.or_else(|| file_lang_hint.clone()).unwrap_or_default();

        let ext = lang_to_ext(&language);
        let filename = if ext == "Dockerfile" {
            "Dockerfile".to_string()
        } else {
            format!("snippet.{}", ext)
        };

        out.push(VscodeSnippet {
            name: name.clone(),
            description,
            prefix,
            language,
            filename,
            body,
            source: source.clone(),
        });
    }

    Ok(out)
}

/// Preview VS Code snippets from a file or directory.
/// If `path` is None, attempts the default OS location.
pub fn preview(path: Option<String>) -> Result<Vec<VscodeSnippet>> {
    let root = match path {
        Some(p) => PathBuf::from(p),
        None => default_snippets_dir()
            .ok_or_else(|| anyhow!("VS Code snippets directory not found — please pick a file or folder manually"))?,
    };

    if !root.exists() {
        return Err(anyhow!("Path does not exist: {:?}", root));
    }

    let mut all = Vec::new();
    if root.is_file() {
        all.extend(parse_file(&root)?);
    } else {
        for entry in std::fs::read_dir(&root)? {
            let entry = entry?;
            let p = entry.path();
            if !p.is_file() { continue }
            let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            let is_snippet = name.ends_with(".json") || name.ends_with(".code-snippets");
            if !is_snippet { continue }
            // Best-effort: skip files that fail to parse, don't abort the whole import.
            if let Ok(snippets) = parse_file(&p) {
                all.extend(snippets);
            }
        }
    }

    Ok(all)
}

/// Strip `//` and `/* */` style comments from JSONC.
/// Naive but sufficient for VS Code snippet files (no string-escape edge cases observed in practice).
fn strip_jsonc_comments(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let mut chars = src.chars().peekable();
    let mut in_string = false;
    let mut escape = false;

    while let Some(c) = chars.next() {
        if in_string {
            out.push(c);
            if escape { escape = false; }
            else if c == '\\' { escape = true; }
            else if c == '"' { in_string = false; }
            continue;
        }
        if c == '"' {
            in_string = true;
            out.push(c);
            continue;
        }
        if c == '/' {
            match chars.peek() {
                Some('/') => {
                    // line comment — consume until newline
                    while let Some(&n) = chars.peek() {
                        if n == '\n' { break; }
                        chars.next();
                    }
                    continue;
                }
                Some('*') => {
                    chars.next();
                    let mut prev = '\0';
                    while let Some(n) = chars.next() {
                        if prev == '*' && n == '/' { break; }
                        prev = n;
                    }
                    continue;
                }
                _ => {}
            }
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Write `content` to a file named exactly `name` inside a uniquely-named
    /// temp directory, preserving the filename stem (which `parse_file` reads as
    /// a language hint). Caller is responsible for cleanup.
    fn temp_file(name: &str, content: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gists-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn lang_to_ext_known_and_unknown() {
        assert_eq!(lang_to_ext("python"), "py");
        assert_eq!(lang_to_ext("TypeScript"), "ts"); // case-insensitive
        assert_eq!(lang_to_ext("typescriptreact"), "ts");
        assert_eq!(lang_to_ext("c++"), "cpp");
        assert_eq!(lang_to_ext("dockerfile"), "Dockerfile");
        assert_eq!(lang_to_ext("totally-unknown"), "txt");
    }

    #[test]
    fn strip_jsonc_line_and_block_comments() {
        let src = "{\n  // a line comment\n  \"a\": 1, /* block */ \"b\": 2\n}";
        let cleaned = strip_jsonc_comments(src);
        assert!(!cleaned.contains("line comment"));
        assert!(!cleaned.contains("block"));
        let json: Value = serde_json::from_str(&cleaned).unwrap();
        assert_eq!(json["a"], 1);
        assert_eq!(json["b"], 2);
    }

    #[test]
    fn strip_jsonc_preserves_slashes_in_strings() {
        let src = r#"{"url": "http://example.com/path"}"#;
        let cleaned = strip_jsonc_comments(src);
        assert!(cleaned.contains("http://example.com/path"));
    }

    #[test]
    fn parse_file_array_body_and_scope_language() {
        let json = r#"{
            "Log": {
                "scope": "javascript,typescript",
                "prefix": "log",
                "body": ["console.log('$1');", "$2"],
                "description": "Log to console"
            }
        }"#;
        let path = temp_file("snippets.code-snippets", json);
        let out = parse_file(&path).unwrap();
        std::fs::remove_file(&path).ok();

        assert_eq!(out.len(), 1);
        let s = &out[0];
        assert_eq!(s.name, "Log");
        assert_eq!(s.description, "Log to console");
        assert_eq!(s.prefix, "log");
        assert_eq!(s.language, "javascript"); // first scope wins
        assert_eq!(s.filename, "snippet.js");
        assert_eq!(s.body, "console.log('$1');\n$2"); // joined with \n
    }

    #[test]
    fn parse_file_infers_language_from_filename_stem() {
        // No scope → language taken from the `python.json` filename stem.
        let json = r#"{ "Hi": { "prefix": "hi", "body": "print('hi')" } }"#;
        let path = temp_file("python.json", json);
        let out = parse_file(&path).unwrap();
        std::fs::remove_file(&path).ok();

        assert_eq!(out.len(), 1);
        assert_eq!(out[0].language, "python");
        assert_eq!(out[0].filename, "snippet.py");
        // description falls back to "Prefix: <prefix>" when absent.
        assert_eq!(out[0].description, "Prefix: hi");
        assert_eq!(out[0].body, "print('hi')");
    }

    #[test]
    fn parse_file_skips_entries_without_body() {
        let json = r#"{ "NoBody": { "prefix": "x" }, "Good": { "body": "ok" } }"#;
        let path = temp_file("misc.json", json);
        let out = parse_file(&path).unwrap();
        std::fs::remove_file(&path).ok();

        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "Good");
    }
}
