//! Heuristic gist category + coarse language bucket for sidebar / filtering.
//! Category is driven primarily by **filename extension** (after config/script rules).
use crate::models::{Gist, GistFile};

/// Returns `(category, lang_group)`.
pub fn classify(gist: &Gist) -> (&'static str, &'static str) {
    let cat = classify_category(gist);
    let lg = classify_lang_group(gist);
    (cat, lg)
}

fn classify_category(gist: &Gist) -> &'static str {
    let files = &gist.files;
    if files.is_empty() {
        return "gist";
    }

    if files.iter().any(|f| is_config_file(f)) {
        return "config";
    }
    if files.iter().any(|f| is_script_signal(f, files.len())) {
        return "script";
    }
    // Extension-first: document / media / data by filename (trimmed), incl. multi-file vote.
    if let Some(c) = dominant_extension_category(files) {
        return c;
    }
    if files.len() >= 3 {
        return "multi";
    }
    if files.len() == 1 {
        let lines = line_count(&files[0].content);
        if lines < 50 {
            return "snippet";
        }
    }
    if files.iter().any(|f| is_library_file(f)) {
        return "library";
    }
    if files.iter().any(|f| is_test_signal(f)) {
        return "test";
    }
    "gist"
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ExtFam {
    Doc,
    Media,
    Data,
    Code,
    Other,
}

/// Per-file bucket from extension / doc-like basename only (not file body except elsewhere).
fn file_extension_family(f: &GistFile) -> ExtFam {
    let name = f.filename.trim();
    if name.is_empty() {
        return ExtFam::Other;
    }
    if file_looks_like_document_filename(name) {
        return ExtFam::Doc;
    }
    let n = name.to_ascii_lowercase();
    if let Some(ext) = gist_extension(&n) {
        if is_media_extension(ext) {
            return ExtFam::Media;
        }
        if is_tabular_or_dump_extension(ext) {
            return ExtFam::Data;
        }
        if is_code_like_extension(ext) {
            return ExtFam::Code;
        }
    }
    ExtFam::Other
}

/// Pick `document` / `media` / `data` from extension families; `None` → fall through to multi/snippet/…
fn dominant_extension_category(files: &[GistFile]) -> Option<&'static str> {
    let fams: Vec<ExtFam> = files.iter().map(file_extension_family).collect();
    if fams.is_empty() {
        return None;
    }
    let n = fams.len();
    let count = |fam: ExtFam| fams.iter().filter(|&&x| x == fam).count();
    let d = count(ExtFam::Doc);
    let m = count(ExtFam::Media);
    let dat = count(ExtFam::Data);

    if n == 1 {
        if d == 1 {
            return Some("document");
        }
        if m == 1 {
            return Some("media");
        }
        if dat == 1 {
            return Some("data");
        }
        return None;
    }

    let max_dmd = d.max(m).max(dat);
    if max_dmd == 0 {
        return None;
    }
    // Plurality; ties: document > media > data (doc-heavy gists stay under “Docs”).
    if d == max_dmd && d >= m && d >= dat {
        return Some("document");
    }
    if m == max_dmd && m >= d && m >= dat {
        return Some("media");
    }
    if dat == max_dmd && dat >= d && dat >= m {
        return Some("data");
    }
    None
}

fn is_media_extension(ext: &str) -> bool {
    matches!(
        ext,
        "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "svg"
            | "ico"
            | "bmp"
            | "tif"
            | "tiff"
            | "heic"
            | "heif"
            | "avif"
            | "mp4"
            | "mov"
            | "webm"
            | "mkv"
            | "avi"
            | "mp3"
            | "wav"
            | "flac"
            | "ogg"
            | "opus"
            | "m4a"
            | "pdf"
    )
}

fn is_tabular_or_dump_extension(ext: &str) -> bool {
    matches!(
        ext,
        "csv" | "tsv" | "sql" | "parquet" | "xls" | "xlsx" | "ods" | "db" | "sqlite" | "sqlite3"
    )
}

