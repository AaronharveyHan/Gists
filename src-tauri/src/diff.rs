/// Pure-Rust text diff engine (no git CLI).
///
/// Uses the `similar` crate (Myers algorithm) to produce standard unified-diff
/// output.  The diff baseline comes from `files_remote_snapshot` in SQLite
/// (written on every GitHub pull), so results are stable even offline.
use anyhow::Result;
use similar::TextDiff;

// ── Per-file diff ─────────────────────────────────────────────────────────────

/// Produce a unified diff between `original` and `modified` for `filename`.
/// Returns an empty string when there are no differences.
/// Context radius is 3 lines (standard `diff -u` default).
pub fn unified_diff(original: &str, modified: &str, filename: &str) -> String {
    let diff = TextDiff::from_lines(original, modified);

    // Short-circuit: no changes at all.
    if diff.ratio() == 1.0 {
        return String::new();
    }

    diff.unified_diff()
        .context_radius(3)
        .header(
            &format!("a/{filename}"),
            &format!("b/{filename}"),
        )
        .to_string()
}

// ── Whole-gist diff ───────────────────────────────────────────────────────────

/// Compare `current_files` (the editor snapshot) against the last-synced remote
/// baseline stored in `files_remote_snapshot`.
///
/// Returns a concatenated unified diff string covering:
/// - modified files  (different content)
/// - new files       (present in current, absent in remote snapshot)
/// - deleted files   (absent in current, present in remote snapshot)
///
/// Returns an empty string when the working tree matches the remote baseline.
pub fn compute_gist_diff(
    gist_id: &str,
    current_files: &[(String, String)],
) -> Result<String> {
    let snapshot = crate::cache::get_remote_snapshot(gist_id)?;

    let mut parts: Vec<String> = Vec::new();

    // Modified + new files
    for (filename, content) in current_files {
        let baseline = snapshot.get(filename).map(|s| s.as_str()).unwrap_or("");
        let chunk = unified_diff(baseline, content, filename);
        if !chunk.is_empty() {
            parts.push(chunk);
        }
    }

    // Deleted files (in snapshot but no longer in current_files)
    let current_names: std::collections::HashSet<&str> =
        current_files.iter().map(|(n, _)| n.as_str()).collect();

    let mut deleted_names: Vec<&str> = snapshot
        .keys()
        .filter(|n| !current_names.contains(n.as_str()))
        .map(|n| n.as_str())
        .collect();
    deleted_names.sort_unstable(); // deterministic order

    for filename in deleted_names {
        let baseline = snapshot[filename].as_str();
        let chunk = unified_diff(baseline, "", filename);
        if !chunk.is_empty() {
            parts.push(chunk);
        }
    }

    Ok(parts.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_content_returns_empty() {
        let d = unified_diff("hello\n", "hello\n", "file.txt");
        assert!(d.is_empty());
    }

    #[test]
    fn both_empty_returns_empty() {
        let d = unified_diff("", "", "file.txt");
        assert!(d.is_empty());
    }

    #[test]
    fn new_file_from_empty() {
        let d = unified_diff("", "line1\nline2\n", "new.rs");
        assert!(d.contains("--- a/new.rs"));
        assert!(d.contains("+++ b/new.rs"));
        assert!(d.contains("+line1"));
        assert!(d.contains("+line2"));
    }

    #[test]
    fn deleted_file_to_empty() {
        let d = unified_diff("line1\nline2\n", "", "old.rs");
        assert!(d.contains("--- a/old.rs"));
        assert!(d.contains("+++ b/old.rs"));
        assert!(d.contains("-line1"));
        assert!(d.contains("-line2"));
    }

    #[test]
    fn single_line_change() {
        let d = unified_diff("old\n", "new\n", "f.txt");
        assert!(d.contains("-old"));
        assert!(d.contains("+new"));
    }

    #[test]
    fn context_lines_present() {
        let original = "a\nb\nc\nd\ne\nf\ng\nh\n";
        let modified = "a\nb\nc\nX\ne\nf\ng\nh\n";
        let d = unified_diff(original, modified, "ctx.txt");
        // Context radius 3: lines a,b,c should appear as context before -d/+X
        assert!(d.contains(" a\n"));
        assert!(d.contains(" b\n"));
        assert!(d.contains(" c\n"));
        assert!(d.contains("-d\n"));
        assert!(d.contains("+X\n"));
    }

    #[test]
    fn header_contains_filename() {
        let d = unified_diff("a\n", "b\n", "path/to/file.rs");
        assert!(d.contains("--- a/path/to/file.rs"));
        assert!(d.contains("+++ b/path/to/file.rs"));
    }

    #[test]
    fn multiline_addition_in_middle() {
        let original = "a\nb\nc\n";
        let modified = "a\nb\nNEW1\nNEW2\nc\n";
        let d = unified_diff(original, modified, "add.txt");
        assert!(d.contains("+NEW1"));
        assert!(d.contains("+NEW2"));
        assert!(!d.contains("-a"));
        assert!(!d.contains("-c"));
    }

    #[test]
    fn multiline_deletion() {
        let original = "a\nb\nc\nd\ne\n";
        let modified = "a\ne\n";
        let d = unified_diff(original, modified, "del.txt");
        assert!(d.contains("-b"));
        assert!(d.contains("-c"));
        assert!(d.contains("-d"));
    }
}
