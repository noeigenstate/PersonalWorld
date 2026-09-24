# Official GPT-5.6 Prompting Guidance

This is a concise, paraphrased working reference for the global skill. It is not a replacement for the live documentation.

Source: [Prompting guidance for GPT-5.6 Sol](https://developers.openai.com/api/docs/guides/prompt-guidance-gpt-5p6)  
Verified against the official page: 2026-07-15

## Contents

1. Core contract
2. Simplification and migration
3. Outcome, autonomy, and stopping
4. Personality, collaboration, and length
5. Tools and programmatic calling
6. Retrieval, grounding, and citations
7. Long-running state and reasoning
8. Frontend and visual work
9. Validation
10. Reusable prompt skeleton

## 1. Core Contract

GPT-5.6 performs best when a prompt states the desired outcome, important constraints, available evidence, and completion bar, while leaving the model freedom to choose an efficient path. Keep true invariants and remove scaffolding that does not change behavior.

Preserve:

- user-visible outcome and deliverable;
- success criteria and stop conditions;
- safety, permission, business, and evidence boundaries;
- context-dependent tool-routing rules;
- required output format and validation.

Trim repeated rules, redundant style instructions, ineffective examples, unnecessary process narration, irrelevant tools, and duplicate tool descriptions. Check the remaining contract for contradictions.

## 2. Simplification and Migration

Start from a prompt stack that already works. Change one variable at a time and run the same representative evaluations after each change.

For migration to GPT-5.6:

1. Change the model while preserving the current reasoning effort.
2. Establish a baseline on real tasks.
3. Remove obsolete scaffolding, repetition, examples that do not change behavior, and unrelated tools.
4. Add the smallest instruction that addresses a measured regression.
5. Re-run the same cases.

Avoid rewriting the complete prompt, tool set, reasoning configuration, and runtime simultaneously because the cause of a behavior change becomes untraceable.

## 3. Outcome, Autonomy, and Stopping

Prefer destination and completion criteria over prescribing every step. Preserve explicit user values. When a value is implicit, give decision criteria instead of universal defaults or keyword mappings.

Use absolute rules only for genuine invariants. Use contextual decision rules for search, questions, tools, retries, and iteration.

Define authorization by request type:

- answer, explain, review, diagnose, or plan: inspect and report without silently implementing;
- change, build, or fix: perform expected in-scope local work and non-destructive checks;
- external, destructive, costly, or scope-expanding actions: require explicit authorization.

Stop as soon as the success criteria are met with adequate evidence. If a required fact is missing, ask for or retrieve the smallest missing piece. Do not let minimizing tool calls outrank correctness.

## 4. Personality, Collaboration, and Length

Keep personality and collaboration instructions short and separate:

- personality controls warmth, directness, formality, humor, empathy, and polish;
- collaboration controls initiative, assumptions, questions, tradeoffs, checking, and uncertainty.

Control default response detail with `text.verbosity` when using the API, then state task-specific content and structure in the prompt. When shortening, preserve required facts, decisions, evidence, caveats, and next actions before trimming introductions, repetition, reassurance, and optional background.

For edits and summaries, preserve the requested artifact, genre, length, structure, and factual claims. Do not introduce new claims, sections, or promotional tone unless requested.

## 5. Tools and Programmatic Calling

Tool descriptions should explain purpose, trigger conditions, important return fields, and failure behavior. Require prerequisite discovery and validation when action correctness depends on them.

Parallelize independent reads. Keep steps sequential when one result changes the next decision. Synthesize parallel results before acting. Try one or two useful fallbacks for empty, partial, or suspiciously narrow results.

Use Programmatic Tool Calling for bounded deterministic processing of many or large records: filtering, joining, sorting, ranking, batching, deduplication, aggregation, and repeated schema validation. Define eligible read-only tools, compact output schema, retry limit, stopping condition, and handoff to direct judgment.

Prefer direct tool calls when one call is enough, outputs are small, each result changes the next decision, approval is required, citations or native artifacts must be preserved, or semantic judgment is needed between calls. Validate both program output and the final assistant message.

## 6. Retrieval, Grounding, and Citations

Define which claims need support and what counts as sufficient evidence. Begin ordinary Q&A with a focused retrieval. Retrieve again only for a missing required fact, owner, date, identifier, source, exhaustive comparison, specific artifact, or material unsupported claim.

Cite retrieved sources near the claims they support. Distinguish sourced facts, inference, and creative wording. State material source conflicts. Missing evidence is not proof of absence; narrow the claim or disclose the gap instead of guessing.

## 7. Long-Running State and Reasoning

For multi-step tasks, give a short preamble before tools and sparse updates at major phase boundaries. Do not narrate routine calls.

Preserve assistant phase values when replaying history. Compact after milestones rather than every turn. Keep reusable prompt prefixes stable for caching. Reuse persisted reasoning only while objectives, assumptions, and priorities remain relevant; stale reasoning can waste tokens and anchor the task incorrectly.

Establish a reasoning-effort baseline before increasing it. Test the same level and one lower level on representative work. Use low for proven latency-sensitive tasks, medium as a balanced start, high or xhigh only for measured gains, and max only for the hardest quality-first workloads. Before increasing effort, check for missing success criteria, dependencies, routing, or verification.

## 8. Frontend and Visual Work

Provide product context, existing design system, required states, responsiveness, and constraints. For incremental changes, preserve tokens, components, patterns, behavior, and scope. Do not add decorative UI or features without authorization.

Render and inspect the result. For spatially precise vision, OCR, localization, or computer-use work, choose image detail intentionally; use original detail when density or coordinates justify its extra cost and latency.

## 9. Validation

For code, run targeted behavior tests, applicable type or lint checks, affected builds, and a minimal smoke test when practical. For visual output, inspect clipping, spacing, layout, missing content, states, and consistency. For plans, cover requirements, resources, state or data flow, validation, failures, security or privacy, and material open questions.

If validation is unavailable, say why and provide the next best check.

## 10. Reusable Prompt Skeleton

Use only the sections that change behavior:

```text
Role: model function and relevant context
Personality: concise tone and collaboration behavior
Goal: user-visible outcome
Success criteria: conditions required before completion
Constraints: safety, evidence, permission, business, and side-effect limits
Tools: relevant tools, routing rules, and excluded routes
Output: required fields, structure, length, language, and tone
Stop rules: retry, fallback, abstention, question, and completion conditions
```

Keep each section short. Do not turn this skeleton into mandatory ceremony for simple requests.