fn is_code_like_extension(ext: &str) -> bool {
    matches!(
        ext,
        "rs"
            | "go"
            | "py"
            | "rb"
            | "js"
            | "mjs"
            | "cjs"
            | "ts"
            | "tsx"
            | "jsx"
            | "java"
            | "kt"
            | "kts"
            | "swift"
            | "scala"
            | "c"
            | "h"
            | "cc"
            | "cpp"
            | "cxx"
            | "hpp"
            | "cs"
            | "php"
            | "zig"
            | "nim"
            | "ex"
            | "exs"
            | "erl"
            | "hrl"
            | "clj"
            | "cljs"
            | "hs"
            | "ml"
            | "mli"
            | "fs"
            | "fsx"
            | "vb"
            | "dart"
            | "lua"
            | "r"
            | "jl"
            | "cr"
            | "pas"
            | "pp"
            | "pl"
            | "pm"
            | "tcl"
            | "vue"
            | "svelte"
            | "elm"
    )
}

fn line_count(s: &str) -> usize {
    if s.is_empty() {
        return 0;
    }
    s.lines().count()
}

fn lower_name(f: &GistFile) -> String {
    f.filename.trim().to_ascii_lowercase()
}

fn gist_basename(name_lower: &str) -> &str {
    name_lower
        .rsplit('/')
        .next()
        .unwrap_or(name_lower)
        .rsplit('\\')
        .next()
        .unwrap_or(name_lower)
}

fn gist_extension(name_lower: &str) -> Option<&str> {
    let base = gist_basename(name_lower);
    base.rsplit_once('.').map(|(_, e)| e).filter(|e| !e.is_empty())
}

fn no_extension_plain_doc_candidate(name_lower: &str) -> bool {
    let base = gist_basename(name_lower);
    if gist_extension(name_lower).is_some() {
        return false;
    }
    !matches!(
        base,
        "dockerfile"
            | "containerfile"
            | "makefile"
            | "gemfile"
            | "rakefile"
            | "podfile"
            | "vagrantfile"
            | "jenkinsfile"
            | "procfile"
            | "brewfile"
            | "cargo"
    )
}

fn is_plain_doc_extension(ext: &str) -> bool {
    matches!(
        ext,
        "md"
            | "markdown"
            | "mdx"
            | "txt"
            | "rst"
            | "adoc"
            | "asciidoc"
            | "textile"
            | "org"
            | "wiki"
    )
}

fn file_looks_like_document_filename(filename: &str) -> bool {
    let name = filename.trim();
    if name.is_empty() {
        return false;
    }
    let n = name.to_ascii_lowercase();
    if let Some(ext) = gist_extension(&n) {
        return is_plain_doc_extension(ext);
    }
    no_extension_plain_doc_candidate(&n)
}

fn is_config_file(f: &GistFile) -> bool {
    let n = lower_name(f);
    if n.starts_with(".env") {
        return true;
    }
    let base = gist_basename(&n);
    if base == "dockerfile" || base == "containerfile" {
        return true;
    }
    if base == "nginx.conf" {
        return true;
    }
    if n.ends_with(".toml") || n.ends_with(".yaml") || n.ends_with(".yml") || n.ends_with(".json")
    {
        return true;
    }
    n.ends_with(".conf")
}

/// Shell / short script — **never** treat plain-doc extensions (.md/.txt/…) as script even if
/// the body starts with `#!` (common in fenced examples).
fn is_script_signal(f: &GistFile, nfiles: usize) -> bool {
    let n = lower_name(f);
    if let Some(ext) = gist_extension(&n) {
        if is_plain_doc_extension(ext) {
            return false;
        }
        if matches!(ext, "sh" | "bash" | "zsh" | "fish") {
            return true;
        }
        if nfiles == 1 && matches!(ext, "py" | "rb") && line_count(&f.content) < 80 {
            return true;
        }
    }
    let content = f.content.trim_start();
    content.starts_with("#!")
}

fn is_library_file(f: &GistFile) -> bool {
    let n = lower_name(f);
    let base = gist_basename(&n);
    base == "lib.rs"
        || base == "index.ts"
        || base == "__init__.py"
        || n.ends_with("/lib.rs")
        || n.ends_with("/index.ts")
        || n.ends_with("/__init__.py")
}

fn is_test_signal(f: &GistFile) -> bool {
    let n = lower_name(f);
    if n.contains("test") || n.contains("spec") {
        return true;
    }
    let c = &f.content;
    c.contains("#[test]") || c.contains("describe(")
}

