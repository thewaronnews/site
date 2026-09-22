"""
Unit tests for linkcheck.classify_tier1, the tier-1 classifier from spec
section 6 step 3. Uses recorded-style fixtures (status code + body string)
rather than live network calls.

Run: python3 -m unittest ops.tests.test_linkstate -v  (from twon/)
     or: python3 -m unittest discover -s ops/tests  (from twon/ops/)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import linkcheck  # noqa: E402

ARTICLE_TITLE = "Trump says CNN, MS NOW and Politico will be banned from the White House"
ARTICLE_BODY = f"<html><head><title>{ARTICLE_TITLE}</title></head><body>Article text here.</body></html>"


class TestClassifyTier1(unittest.TestCase):
    def test_200_matching_title_is_live(self):
        state = linkcheck.classify_tier1(
            200, None,
            "https://www.npr.org/2026/09/19/nx-s1-5974854/trump-cnn-msnow-politico-ban",
            "https://www.npr.org/2026/09/19/nx-s1-5974854/trump-cnn-msnow-politico-ban",
            ARTICLE_BODY, ARTICLE_TITLE,
        )
        self.assertEqual(state, "live")

    def test_200_redirected_to_different_path_with_matching_title_is_redirected(self):
        state = linkcheck.classify_tier1(
            200, None,
            "https://www.npr.org/2026/09/19/some-new-canonical-slug",
            "https://www.npr.org/2026/09/19/nx-s1-5974854/trump-cnn-msnow-politico-ban",
            ARTICLE_BODY, ARTICLE_TITLE,
        )
        self.assertEqual(state, "redirected")

    def test_200_on_homepage_is_ambiguous(self):
        body = "<html><head><title>NPR : National Public Radio</title></head><body>Home.</body></html>"
        state = linkcheck.classify_tier1(
            200, None, "https://www.npr.org/", "https://www.npr.org/2026/09/19/some-story", body, ARTICLE_TITLE,
        )
        self.assertEqual(state, "ambiguous")

    def test_200_with_unrelated_title_is_ambiguous(self):
        body = "<html><head><title>Weather forecast for Tuesday</title></head><body>...</body></html>"
        url = "https://www.npr.org/2026/09/19/nx-s1-5974854/trump-cnn-msnow-politico-ban"
        state = linkcheck.classify_tier1(200, None, url, url, body, ARTICLE_TITLE)
        self.assertEqual(state, "ambiguous")

    def test_401_is_paywalled(self):
        state = linkcheck.classify_tier1(401, None, "https://example.com/a", "https://example.com/a", "", ARTICLE_TITLE)
        self.assertEqual(state, "paywalled")

    def test_402_is_paywalled(self):
        state = linkcheck.classify_tier1(402, None, "https://example.com/a", "https://example.com/a", "", ARTICLE_TITLE)
        self.assertEqual(state, "paywalled")

    def test_200_with_paywall_marker_is_paywalled(self):
        body = '<html><head><title>%s</title></head><body>Subscribe to continue reading.</body></html>' % ARTICLE_TITLE
        url = "https://example.com/a"
        state = linkcheck.classify_tier1(200, None, url, url, body, ARTICLE_TITLE)
        self.assertEqual(state, "paywalled")

    def test_403_with_challenge_marker_is_tier2(self):
        body = "<html><body>Checking your browser... Just a moment...</body></html>"
        state = linkcheck.classify_tier1(403, None, "https://example.com/a", "https://example.com/a", body, ARTICLE_TITLE)
        self.assertEqual(state, "tier2")

    def test_403_without_challenge_marker_is_dead(self):
        body = "<html><body>Forbidden</body></html>"
        state = linkcheck.classify_tier1(403, None, "https://example.com/a", "https://example.com/a", body, ARTICLE_TITLE)
        self.assertEqual(state, "dead")

    def test_429_with_datadome_marker_is_tier2(self):
        body = "<html><body>datadome protection active</body></html>"
        state = linkcheck.classify_tier1(429, None, "https://example.com/a", "https://example.com/a", body, ARTICLE_TITLE)
        self.assertEqual(state, "tier2")

    def test_503_with_cf_mitigated_is_tier2(self):
        body = "<html><body>cf-mitigated challenge page</body></html>"
        state = linkcheck.classify_tier1(503, None, "https://example.com/a", "https://example.com/a", body, ARTICLE_TITLE)
        self.assertEqual(state, "tier2")

    def test_404_is_dead(self):
        state = linkcheck.classify_tier1(404, None, "https://example.com/a", "https://example.com/a", "", ARTICLE_TITLE)
        self.assertEqual(state, "dead")

    def test_410_is_dead(self):
        state = linkcheck.classify_tier1(410, None, "https://example.com/a", "https://example.com/a", "", ARTICLE_TITLE)
        self.assertEqual(state, "dead")

    def test_tls_failure_is_dead(self):
        state = linkcheck.classify_tier1(None, "tls_failure", "https://example.com/a", "https://example.com/a", "", ARTICLE_TITLE)
        self.assertEqual(state, "dead")

    def test_timeout_is_dead(self):
        state = linkcheck.classify_tier1(None, "timeout", "https://example.com/a", "https://example.com/a", "", ARTICLE_TITLE)
        self.assertEqual(state, "dead")

    def test_network_error_is_dead(self):
        state = linkcheck.classify_tier1(None, "network_error", "https://example.com/a", "https://example.com/a", "", ARTICLE_TITLE)
        self.assertEqual(state, "dead")


class TestTitleOverlap(unittest.TestCase):
    def test_identical_titles_full_overlap(self):
        import common
        self.assertEqual(common.title_token_overlap("Hello World", "Hello World"), 1.0)

    def test_disjoint_titles_zero_overlap(self):
        import common
        self.assertEqual(common.title_token_overlap("Hello World", "Foo Bar"), 0.0)

    def test_partial_overlap_between_zero_and_one(self):
        import common
        overlap = common.title_token_overlap(
            "Trump says CNN will be banned",
            "CNN reporters denied entry at White House",
        )
        self.assertTrue(0.0 < overlap < 1.0)


if __name__ == "__main__":
    unittest.main()
