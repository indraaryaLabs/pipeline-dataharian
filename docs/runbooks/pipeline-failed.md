# Pipeline failed

## Symptoms

- The Pipeline workflow shows a red run.
- The page says "The latest update failed" or "The data has not refreshed for N days".
- The page shows an old "updated" time.

## First look

Open the failed run and read the **Pipeline run** summary at the bottom. It lists, per source, how many rows were fetched, added, revised, removed and rejected, the status of every check, and a `problem:` line when something stopped the run.

## Causes and fixes

| Cause                                                            | How to see it                                                        | Fix                                                                                             |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| USGS is down or rate limiting                                    | `problem:` names USGS; run status is `failed`                        | Nothing to do. The stored data and the page are intact. Run the workflow again later            |
| BMKG is down or changed address                                  | Run status `partial`; the page says BMKG could not be read           | Wait, or see [a source changed](source-changed.md) if it persists for days                      |
| A full refresh was refused                                       | `problem:` says it would delete N of M events, or returned no events | Check USGS. If the clean-up is legitimate, see [reset the warehouse](reset-warehouse.md)        |
| A check failed                                                   | Run is green in the pipeline but the check list shows `FAIL`         | The check detail says which. Usually an upstream problem; see the table in the data-quality doc |
| Scheduled runs stopped after 60 days without repository activity | Actions tab shows the workflow as disabled                           | Click Enable workflow, then run it once. A commit to `main` resets the 60 day counter           |
| The workflow cannot push the data branch                         | The Publish step fails with 403                                      | Settings, Actions, General: workflow permissions must allow read and write                      |
| Pages deployment fails                                           | The Deploy page job fails                                            | Settings, Pages: Source must be GitHub Actions                                                  |
| GitHub Actions itself is delayed                                 | Runs are queued or missing and the GitHub status page agrees         | Wait. The page already warns visitors when data is older than 36 hours                          |

## Running it by hand

```bash
make setup && . .venv/bin/activate
git fetch origin data && mkdir -p data
git show origin/data:warehouse.db > data/warehouse.db
dataharian run --db data/warehouse.db --out out/data.json
```

Add `--mode backfill` to re-read the whole year, and `--now 2026-11-15T01:17:00Z` to run as if it were another moment. Running by hand writes only local files; it does not publish.

## Confirming it is fixed

1. The next Pipeline run is green and the summary shows `ok`.
2. The page says "Updated N minutes ago" and shows no notice.
3. All checks on the page are `Passed`, or a `warn` you understand.