fn infer_lang_from_filename(name: &str) -> Option<&'static str> {
    let name = name.trim();
    let n = name.to_ascii_lowercase();
    let ext = gist_extension(&n)?;
    Some(match ext {
        "md" | "markdown" | "mdx" => "Markdown",
        "txt" => "Text",
        "rst" => "reStructuredText",
        "adoc" | "asciidoc" => "AsciiDoc",
        "textile" => "Textile",
        "org" => "Org",
        "rs" => "Rust",
        "ts" | "tsx" => "TypeScript",
        "js" | "jsx" | "mjs" | "cjs" => "JavaScript",
        "py" => "Python",
        "go" => "Go",
        "rb" => "Ruby",
        "sh" | "bash" | "zsh" | "fish" => "Shell",
        "html" | "htm" => "HTML",
        "css" => "CSS",
        "json" => "JSON",
        "yaml" | "yml" => "YAML",
        "sql" => "SQL",
        "csv" => "CSV",
        "c" | "h" => "C",
        "cpp" | "cc" | "cxx" | "hpp" => "C++",
        "cs" => "C#",
        "java" => "Java",
        "kt" | "kts" => "Kotlin",
        "swift" => "Swift",
        "scala" => "Scala",
        "zig" => "Zig",
        "tex" | "latex" => "TeX",
        _ => return None,
    })
}

fn language_group(lang: &str) -> &'static str {
    let l = lang.trim().to_ascii_lowercase();
    match l.as_str() {
        "javascript" | "typescript" | "tsx" | "jsx" | "html" | "css" | "vue" | "svelte" => "web",
        "json" | "yaml" | "csv" | "sql" | "sqlite" => "data",
        "markdown"
        | "tex"
        | "asciidoc"
        | "rst"
        | "text"
        | "plaintext"
        | "restructuredtext"
        | "org"
        | "textile"
        | "wikitext"
        | "rdoc" => "docs",
        "python"
        | "ruby"
        | "shell"
        | "powershell"
        | "perl"
        | "fish"
        | "php"
        | "lua" => "scripting",
        "rust" | "c" | "c++" | "c#" | "go" | "swift" | "kotlin" | "java" | "scala" | "zig"
        | "nim" | "dart" | "objective-c" => "systems",
        _ => "other",
    }
}

fn classify_lang_group(gist: &Gist) -> &'static str {
    const ORDER: &[&str] = &["web", "systems", "scripting", "data", "docs", "other"];
    let mut best_rank = ORDER.len();

    for f in &gist.files {
        let group = file_lang_group(f);
        let rank = ORDER.iter().position(|&x| x == group).unwrap_or(ORDER.len() - 1);
        if rank < best_rank {
            best_rank = rank;
        }
    }

    ORDER.get(best_rank).copied().unwrap_or("other")
}

