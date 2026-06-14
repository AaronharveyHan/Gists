/// GitHub Gist API client.
/// Uses reqwest with rustls (no OpenSSL dep) for minimal binary size.
use anyhow::{bail, Result};
use futures::stream::{self, StreamExt};
use reqwest::{
    header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, USER_AGENT},
    Client, StatusCode,
};
use std::collections::HashMap;
use std::time::Duration;

use crate::models::*;

const BASE_URL: &str = "https://api.github.com";
const PER_PAGE: u32 = 100;

fn build_client(token: &str) -> Result<Client> {
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", token))?,
    );
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/vnd.github+json"),
    );
    headers.insert(USER_AGENT, HeaderValue::from_static("gists-client/0.1"));
    headers.insert(
        "X-GitHub-Api-Version",
        HeaderValue::from_static("2022-11-28"),
    );

    Ok(Client::builder()
        .use_rustls_tls()
        .default_headers(headers)
        .timeout(Duration::from_secs(30))
        .build()?)
}

/// Strip the surrounding quotes GitHub wraps ETag values in.
fn strip_etag_quotes(raw: &str) -> String {
    raw.trim_matches('"').to_string()
}

/// Extract the ETag value from a response (strips surrounding quotes).
fn extract_etag(resp: &reqwest::Response) -> Option<String> {
    resp.headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .map(strip_etag_quotes)
}

/// First 8 characters of a commit SHA (or the whole SHA if shorter).
fn short_sha(sha: &str) -> String {
    sha[..8.min(sha.len())].to_string()
}

/// How long to sleep when the rate limit is exhausted, given the
/// `X-RateLimit-Reset` epoch second (if any) and the current epoch second.
/// Falls back to 60s when reset is missing or already in the past, and is
/// capped at 5 minutes so a bogus reset value can't stall the app.
fn backoff_wait_secs(reset: Option<u64>, now: u64) -> u64 {
    reset
        .and_then(|reset| reset.checked_sub(now).map(|d| d + 1))
        .unwrap_or(60)
        .min(300)
}

// ── Rate limit helpers ────────────────────────────────────────────────────────

/// Read `X-RateLimit-Remaining` from a response.
fn rate_limit_remaining(resp: &reqwest::Response) -> Option<u32> {
    resp.headers()
        .get("X-RateLimit-Remaining")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
}

/// If the rate limit is exhausted, sleep until `X-RateLimit-Reset` (capped at
/// 5 min). If the limit is merely low (< 10 remaining), emit a warning.
async fn backoff_if_rate_limited(resp: &reqwest::Response) {
    let remaining = match rate_limit_remaining(resp) {
        Some(r) => r,
        None => return,
    };

    if remaining == 0 {
        let reset = resp
            .headers()
            .get("X-RateLimit-Reset")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok());
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let wait_secs = backoff_wait_secs(reset, now);
        eprintln!("[gists-client] GitHub rate limit exhausted — waiting {wait_secs}s");
        tokio::time::sleep(tokio::time::Duration::from_secs(wait_secs)).await;
    } else if remaining < 10 {
        eprintln!("[gists-client] GitHub rate limit low: {remaining} requests remaining");
    }
}

// ── Conditional GET result ─────────────────────────────────────────────────────

pub enum FetchGistOutcome {
    /// Server returned 200: new content + optional ETag.
    Modified { gist: Gist, etag: Option<String> },
    /// Server returned 304: local cache is still current.
    NotModified,
}

// ── Single-gist fetches ───────────────────────────────────────────────────────

/// Conditional fetch using `If-None-Match`.
/// Returns `NotModified` on 304, `Modified` on 200.
pub async fn fetch_gist_conditional(
    token: &str,
    gist_id: &str,
    etag: Option<&str>,
) -> Result<FetchGistOutcome> {
    fetch_gist_conditional_at(BASE_URL, token, gist_id, etag).await
}

/// Implementation with an injectable API base so tests can target a mock server.
pub(crate) async fn fetch_gist_conditional_at(
    base: &str,
    token: &str,
    gist_id: &str,
    etag: Option<&str>,
) -> Result<FetchGistOutcome> {
    let client = build_client(token)?;
    let url = format!("{}/gists/{}", base, gist_id);
    let mut req = client.get(&url);
    if let Some(e) = etag {
        req = req.header("If-None-Match", format!("\"{}\"", e));
    }
    let resp = req.send().await?;
    if resp.status() == StatusCode::NOT_MODIFIED {
        return Ok(FetchGistOutcome::NotModified);
    }
    let resp = resp.error_for_status()?;
    let new_etag = extract_etag(&resp);
    backoff_if_rate_limited(&resp).await;
    let g: GitHubGist = resp.json().await?;
    Ok(FetchGistOutcome::Modified { gist: g.into(), etag: new_etag })
}

