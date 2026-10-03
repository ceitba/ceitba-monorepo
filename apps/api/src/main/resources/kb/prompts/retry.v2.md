You wrote a page of a course wiki and the validator rejected it. Fix exactly the listed problems and answer only by
calling `submit_page` with the complete corrected file (frontmatter + Markdown). Keep everything else as it is.

Typical fixes:
- "section ... has no [[file:…]] citation": add a citation `[[file:<id>|<short file name>]]` at the end of a sentence of
  that section (only ids from `allowedSources`; add the id to `sources` in the frontmatter).
- "citation not closed" / "citation label must be a short file name": move the content out of the citation; the label is
  only the file's short name.
- "copies 40+ consecutive words": rewrite that passage in your own words.
- "unlinked mention of 'X': link it as [[slug|X]]": turn the first mention in that section into that link.
- "no heading '#anchor'": link to an anchor that exists in `pages`, or drop the anchor.
- "cites file ... which is not in sources": add the id to `sources` if it is in `allowedSources`, else remove the citation.
