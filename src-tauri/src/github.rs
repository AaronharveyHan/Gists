/// GitHub Gist API client.
/// Uses reqwest with rustls (no OpenSSL dep) for minimal binary size.
use anyhow::{bail, Result};
use futures::stream::{self, StreamExt};
use reqwest::{
    header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, USER_AGENT},
    Client, StatusCode,
};
use std::collections::HashMap;

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
        .build()?)
}

/// Extract the ETag value from a response (strips surrounding quotes).
fn extract_etag(resp: &reqwest::Response) -> Option<String> {
    resp.headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim_matches('"').to_string())
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
        let wait_secs = resp
            .headers()
            .get("X-RateLimit-Reset")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok())
            .and_then(|reset| {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .ok()?
                    .as_secs();
                reset.checked_sub(now).map(|d| d + 1)
            })
            .unwrap_or(60)
            .min(300); // cap at 5 minutes
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
    let client = build_client(token)?;
    let url = format!("{}/gists/{}", BASE_URL, gist_id);
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
    let client = build_client(token)?;
    let url = format!("{}/gists/{}/{}", BASE_URL, gist_id, sha);
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
    let client = build_client(token)?;
    let mut ids: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut page = 1u32;

    loop {
        let mut req = client
            .get(format!("{}/gists", BASE_URL))
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

    let pairs: Vec<(Gist, Option<String>)> = stream::iter(ids.into_iter().map(|id| {
        let tok = token_owned.clone();
        async move {
            let etag = crate::cache::get_remote_etag(&id).ok().flatten();
            match fetch_gist_conditional(&tok, &id, etag.as_deref()).await {
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
    let client = build_client(token)?;
    let url = format!("{}/gists/{}/commits", BASE_URL, gist_id);
    let resp = client.get(&url).send().await?.error_for_status()?;
    let raw: Vec<RawCommit> = resp.json().await?;
    let rows = raw
        .into_iter()
        .map(|c| {
            let sha = c.version;
            let short_sha = sha[..8.min(sha.len())].to_string();
            GistRevisionView {
                short_sha,
                sha,
                author_login: c.user.login,
                committed_at: c.committed_at,
                files_changed: 0,
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
        .post(&format!("{}/gists", BASE_URL))
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
    let client = build_client(token)?;
    let payload = UpdateGistPayload {
        description: description.to_string(),
        files,
    };
    let resp = client
        .patch(&format!("{}/gists/{}", BASE_URL, gist_id))
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
    let client = build_client(token)?;
    client
        .delete(&format!("{}/gists/{}", BASE_URL, gist_id))
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

/// Validate token by hitting /user endpoint.
pub async fn validate_token(token: &str) -> Result<String> {
    let client = build_client(token)?;
    let resp = client
        .get(&format!("{}/user", BASE_URL))
        .send()
        .await?
        .error_for_status()?;
    let json: serde_json::Value = resp.json().await?;
    Ok(json["login"].as_str().unwrap_or("").to_string())
}

/// Fetch login + avatar_url for the token owner in one API call.
pub async fn get_user_profile(token: &str) -> Result<(String, Option<String>)> {
    let client = build_client(token)?;
    let json: serde_json::Value = client
        .get(&format!("{}/user", BASE_URL))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let login = json["login"].as_str().unwrap_or("").to_string();
    let avatar = json["avatar_url"].as_str().map(|s| s.to_string());
    Ok((login, avatar))
}