/// Fetch a gist at a specific commit SHA (`GET /gists/:id/:sha`).
pub async fn fetch_gist_at_sha(token: &str, gist_id: &str, sha: &str) -> Result<Gist> {
    fetch_gist_at_sha_at(BASE_URL, token, gist_id, sha).await
}

pub(crate) async fn fetch_gist_at_sha_at(
    base: &str,
    token: &str,
    gist_id: &str,
    sha: &str,
) -> Result<Gist> {
    let client = build_client(token)?;
    let url = format!("{}/gists/{}/{}", base, gist_id, sha);
    let resp = client.get(&url).send().await?.error_for_status()?;
    let g: GitHubGist = resp.json().await?;
    Ok(g.into())
}

// ── Sync ──────────────────────────────────────────────────────────────────────

/// Paginate the gist list, then do a conditional GET for each gist.
/// Returns only gists whose individual `GET /gists/:id` returned 200
/// (304 entries are omitted — local cache is still valid for them).
///
/// `since`: ISO 8601 timestamp — only gists modified after this are fetched
/// from the list. Pass `None` for a full sync.
pub async fn fetch_gists_sync_pairs(
    token: &str,
    since: Option<&str>,
) -> Result<Vec<(Gist, Option<String>)>> {
    fetch_gists_sync_pairs_at(BASE_URL, token, since).await
}

pub(crate) async fn fetch_gists_sync_pairs_at(
    base: &str,
    token: &str,
    since: Option<&str>,
) -> Result<Vec<(Gist, Option<String>)>> {
    let client = build_client(token)?;
    let mut ids: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut page = 1u32;

    loop {
        let mut req = client
            .get(format!("{}/gists", base))
            .query(&[("per_page", PER_PAGE.to_string()), ("page", page.to_string())]);
        if let Some(s) = since {
            req = req.query(&[("since", s)]);
        }
        let resp = req.send().await?;
        if resp.status() == StatusCode::UNAUTHORIZED {
            bail!("Invalid GitHub token");
        }
        resp.error_for_status_ref()?;
        backoff_if_rate_limited(&resp).await;
        let batch: Vec<GitHubGist> = resp.json().await?;
        let is_last = batch.len() < PER_PAGE as usize;
        for g in &batch {
            if seen.insert(g.id.clone()) {
                ids.push(g.id.clone());
            }
        }
        if is_last {
            break;
        }
        page += 1;
    }

    const CONCURRENCY: usize = 10;
    let token_owned = token.to_string();
    let base_owned = base.to_string();

    let pairs: Vec<(Gist, Option<String>)> = stream::iter(ids.into_iter().map(|id| {
        let tok = token_owned.clone();
        let base = base_owned.clone();
        async move {
            let etag = crate::cache::get_remote_etag(&id).ok().flatten();
            match fetch_gist_conditional_at(&base, &tok, &id, etag.as_deref()).await {
                Ok(FetchGistOutcome::Modified { gist, etag: new_etag }) => {
                    Some((gist, new_etag))
                }
                Ok(FetchGistOutcome::NotModified) => None,
                Err(e) => {
                    eprintln!("[gists-client] skipping gist {id}: fetch failed: {e:#}");
                    None
                }
            }
        }
    }))
    .buffer_unordered(CONCURRENCY)
    .filter_map(|opt| async { opt })
    .collect()
    .await;

    Ok(pairs)
}

// ── Commits ───────────────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct CommitUser {
    login: String,
}

#[derive(serde::Deserialize)]
struct CommitChangeStatus {
    additions: Option<u32>,
    deletions: Option<u32>,
    total: Option<u32>,
}

#[derive(serde::Deserialize)]
struct RawCommit {
    version: String,
    user: CommitUser,
    committed_at: String,
    change_status: Option<CommitChangeStatus>,
}

/// Fetch the commit history of a gist from the GitHub API.
/// Returns ready-to-serialize `GistRevisionView` rows.
pub async fn fetch_gist_commits(
    token: &str,
    gist_id: &str,
) -> Result<Vec<GistRevisionView>> {
    fetch_gist_commits_at(BASE_URL, token, gist_id).await
}

