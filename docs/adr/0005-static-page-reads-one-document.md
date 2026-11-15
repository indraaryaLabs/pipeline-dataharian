# ADR 0005: A static page that reads one document and always shows state

- Status: accepted
- Date: 2026-11-16

## Context

The page is public and the data changes once a day. A backend would add cost and failure modes for no gain. At the same time, a dashboard that looks fine while its data is two weeks old is misleading.

## Decision

The page is static, hosted on GitHub Pages and reads one file, `data.json`, validated on load against the parts it uses. The pipeline always writes that file, including after a failed run. The page shows the age of the data, flags data older than 36 hours as stale, and says when the latest run was partial or failed. Loading, network error, wrong format and empty are separate states with their own copy.

## Consequences

- No server to run, and the deployed page keeps working if the pipeline stops, while saying that it has.
- The pipeline and the page are decoupled by a versioned contract with a JSON Schema and a test.
- The page cannot show anything that is not in the document, which keeps it simple and keeps the numbers traceable to the pipeline.
- Visitors on a long-open tab pick up a new daily document without reloading: the page refetches after an hour.
