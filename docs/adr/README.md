# Architecture decision records

| Record                                         | Decision                                                      |
| ---------------------------------------------- | ------------------------------------------------------------- |
| [0001](0001-sqlite-on-a-data-branch.md)        | Keep the warehouse as a SQLite file on a single-commit branch |
| [0002](0002-two-agencies-compared.md)          | Read two agencies and compare them instead of picking one     |
| [0003](0003-refuse-implausible-refreshes.md)   | Refuse a refresh that would wipe or empty the catalogue       |
| [0004](0004-matching-rules.md)                 | Match events by time and distance, one-to-one                 |
| [0005](0005-static-page-reads-one-document.md) | A static page that reads one document and always shows state  |
