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

// ── URL normalization ─────────────────────────────────────────────────────────

/// Normalize a user-configured embeddings base URL: trim trailing slashes and
/// strip a trailing "/embeddings" path segment so callers can safely append
/// "/embeddings" themselves. Guards against users who stored the full endpoint
/// (e.g. "https://api.example.com/v1/embeddings") instead of the base URL.
pub fn strip_embeddings_suffix(raw: &str) -> String {
    let trimmed = raw.trim_end_matches('/');
    if trimmed.ends_with("/embeddings") {
        trimmed[..trimmed.len() - "/embeddings".len()].to_string()
    } else {
        trimmed.to_string()
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vec_bytes_roundtrip() {
        let v = vec![0.0_f32, 1.5, -2.25, 3.125, f32::MIN, f32::MAX];
        let bytes = vec_to_bytes(&v);
        assert_eq!(bytes.len(), v.len() * 4);
        assert_eq!(bytes_to_vec(&bytes), v);
    }

    #[test]
    fn bytes_to_vec_ignores_trailing_partial_chunk() {
        // 6 bytes = one full f32 + 2 stray bytes; the remainder is dropped.
        let bytes = [0u8, 0, 128, 63, 1, 2]; // first 4 bytes == 1.0_f32
        assert_eq!(bytes_to_vec(&bytes), vec![1.0_f32]);
    }

    #[test]
    fn cosine_identical_is_one() {
        let a = vec![1.0, 2.0, 3.0];
        assert!((cosine_similarity(&a, &a) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn cosine_orthogonal_is_zero() {
        assert!(cosine_similarity(&[1.0, 0.0], &[0.0, 1.0]).abs() < 1e-6);
    }

    #[test]
    fn cosine_opposite_is_negative_one() {
        assert!((cosine_similarity(&[1.0, 0.0], &[-1.0, 0.0]) + 1.0).abs() < 1e-6);
    }

    #[test]
    fn cosine_zero_vector_is_zero() {
        // Guards the divide-by-zero branch.
        assert_eq!(cosine_similarity(&[0.0, 0.0], &[1.0, 2.0]), 0.0);
    }

    #[test]
    fn build_embed_text_includes_desc_and_files() {
        let files = vec![
            ("a.py".to_string(), "print(1)".to_string()),
            ("b.txt".to_string(), "hello".to_string()),
        ];
        let out = build_embed_text("my desc", &files);
        assert!(out.starts_with("my desc\n"));
        assert!(out.contains("Files: a.py, b.txt"));
        assert!(out.contains("print(1)"));
        assert!(out.contains("hello"));
    }

    #[test]
    fn build_embed_text_truncates_large_content() {
        let big = "x".repeat(10_000);
        let files = vec![("big.txt".to_string(), big)];
        let out = build_embed_text("", &files);
        // Hard cap is ~6000 chars plus the truncation marker.
        assert!(out.len() <= 6000 + "\n[truncated]".len());
        assert!(out.contains("[truncated]"));
    }

    #[test]
    fn build_embed_text_empty_inputs() {
        assert_eq!(build_embed_text("", &[]), "");
    }

    #[test]
    fn strip_embeddings_suffix_removes_endpoint_path() {
        assert_eq!(
            strip_embeddings_suffix("https://api.example.com/v1/embeddings"),
            "https://api.example.com/v1"
        );
        assert_eq!(
            strip_embeddings_suffix("https://api.example.com/v1/embeddings/"),
            "https://api.example.com/v1"
        );
    }

    #[test]
    fn strip_embeddings_suffix_trims_trailing_slashes_only() {
        assert_eq!(
            strip_embeddings_suffix("https://api.example.com/v1///"),
            "https://api.example.com/v1"
        );
    }

    #[test]
    fn strip_embeddings_suffix_leaves_clean_url_untouched() {
        assert_eq!(
            strip_embeddings_suffix("https://api.example.com/v1"),
            "https://api.example.com/v1"
        );
        assert_eq!(strip_embeddings_suffix(""), "");
    }

    #[test]
    fn strip_embeddings_suffix_does_not_match_partial_word() {
        // "myembeddings" is not the "/embeddings" path segment.
        assert_eq!(
            strip_embeddings_suffix("https://x.com/myembeddings"),
            "https://x.com/myembeddings"
        );
    }
}
