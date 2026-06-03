//! Local, offline text embeddings via fastembed (ONNX `all-MiniLM-L6-v2`).
//!
//! This is the optional, privacy-preserving alternative to the remote
//! OpenAI-compatible embedding API in `embedding.rs`. When enabled, the model
//! (~90 MB) is downloaded once into a user-configurable directory, after which
//! all embedding generation runs fully offline on the CPU.
//!
//! The produced vectors are 384-dimensional. They are stored under the model
//! id [`LOCAL_MODEL_ID`] so that cosine similarity never mixes them with
//! remote-API vectors, which live in a different (and differently-sized) space.

use anyhow::{Context, Result};
use fastembed::{EmbeddingModel, TextEmbedding, TextInitOptions};
use once_cell::sync::OnceCell;
use std::path::PathBuf;
use std::sync::Mutex;

/// Stable identity used as the partition key in `gist_embeddings.model`.
pub const LOCAL_MODEL_ID: &str = "local:all-MiniLM-L6-v2";

/// Loading the model reads ONNX weights and spins up an ONNX Runtime session,
/// which is expensive — keep a single global instance behind a mutex and
/// initialise it lazily on first use. `TextEmbedding::embed` takes `&mut self`,
/// hence the `Mutex` rather than a plain `OnceCell<TextEmbedding>`.
static MODEL: OnceCell<Mutex<TextEmbedding>> = OnceCell::new();

fn init_model(cache_dir: &str) -> Result<TextEmbedding> {
    let dir = PathBuf::from(cache_dir);
    // Best-effort: create the directory so the first download has somewhere to go.
    let _ = std::fs::create_dir_all(&dir);
    let opts = TextInitOptions::new(EmbeddingModel::AllMiniLML6V2)
        .with_cache_dir(dir)
        .with_show_download_progress(false);
    TextEmbedding::try_new(opts).context("Failed to initialise local embedding model")
}

/// True once the model has been loaded into memory this session. Does not tell
/// you whether the files exist on disk — use [`is_downloaded`] for that.
pub fn is_loaded() -> bool {
    MODEL.get().is_some()
}

/// Heuristic check for whether the model files already exist under `cache_dir`,
/// so the UI can decide whether enabling local search needs a download first.
/// fastembed stores models in a `models--Qdrant--all-MiniLM-L6-v2-onnx`-style
/// subfolder; we just look for any non-empty subdirectory containing a
/// `model.onnx` (or `*.onnx`) file.
pub fn is_downloaded(cache_dir: &str) -> bool {
    let root = PathBuf::from(cache_dir);
    if !root.is_dir() {
        return false;
    }
    fn has_onnx(dir: &std::path::Path, depth: usize) -> bool {
        if depth > 4 {
            return false;
        }
        let Ok(entries) = std::fs::read_dir(dir) else { return false };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if has_onnx(&path, depth + 1) {
                    return true;
                }
            } else if path.extension().and_then(|e| e.to_str()) == Some("onnx") {
                return true;
            }
        }
        false
    }
    has_onnx(&root, 0)
}

/// Ensure the model is initialised (triggering a one-time download into
/// `cache_dir` if necessary). Returns once the model is ready to embed.
pub fn ensure_ready(cache_dir: &str) -> Result<()> {
    MODEL.get_or_try_init(|| init_model(cache_dir).map(Mutex::new))?;
    Ok(())
}

/// Embed a single document locally, downloading the model on first use.
pub fn embed_local(text: &str, cache_dir: &str) -> Result<Vec<f32>> {
    let cell = MODEL.get_or_try_init(|| init_model(cache_dir).map(Mutex::new))?;
    // Recover from poisoning rather than failing forever: a panic in a prior
    // embed call leaves the model usable, so `into_inner()` keeps the feature
    // alive instead of bricking all future local embeddings.
    let mut model = cell.lock().unwrap_or_else(|e| e.into_inner());
    let mut out = model.embed(vec![text], None)?;
    out.pop()
        .ok_or_else(|| anyhow::anyhow!("local embedding produced no output"))
}
