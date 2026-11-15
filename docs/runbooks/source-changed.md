# A source changed

Both agencies publish open data without a promise of stability. The pipeline is built so that a change shows up as rejected rows and failed checks instead of wrong charts.

## Symptoms

- The `reject_rate` check warns or fails.
- The page lists many rejected rows with the same reason.
- A source answers successfully but the run adds nothing for days.

## Find out what changed

Fetch the source from a normal connection and compare with the sample files in `tests/data/`, which are real responses.

```bash
curl -sS 'https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json' | head -c 600
curl -sS 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&limit=1&minmagnitude=4&orderby=time'
```

| Reason in the page                        | Likely change                                                    |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `malformed_row`, `bad_time`, `bad_number` | BMKG renamed a field or changed a date or number format          |
| `malformed_feature`, `missing_*`          | USGS changed the GeoJSON shape (rare; the API is versioned)      |
| `outside_region`                          | The region box in `config.py` no longer matches what is reported |
| `not_an_earthquake`                       | USGS now includes other event types; the query filters on type   |

## Fix

1. Add the new response as a file in `tests/data/` and a failing test that parses it.
2. Change the parser in `src/dataharian/sources/` until the test passes. Keep the old shape working if both can occur.
3. Open a pull request. CI runs the pipeline tests and the dashboard tests.
4. After merging, run the Pipeline workflow and confirm the rejects drop.

Parsers only ever add a named reason for a row they cannot read. They do not guess missing values.
