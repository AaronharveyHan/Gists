/// Structured query after parsing "tag:X lang:Y is:public keyword" syntax.
#[derive(Debug, Default)]
pub struct ParsedQuery {
    /// Free-text keywords — matched via FTS5 MATCH + BM25 ranking.
    pub keywords: Vec<String>,
    /// `tag:X` tokens — filter to gists tagged with this name (case-insensitive).
    pub tags: Vec<String>,
    /// `lang:Y` tokens — filter to gists that have a file in this language.
    pub langs: Vec<String>,
    /// `is:public` → `Some(true)`, `is:secret`/`is:private` → `Some(false)`.
    pub is_public: Option<bool>,
}

impl ParsedQuery {
    pub fn is_empty(&self) -> bool {
        self.keywords.is_empty()
            && self.tags.is_empty()
            && self.langs.is_empty()
            && self.is_public.is_none()
    }
}

/// Parse a search string into structured query components.
///
/// Tokens of the form `tag:X`, `lang:Y`, `is:public`, `is:secret` are
/// extracted; everything else becomes a free-text keyword.
///
/// # Examples
/// ```
/// use gists_client::search_parser::parse;
///
/// let q = parse("tag:rust lang:python is:public async");
/// assert_eq!(q.tags, ["rust"]);
/// assert_eq!(q.langs, ["python"]);
/// assert_eq!(q.is_public, Some(true));
/// assert_eq!(q.keywords, ["async"]);
/// ```
pub fn parse(input: &str) -> ParsedQuery {
    let mut pq = ParsedQuery::default();
    for token in input.split_whitespace() {
        let lower = token.to_lowercase();
        if let Some(rest) = lower.strip_prefix("tag:") {
            if !rest.is_empty() {
                pq.tags.push(rest.to_string());
            }
        } else if let Some(rest) = lower.strip_prefix("lang:") {
            if !rest.is_empty() {
                pq.langs.push(rest.to_string());
            }
        } else if lower == "is:public" {
            pq.is_public = Some(true);
        } else if lower == "is:secret" || lower == "is:private" {
            pq.is_public = Some(false);
        } else {
            pq.keywords.push(token.to_string());
        }
    }
    pq
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input() {
        let pq = parse("");
        assert!(pq.is_empty());
    }

    #[test]
    fn whitespace_only() {
        let pq = parse("   \t  ");
        assert!(pq.is_empty());
    }

    #[test]
    fn plain_keywords() {
        let pq = parse("async rust");
        assert_eq!(pq.keywords, vec!["async", "rust"]);
        assert!(pq.tags.is_empty());
        assert!(pq.langs.is_empty());
        assert_eq!(pq.is_public, None);
    }

    #[test]
    fn single_tag() {
        let pq = parse("tag:work");
        assert_eq!(pq.tags, vec!["work"]);
        assert!(pq.keywords.is_empty());
    }

    #[test]
    fn single_lang() {
        let pq = parse("lang:python");
        assert_eq!(pq.langs, vec!["python"]);
    }

    #[test]
    fn is_public() {
        let pq = parse("is:public");
        assert_eq!(pq.is_public, Some(true));
    }

    #[test]
    fn is_secret() {
        let pq = parse("is:secret");
        assert_eq!(pq.is_public, Some(false));
    }

    #[test]
    fn is_private_alias() {
        let pq = parse("is:private");
        assert_eq!(pq.is_public, Some(false));
    }

    #[test]
    fn combined_query() {
        let pq = parse("tag:notes lang:markdown is:secret draft");
        assert_eq!(pq.tags, vec!["notes"]);
        assert_eq!(pq.langs, vec!["markdown"]);
        assert_eq!(pq.is_public, Some(false));
        assert_eq!(pq.keywords, vec!["draft"]);
    }

    #[test]
    fn multiple_tags_and_langs() {
        let pq = parse("tag:a tag:b lang:rust lang:go");
        assert_eq!(pq.tags, vec!["a", "b"]);
        assert_eq!(pq.langs, vec!["rust", "go"]);
    }

    #[test]
    fn case_insensitive_prefixes() {
        let pq = parse("TAG:Work LANG:Python IS:PUBLIC");
        assert_eq!(pq.tags, vec!["work"]);
        assert_eq!(pq.langs, vec!["python"]);
        assert_eq!(pq.is_public, Some(true));
    }

    #[test]
    fn empty_tag_value_ignored() {
        let pq = parse("tag: lang:");
        assert!(pq.tags.is_empty());
        assert!(pq.langs.is_empty());
        assert!(pq.keywords.is_empty());
    }

    #[test]
    fn keywords_preserve_original_case() {
        let pq = parse("FooBar");
        assert_eq!(pq.keywords, vec!["FooBar"]);
    }

    #[test]
    fn is_empty_only_with_defaults() {
        let pq = ParsedQuery::default();
        assert!(pq.is_empty());

        let pq2 = parse("tag:x");
        assert!(!pq2.is_empty());
    }

    #[test]
    fn unknown_is_value_becomes_keyword() {
        let pq = parse("is:archived");
        assert_eq!(pq.keywords, vec!["is:archived"]);
        assert_eq!(pq.is_public, None);
    }

    #[test]
    fn last_is_wins() {
        let pq = parse("is:public is:secret");
        assert_eq!(pq.is_public, Some(false));
    }
}
