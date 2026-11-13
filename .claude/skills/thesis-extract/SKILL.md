---
name: thesis-extract
description: Turn the capstone thesis .docx (IoT-Based Water Level and Quality Monitoring System for MSU Motor Pool) into plain-text files with paragraph numbers, Word comments, highlighted passages and an outline. Use before any thesis review, proofreading, paraphrasing, humanizing, adviser-comment or thesis-vs-code task, and whenever the user mentions their thesis draft, manuscript, chapter, or a .docx in Downloads.
---

# Thesis extract

The thesis lives as a Word file, usually in `C:\Users\msu-wone\Downloads\` (names contain
"IOT-BASED WATER LEVEL AND QUALITY MONITORING SYSTEM"; the newest one is normally the one to use;
confirm the file with the user if several look current). Google Docs cannot be opened directly:
the user downloads it as .docx first.

## Extract

```bash
python -I .claude/skills/thesis-extract/scripts/extract.py "<thesis.docx>" thesis-review/extract
```

Standard library only (no pandoc or python-docx needed). Output in `thesis-review/extract/`:

| File | Contents |
|---|---|
| `draft.txt` | Every non-empty paragraph as `[p123] text`. Comment anchors show as `[[C5>]] ... [[<C5]]`. |
| `outline.txt` | Chapter and numbered-section headings with their `[p…]` numbers. Use it to jump to a section. |
| `highlights.txt` | Highlighted passages as `[p123] (yellow) text`. In past drafts, yellow marked passages the student was revising. |
| `comments.txt` | Word comments as `[C5] Author: text`. Only exists when the file has comments; comments made in Google Docs survive the .docx download only if they were not resolved. |

The draft is ~30,000 words: read `outline.txt` first, then only the paragraph range you need
(`grep -n` or `sed -n`) instead of the whole `draft.txt`.

## Rules

- Never modify the original .docx. Write results to `thesis-review/` (git-ignored, so thesis text
  is never pushed to GitHub).
- Always cite locations by section number and `[p…]` so the student can find them in Word.
- To write comments or edits back into a .docx copy, use the `docx` skill
  (`.claude/skills/docx`, e.g. `scripts/comment.py`) on a copy, never on the original.
