# ADR 0036 — Localized replies and bounded Groq interpretation

Status: Implemented locally for #51; production enablement requires deployment privacy approval.

## Decision

Persist locale on the existing signed channel conversation. Localize reviewed templates,
including money and quote responses, without generating business wording. Keep staff
messages and qualified delivery-code templates under their existing owners.

Use official `groq-sdk` 1.6.0 only, exact model `qwen/qwen3.8-27b`, and
`reasoning_effort: "none"`. Explicitly inject server `LLM_API_KEY`; never rely on
`GROQ_API_KEY` or ambient endpoint/log overrides. The request returns a strict allowlisted
intent/placeholder/confidence object. It neither executes tools nor returns facts.

Minimize disclosure through a closed reviewed vocabulary, removed unknown tokens and
opaque docket marker. Guided quote/pickup details never go to the provider. No history,
prices, statuses, phone numbers, addresses, OTPs or keys enter prompts. Missing coverage
falls back to clarification/handoff. A privacy-policy reference gates external use.

Commit a single durable per-inbox reservation and organization budget before inference;
close the transaction before calling Groq. Limit one request to five seconds, 512 input
characters and 192 output tokens. No retries. Per-organization ceilings cover all replicas
and sibling franchises. Reauthorize after inference and again before delivery. Expired
reservations become fallback rather than repeat calls. Safe metadata excludes raw text.

## Evidence and alternatives

[Groq model documentation](https://console.groq.com/docs/model/qwen/qwen3.8-27b) confirms
the exact model and instruct mode via `reasoning_effort: "none"`.
[Structured outputs](https://console.groq.com/docs/structured-outputs) supports this model
in strict mode but cannot combine structured output with tool calling or streaming.
We therefore use one JSON classification, followed by server-owned dispatch.
[SDK documentation](https://github.com/groq/groq-typescript) documents default retries,
timeouts and debug payload logging; explicit zero retries, deadline and logging off prevent
request multiplication and disclosure. npm metadata was reviewed: no runtime dependencies
or install hooks; lock integrity is pinned and install scripts were disabled.

[Anthropic's workflow guidance](https://www.anthropic.com/engineering/building-effective-agents)
fits a small routing step and favors starting with direct APIs. An agent framework,
retrieval store, autonomous loop and model-generated replies add no required capability.
[AWS request identity guidance](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
supports preserving a durable identity across retries. Here, conservative no-retry inference
also avoids ambiguous acceptance costs. Deterministic tools retain their own atomic receipts.

[Groq data controls](https://console.groq.com/docs/your-data) describes US retention and ZDR;
an API key or successful synthetic smoke does not establish production privacy approval.
Retain explicit deployment approval and default-off behavior. Provider/model comparison is
outside scope because the user fixed both decisions.

## Consequences

Known English/Hindi/Hinglish commands remain independent of provider availability.
Natural-language coverage is deliberately limited by privacy filtering and requires measured
evaluation before rollout. Confidence is a reject heuristic, never proof of correctness.
The ordered scheduler can briefly wait on an inference reservation; five-second calls and
15-second abandoned-reservation recovery bound that delay. Higher throughput is future
measured work, not justification for replacing the existing queue now.

See [operating contract](../architecture/multilingual-assistant.md) and
[acceptance evidence](../architecture/issue-51-verification.md).
