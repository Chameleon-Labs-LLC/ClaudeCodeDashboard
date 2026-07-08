---
title: Usage & Cost
---

This page aggregates token usage and estimated cost across every Claude Code
session on this machine (plus any extra sources you've added on the Sources
page). It reads the session `.jsonl` files under `~/.claude/projects/`,
deduplicates streamed events, and prices them with LiteLLM's published
per-model rates — the same method the `ccusage` CLI uses, so the two agree.

## Reading the numbers

Each row breaks tokens into four buckets: **input**, **output**, **cache
creation**, and **cache read**. Cache reads are much cheaper than fresh input
tokens, which is why a session with millions of cache-read tokens can still
cost cents. **Cost** is estimated from LiteLLM pricing — live rates when
available, a bundled fallback table otherwise (the badge in the header shows
which one priced the report).

## Filters and controls

- **Date range** — since/until, inclusive, in your local timezone.
- **Granularity** — bucket the chart by day, week (Monday start), or month.
- **Projects / Models / Sources** — multi-select filters. They combine: a
  model filter of `claude-fable-5` plus a project filter shows only that
  model's usage inside those projects.
- Filter options are built from *all* data, not the filtered view, so you can
  always widen a filter back out.

## Why is there an "unknown" model?

Claude Code sometimes writes locally-generated placeholder messages into
session files — for example "No response requested." or an API-error notice.
These carry the pseudo-model `<synthetic>` and zero tokens in every bucket,
because no API request ever happened. The dashboard groups them under
**unknown**, which is why that row always shows 0 tokens and $0.00. It never
affects totals; you can filter it out (or just ignore it).

## Fast mode

Entries produced in fast mode are shown as a separate `-fast` model variant
(e.g. `claude-opus-4-8-fast`) and priced with the fast-mode output-token
multiplier, so regular and fast usage of the same model stay distinguishable.

## Sessions table

The bottom table attributes usage to individual sessions, with per-model
breakdowns, message counts, and first/last activity timestamps. Use it to
find which session or project is driving cost.
