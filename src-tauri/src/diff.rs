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

// ── Three-way merge ───────────────────────────────────────────────────────────

pub struct MergeResult {
    pub content: String,
    pub had_conflict: bool,
}

/// Line-level three-way merge of `base` → `local` and `base` → `remote`.
///
/// Non-overlapping changes from either side are taken automatically.
/// Overlapping changes produce standard Git conflict markers:
///   <<<<<<< Local
///   ...local lines...
///   =======
///   ...remote lines...
///   >>>>>>> Remote
pub fn three_way_merge(base: &str, local: &str, remote: &str) -> MergeResult {
    // Fast-paths
    if local == remote {
        return MergeResult { content: local.to_string(), had_conflict: false };
    }
    if local == base {
        return MergeResult { content: remote.to_string(), had_conflict: false };
    }
    if remote == base {
        return MergeResult { content: local.to_string(), had_conflict: false };
    }

    let base_lines: Vec<&str> = base.lines().collect();
    let local_lines: Vec<&str> = local.lines().collect();
    let remote_lines: Vec<&str> = remote.lines().collect();

    // Compute changesets from base to each side.
    let local_ops = diff_ops(&base_lines, &local_lines);
    let remote_ops = diff_ops(&base_lines, &remote_lines);

    let mut output: Vec<String> = Vec::new();
    let mut had_conflict = false;

    // Walk base line-by-line using two cursors into the op slices.
    let mut li = 0usize; // index into local_ops
    let mut ri = 0usize; // index into remote_ops
    let mut base_pos = 0usize;

    while base_pos < base_lines.len() || li < local_ops.len() || ri < remote_ops.len() {
        // Peek at the next local and remote operations touching base_pos.
        let lop = local_ops.get(li);
        let rop = remote_ops.get(ri);

        match (lop, rop) {
            // Both ops start at the same base position — potential conflict.
            (Some(l), Some(r)) if l.old_start == base_pos && r.old_start == base_pos => {
                let l_new: Vec<&str> = local_lines[l.new_start..l.new_start + l.new_len].to_vec();
                let r_new: Vec<&str> = remote_lines[r.new_start..r.new_start + r.new_len].to_vec();
                if l_new == r_new {
                    // Both sides made the identical change — take it.
                    for line in &l_new {
                        output.push(line.to_string());
                    }
                } else {
                    had_conflict = true;
                    output.push("<<<<<<< Local".to_string());
                    for line in &l_new {
                        output.push(line.to_string());
                    }
                    output.push("=======".to_string());
                    for line in &r_new {
                        output.push(line.to_string());
                    }
                    output.push(">>>>>>> Remote".to_string());
                }
                base_pos += l.old_len;
                li += 1;
                ri += 1;
            }
            // Only local op at this base position.
            (Some(l), _) if l.old_start == base_pos => {
                let l_new = &local_lines[l.new_start..l.new_start + l.new_len];
                for line in l_new {
                    output.push(line.to_string());
                }
                base_pos += l.old_len;
                li += 1;
            }
            // Only remote op at this base position.
            (_, Some(r)) if r.old_start == base_pos => {
                let r_new = &remote_lines[r.new_start..r.new_start + r.new_len];
                for line in r_new {
                    output.push(line.to_string());
                }
                base_pos += r.old_len;
                ri += 1;
            }
            // No op touches this base line — emit it verbatim.
            _ => {
                if base_pos < base_lines.len() {
                    output.push(base_lines[base_pos].to_string());
                }
                base_pos += 1;
            }
        }
    }

    let mut content = output.join("\n");
    // Preserve trailing newline if either input had one.
    if local.ends_with('\n') || remote.ends_with('\n') {
        content.push('\n');
    }

    MergeResult { content, had_conflict }
}

/// A replaced hunk: `old_start..old_start+old_len` in base becomes
/// `new_start..new_start+new_len` in the modified text.
struct DiffOp {
    old_start: usize,
    old_len: usize,
    new_start: usize,
    new_len: usize,
}

/// Extract replacement hunks from a line diff (base → modified).
fn diff_ops(base: &[&str], modified: &[&str]) -> Vec<DiffOp> {
    use similar::TextDiff;

    let base_str = base.join("\n");
    let mod_str = modified.join("\n");
    let diff = TextDiff::from_lines(base_str.as_str(), mod_str.as_str());

    let mut ops: Vec<DiffOp> = Vec::new();

    for group in diff.grouped_ops(0) {
        for op in group {
            use similar::DiffOp::*;
            match op {
                Equal { .. } => {}
                Delete { old_index, old_len, new_index, .. } => {
                    ops.push(DiffOp {
                        old_start: old_index,
                        old_len,
                        new_start: new_index,
                        new_len: 0,
                    });
                }
                Insert { old_index, new_index, new_len } => {
                    ops.push(DiffOp {
                        old_start: old_index,
                        old_len: 0,
                        new_start: new_index,
                        new_len,
                    });
                }
                Replace { old_index, old_len, new_index, new_len } => {
                    ops.push(DiffOp {
                        old_start: old_index,
                        old_len,
                        new_start: new_index,
                        new_len,
                    });
                }
            }
        }
    }
    ops
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

    // ── three_way_merge tests ─────────────────────────────────────────────────

    #[test]
    fn merge_no_conflict_different_sections() {
        let base = "a\nb\nc\n";
        let local = "A\nb\nc\n";   // changed line 1
        let remote = "a\nb\nC\n";  // changed line 3
        let r = three_way_merge(base, local, remote);
        assert!(!r.had_conflict);
        assert_eq!(r.content, "A\nb\nC\n");
    }

    #[test]
    fn merge_conflict_same_line() {
        let base = "a\nb\nc\n";
        let local = "a\nLOCAL\nc\n";
        let remote = "a\nREMOTE\nc\n";
        let r = three_way_merge(base, local, remote);
        assert!(r.had_conflict);
        assert!(r.content.contains("<<<<<<< Local"));
        assert!(r.content.contains("LOCAL"));
        assert!(r.content.contains("======="));
        assert!(r.content.contains("REMOTE"));
        assert!(r.content.contains(">>>>>>> Remote"));
    }

    #[test]
    fn merge_both_sides_identical_change() {
        let base = "a\nb\n";
        let local = "a\nX\n";
        let remote = "a\nX\n";
        let r = three_way_merge(base, local, remote);
        assert!(!r.had_conflict);
        assert_eq!(r.content, "a\nX\n");
    }

    #[test]
    fn merge_local_unchanged() {
        let base = "a\nb\n";
        let local = "a\nb\n";
        let remote = "a\nR\n";
        let r = three_way_merge(base, local, remote);
        assert!(!r.had_conflict);
        assert_eq!(r.content, "a\nR\n");
    }

    #[test]
    fn merge_remote_unchanged() {
        let base = "a\nb\n";
        let local = "a\nL\n";
        let remote = "a\nb\n";
        let r = three_way_merge(base, local, remote);
        assert!(!r.had_conflict);
        assert_eq!(r.content, "a\nL\n");
    }
}
