# ADR 0040: Bounded, resumable carrier CSV evidence

Date: 2026-10-03. Status: implementation for review under #55.

Use the existing carrier service, W26/R19 and organization transaction locks. A saved
preview pins parcel/reference/mapping state. Each selected row revalidates it and commits
its domain evidence plus immutable outcome together. A client command key binds the
selected row set; a source ID plus normalized fingerprint prevents cross-run duplicates
and rejects conflicting reuse. Shipment rows only link existing ShipIT dockets.

| Primary evidence | Concrete decision, fit and cost |
| --- | --- |
| [AWS safe retries](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) | Adopt caller intent keys and atomic receipt/effect. Recover a lost response without duplication; three small SQL tables, no distributed coordinator. Test concurrency and lost COMMIT. |
| [Microsoft translation boundary](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer) | Adapt within the existing module: carrier claims cannot become ShipIT delivery/payment state. Test unchanged proof/money/events. No separate service. |
| [PostgreSQL 18 constraints](https://www.postgresql.org/docs/18/ddl-constraints.html) | Adopt composite ownership FKs and unique source outcomes, with immutable run/outcome evidence. Test foreign IDs, runtime privileges and forward upgrades. |
| [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180) | Implement a small bounded comma/quote grammar including quoted newlines and doubled quotes; accept LF too. No arbitrary dialect detection, scripts or spreadsheet engine. Unit tests cover grammar and limits. |
| [OWASP file upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) | Adapt validation, size limits and authorization. UTF-8 text is parsed in memory; raw upload has zero persistent retention and no download/execution path. Reject binary/control content; do not claim antivirus scanning. |
| [OWASP CSV injection](https://owasp.org/www-community/attacks/CSV_Injection) | Treat every cell as data; invalid operational codes are rejected without echoing content. No raw CSV re-export is provided. Any future export must escape spreadsheet formulas at its own boundary; quoting alone is not a universal guarantee. |

Limits are engineering choices for small shop files: 64 KiB/200 records, 20 rows per
commit. Bounded synchronous work is simpler to operate than a queue here; clients resume
remaining rows explicitly. Large bulk import infrastructure is deferred. Raw files are
not retained because normalized safe evidence and file digests suffice for replay;
operators keep their originals. This avoids storing arbitrary extra columns or PII.

Reuse Node 22.23.2, Fastify 5.12.3, raw pg and PostgreSQL 18.6. No dependency change.
No LLM/provider calls, cost accounting, rate publication or automatic reconciliation.
