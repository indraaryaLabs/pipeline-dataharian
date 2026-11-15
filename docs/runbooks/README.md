# Runbooks

Written for whoever sees a red Pipeline run or a page that says the data is old. Each one answers: what is wrong, how do I confirm it, how do I fix it, and how do I know it is fixed.

| Runbook                                   | When                                                               |
| ----------------------------------------- | ------------------------------------------------------------------ |
| [Pipeline failed](pipeline-failed.md)     | The Pipeline workflow is red, or the page says the data is stale   |
| [Reset the warehouse](reset-warehouse.md) | The warehouse is corrupt, or a large clean-up upstream was refused |
| [A source changed](source-changed.md)     | Many rejected rows, or a source answers but the numbers look wrong |

Habit, in order: read the run summary first, since the pipeline writes what it did and why it stopped; confirm the upstream from a second place; fix the cause rather than re-running until it passes.
