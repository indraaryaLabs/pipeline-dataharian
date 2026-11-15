# ADR 0004: Match events by time and distance, one-to-one

- Status: accepted
- Date: 2026-11-16

## Context

The two agencies share no identifier. "The same earthquake" has to be decided from origin time and position, and wrong matches would make the agreement figure meaningless.

## Decision

A BMKG report and a USGS event match when their origin times are within 90 seconds and their epicentres within 150 km (haversine). Candidates are scored by normalised time gap plus normalised distance and assigned closest first, so each event is used at most once. BMKG reports younger than 12 hours are counted as pending, not as unmatched, because USGS often lists an event after BMKG does.

## Consequences

- The thresholds were chosen from agency location and timing scatter for regional events, and are constants with tests, not tuned per run.
- In a swarm, two nearby events within the windows could be paired wrongly. One-to-one assignment limits the damage but does not remove it.
- The agreement share is only computed over events old enough to be fair, and the check skips when fewer than five qualify.
