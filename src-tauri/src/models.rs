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