pub(crate) async fn fetch_gist_commits_at(
    base: &str,
    token: &str,
    gist_id: &str,
) -> Result<Vec<GistRevisionView>> {
    let client = build_client(token)?;
    let url = format!("{}/gists/{}/commits", base, gist_id);
    let resp = client.get(&url).send().await?.error_for_status()?;
    let raw: Vec<RawCommit> = resp.json().await?;
    let rows = raw
        .into_iter()
        .map(|c| {
            let sha = c.version;
            let short_sha = short_sha(&sha);
            GistRevisionView {
                short_sha,
                sha,
                author_login: c.user.login,
                committed_at: c.committed_at,
                files_changed: c.change_status.as_ref().and_then(|s| s.total).unwrap_or(0),
                additions: c.change_status.as_ref().and_then(|s| s.additions).unwrap_or(0),
                deletions: c.change_status.as_ref().and_then(|s| s.deletions).unwrap_or(0),
            }
        })
        .collect();
    Ok(rows)
}

// ── Create / Update / Delete ──────────────────────────────────────────────────

/// Create a new gist. Returns `(Gist, Option<ETag>)`.
pub async fn create_gist(
    token: &str,
    description: &str,
    public: bool,
    files: Vec<(String, String)>,
) -> Result<(Gist, Option<String>)> {
    create_gist_at(BASE_URL, token, description, public, files).await
}

pub(crate) async fn create_gist_at(
    base: &str,
    token: &str,
    description: &str,
    public: bool,
    files: Vec<(String, String)>,
) -> Result<(Gist, Option<String>)> {
    let client = build_client(token)?;
    let payload = CreateGistPayload {
        description: description.to_string(),
        public,
        files: files
            .into_iter()
            .map(|(name, content)| (name, CreateGistFile { content }))
            .collect(),
    };
    let resp = client
        .post(&format!("{}/gists", base))
        .json(&payload)
        .send()
        .await?
        .error_for_status()?;
    let etag = extract_etag(&resp);
    let g: GitHubGist = resp.json().await?;
    Ok((g.into(), etag))
}

/// Update description and/or files of an existing gist. Returns `(Gist, Option<ETag>)`.
pub async fn update_gist(
    token: &str,
    gist_id: &str,
    description: &str,
    files: HashMap<String, Option<UpdateGistFile>>,
) -> Result<(Gist, Option<String>)> {
    update_gist_at(BASE_URL, token, gist_id, description, files).await
}

pub(crate) async fn update_gist_at(
    base: &str,
    token: &str,
    gist_id: &str,
    description: &str,
    files: HashMap<String, Option<UpdateGistFile>>,
) -> Result<(Gist, Option<String>)> {
    let client = build_client(token)?;
    let payload = UpdateGistPayload {
        description: description.to_string(),
        files,
    };
    let resp = client
        .patch(&format!("{}/gists/{}", base, gist_id))
        .json(&payload)
        .send()
        .await?
        .error_for_status()?;
    let etag = extract_etag(&resp);
    let g: GitHubGist = resp.json().await?;
    Ok((g.into(), etag))
}

/// Delete a gist (returns 204 No Content on success).
pub async fn delete_gist(token: &str, gist_id: &str) -> Result<()> {
    delete_gist_at(BASE_URL, token, gist_id).await
}

