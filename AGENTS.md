# AGENTS.md

Instructions for AI coding agents (Codex, Claude Code and others) working on this repository.
To *use* jev-organize on company data, see `skills/jev-organize/SKILL.md` (a Claude and Codex skill) and `.codex/agents/jev_organizer.toml` (a Codex custom agent).

## What this is

A zero-dependency Node 22 CLI that classifies and organizes a folder of company files with TypeSafe's Jev decision model on OpenRouter (`POST https://openrouter.ai/api/alpha/decisions`, model `~typesafe/jev-latest`). Jev only answers typed questions (Choice / Noul / Score) about a `state`; it never writes text. So:

- dates and organisation names are found by code (`src/candidates.mjs`) and Jev picks one ("pick, don't extract");
- sensitive values are found by code (`src/detect.mjs`), masked before sending, and set a sensitivity floor Jev can't lower;
- thresholds in the config route uncertain files to review.

## Layout

| Path | What |
| --- | --- |
| `bin/jev-organize.mjs` | CLI: scan, apply, query, init, install, doctor |
| `src/organize.mjs` | Scan pipeline: walk, hash, extract, dedupe, detect company, estimate, classify (cached), route |
| `src/classify.mjs` | Builds the Jev request per file and turns answers into a record |
| `src/extract/` | Text from docx/xlsx/pptx/odf (own ZIP reader), PDF (pdftotext or built-in), eml, html, csv, text |
| `src/detect.mjs`, `src/candidates.mjs` | Redaction + detectors; date and organisation candidates |
| `src/config.mjs` | Default taxonomy and config loading |
| `src/report/` | catalog.jsonl/csv, INDEX.md + AGENTS.md for the organized folder, report.html |
| `src/apply.mjs` | Copies/links files into the organized folder; never touches originals |
| `skills/jev-organize/` | The skill. `scripts/` is a generated copy of bin + src: never edit it by hand |
| `.codex/agents/jev_organizer.toml` | Codex custom agent |
| `examples/company-data-src/` | Text sources of the fictional example data; `npm run examples` builds `examples/company-data/` (docx, xlsx, pptx, pdf) |
| `examples/labels.json` | Hand labels for the example data |
| `scripts/` | build (skill bundle + zip), make-examples, evaluate, office-writer |
| `results/` | Measured runs on the example data |

## Commands

```bash
npm test                 # offline tests with a fake Jev (no key, no network)
npm run build            # after any change in bin/ or src/: refresh the skill bundle and dist zip
npm run check            # fails if the skill bundle is stale
npm run examples         # rebuild examples/company-data from the sources
npm run evaluate         # live: scan the examples and score against labels.json (needs OPENROUTER_API_KEY)
```

## Rules

- No runtime dependencies. Node built-ins only.
- Never write to the input folder. Never delete, move or overwrite user files. `apply` copies or links, and skips or renames on conflicts.
- Everything sent to Jev goes through `prepare()` in `src/classify.mjs`, which redacts first. Don't add a path that sends raw text.
- Never commit `.env` or an API key. Run `git grep -n "sk-or-"` before pushing.
- Keep the Jev state small and relevant: Jev is weakest with large irrelevant state, arithmetic and multi-hop reasoning.
- After changing questions or the taxonomy, run `npm run evaluate` and update the numbers in README.md and `results/`.
- Run `npm test` and `npm run check` before committing.
