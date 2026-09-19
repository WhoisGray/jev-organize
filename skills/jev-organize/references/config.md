# jev-organize.config.json

`jev-organize init` writes the full default config. Every key is optional: whatever you leave out keeps its default. `company`, `folders` and `thresholds` merge key by key; any other key you set replaces the default completely (so a `departments` object you write is the whole list).

A scan finds the config in this order: `--config <file>`, then `jev-organize.config.json` in the output folder, the input folder, or the current folder.

## What each key does

| Key | What it does | Re-asks Jev when changed? |
| --- | --- | --- |
| `company.name`, `company.aliases`, `company.about` | Who "we" are. The counterparty question never picks this name. Empty means the tool detects it from the files | yes |
| `departments` | `{ id: { label, description } }`. The id goes into the catalog, the label becomes the folder name, and the description is what Jev matches against. At most 250 | yes |
| `department_rules` | Sentences that settle boundary cases, e.g. "Offer letters are hr, not legal" | yes |
| `types`, `type_rules` | The same for document types | yes |
| `sensitivity`, `sensitivity_rules` | Levels from least to most sensitive. Keep the ids `public`, `internal`, `confidential` and `restricted`: the detectors raise files to `confidential` or `restricted` by those ids | yes |
| `tags` | `{ id: description }`. Each tag is a separate yes/no question; a file can have many | yes |
| `column_types` | What PII each spreadsheet column may hold. Keep `none` | yes |
| `known_entities` | Organisation names to recognise even without "Ltd" or "GmbH", e.g. `"Cairn & Co Outfitters"` | yes |
| `date_order` | `dmy` (03/04/2026 = 3 April) or `mdy` (US) | yes |
| `max_chars` | How much text per file is sent (start and end of long files). Default 6000 | yes |
| `redact` | Mask emails, phones, IBANs, card numbers, national IDs and secrets before sending. Default `true` | yes |
| `layout` | Folder pattern. Tokens: `{department}` `{type}` `{year}` `{quarter}` `{month}` `{date}` `{counterparty}` `{sensitivity}` `{name}` `{stem}` `{ext}`, plus `{department_id}` `{type_id}`. Must end in `{name}` or `{stem}{ext}` | no |
| `folders` | Names of the special folders: `review`, `restricted`, `noise`, `duplicates` | no |
| `restricted_separately` | Put restricted files under `folders.restricted` so access can be locked down in one place. Default `true` | no |
| `thresholds` | `department` (0.6) and `type` (0.5): below these a file goes to review. `noise` (0.8), `flag` (0.5), `tag` (0.6) | no |
| `ignore` | File and folder names to skip (`*` wildcards) | no |

"Re-asks Jev" means the cache no longer matches, so the next scan classifies every file again. Changes marked "no" only need a re-scan, which is free because the answers come from the cache.

## Writing good options

- Describe every option with the words that appear in real files. Jev matches the file against these descriptions. A bare `ops` gives it nothing to match.
- Settle overlaps with a rule rather than a longer description: "A purchase order is operations, even when it mentions an invoice."
- Keep an `other` option in every list, so a file that fits nothing has somewhere to go.
- After changing the taxonomy, scan a sample with `--limit 40` and read the review list before running on everything.

## Example: a law firm

```json
{
  "company": { "name": "Morrow Legal LLP", "about": "A 30-lawyer commercial law firm" },
  "departments": {
    "matters": { "label": "Client Matters", "description": "Work for a client: advice, contracts drafted for clients, court filings, correspondence about a case" },
    "finance": { "label": "Finance", "description": "Billing, invoices to clients, time records, bank, payroll totals" },
    "people": { "label": "People", "description": "Recruitment, CVs, employment contracts, reviews, training records" },
    "knowledge": { "label": "Knowledge", "description": "Precedents, templates, practice notes and research that are not about one client" },
    "firm": { "label": "Firm Management", "description": "Partnership meetings, strategy, policies, insurance, IT" },
    "other": { "label": "Other", "description": "Anything else" }
  },
  "department_rules": ["Anything about one client's matter is matters, even an invoice to that client."],
  "layout": "{department}/{counterparty}/{year}/{name}"
}
```