fn file_lang_group(f: &GistFile) -> &'static str {
    if file_looks_like_document_filename(&f.filename) {
        return "docs";
    }

    if let Some(l) = f.language.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let g = language_group(l);
        if g != "other" {
            return g;
        }
    }

    if let Some(inf) = infer_lang_from_filename(&f.filename) {
        let g = language_group(inf);
        if g != "other" {
            return g;
        }
    }

    if let Some(ext) = gist_extension(&lower_name(f)) {
        if is_media_extension(ext) {
            return "other";
        }
        if is_tabular_or_dump_extension(ext) {
            return "data";
        }
    }

    "other"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::GistFile;

    fn one_file(name: &str, lang: Option<&str>, content: &str) -> Gist {
        Gist {
            id: "1".into(),
            description: String::new(),
            public: false,
            html_url: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
            files: vec![GistFile {
                filename: name.into(),
                language: lang.map(String::from),
                content: content.into(),
                size: content.len() as i64,
                raw_url: None,
            }],
            pending_push: false,
            category: "gist".into(),
            lang_group: "other".into(),
            pinned: false,
        }
    }

    fn two_files(a: GistFile, b: GistFile) -> Gist {
        Gist {
            id: "2".into(),
            description: String::new(),
            public: false,
            html_url: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
            files: vec![a, b],
            pending_push: false,
            category: "gist".into(),
            lang_group: "other".into(),
            pinned: false,
        }
    }

    #[test]
    fn snippet_single_short() {
        let g = one_file("a.rs", Some("Rust"), "fn main() {}\n");
        assert_eq!(classify_category(&g), "snippet");
    }

    #[test]
    fn config_cargo_toml() {
        let g = one_file("Cargo.toml", None, "[package]\nname=\"x\"\n");
        assert_eq!(classify_category(&g), "config");
    }

    #[test]
    fn script_shebang() {
        let g = one_file("run", None, "#!/bin/bash\necho hi\n");
        assert_eq!(classify_category(&g), "script");
    }

    #[test]
    fn document_md() {
        let g = one_file("README.md", Some("Markdown"), "# Title\n");
        assert_eq!(classify_category(&g), "document");
    }

    #[test]
    fn md_with_shebang_line_still_document_not_script() {
        let g = one_file(
            "notes.md",
            None,
            "#!/usr/bin/env bash\necho fenced example\n",
        );
        assert_eq!(classify_category(&g), "document");
    }

    #[test]
    fn trimmed_filename_md() {
        let g = one_file("  NOTES.MD  ", None, "# x\n");
        assert_eq!(classify_category(&g), "document");
    }

    #[test]
    fn multi_two_md_document() {
        let g = two_files(
            GistFile {
                filename: "a.md".into(),
                language: None,
                content: "# A".into(),
                size: 3,
                raw_url: None,
            },
            GistFile {
                filename: "b.md".into(),
                language: None,
                content: "# B".into(),
                size: 3,
                raw_url: None,
            },
        );
        assert_eq!(classify_category(&g), "document");
    }

    #[test]
    fn multi_md_and_rs_document_wins_plurality() {
        let g = two_files(
            GistFile {
                filename: "a.md".into(),
                language: None,
                content: "# A".into(),
                size: 3,
                raw_url: None,
            },
            GistFile {
                filename: "b.rs".into(),
                language: Some("Rust".into()),
                content: "fn main() {}".into(),
                size: 12,
                raw_url: None,
            },
        );
        assert_eq!(classify_category(&g), "document");
    }

    #[test]
    fn lang_group_txt_no_api_language() {
        let g = one_file("notes.txt", None, "hello\n");
        assert_eq!(classify_lang_group(&g), "docs");
    }

    #[test]
    fn lang_group_rst_adoc() {
        assert_eq!(
            classify_lang_group(&one_file("guide.rst", None, "x\n")),
            "docs"
        );
        assert_eq!(
            classify_lang_group(&one_file("book.adoc", None, "= x\n")),
            "docs"
        );
    }

    #[test]
    fn lang_group_license_no_ext() {
        let g = one_file("LICENSE", None, "MIT\n");
        assert_eq!(classify_lang_group(&g), "docs");
    }

    #[test]
    fn dockerfile_no_ext_not_docs_lang() {
        let g = one_file("Dockerfile", None, "FROM alpine\n");
        assert_ne!(classify_lang_group(&g), "docs");
    }

    #[test]
    fn category_media_png() {
        let g = one_file("shot.png", None, "\0\0\0\0");
        assert_eq!(classify_category(&g), "media");
    }

    #[test]
    fn category_data_csv() {
        let g = one_file("rows.csv", None, "a,b\n");
        assert_eq!(classify_category(&g), "data");
    }

    #[test]
    fn text_api_language_maps_docs() {
        let g = one_file("foo.txt", Some("Text"), "x\n");
        assert_eq!(classify_lang_group(&g), "docs");
    }

    // ── Empty / edge cases ───────────────────────────────────────────────────

    #[test]
    fn empty_gist_category_and_lang_group() {
        let g = Gist {
            id: "0".into(),
            description: String::new(),
            public: false,
            html_url: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
            files: vec![],
            pending_push: false,
            category: "gist".into(),
            lang_group: "other".into(),
            pinned: false,
        };
        assert_eq!(classify(&g), ("gist", "other"));
    }

    #[test]
    fn empty_filename_falls_through() {
        let g = one_file("", None, "hello world\n");
        assert_eq!(classify_category(&g), "snippet");
    }

    // ── Category: multi / snippet / library / test ───────────────────────────

    fn n_files(specs: &[(&str, &str)]) -> Gist {
        let files = specs
            .iter()
            .map(|(name, content)| GistFile {
                filename: name.to_string(),
                language: None,
                content: content.to_string(),
                size: content.len() as i64,
                raw_url: None,
            })
            .collect();
        Gist {
            id: "m".into(),
            description: String::new(),
            public: false,
            html_url: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
            files,
            pending_push: false,
            category: "gist".into(),
            lang_group: "other".into(),
            pinned: false,
        }
    }

    #[test]
    fn multi_three_mixed_files() {
        let g = n_files(&[
            ("a.rs", "fn main() {}"),
            ("b.py", "print('hi')"),
            ("c.js", "console.log()"),
        ]);
        assert_eq!(classify_category(&g), "multi");
    }

    #[test]
    fn library_lib_rs() {
        // lib.rs is > 50 lines so it won't be snippet
        let body = "use std::io;\n".repeat(60);
        let g = one_file("lib.rs", Some("Rust"), &body);
        assert_eq!(classify_category(&g), "library");
    }

    #[test]
    fn library_index_ts() {
        let body = "export {};\n".repeat(60);
        let g = one_file("index.ts", Some("TypeScript"), &body);
        assert_eq!(classify_category(&g), "library");
    }

    #[test]
    fn test_signal_from_filename() {
        let body = "fn something() {}\n".repeat(60);
        let g = one_file("my_test.rs", Some("Rust"), &body);
        assert_eq!(classify_category(&g), "test");
    }

    #[test]
    fn test_signal_from_content() {
        let body = format!("{}#[test]\nfn it_works() {{}}\n", "fn f() {}\n".repeat(60));
        let g = one_file("check.rs", Some("Rust"), &body);
        assert_eq!(classify_category(&g), "test");
    }

    #[test]
    fn snippet_short_code() {
        let g = one_file("util.go", Some("Go"), "package main\n\nfunc main() {}\n");
        assert_eq!(classify_category(&g), "snippet");
    }

    #[test]
    fn long_single_file_falls_to_gist() {
        let body = "x\n".repeat(100);
        let g = one_file("stuff.rs", Some("Rust"), &body);
        assert_eq!(classify_category(&g), "gist");
    }

    // ── Category: config variants ────────────────────────────────────────────

    #[test]
    fn config_dotenv() {
        let g = one_file(".env.production", None, "KEY=val\n");
        assert_eq!(classify_category(&g), "config");
    }

    #[test]
    fn config_yaml() {
        let g = one_file("ci.yaml", None, "steps:\n  - run: echo\n");
        assert_eq!(classify_category(&g), "config");
    }

    #[test]
    fn config_dockerfile() {
        let g = one_file("Dockerfile", None, "FROM alpine\nRUN echo hi\n");
        assert_eq!(classify_category(&g), "config");
    }

    #[test]
    fn config_json() {
        let g = one_file("tsconfig.json", None, "{}\n");
        assert_eq!(classify_category(&g), "config");
    }

    // ── Category: script variants ────────────────────────────────────────────

    #[test]
    fn script_sh_extension() {
        let g = one_file("deploy.sh", None, "echo deploying\n");
        assert_eq!(classify_category(&g), "script");
    }

    #[test]
    fn script_short_python() {
        let g = one_file("hello.py", Some("Python"), "print('hi')\n");
        assert_eq!(classify_category(&g), "script");
    }

    #[test]
    fn long_python_not_script() {
        let body = "x = 1\n".repeat(100);
        let g = one_file("big.py", Some("Python"), &body);
        assert_ne!(classify_category(&g), "script");
    }

    // ── Lang group branches ──────────────────────────────────────────────────

    #[test]
    fn lang_group_web() {
        assert_eq!(classify_lang_group(&one_file("app.tsx", Some("TypeScript"), "x")), "web");
        assert_eq!(classify_lang_group(&one_file("index.html", Some("HTML"), "x")), "web");
    }

    #[test]
    fn lang_group_systems() {
        assert_eq!(classify_lang_group(&one_file("main.rs", Some("Rust"), "x")), "systems");
        assert_eq!(classify_lang_group(&one_file("main.go", Some("Go"), "x")), "systems");
    }

    #[test]
    fn lang_group_scripting() {
        assert_eq!(classify_lang_group(&one_file("run.py", Some("Python"), "x")), "scripting");
        assert_eq!(classify_lang_group(&one_file("gem.rb", Some("Ruby"), "x")), "scripting");
    }

    #[test]
    fn lang_group_data() {
        assert_eq!(classify_lang_group(&one_file("q.sql", Some("SQL"), "x")), "data");
        assert_eq!(classify_lang_group(&one_file("d.csv", None, "a,b")), "data");
    }

    #[test]
    fn lang_group_priority_web_over_systems() {
        let g = n_files(&[("app.tsx", "x"), ("lib.rs", "y")]);
        assert_eq!(classify_lang_group(&g), "web");
    }

    // ── Top-level classify() ─────────────────────────────────────────────────

    #[test]
    fn classify_returns_both() {
        let g = one_file("deploy.sh", Some("Shell"), "echo hi\n");
        let (cat, lg) = classify(&g);
        assert_eq!(cat, "script");
        assert_eq!(lg, "scripting");
    }
}