pub(crate) async fn delete_gist_at(base: &str, token: &str, gist_id: &str) -> Result<()> {
    let client = build_client(token)?;
    client
        .delete(&format!("{}/gists/{}", base, gist_id))
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

/// Validate token by hitting /user endpoint.
pub async fn validate_token(token: &str) -> Result<String> {
    validate_token_at(BASE_URL, token).await
}

pub(crate) async fn validate_token_at(base: &str, token: &str) -> Result<String> {
    let client = build_client(token)?;
    let resp = client
        .get(&format!("{}/user", base))
        .send()
        .await?
        .error_for_status()?;
    let json: serde_json::Value = resp.json().await?;
    Ok(json["login"].as_str().unwrap_or("").to_string())
}

/// Fetch login + avatar_url for the token owner in one API call.
pub async fn get_user_profile(token: &str) -> Result<(String, Option<String>)> {
    get_user_profile_at(BASE_URL, token).await
}

pub(crate) async fn get_user_profile_at(base: &str, token: &str) -> Result<(String, Option<String>)> {
    let client = build_client(token)?;
    let json: serde_json::Value = client
        .get(&format!("{}/user", base))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let login = json["login"].as_str().unwrap_or("").to_string();
    let avatar = json["avatar_url"].as_str().map(|s| s.to_string());
    Ok((login, avatar))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_etag_quotes_unwraps_value() {
        assert_eq!(strip_etag_quotes("\"abc123\""), "abc123");
        assert_eq!(strip_etag_quotes("noquotes"), "noquotes");
    }

    #[test]
    fn short_sha_truncates_to_eight() {
        assert_eq!(short_sha("0123456789abcdef"), "01234567");
    }

    #[test]
    fn short_sha_handles_short_input() {
        assert_eq!(short_sha("abc"), "abc");
        assert_eq!(short_sha(""), "");
    }

    #[test]
    fn backoff_uses_reset_plus_one_second() {
        // reset 40s in the future → wait 41s.
        assert_eq!(backoff_wait_secs(Some(140), 100), 41);
    }

    #[test]
    fn backoff_caps_at_five_minutes() {
        // A reset far in the future is clamped to 300s.
        assert_eq!(backoff_wait_secs(Some(1_000_000), 0), 300);
    }

    #[test]
    fn backoff_falls_back_when_missing_or_past() {
        assert_eq!(backoff_wait_secs(None, 100), 60);
        // reset already elapsed → checked_sub yields None → default 60.
        assert_eq!(backoff_wait_secs(Some(50), 100), 60);
    }

    #[test]
    fn github_gist_list_parses_pagination_batch() {
        // The sync loop deserializes each page as Vec<GitHubGist>; verify the
        // shape parses and that a short page (< PER_PAGE) signals the last page.
        let json = r#"[
            {"id":"1","public":true,"html_url":"u","created_at":"c","updated_at":"u","files":{}},
            {"id":"2","public":false,"html_url":"u","created_at":"c","updated_at":"u","files":{}}
        ]"#;
        let batch: Vec<GitHubGist> = serde_json::from_str(json).unwrap();
        assert_eq!(batch.len(), 2);
        assert!((batch.len() as u32) < PER_PAGE); // would terminate pagination
    }
}

/// HTTP-path tests against a local wiremock server, exercising the real
/// request building, header handling, and response parsing.
#[cfg(test)]
mod http_tests {
    use super::*;
    use wiremock::matchers::{body_string_contains, header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn gist_json(id: &str) -> String {
        format!(
            r#"{{"id":"{id}","description":"d","public":true,"html_url":"u","created_at":"c","updated_at":"u","files":{{}}}}"#
        )
    }

    fn json_response(status: u16, body: String) -> ResponseTemplate {
        ResponseTemplate::new(status).set_body_raw(body, "application/json")
    }

    #[tokio::test]
    async fn conditional_fetch_sends_if_none_match_and_honours_304() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/gists/g1"))
            .and(header("if-none-match", "\"tag1\""))
            .and(header("authorization", "Bearer tok"))
            .respond_with(ResponseTemplate::new(304))
            .expect(1)
            .mount(&server)
            .await;

        let out = fetch_gist_conditional_at(&server.uri(), "tok", "g1", Some("tag1"))
            .await
            .unwrap();
        assert!(matches!(out, FetchGistOutcome::NotModified));
    }

    #[tokio::test]
    async fn conditional_fetch_returns_gist_and_unquoted_etag_on_200() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/gists/g1"))
            .respond_with(json_response(200, gist_json("g1")).insert_header("etag", "\"fresh\""))
            .mount(&server)
            .await;

