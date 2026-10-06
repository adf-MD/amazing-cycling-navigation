# History index

The complete shipped implementation record, split into bounded files. See [`../README.md`](../README.md) for the full documentation map and the stable item-number convention.

## Completed backlog items

Fifteen range files, each covering a contiguous range of item numbers in ascending order, plus item 124's own two files and item 122's own file (pending/monitored/ledger items originally interleaved among these have moved to [`../backlog.md`](../backlog.md) or [`../current-status.md`](../current-status.md) instead — see each file's own intro for exactly which numbers it holds):

- [`items-06-29.md`](items-06-29.md)
- [`items-30-38.md`](items-30-38.md)
- [`items-39-48.md`](items-39-48.md)
- [`items-49-55.md`](items-49-55.md) — also carries the shared items-55–58 design-reference caveat (see that file's own note)
- [`items-56-68.md`](items-56-68.md) — also carries the shared items-55–58 design-reference caveat (see that file's own note)
- [`items-69-80.md`](items-69-80.md)
- [`items-81-88.md`](items-81-88.md)
- [`items-89-94.md`](items-89-94.md)
- [`items-95-99.md`](items-95-99.md)
- [`items-100-103.md`](items-100-103.md) — opens the 100– range and closes at item 103; holds items 100, 101 and 102, with 103 reserved for when it is completed
- [`items-104-109.md`](items-104-109.md) — continues the 100– range and closes at item 109; holds items 104, 105, 106, 107, 108 and 109, with 104 having been implemented ahead of items 100–103 (see each file's own intro)
- [`items-110-113.md`](items-110-113.md) — continues the 100– range; holds items 110, 111, 112 and 113, all completed ahead of items 102 and 103
- [`items-114-117.md`](items-114-117.md) — continues the 100– range; holds items 114, 115, 116 and 117, with item 114 completed last (`0.4.45`) and filed first
- [`items-118-131.md`](items-118-131.md) — continues the 100– range and closes at item 131; holds items 118, 119, 121 and 123, completed ahead of items 102, 103 and 120, item 128, completed after item 102, and item 131, completed ahead of item 124's remaining slices, with items 120, 125–127, 129 and 130 reserved for when they are completed, and pointers for items 122 and 124
- [`item-124.md`](item-124.md) and [`item-124-continued.md`](item-124-continued.md) — item 124 alone, closed on 4 October 2026: its record, about 225,000 characters, exceeds the soft cap on its own, so it keeps the two-part split it had in `backlog.md`, with a pointer in `items-118-131.md`
- [`item-122.md`](item-122.md) — item 122 alone, completed in `0.4.64` on 5 October 2026 and accepted on the installed iPhone the same day: added to `items-118-131.md`, which is closed at item 131, it would take that file past the soft cap, so it has its own file, with a pointer in `items-118-131.md`
- [`items-132-NN.md`](items-132-NN.md) — continues the 100– range; holds item 132 and item 133, a CI-only change completed before it and moved here when item 132 opened the file, item 140, completed in two slices (`0.4.65` and `0.4.66`) and accepted on the installed iPhone on 6 October 2026, and item 141, completed in `0.4.63` and accepted on the installed iPhone

When a new item is completed, append it to whichever of these files its number naturally continues (in ascending numeric order). If that would push a file past roughly 150,000 characters, start a new range file (e.g. `items-74-NN.md`) instead of letting an existing file grow unbounded, and add it to the list above. An item whose record alone would exceed that cap gets its own `item-N.md` file, split further at an existing boundary if needed (as item 124's is), with a short pointer in its natural range file.

## Pre-backlog narrative history

Two further files hold historical narrative that predates, and is referenced by, several numbered backlog items — this is not itself part of the numbered backlog, but is real, substantive shipped-implementation history that used to live inline in root `CLAUDE.md`:

- [`delivery-milestones.md`](delivery-milestones.md) — the full Milestone 1–4 delivery narrative (originally root `CLAUDE.md`'s "Delivery order" section), including Milestone 3's six-slice and Milestone 4's fourteen-slice narratives that several completed backlog items reference by name.
- [`interface-accessibility-migration.md`](interface-accessibility-migration.md) — the full seven-slice UI visual-migration narrative (originally root `CLAUDE.md`'s "Interface and accessibility" section), including a real CI-driven MapLibre gesture-bug fix discovered during the fifth slice.

## Reading these files

**These are historical accounts of what shipped and why, at the time each was recorded.** Where later work has changed or superseded a detail described in an older entry, current source and tests are authoritative — but the rationale, rejected alternatives, and real regressions documented in these files remain valuable and are preserved rather than edited to match the present state. See root [`CLAUDE.md`](../../../CLAUDE.md) for the required reading order before implementing anything.
