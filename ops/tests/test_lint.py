"""
Unit tests for common.Lint, against the real editorial/lint-rules.json.

Run: python3 -m unittest ops.tests.test_lint -v  (from twon/)
     or: python3 -m unittest discover -s ops/tests  (from twon/ops/)
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import common  # noqa: E402


class TestLint(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.lint = common.Lint()

    def kinds(self, text):
        return [v["kind"] for v in self.lint.check(text)]

    def texts(self, text):
        return [v["text"] for v in self.lint.check(text)]

    # -- banned phrases -------------------------------------------------

    def test_banned_phrase_outside_quotes_is_flagged(self):
        v = self.lint.check("This was another crackdown on the press.")
        self.assertTrue(any(x["kind"] == "banned_phrase" and x["text"].lower() == "crackdown on" for x in v))

    def test_banned_phrase_inside_straight_quotes_is_exempt(self):
        v = self.lint.check('The outlet called it a "crackdown on journalism."')
        self.assertFalse(any(x["kind"] == "banned_phrase" for x in v))

    def test_banned_phrase_inside_curly_quotes_is_exempt(self):
        v = self.lint.check("The outlet called it a “crackdown on journalism.”")
        self.assertFalse(any(x["kind"] == "banned_phrase" for x in v))

    def test_banned_phrase_in_blockquote_is_exempt(self):
        text = "Normal line.\n> This was a crackdown on the press, the statement said.\n"
        v = self.lint.check(text)
        self.assertFalse(any(x["kind"] == "banned_phrase" for x in v))

    def test_banned_phrase_replacement_is_reported(self):
        v = self.lint.check("Officials claimed the policy was legal.")
        matches = [x for x in v if x["text"].lower() == "claimed"]
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["replacement"], "said")

    def test_reportedly_is_banned(self):
        v = self.lint.check("The agency reportedly acted on Tuesday.")
        self.assertTrue(any(x["text"].lower() == "reportedly" for x in v))

    # -- quotation-only words -------------------------------------------

    def test_quotation_only_word_outside_quotes_is_flagged(self):
        v = self.lint.check("The new rule is an unconstitutional overreach.")
        self.assertTrue(any(x["kind"] == "quotation_only" and x["text"].lower() == "unconstitutional" for x in v))

    def test_quotation_only_word_inside_quotes_is_exempt(self):
        v = self.lint.check('The court held the policy "unconstitutional."')
        self.assertFalse(any(x["kind"] == "quotation_only" for x in v))

    def test_banned_phrase_containing_quotation_only_word_reported_once(self):
        # "attack on" is a banned phrase; "attack" alone is quotation-only.
        # lint-rules.json: reported once, as the banned phrase.
        v = self.lint.check("This was an attack on the press.")
        kinds = [x["kind"] for x in v if "attack" in x["text"].lower()]
        self.assertEqual(kinds, ["banned_phrase"])

    def test_quotation_only_word_not_part_of_banned_phrase_still_flagged(self):
        v = self.lint.check("The policy was called authoritarian by critics.")
        self.assertTrue(any(x["kind"] == "quotation_only" and x["text"].lower() == "authoritarian" for x in v))

    # -- dashes -----------------------------------------------------------

    def test_em_dash_outside_quotes_is_flagged(self):
        v = self.lint.check("The order took effect immediately — no exceptions were made.")
        self.assertTrue(any(x["kind"] == "dash" and x["text"] == "—" for x in v))

    def test_em_dash_inside_quotes_is_exempt_as_verbatim(self):
        v = self.lint.check('The memo said, "no exceptions — none at all."')
        self.assertFalse(any(x["kind"] == "dash" for x in v))

    def test_en_dash_in_prose_is_flagged(self):
        v = self.lint.check("The rule covered 2017–2021.")
        self.assertTrue(any(x["kind"] == "dash" for x in v))

    def test_spaced_double_hyphen_is_flagged(self):
        v = self.lint.check("The order took effect -- no exceptions.")
        self.assertTrue(any(x["kind"] == "dash" for x in v))

    def test_spaced_hyphen_is_flagged(self):
        v = self.lint.check("The order took effect - no exceptions.")
        self.assertTrue(any(x["kind"] == "dash" for x in v))

    def test_hyphenated_compound_word_is_not_flagged(self):
        # a real hyphen inside a word (no surrounding spaces) is not a dash
        v = self.lint.check("The well-sourced report was published Monday.")
        self.assertFalse(any(x["kind"] == "dash" for x in v))

    # -- exempt site name -------------------------------------------------

    def test_site_name_is_exempt_from_war_on(self):
        v = self.lint.check("Read more on The War On News about this incident.")
        self.assertFalse(any(x["kind"] == "banned_phrase" and "war" in x["text"].lower() for x in v))

    def test_war_on_outside_site_name_is_flagged(self):
        v = self.lint.check("This is the latest chapter in the war on the press.")
        self.assertTrue(any(x["text"].lower() == "war on" for x in v))

    # -- clean text ---------------------------------------------------

    def test_clean_sentence_has_no_violations(self):
        text = (
            "On September 18, 2026, President Donald Trump announced on Truth "
            'Social that CNN, MS NOW and Politico would be barred from the '
            'White House. The post cited "FICTION and LIES," according to NPR.'
        )
        self.assertEqual(self.lint.check(text), [])
        self.assertTrue(self.lint.is_clean(text))


if __name__ == "__main__":
    unittest.main()
