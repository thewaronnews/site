-- Instrument registry (spec section 2.2). The 13 Crank #2 crawler patterns
-- that carry a User-Agent (the two robots.txt policy tokens, Google-Extended
-- and Applebot-Extended, send no User-Agent of their own and are not rows
-- here), with the IP lists Crank #2 verified on 2026-09-13, plus Meta,
-- Bytespider, Amazonbot, CCBot, DuckAssistBot and four feed readers.
-- ip_list_url is NULL wherever no vendor JSON list was verified.

INSERT OR IGNORE INTO bots (slug, name, vendor, kind, ua_pattern, ip_list_url, created_at) VALUES
  ('gptbot', 'GPTBot', 'OpenAI', 'crawler', 'GPTBot', 'https://openai.com/gptbot.json', '2026-09-22T00:00:00Z'),
  ('oai-searchbot', 'OAI-SearchBot', 'OpenAI', 'search_bot', 'OAI-SearchBot', 'https://openai.com/searchbot.json', '2026-09-22T00:00:00Z'),
  ('chatgpt-user', 'ChatGPT-User', 'OpenAI', 'fetcher', 'ChatGPT-User', 'https://openai.com/chatgpt-user.json', '2026-09-22T00:00:00Z'),
  ('oai-adsbot', 'OAI-AdsBot', 'OpenAI', 'ads_bot', 'OAI-AdsBot', 'https://openai.com/adsbot.json', '2026-09-22T00:00:00Z'),
  ('claudebot', 'ClaudeBot', 'Anthropic', 'crawler', 'ClaudeBot', 'https://claude.com/crawling/bots.json', '2026-09-22T00:00:00Z'),
  ('claude-searchbot', 'Claude-SearchBot', 'Anthropic', 'search_bot', 'Claude-SearchBot', 'https://claude.com/crawling/bots.json', '2026-09-22T00:00:00Z'),
  ('claude-user', 'Claude-User', 'Anthropic', 'fetcher', 'Claude-User', 'https://claude.com/crawling/bots.json', '2026-09-22T00:00:00Z'),
  ('perplexitybot', 'PerplexityBot', 'Perplexity', 'search_bot', 'PerplexityBot', 'https://www.perplexity.ai/perplexitybot.json', '2026-09-22T00:00:00Z'),
  ('perplexity-user', 'Perplexity-User', 'Perplexity', 'fetcher', 'Perplexity-User', 'https://www.perplexity.ai/perplexity-user.json', '2026-09-22T00:00:00Z'),
  ('googlebot', 'Googlebot', 'Google', 'crawler', 'Googlebot', 'https://developers.google.com/static/crawling/ipranges/common-crawlers.json', '2026-09-22T00:00:00Z'),
  ('googleother', 'GoogleOther', 'Google', 'crawler', 'GoogleOther', 'https://developers.google.com/static/crawling/ipranges/common-crawlers.json', '2026-09-22T00:00:00Z'),
  ('bingbot', 'Bingbot', 'Microsoft', 'crawler', 'bingbot', 'https://www.bing.com/toolbox/bingbot.json', '2026-09-22T00:00:00Z'),
  ('applebot', 'Applebot', 'Apple', 'crawler', 'Applebot(?!-Extended)', 'https://search.developer.apple.com/applebot.json', '2026-09-22T00:00:00Z'),
  ('meta-externalagent', 'Meta-ExternalAgent', 'Meta', 'crawler', 'meta-externalagent', NULL, '2026-09-22T00:00:00Z'),
  ('meta-externalfetcher', 'Meta-ExternalFetcher', 'Meta', 'fetcher', 'meta-externalfetcher', NULL, '2026-09-22T00:00:00Z'),
  ('facebookexternalhit', 'facebookexternalhit', 'Meta', 'fetcher', 'facebookexternalhit', NULL, '2026-09-22T00:00:00Z'),
  ('bytespider', 'Bytespider', 'ByteDance', 'crawler', 'Bytespider', NULL, '2026-09-22T00:00:00Z'),
  ('amazonbot', 'Amazonbot', 'Amazon', 'crawler', 'Amazonbot', NULL, '2026-09-22T00:00:00Z'),
  ('ccbot', 'CCBot', 'Common Crawl', 'crawler', 'CCBot', NULL, '2026-09-22T00:00:00Z'),
  ('duckassistbot', 'DuckAssistBot', 'DuckDuckGo', 'fetcher', 'DuckAssistBot', NULL, '2026-09-22T00:00:00Z'),
  ('feedly', 'Feedly', 'Feedly', 'feed_reader', 'Feedly', NULL, '2026-09-22T00:00:00Z'),
  ('inoreader', 'Inoreader', 'Inoreader', 'feed_reader', 'Inoreader', NULL, '2026-09-22T00:00:00Z'),
  ('newsblur', 'NewsBlur', 'NewsBlur', 'feed_reader', 'NewsBlur', NULL, '2026-09-22T00:00:00Z'),
  ('feedbin', 'Feedbin', 'Feedbin', 'feed_reader', 'Feedbin', NULL, '2026-09-22T00:00:00Z');
