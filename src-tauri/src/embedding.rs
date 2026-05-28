/// Embedding utilities: serialization, similarity, text prep, and API calls.
use anyhow::Result;
use serde::{Deserialize, Serialize};

// ── f32 serialization ─────────────────────────────────────────────────────────

pub fn vec_to_bytes(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|f| f.to_le_bytes()).collect()
}

pub fn bytes_to_vec(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

// ── Cosine similarity ─────────────────────────────────────────────────────────

pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    (dot / (norm_a * norm_b)).clamp(-1.0, 1.0)
}

// ── Text preparation ──────────────────────────────────────────────────────────

/// Build the text that gets embedded for a gist.
/// Max ~6000 chars: description + file listing + file bodies (truncated).
pub fn build_embed_text(description: &str, files: &[(String, String)]) -> String {
    const MAX_CHARS: usize = 6000;
    let mut out = String::new();
    if !description.is_empty() {
        out.push_str(description);
        out.push('\n');
    }
    let names: Vec<&str> = files.iter().map(|(n, _)| n.as_str()).collect();
    if !names.is_empty() {
        out.push_str("Files: ");
        out.push_str(&names.join(", "));
        out.push('\n');
    }
    for (name, content) in files {
        if out.len() >= MAX_CHARS {
            break;
        }
        out.push('\n');
        out.push_str(name);
        out.push_str(":\n");
        let remaining = MAX_CHARS.saturating_sub(out.len());
        if content.len() <= remaining {
            out.push_str(content);
        } else {
            out.push_str(&content[..remaining]);
            out.push_str("\n[truncated]");
        }
    }
    out
}

// ── Embedding API (OpenAI-compatible) ────────────────────────────────────────

#[derive(Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
}

#[derive(Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingData>,
}

#[derive(Serialize)]
struct EmbeddingRequest<'a> {
    model: &'a str,
    input: &'a str,
}

pub async fn generate_embedding(
    text: &str,
    base_url: &str,
    api_key: &str,
    model: &str,
) -> Result<Vec<f32>> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    let url = format!("{}/embeddings", base_url.trim_end_matches('/'));

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&EmbeddingRequest { model, input: text })
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("Embedding API {} {}: {}", url, status, body);
    }

    let parsed: EmbeddingResponse = resp.json().await?;
    parsed
        .data
        .into_iter()
        .next()
        .map(|d| d.embedding)
        .ok_or_else(|| anyhow::anyhow!("Empty embedding response"))
}
