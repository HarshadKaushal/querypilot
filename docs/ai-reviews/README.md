# AI reviews

Every commit has a review file in this folder, added in the same commit. The file name is `YYYY-MM-DD-<short-subject>.md`. A review describes its own commit and names the commit it was built on, because a file cannot contain the hash of the commit that adds it.

Files dated before 2026-10-12 were written before the repository had git. They review whole phases, not commits.

## Sections

Use these headings, in this order. Write "None." under a heading that does not apply.

```markdown
# AI review: <subject>

Date: YYYY-MM-DD
Base commit: `<hash>` (<subject of that commit>)

## What changed

What the commit does, and why it was needed.

## AI usage

Which parts were written or proposed by an AI assistant, and which by a person.

## Suggestions accepted

Each AI suggestion that went in, and why.

## Suggestions rejected

Each AI suggestion, or alternative it raised, that did not go in, and why.

## Decisions

Trade-offs taken and the reasoning behind them.

## What was checked

Tests and commands that were run, and their results.

## Still open

Known gaps left for later.
```
