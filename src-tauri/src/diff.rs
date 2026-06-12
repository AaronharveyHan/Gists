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

// ── File-set merge ────────────────────────────────────────────────────────────

/// Merge three file sets (base snapshot, local edits, remote state) file by
/// file. Semantics per file:
///   - present on both sides            → line-level `three_way_merge`
///   - new local file (absent in base)  → keep local, no conflict
///   - remote deleted, local edited     → keep local, flag conflict
///   - only in remote                   → take remote
///   - deleted on both sides            → omit
pub fn merge_file_sets(
    base: &std::collections::HashMap<String, String>,
    local: &std::collections::HashMap<String, String>,
    remote: &std::collections::HashMap<String, String>,
) -> crate::models::MergeOutcome {
    use crate::models::{MergeOutcome, MergedFile};

    // Union of all filenames across base, local, remote (sorted for stability).
    let mut all_names: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    all_names.extend(base.keys().cloned());
    all_names.extend(local.keys().cloned());
    all_names.extend(remote.keys().cloned());

    let mut files: Vec<MergedFile> = Vec::new();
    let mut any_conflict = false;

    for name in all_names {
        let b = base.get(&name).map(|s| s.as_str()).unwrap_or("");
        let l = local.get(&name).map(|s| s.as_str());
        let r = remote.get(&name).map(|s| s.as_str());

        let (content, had_conflict) = match (l, r) {
            (Some(lc), Some(rc)) => {
                let result = three_way_merge(b, lc, rc);
                (result.content, result.had_conflict)
            }
            // File only in local — keep it (new local file).
            (Some(lc), None) if b.is_empty() => (lc.to_string(), false),
            // Remote deleted, local still has it — keep local, flag conflict.
            (Some(lc), None) => (lc.to_string(), true),
            // Only in remote — take it.
            (None, Some(rc)) => (rc.to_string(), false),
            // Only in base (deleted by both) — omit.
            (None, None) => continue,
        };

        if had_conflict {
            any_conflict = true;
        }
        files.push(MergedFile { filename: name, content, had_conflict });
    }

    MergeOutcome { files, any_conflict }
}

// ── Revision diff assembly ────────────────────────────────────────────────────

