# ADR 0001: Keep the warehouse as a SQLite file on a single-commit branch

- Status: accepted
- Date: 2026-11-16

## Context

The pipeline needs a place to keep a year of events, run history and rejected rows between daily runs, at no cost. A hosted database would add an account, a secret and a free tier that can lapse. Committing a growing database to `main` every day would bury real changes and bloat every clone.

## Decision

Use SQLite as the warehouse and keep the file on a branch called `data`. Each run restores the file from that branch, works on it, and publishes it back by creating a fresh repository with one commit and force-pushing it. `data.json` is published on the same branch.

## Consequences

- No servers, no secrets beyond the workflow token, and the data can be inspected by downloading one file.
- `main` stays about code. The `data` branch has no history, so repository size stays flat once old commits are collected.
- Past warehouse states are not recoverable from the branch. The run history and a year of events are inside the file, which is what the page needs.
- Concurrent runs would overwrite each other. The workflow uses a concurrency group that queues instead of cancelling.
- A damaged file blocks the pipeline, because opening it fails loudly rather than starting over. The runbook describes the reset and what it loses.
- SQLite fits one writer and a few thousand rows a day. If this ever needed many writers or much more data, this decision should be revisited.
