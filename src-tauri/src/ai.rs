use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: &'a [AiMessage],
    stream: bool,
}

/// Parse one OpenAI-compatible SSE `data:` payload and return the text delta,
/// if any. Returns `None` for unparseable JSON or an empty/absent content field
/// so the caller can simply skip it. The `[DONE]` sentinel is handled upstream.
fn extract_sse_delta(data: &str) -> Option<String> {
    let json: serde_json::Value = serde_json::from_str(data).ok()?;
    let content = json["choices"][0]["delta"]["content"].as_str()?;
    if content.is_empty() {
        None
    } else {
        Some(content.to_string())
    }
}

/// Stream a chat completion to the frontend via Tauri window events.
/// Emits `ai-chunk-{stream_id}` for each text delta,
/// then `ai-done-{stream_id}` when complete (or on error).
pub async fn stream_chat(
    window: &tauri::Window,
    stream_id: &str,
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[AiMessage],
) -> anyhow::Result<()> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()?;

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&ChatRequest {
            model,
            messages,
            stream: true,
        })
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("API error {}: {}", status, body);
    }

    let mut byte_stream = resp.bytes_stream();
    let mut buf = String::new();

    'outer: while let Some(item) = byte_stream.next().await {
        let bytes = item?;
        buf.push_str(&String::from_utf8_lossy(&*bytes));

        loop {
            match buf.find('\n') {
                None => break,
                Some(pos) => {
                    let line = buf[..pos].trim_end_matches('\r').to_owned();
                    buf = buf[pos + 1..].to_owned();

                    if let Some(data) = line.strip_prefix("data: ") {
                        let data = data.trim();
                        if data == "[DONE]" {
                            break 'outer;
                        }
                        if let Some(content) = extract_sse_delta(data) {
                            let _ = window
                                .emit(&format!("ai-chunk-{}", stream_id), content);
                        }
                    }
                }
            }
        }
    }

    let _ = window.emit(&format!("ai-done-{}", stream_id), ());
    Ok(())
}

/// One-shot (non-streaming) chat completion — used for batch jobs like the
/// library organizer where per-item streaming would be wasteful. Returns the
/// assistant message content.
pub async fn complete(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[AiMessage],
) -> anyhow::Result<String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()?;

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&ChatRequest { model, messages, stream: false })
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("API error {}: {}", status, body);
    }

    let json: serde_json::Value = resp.json().await?;
    Ok(json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or_default()
        .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_content_delta() {
        let data = r#"{"choices":[{"delta":{"content":"Hello"}}]}"#;
        assert_eq!(extract_sse_delta(data).as_deref(), Some("Hello"));
    }

    #[test]
    fn skips_empty_delta() {
        let data = r#"{"choices":[{"delta":{"content":""}}]}"#;
        assert_eq!(extract_sse_delta(data), None);
    }

    #[test]
    fn skips_delta_without_content() {
        // Role-only opening chunk has no content field.
        let data = r#"{"choices":[{"delta":{"role":"assistant"}}]}"#;
        assert_eq!(extract_sse_delta(data), None);
    }

    #[test]
    fn skips_unparseable_json() {
        assert_eq!(extract_sse_delta("not json"), None);
        assert_eq!(extract_sse_delta(""), None);
    }
}