        match fetch_gist_conditional_at(&server.uri(), "tok", "g1", None).await.unwrap() {
            FetchGistOutcome::Modified { gist, etag } => {
                assert_eq!(gist.id, "g1");
                assert_eq!(etag.as_deref(), Some("fresh"));
            }
            FetchGistOutcome::NotModified => panic!("expected Modified"),
        }
    }

    #[tokio::test]
    async fn fetch_at_sha_hits_revision_url() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/gists/g1/abc123"))
            .respond_with(json_response(200, gist_json("g1")))
            .expect(1)
            .mount(&server)
            .await;

        let gist = fetch_gist_at_sha_at(&server.uri(), "tok", "g1", "abc123").await.unwrap();
        assert_eq!(gist.id, "g1");
    }

    #[tokio::test]
    async fn sync_pairs_returns_modified_and_skips_not_modified() {
        crate::db::ensure_test_db();
        let server = MockServer::start().await;
        // Page 1 lists two gists; a short page (< PER_PAGE) ends pagination.
        Mock::given(method("GET"))
            .and(path("/gists"))
            .and(query_param("page", "1"))
            .respond_with(json_response(
                200,
                format!("[{},{}]", gist_json("s1"), gist_json("s2")),
            ))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/gists/s1"))
            .respond_with(json_response(200, gist_json("s1")).insert_header("etag", "\"e-s1\""))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/gists/s2"))
            .respond_with(ResponseTemplate::new(304))
            .mount(&server)
            .await;

        let pairs = fetch_gists_sync_pairs_at(&server.uri(), "tok", None).await.unwrap();
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].0.id, "s1");
        assert_eq!(pairs[0].1.as_deref(), Some("e-s1"));
    }

    #[tokio::test]
    async fn sync_pairs_rejects_invalid_token() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/gists"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;

        let err = fetch_gists_sync_pairs_at(&server.uri(), "bad", None)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("Invalid GitHub token"));
    }

    #[tokio::test]
    async fn create_gist_posts_files_and_returns_etag() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/gists"))
            .and(body_string_contains("\"hello.py\""))
            .and(body_string_contains("print(1)"))
            .respond_with(json_response(201, gist_json("new1")).insert_header("etag", "\"created\""))
            .expect(1)
            .mount(&server)
            .await;

        let (gist, etag) = create_gist_at(
            &server.uri(),
            "tok",
            "desc",
            true,
            vec![("hello.py".to_string(), "print(1)".to_string())],
        )
        .await
        .unwrap();
        assert_eq!(gist.id, "new1");
        assert_eq!(etag.as_deref(), Some("created"));
    }

    #[tokio::test]
    async fn update_gist_patches_and_serializes_file_deletion_as_null() {
        let server = MockServer::start().await;
        Mock::given(method("PATCH"))
            .and(path("/gists/g1"))
            .and(body_string_contains("\"old.txt\":null"))
            .respond_with(json_response(200, gist_json("g1")))
            .expect(1)
            .mount(&server)
            .await;

        let mut files: HashMap<String, Option<UpdateGistFile>> = HashMap::new();
        files.insert("old.txt".to_string(), None); // None ⇒ delete on GitHub
        let (gist, _) = update_gist_at(&server.uri(), "tok", "g1", "new desc", files)
            .await
            .unwrap();
        assert_eq!(gist.id, "g1");
    }

    #[tokio::test]
    async fn delete_gist_accepts_204_and_surfaces_http_errors() {
        let server = MockServer::start().await;
        Mock::given(method("DELETE"))
            .and(path("/gists/ok"))
            .respond_with(ResponseTemplate::new(204))
            .mount(&server)
            .await;
        Mock::given(method("DELETE"))
            .and(path("/gists/missing"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        assert!(delete_gist_at(&server.uri(), "tok", "ok").await.is_ok());
        assert!(delete_gist_at(&server.uri(), "tok", "missing").await.is_err());
    }

    #[tokio::test]
    async fn validate_token_returns_login_and_fails_on_401() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/user"))
            .and(header("authorization", "Bearer good"))
            .respond_with(json_response(200, r#"{"login":"octocat"}"#.to_string()))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/user"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;

        assert_eq!(validate_token_at(&server.uri(), "good").await.unwrap(), "octocat");
        assert!(validate_token_at(&server.uri(), "bad").await.is_err());
    }

    #[tokio::test]
    async fn user_profile_parses_login_and_avatar() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/user"))
            .respond_with(json_response(
                200,
                r#"{"login":"me","avatar_url":"https://a.png"}"#.to_string(),
            ))
            .mount(&server)
            .await;

        let (login, avatar) = get_user_profile_at(&server.uri(), "tok").await.unwrap();
        assert_eq!(login, "me");
        assert_eq!(avatar.as_deref(), Some("https://a.png"));
    }

    #[tokio::test]
    async fn commits_parse_change_status_and_tolerate_its_absence() {
        let server = MockServer::start().await;
        let body = r#"[
            {"version":"0123456789abcdef","user":{"login":"alice"},
             "committed_at":"2024-01-01T00:00:00Z",
             "change_status":{"additions":3,"deletions":1,"total":4}},
            {"version":"ffff","user":{"login":"bob"},
             "committed_at":"2024-01-02T00:00:00Z","change_status":null}
        ]"#;
        Mock::given(method("GET"))
            .and(path("/gists/g1/commits"))
            .respond_with(json_response(200, body.to_string()))
            .mount(&server)
            .await;

        let rows = fetch_gist_commits_at(&server.uri(), "tok", "g1").await.unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].short_sha, "01234567");
        assert_eq!(rows[0].author_login, "alice");
        assert_eq!(rows[0].additions, 3);
        assert_eq!(rows[0].deletions, 1);
        assert_eq!(rows[0].files_changed, 4);
        // Missing change_status degrades to zeros instead of failing the parse.
        assert_eq!(rows[1].additions, 0);
        assert_eq!(rows[1].files_changed, 0);
    }
}
