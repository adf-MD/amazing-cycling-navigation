# History index

The complete shipped implementation record, split into bounded files. See [`../README.md`](../README.md) for the full documentation map and the stable item-number convention.

## Completed backlog items

Six files, each covering a contiguous range of item numbers in ascending order (pending/monitored/ledger items originally interleaved among these have moved to [`../backlog.md`](../backlog.md) or [`../current-status.md`](../current-status.md) instead — see each file's own intro for exactly which numbers it holds):

- [`items-06-29.md`](items-06-29.md)
- [`items-30-38.md`](items-30-38.md)
- [`items-39-48.md`](items-39-48.md)
- [`items-49-55.md`](items-49-55.md) — also carries the shared items-55–58 design-reference caveat (see that file's own note)
- [`items-56-68.md`](items-56-68.md) — also carries the shared items-55–58 design-reference caveat (see that file's own note)
- [`items-69-80.md`](items-69-80.md)
- [`items-81-NN.md`](items-81-NN.md)

When a new item is completed, append it to whichever of these files its number naturally continues (in ascending numeric order). If that would push a file past roughly 150,000 characters, start a new range file (e.g. `items-74-NN.md`) instead of letting an existing file grow unbounded, and add it to the list above.

## Pre-backlog narrative history

Two further files hold historical narrative that predates, and is referenced by, several numbered backlog items — this is not itself part of the numbered backlog, but is real, substantive shipped-implementation history that used to live inline in root `CLAUDE.md`:

- [`delivery-milestones.md`](delivery-milestones.md) — the full Milestone 1–4 delivery narrative (originally root `CLAUDE.md`'s "Delivery order" section), including Milestone 3's six-slice and Milestone 4's fourteen-slice narratives that several completed backlog items reference by name.
- [`interface-accessibility-migration.md`](interface-accessibility-migration.md) — the full seven-slice UI visual-migration narrative (originally root `CLAUDE.md`'s "Interface and accessibility" section), including a real CI-driven MapLibre gesture-bug fix discovered during the fifth slice.

## Reading these files

**These are historical accounts of what shipped and why, at the time each was recorded.** Where later work has changed or superseded a detail described in an older entry, current source and tests are authoritative — but the rationale, rejected alternatives, and real regressions documented in these files remain valuable and are preserved rather than edited to match the present state. See root [`CLAUDE.md`](../../../CLAUDE.md) for the required reading order before implementing anything.
