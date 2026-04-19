//! Local web grounding pipeline for providers without native search tools.
//!
//! The launcher runs a staged pipeline:
//! search -> fetch -> extract -> rerank -> compact grounding context.
//! This keeps local models away from raw HTML while preserving citations.

use crate::errors::AppError;
use reqwest::{Client, Url};
use scraper::{Html, Selector};

use super::types::WebSearchOptions;

const SEARCH_ENDPOINT: &str = "https://html.duckduckgo.com/html/";
const MAX_SEARCH_RESULTS: usize = 6;
const MAX_FETCH_RESULTS: usize = 4;
const MAX_CONTEXT_CHARS: usize = 6_000;
const MAX_DOCUMENT_CHARS: usize = 1_400;

#[derive(Debug, Clone, PartialEq, Eq)]
struct SearchResult {
    title: String,
    url: String,
    snippet: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FetchedPage {
    title: String,
    url: String,
    snippet: String,
    html: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ExtractedDocument {
    title: String,
    url: String,
    snippet: String,
    text: String,
}

/// Builds a compact grounding message for local models by searching the web,
/// fetching the top results, extracting readable text, reranking it, and
/// serializing the best chunks into a single system prompt.
pub async fn build_grounding_message(
    query: &str,
    options: &WebSearchOptions,
) -> Result<Option<String>, AppError> {
    let normalized_query = normalize_whitespace(query);
    if normalized_query.is_empty() || !should_ground_query(&normalized_query) {
        return Ok(None);
    }

    let client = build_http_client()?;
    let search_hits = search_results(&client, &normalized_query, options).await?;
    if search_hits.is_empty() {
        return Ok(None);
    }

    let fetched_pages = fetch_pages(&client, search_hits).await;
    if fetched_pages.is_empty() {
        return Ok(None);
    }

    let extracted_documents = extract_documents(fetched_pages)?;
    if extracted_documents.is_empty() {
        return Ok(None);
    }

    let ranked_documents = rerank_documents(&normalized_query, extracted_documents);
    Ok(render_grounding_context(ranked_documents))
}

fn build_http_client() -> Result<Client, AppError> {
    Client::builder()
        .user_agent("Axelate/0.1.5 (+https://github.com/F0RLE/Axelate)")
        .gzip(true)
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(AppError::from)
}

fn should_ground_query(query: &str) -> bool {
    let lowercase = query.to_lowercase();
    let markers = [
        "search",
        "web",
        "internet",
        "latest",
        "current",
        "today",
        "news",
        "recent",
        "lookup",
        "find online",
        "найди",
        "поищи",
        "посмотри",
        "в интернете",
        "в сети",
        "сегодня",
        "сейчас",
        "последн",
        "новост",
        "актуаль",
    ];

    markers.iter().any(|marker| lowercase.contains(marker))
        || query.contains("http://")
        || query.contains("https://")
}

async fn search_results(
    client: &Client,
    query: &str,
    options: &WebSearchOptions,
) -> Result<Vec<SearchResult>, AppError> {
    let mut search_url = Url::parse(SEARCH_ENDPOINT).map_err(|error| AppError::External {
        request_id: None,
        message: format!("Invalid search endpoint: {error}"),
    })?;
    search_url.query_pairs_mut().append_pair("q", query);

    let response = client.get(search_url).send().await?;
    let body = response.text().await?;
    let document = Html::parse_document(&body);
    let result_selector = parse_selector(".result")?;
    let title_selector = parse_selector(".result__title a, a.result__a")?;
    let snippet_selector = parse_selector(".result__snippet")?;

    let mut results = Vec::new();
    for result_node in document.select(&result_selector) {
        let Some(title_node) = result_node.select(&title_selector).next() else {
            continue;
        };

        let Some(raw_href) = title_node.value().attr("href") else {
            continue;
        };

        let Some(url) = normalize_result_url(raw_href) else {
            continue;
        };

        if !domain_allowed(&url, options) {
            continue;
        }

        let title = normalize_whitespace(&title_node.text().collect::<Vec<_>>().join(" "));
        let snippet = result_node
            .select(&snippet_selector)
            .next()
            .map(|node| normalize_whitespace(&node.text().collect::<Vec<_>>().join(" ")))
            .unwrap_or_default();

        if title.is_empty() {
            continue;
        }

        results.push(SearchResult {
            title,
            url,
            snippet,
        });

        if results.len() >= MAX_SEARCH_RESULTS {
            break;
        }
    }

    Ok(results)
}

async fn fetch_pages(client: &Client, results: Vec<SearchResult>) -> Vec<FetchedPage> {
    let mut pages = Vec::new();

    for result in results.into_iter().take(MAX_FETCH_RESULTS) {
        let Ok(response) = client.get(&result.url).send().await else {
            continue;
        };
        let Ok(html) = response.text().await else {
            continue;
        };

        pages.push(FetchedPage {
            title: result.title,
            url: result.url,
            snippet: result.snippet,
            html,
        });
    }

    pages
}

fn extract_documents(pages: Vec<FetchedPage>) -> Result<Vec<ExtractedDocument>, AppError> {
    pages
        .into_iter()
        .map(extract_document)
        .filter_map(Result::transpose)
        .collect()
}

fn extract_document(page: FetchedPage) -> Result<Option<ExtractedDocument>, AppError> {
    let document = Html::parse_document(&page.html);
    let selectors = ["main", "article", "section", "p", "li", "h1", "h2", "h3"];

    let mut chunks = Vec::new();
    for pattern in selectors {
        let selector = parse_selector(pattern)?;
        for node in document.select(&selector) {
            let text = normalize_whitespace(&node.text().collect::<Vec<_>>().join(" "));
            if text.len() < 40 || chunks.iter().any(|existing: &String| existing == &text) {
                continue;
            }

            chunks.push(text);
            if chunks.len() >= 6 {
                break;
            }
        }

        if chunks.len() >= 6 {
            break;
        }
    }

    let extracted_text = trim_to_boundary(&chunks.join(" "), MAX_DOCUMENT_CHARS);
    let final_text = if extracted_text.is_empty() {
        page.snippet.clone()
    } else {
        extracted_text
    };

    if final_text.is_empty() {
        return Ok(None);
    }

    Ok(Some(ExtractedDocument {
        title: page.title,
        url: page.url,
        snippet: page.snippet,
        text: final_text,
    }))
}

fn rerank_documents(query: &str, mut documents: Vec<ExtractedDocument>) -> Vec<ExtractedDocument> {
    let query_tokens = tokenize(query);
    documents.sort_by(|left, right| {
        let right_score = lexical_overlap_score(&query_tokens, right);
        let left_score = lexical_overlap_score(&query_tokens, left);
        right_score
            .cmp(&left_score)
            .then_with(|| left.title.len().cmp(&right.title.len()))
    });
    documents
}

fn lexical_overlap_score(query_tokens: &[String], document: &ExtractedDocument) -> usize {
    let haystack = format!(
        "{} {} {}",
        document.title.to_lowercase(),
        document.snippet.to_lowercase(),
        document.text.to_lowercase()
    );

    query_tokens
        .iter()
        .filter(|token| haystack.contains(token.as_str()))
        .count()
}

fn render_grounding_context(documents: Vec<ExtractedDocument>) -> Option<String> {
    let mut context = String::from(
        "Launcher web grounding. Use this context for up-to-date facts. Cite sources inline like [1], [2]. If the sources conflict, say so.\n\n",
    );

    for (index, document) in documents.into_iter().enumerate() {
        let block = format!(
            "[{number}] {title}\nURL: {url}\nExcerpt: {excerpt}\n\n",
            number = index + 1,
            title = document.title,
            url = document.url,
            excerpt = document.text
        );

        if context.len() + block.len() > MAX_CONTEXT_CHARS {
            break;
        }

        context.push_str(&block);
    }

    if context.trim_end().ends_with("facts.") {
        return None;
    }

    Some(context.trim().to_string())
}

fn parse_selector(pattern: &str) -> Result<Selector, AppError> {
    Selector::parse(pattern).map_err(|error| AppError::Internal {
        request_id: None,
        message: format!("Invalid HTML selector '{pattern}': {error}"),
    })
}

fn normalize_result_url(raw_href: &str) -> Option<String> {
    if raw_href.starts_with("http://") || raw_href.starts_with("https://") {
        return Some(raw_href.to_string());
    }

    let base = Url::parse("https://duckduckgo.com").ok()?;
    let url = base.join(raw_href).ok()?;
    let uddg = url
        .query_pairs()
        .find(|(key, _)| key == "uddg")
        .map(|(_, value)| value.into_owned());

    uddg.or_else(|| {
        if url.scheme().starts_with("http") {
            Some(url.to_string())
        } else {
            None
        }
    })
}

fn domain_allowed(url: &str, options: &WebSearchOptions) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };

    if options
        .excluded_domains
        .iter()
        .any(|domain| host_matches_domain(host, domain))
    {
        return false;
    }

    if options.allowed_domains.is_empty() {
        return true;
    }

    options
        .allowed_domains
        .iter()
        .any(|domain| host_matches_domain(host, domain))
}

fn host_matches_domain(host: &str, domain: &str) -> bool {
    let normalized_host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    let normalized_domain = domain.trim().trim_matches('.').to_ascii_lowercase();
    if normalized_host.is_empty() || normalized_domain.is_empty() {
        return false;
    }

    normalized_host == normalized_domain
        || normalized_host
            .strip_suffix(&normalized_domain)
            .is_some_and(|prefix| prefix.ends_with('.'))
}

fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|char: char| !char.is_alphanumeric())
        .filter(|token| token.len() >= 3)
        .map(ToOwned::to_owned)
        .collect()
}

fn normalize_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn trim_to_boundary(text: &str, max_chars: usize) -> String {
    if text.len() <= max_chars {
        return text.to_string();
    }

    let mut end = 0usize;
    for (idx, _) in text.char_indices() {
        if idx > max_chars {
            break;
        }
        end = idx;
    }

    let candidate = &text[..end];
    let cut = candidate
        .rfind(['.', '!', '?', ' '])
        .unwrap_or(candidate.len());
    candidate[..cut].trim().to_string()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::expect_used, clippy::indexing_slicing)]

    use super::{
        ExtractedDocument, domain_allowed, host_matches_domain, normalize_result_url,
        normalize_whitespace, rerank_documents, should_ground_query, tokenize, trim_to_boundary,
    };
    use crate::domain::ai::WebSearchOptions;

    #[test]
    fn grounding_heuristic_detects_recency_queries() {
        assert!(should_ground_query("найди свежие новости про llama.cpp"));
        assert!(should_ground_query("latest rust release today"));
        assert!(!should_ground_query("объясни что такое ownership в Rust"));
    }

    #[test]
    fn ddg_redirect_is_unwrapped_to_real_url() {
        let url = normalize_result_url(
            "/l/?uddg=https%3A%2F%2Fopenrouter.ai%2Fdocs%2Fguides%2Ffeatures%2Fserver-tools%2Fweb-search",
        )
        .expect("must parse");

        assert_eq!(
            url,
            "https://openrouter.ai/docs/guides/features/server-tools/web-search"
        );
    }

    #[test]
    fn domain_filters_apply_to_urls() {
        let options = WebSearchOptions {
            enabled: true,
            allowed_domains: vec!["openrouter.ai".to_string()],
            excluded_domains: vec!["reddit.com".to_string()],
            ..Default::default()
        };

        assert!(domain_allowed("https://openrouter.ai/docs", &options));
        assert!(domain_allowed(
            "https://docs.openrouter.ai/guides",
            &options
        ));
        assert!(!domain_allowed("https://evilopenrouter.ai/docs", &options));
        assert!(!domain_allowed("https://reddit.com/r/test", &options));
        assert!(!domain_allowed("https://example.com", &options));
    }

    #[test]
    fn domain_filters_require_domain_boundaries() {
        let options = WebSearchOptions {
            enabled: true,
            excluded_domains: vec!["reddit.com".to_string()],
            ..Default::default()
        };

        assert!(host_matches_domain("reddit.com", "reddit.com"));
        assert!(host_matches_domain("www.reddit.com", "reddit.com"));
        assert!(!host_matches_domain("notreddit.com", "reddit.com"));
        assert!(!host_matches_domain("evilopenrouter.ai", "openrouter.ai"));
        assert!(domain_allowed("https://notreddit.com/r/test", &options));
        assert!(!domain_allowed("https://www.reddit.com/r/test", &options));
    }

    #[test]
    fn whitespace_and_trim_helpers_keep_text_compact() {
        assert_eq!(normalize_whitespace("a   b\n c"), "a b c");
        assert_eq!(trim_to_boundary("One. Two. Three.", 8), "One.");
    }

    #[test]
    fn lexical_rerank_prefers_documents_with_more_query_overlap() {
        let query = "latest bitcoin etf news";
        let documents = vec![
            ExtractedDocument {
                title: "Random Rust release".to_string(),
                url: "https://example.com/rust".to_string(),
                snippet: String::new(),
                text: "Cargo and ownership".to_string(),
            },
            ExtractedDocument {
                title: "Bitcoin ETF latest updates".to_string(),
                url: "https://example.com/btc".to_string(),
                snippet: "news".to_string(),
                text: "Bitcoin ETF news today".to_string(),
            },
        ];

        let ranked = rerank_documents(query, documents);
        assert_eq!(ranked[0].url, "https://example.com/btc");
    }

    #[test]
    fn tokenizer_keeps_only_meaningful_terms() {
        let tokens = tokenize("What is the latest bitcoin ETF news today?");
        assert!(tokens.contains(&"latest".to_string()));
        assert!(tokens.contains(&"bitcoin".to_string()));
        assert!(!tokens.contains(&"is".to_string()));
    }
}
