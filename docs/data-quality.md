# Data quality

Nine checks run after every load. Each returns `pass`, `warn`, `fail` or `skip` with a one-line detail, and the whole list is published in `data.json` and shown on the page. The CLI exits 1 when any check fails, so the workflow turns red.

| Check                | Pass                                                | Warn                                                                                | Fail                            | Skip                            |
| -------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------- | ------------------------------- |
| `catalogue_present`  | The USGS catalogue has events                       |                                                                                     | It is empty                     |                                 |
| `values_plausible`   | Magnitude 0 to 10 and depth -5 to 800 km everywhere |                                                                                     | Any event outside those ranges  |                                 |
| `inside_region`      | Every event inside the bounding box                 |                                                                                     | Any event outside it            |                                 |
| `fresh_catalogue`    | Newest event is at most 72 hours old                | Older than 72 hours, up to 7 days                                                   | Older than 7 days, or no events |                                 |
| `daily_volume`       | Yesterday is in line with the previous two weeks    | None yesterday when 3 or more are typical, or more than 12 and over 4 times typical |                                 | Fewer than 30 events of history |
| `no_double_counting` | No two events within 5 seconds and 5 km           | Any such pair                                                                       |                                 |                                 |
| `last_run`           | Last run read both sources                          | Last run was partial                                                                | Last run failed                 | No run recorded yet             |
| `reject_rate`        | At most 2% of fetched rows rejected                 | Over 2%, up to 10%                                                                  | Over 10%                        | Nothing fetched                 |
| `agency_agreement`   | At least 70% of eligible BMKG events found in USGS  | Below 70%                                                                           |                                 | Fewer than 5 events to compare  |

### Why `no_double_counting` is so tight

The first run against real data showed that 38 pairs of events fell within 60 seconds and 50 km of each other. They were aftershocks in swarms near the Molucca Sea and southern Mindanao: different USGS IDs, different magnitudes, a genuine sequence. A check that warns about real earthquakes on every run is noise. The check now looks only for the signature of a duplicate, the same moment and the same place under two IDs, which is what an ID scheme change or a re-import would produce. The closest real pair in a year of data was 11 seconds and 10 km apart.

## Row-level rejections

Before anything is stored, each row is checked. The reason is stored and counted.

| Reason                     | Meaning                                        |
| -------------------------- | ---------------------------------------------- |
| `coordinates_out_of_range` | Latitude or longitude is not a real coordinate |
| `outside_region`           | Real, but outside the configured region        |
| `magnitude_out_of_range`   | Not between 0 and 10                           |
| `depth_out_of_range`       | Not between -5 and 800 km                      |
| `time_in_future`           | More than 10 minutes ahead of the run clock    |

Rows that cannot be read at all are rejected earlier, while parsing, with their own reasons:

| Source | Reasons                                                                                                               |
| ------ | --------------------------------------------------------------------------------------------------------------------- |
| USGS   | `malformed_feature`, `missing_coordinates`, `missing_magnitude`, `missing_depth`, `missing_time`, `not_an_earthquake` |
| BMKG   | `malformed_row`, `bad_time`, `bad_number`, `bad_depth`                                                                |

## What the agreement figure means

BMKG reports are matched to USGS events within 90 seconds and 150 km, one-to-one, closest first. Only BMKG events older than 12 hours count: a fresh BMKG report can precede the USGS listing, so it is "pending" rather than "missing". A low share does not by itself mean either agency is wrong; it means they disagree, and the unmatched events are listed on the page so a person can look.
