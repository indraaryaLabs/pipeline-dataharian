# Reset the warehouse

Use this when the warehouse file is corrupt, or when USGS legitimately removed more than a fifth of the stored events and the pipeline refused to follow.

Resetting loses the run history and the list of rejected rows. The events come back, because a fresh run reads the whole year again. The page will show a short run history afterwards.

## Steps

Save what is there first, if it can be read:

```bash
git fetch origin data
git show origin/data:warehouse.db > warehouse-backup.db
git show origin/data:data.json > data-backup.json
```

Delete the branch and start again:

```bash
git push origin --delete data
```

Run the Pipeline workflow manually with mode `auto`. With no warehouse it chooses `backfill`, reads the 365-day window from USGS in 60-day chunks, and publishes a new `data` branch and page.

## Checking the result

- The run summary shows mode `backfill` and a few thousand USGS rows.
- The page shows a full year in the 1 year view.
- Compare the event count with the backup: `sqlite3 warehouse-backup.db "select count(*) from quakes where source='usgs'"`.
