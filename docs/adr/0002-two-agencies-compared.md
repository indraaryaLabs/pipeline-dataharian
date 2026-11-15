# ADR 0002: Read two agencies and compare them instead of picking one

- Status: accepted
- Date: 2026-11-16

## Context

USGS publishes a global catalogue with a public API and stable identifiers. BMKG is the Indonesian agency, publishes its own magnitudes and locations, and offers a short recent list. They report the same earthquakes differently and at different times. Choosing one hides that; merging them blindly double counts.

## Decision

Treat USGS as the catalogue of record, because it has the history, the incremental API and revision tracking. Read BMKG's recent magnitude 5+ list as a second opinion, store it separately, and reconcile the two. Publish the agreement as a result, with the unmatched events listed.

## Consequences

- The page can say how well the agencies agree and show the typical differences in magnitude, position and time.
- Disagreements are visible instead of being averaged away.
- The comparison only covers what BMKG lists: magnitude 5 and above, and a short window. The page says so.
- Losing BMKG does not stop the page; the run is marked `partial` and the comparison is marked as not current.
- Losing USGS does stop new data; the run is `failed` and the last good data stays published.