/// Build the combined unified diff between one gist revision and its
/// predecessor. `prev_files` maps filename → content at the previous revision;
/// files missing there appear as additions, files only there as deletions.
/// Output chunks are sorted by filename (modified/new first, then deleted).
pub fn assemble_rev_diff(
    mut cur_files: Vec<crate::models::GistFile>,
    prev_files: &std::collections::HashMap<String, String>,
) -> String {
    let mut parts: Vec<String> = Vec::new();

    // Modified + new files (present in this revision).
    cur_files.sort_unstable_by(|a, b| a.filename.cmp(&b.filename));
    for f in &cur_files {
        let prev_content = prev_files.get(&f.filename).map(|s| s.as_str()).unwrap_or("");
        let chunk = unified_diff(prev_content, &f.content, &f.filename);
        if !chunk.is_empty() {
            parts.push(chunk);
        }
    }

    // Deleted files (in prev but absent in this revision).
    let cur_names: std::collections::HashSet<&str> =
        cur_files.iter().map(|f| f.filename.as_str()).collect();
    let mut deleted: Vec<(&String, &String)> = prev_files
        .iter()
        .filter(|(n, _)| !cur_names.contains(n.as_str()))
        .collect();
    deleted.sort_unstable_by_key(|(n, _)| n.as_str());
    for (filename, content) in deleted {
        let chunk = unified_diff(content, "", filename);
        if !chunk.is_empty() {
            parts.push(chunk);
        }
    }

    parts.join("\n")
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

    // ── merge_file_sets ──────────────────────────────────────────────────────

    fn file_map(entries: &[(&str, &str)]) -> std::collections::HashMap<String, String> {
        entries
            .iter()
            .map(|(n, c)| (n.to_string(), c.to_string()))
            .collect()
    }

    #[test]
    fn file_sets_merge_both_sides_via_three_way() {
        // Non-overlapping edits to the same file merge cleanly.
        let base = file_map(&[("a.txt", "1\n2\n3\n")]);
        let local = file_map(&[("a.txt", "L\n2\n3\n")]);
        let remote = file_map(&[("a.txt", "1\n2\nR\n")]);
        let out = merge_file_sets(&base, &local, &remote);
        assert!(!out.any_conflict);
        assert_eq!(out.files.len(), 1);
        assert_eq!(out.files[0].content, "L\n2\nR\n");
    }

    #[test]
    fn file_sets_new_local_file_kept_without_conflict() {
        let base = file_map(&[]);
        let local = file_map(&[("new.rs", "fn main() {}\n")]);
        let remote = file_map(&[]);
        let out = merge_file_sets(&base, &local, &remote);
        assert!(!out.any_conflict);
        assert_eq!(out.files[0].filename, "new.rs");
        assert!(!out.files[0].had_conflict);
    }

    #[test]
    fn file_sets_remote_deleted_local_edited_is_conflict() {
        // File existed in base, remote deleted it, local still has it.
        let base = file_map(&[("gone.txt", "old\n")]);
        let local = file_map(&[("gone.txt", "edited\n")]);
        let remote = file_map(&[]);
        let out = merge_file_sets(&base, &local, &remote);
        assert!(out.any_conflict);
        assert_eq!(out.files[0].content, "edited\n");
        assert!(out.files[0].had_conflict);
    }

    #[test]
    fn file_sets_remote_only_file_taken() {
        let base = file_map(&[]);
        let local = file_map(&[]);
        let remote = file_map(&[("r.md", "remote\n")]);
        let out = merge_file_sets(&base, &local, &remote);
        assert!(!out.any_conflict);
        assert_eq!(out.files[0].content, "remote\n");
    }

    #[test]
    fn file_sets_deleted_on_both_sides_omitted() {
        let base = file_map(&[("dead.txt", "x\n")]);
        let local = file_map(&[]);
        let remote = file_map(&[]);
        let out = merge_file_sets(&base, &local, &remote);
        assert!(!out.any_conflict);
        assert!(out.files.is_empty());
    }

    #[test]
    fn file_sets_output_sorted_by_filename() {
        let base = file_map(&[]);
        let local = file_map(&[("z.txt", "z\n"), ("a.txt", "a\n")]);
        let remote = file_map(&[("m.txt", "m\n")]);
        let out = merge_file_sets(&base, &local, &remote);
        let names: Vec<&str> = out.files.iter().map(|f| f.filename.as_str()).collect();
        assert_eq!(names, ["a.txt", "m.txt", "z.txt"]);
    }

    // ── assemble_rev_diff ────────────────────────────────────────────────────

    fn gist_file(name: &str, content: &str) -> crate::models::GistFile {
        crate::models::GistFile {
            filename: name.to_string(),
            language: None,
            content: content.to_string(),
            size: content.len() as i64,
            raw_url: None,
        }
    }

    #[test]
    fn rev_diff_modified_file_produces_chunk() {
        let cur = vec![gist_file("a.txt", "new\n")];
        let prev = file_map(&[("a.txt", "old\n")]);
        let out = assemble_rev_diff(cur, &prev);
        assert!(out.contains("-old"));
        assert!(out.contains("+new"));
    }

    #[test]
    fn rev_diff_initial_commit_shows_all_as_additions() {
        let cur = vec![gist_file("a.txt", "hello\n")];
        let out = assemble_rev_diff(cur, &std::collections::HashMap::new());
        assert!(out.contains("+hello"));
        assert!(!out.contains("-hello"));
    }

    #[test]
    fn rev_diff_deleted_file_shows_as_removal() {
        let cur: Vec<crate::models::GistFile> = vec![];
        let prev = file_map(&[("gone.txt", "bye\n")]);
        let out = assemble_rev_diff(cur, &prev);
        assert!(out.contains("-bye"));
    }

    #[test]
    fn rev_diff_unchanged_files_produce_empty_output() {
        let cur = vec![gist_file("same.txt", "x\n")];
        let prev = file_map(&[("same.txt", "x\n")]);
        assert_eq!(assemble_rev_diff(cur, &prev), "");
    }

    #[test]
    fn rev_diff_orders_modified_before_deleted() {
        let cur = vec![gist_file("z_mod.txt", "new\n")];
        let prev = file_map(&[("a_del.txt", "bye\n"), ("z_mod.txt", "old\n")]);
        let out = assemble_rev_diff(cur, &prev);
        let mod_pos = out.find("z_mod.txt").unwrap();
        let del_pos = out.find("a_del.txt").unwrap();
        assert!(mod_pos < del_pos, "modified chunk should come before deleted");
    }
}
