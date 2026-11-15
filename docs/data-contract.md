# Data contract

The pipeline publishes one file, `data.json`, and the page reads only that. It is described by [`schema/data.schema.json`](../schema/data.schema.json) (JSON Schema draft 2020-12). A test validates every generated document, including the demo fixtures, against it.

`schemaVersion` is `1`. A change that removes or reshapes a field bumps it; the page refuses a version it does not know and says so instead of drawing garbage.

## Shape

| Field             | Meaning                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `schemaVersion`   | Integer, currently 1                                                                       |
| `generatedAt`     | When the document was built, UTC, ISO 8601                                                 |
| `pipelineVersion` | Version of the pipeline that wrote it                                                      |
| `region`          | Name, bounding box `[minLat, maxLat, minLon, maxLon]` and the minimum magnitude            |
| `window`          | `from`, `to` and `days` covered                                                            |
| `events`          | Column-oriented: `columns` names the fields of each row in `rows`                          |
| `daily`           | Per-day counts in three magnitude bands (4.0-4.9, 5.0-5.9, 6.0+) and the strongest per day |
| `crosscheck`      | USGS and BMKG agreement: matched pairs, unmatched BMKG events, medians, pending count      |
| `pipeline`        | Recent runs, totals, reject reasons, the nine checks and the state of each source          |

Events are rows of `[id, t, lat, lon, depth, mag, place]`, where `t` is Unix seconds and `depth` is in kilometres. Rows rather than objects keep a year of events to a few hundred kilobytes before compression, and GitHub Pages compresses it.

## Guarantees

- The output is deterministic for a given warehouse and time: same input, same bytes.
- Times are UTC. The page shows UTC and says so.
- Every event in `events` passed validation; rejected rows appear only as counts in `pipeline.rejects`.
- `pipeline.runs[0]` is the latest run, newest first.

## Compatibility

Adding a field is not a breaking change; the page ignores what it does not use. The page validates the parts it relies on when it loads (`parseDocument`) and shows a format error when they are missing.
