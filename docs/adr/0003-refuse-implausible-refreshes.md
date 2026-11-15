# ADR 0003: Refuse a refresh that would wipe or empty the catalogue

- Status: accepted
- Date: 2026-11-16

## Context

A full refresh (backfill) is the only run that deletes events: USGS can remove an event that turned out to be a duplicate or not an earthquake. The same code path would also delete everything if an upstream returned an empty answer or an error page parsed as zero rows. A pipeline that quietly erases a year of data because a service had a bad day is worse than one that fails.

## Decision

A backfill raises an error and changes nothing when the answer is empty while events are stored, or when it would delete more than 20% of the stored events. Incremental runs never delete. Every other failure leaves stored data alone too, because loading happens in one transaction after fetching and validating.

## Consequences

- A bad upstream day produces a failed run and a red workflow, not data loss.
- A legitimate large clean-up by USGS would be refused. The runbook says how to force it: delete the `data` branch and run a backfill.
- The 20% limit is a judgement. It is a named constant with tests on both sides of it.
