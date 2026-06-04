use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Shared domain types ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GistFile {
    pub filename: String,
    pub language: Option<String>,
    pub content: String,
    pub size: i64,
    pub raw_url: Option<String>,
}

fn default_gist_category() -> String {
    "gist".into()
}

fn default_lang_group() -> String {
    "other".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Gist {
    pub id: String,
    pub description: String,
    pub public: bool,
    pub html_url: String,
    pub created_at: String,
    pub updated_at: String,
    pub files: Vec<GistFile>,
    /// Local edits saved to SQLite but not yet pushed to GitHub API.
    #[serde(default)]
    pub pending_push: bool,
    /// Auto or user-assigned bucket: config, script, document, multi, snippet, library, test, gist.
    #[serde(default = "default_gist_category")]
    pub category: String,
    /// Coarse language bucket: web, systems, scripting, data, docs, other.
    #[serde(default = "default_lang_group")]
    pub lang_group: String,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub local_only: bool,
}

/// One row for sidebar category counts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryCount {
    pub category: String,
    pub count: i64,
}

/// A user-defined tag that can be applied to gists.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub color: String,
}

/// A user-created collection (workspace) that holds a named set of gists.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub description: String,
    pub color: String,
    pub icon: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Collection with gist count — used by the sidebar list.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionCount {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon: String,
    pub count: i64,
}

/// Returned to the frontend after every sync call.
#[derive(Debug, Serialize)]
pub struct SyncResult {
    /// Number of gists fetched/updated in this sync pass.
    pub updated: usize,
    /// Total gists in local cache after sync.
    pub total: usize,
    /// true = only changed gists were fetched; false = full pull.
    pub incremental: bool,
}

// ── GitHub API response shapes ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct GitHubGistFile {
    pub filename: Option<String>,
    pub language: Option<String>,
    pub content: Option<String>,
    pub size: Option<i64>,
    pub raw_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GitHubGist {
    pub id: String,
    pub description: Option<String>,
    pub public: bool,
    pub html_url: String,
    pub created_at: String,
    pub updated_at: String,
    pub files: HashMap<String, GitHubGistFile>,
}

impl From<GitHubGist> for Gist {
    fn from(g: GitHubGist) -> Self {
        let files = g
            .files
            .into_values()
            .map(|f| GistFile {
                filename: f.filename.unwrap_or_default(),
                language: f.language,
                content: f.content.unwrap_or_default(),
                size: f.size.unwrap_or(0),
                raw_url: f.raw_url,
            })
            .collect();
        Self {
            id: g.id,
            description: g.description.unwrap_or_default(),
            public: g.public,
            html_url: g.html_url,
            created_at: g.created_at,
            updated_at: g.updated_at,
            files,
            pending_push: false,
            category: default_gist_category(),
            lang_group: default_lang_group(),
            pinned: false,
            local_only: false,
        }
    }
}

/// One gist revision for the revision timeline (GitHub API metadata only,
/// no git dependency).
#[derive(Debug, Clone, Serialize)]
pub struct GistRevisionView {
    pub sha: String,
    pub short_sha: String,
    pub author_login: String,
    pub committed_at: String,
    pub files_changed: u32,
    pub additions: u32,
    pub deletions: u32,
}

// ── Create / Update payloads ──────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct CreateGistPayload {
    pub description: String,
    pub public: bool,
    pub files: HashMap<String, CreateGistFile>,
}

#[derive(Debug, Serialize)]
pub struct CreateGistFile {
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct UpdateGistPayload {
    pub description: String,
    /// To rename: key = old name, value has "filename" set to new name.
    /// To delete: value is null (serde skip_serializing_if handles this).
    pub files: HashMap<String, Option<UpdateGistFile>>,
}

#[derive(Debug, Serialize)]
pub struct UpdateGistFile {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
}

/// One saved execution of a gist file.
#[derive(Debug, Clone, Serialize)]
pub struct RunRecord {
    pub id: i64,
    pub gist_id: String,
    pub filename: String,
    pub ran_at: String,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: i64,
    pub timed_out: bool,
    pub killed: bool,
    /// True if stdout/stderr was clipped at the 100 KB archive cap.
    pub truncated: bool,
}

/// One file in a three-way merge result.
#[derive(Debug, Serialize)]
pub struct MergedFile {
    pub filename: String,
    pub content: String,
    pub had_conflict: bool,
}

/// Result of merging all files in a gist conflict.
#[derive(Debug, Serialize)]
pub struct MergeOutcome {
    pub files: Vec<MergedFile>,
    pub any_conflict: bool,
}

/// A saved GitHub account (name + token stored separately in keychain).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: i64,
    pub name: String,
    pub login: Option<String>,
    pub avatar_url: Option<String>,
    pub token_key: String,
    pub is_active: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_gist_converts_to_domain_gist() {
        let json = r#"{
            "id": "abc123",
            "description": "a gist",
            "public": true,
            "html_url": "https://gist.github.com/abc123",
            "created_at": "2024-01-01T00:00:00Z",
            "updated_at": "2024-01-02T00:00:00Z",
            "files": {
                "main.py": {
                    "filename": "main.py",
                    "language": "Python",
                    "content": "print(1)",
                    "size": 8,
                    "raw_url": "https://example.com/main.py"
                }
            }
        }"#;
        let gh: GitHubGist = serde_json::from_str(json).unwrap();
        let g: Gist = gh.into();

        assert_eq!(g.id, "abc123");
        assert_eq!(g.description, "a gist");
        assert!(g.public);
        assert_eq!(g.files.len(), 1);
        assert_eq!(g.files[0].filename, "main.py");
        assert_eq!(g.files[0].language.as_deref(), Some("Python"));
        // Conversion defaults the local-only fields.
        assert!(!g.pending_push);
        assert!(!g.local_only);
        assert_eq!(g.category, "gist");
        assert_eq!(g.lang_group, "other");
    }

    #[test]
    fn github_gist_tolerates_missing_optional_fields() {
        // description/content/size/raw_url absent → safe defaults.
        let json = r#"{
            "id": "x",
            "public": false,
            "html_url": "u",
            "created_at": "c",
            "updated_at": "d",
            "files": { "f": { "filename": "f" } }
        }"#;
        let gh: GitHubGist = serde_json::from_str(json).unwrap();
        let g: Gist = gh.into();
        assert_eq!(g.description, "");
        assert_eq!(g.files[0].content, "");
        assert_eq!(g.files[0].size, 0);
        assert_eq!(g.files[0].raw_url, None);
    }

    #[test]
    fn gist_deserialize_applies_serde_defaults() {
        // A persisted Gist missing the newer fields should still deserialize.
        let json = r#"{
            "id": "g",
            "description": "",
            "public": false,
            "html_url": "",
            "created_at": "c",
            "updated_at": "u",
            "files": []
        }"#;
        let g: Gist = serde_json::from_str(json).unwrap();
        assert!(!g.pending_push);
        assert_eq!(g.category, "gist");
        assert_eq!(g.lang_group, "other");
        assert!(!g.pinned);
        assert!(!g.local_only);
    }

    #[test]
    fn update_gist_file_omits_none_filename() {
        // skip_serializing_if must drop `filename` when it is None (= no rename).
        let f = UpdateGistFile { content: "x".into(), filename: None };
        let json = serde_json::to_string(&f).unwrap();
        assert!(!json.contains("filename"));

        let f2 = UpdateGistFile { content: "x".into(), filename: Some("new.rs".into()) };
        assert!(serde_json::to_string(&f2).unwrap().contains("new.rs"));
    }
}
