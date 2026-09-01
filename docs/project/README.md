# Project documentation index

This directory holds the complete project record that used to live entirely inside the root [`CLAUDE.md`](../../CLAUDE.md). It was split out because the monolithic file had grown past Claude's automatic project-memory allowance (150,000 characters) to roughly 721,000 characters — large enough that later content, including the full contract for the next backlog item, was not reliably available even though the file was loaded as project memory.

Root `CLAUDE.md` remains the single always-loaded entry point: durable product and engineering rules, a short current-state summary, a concise pending/monitored queue index, and the reading protocol below. Everything else lives here, in bounded files an implementer reads deliberately for the task at hand.

## Where everything lives

- **[`backlog.md`](backlog.md)** — full, byte-preserved specifications for every approved-but-not-yet-implemented backlog item. This is where the next item's complete contract lives; read it in full before starting work on it.
- **[`current-status.md`](current-status.md)** — the manual acceptance ledger (what has actually been verified on a real device) plus monitored reliability observations that are neither approved future work nor fully resolved.
- **[`history/`](history/README.md)** — the complete shipped implementation record: every completed backlog item's full text, plus the Delivery-order milestone narrative and the Interface-and-accessibility visual-migration narrative that predate/parallel the numbered backlog. See `history/README.md` for how this is split across files.
- **[`release-readiness-audit.md`](release-readiness-audit.md)** — item 86's evidence-based security/privacy/reliability/maintainability audit of the `0.3.73` baseline: a risk register, verified strengths, a `0.3.x`/`0.4.0`/`1.0.0` release-decision model, and the rationale behind backlog items 87–92.

## The stable item-number convention

Every backlog item (currently numbered 6–93) keeps its number for as long as this project exists, **regardless of which file its text currently lives in**. An item's number is a permanent identifier; only its physical location moves as items are completed or as history files are split further. Never renumber an item, and never reuse a retired number for something unrelated.

## Adding new work

- **A newly completed item**: move its full text (or write it fresh, if newly implemented) into the appropriate `history/items-*.md` file in ascending numeric order. If the item's own natural range file would exceed roughly 150,000 characters once added, start a new range file instead (see `history/README.md`) — do not let a single history file grow unbounded, and do not compress or shorten existing entries to make room.
- **A newly approved future item**: add its full specification to `backlog.md`, in numeric order, with a stable `<a id="item-N"></a>` anchor immediately before its heading (leave a blank line on both sides of the anchor tag — see the note on this below).
- **A newly confirmed piece of manual acceptance evidence**: update the relevant entry in `current-status.md` directly; do not create a parallel acceptance record elsewhere.
- Do not let root `CLAUDE.md` gradually reabsorb this material. If you find yourself pasting a multi-paragraph implementation narrative back into the root file "just this once," that is the same mistake that made the original file unbounded — put it here instead, and add a short pointer from root if genuinely needed.

## A note on anchors

Every item entry across `backlog.md`, `current-status.md`, and the `history/items-*.md` files uses an explicit `<a id="item-N"></a>` tag immediately before its `## Item N — Title` heading, rather than relying on a Markdown renderer's auto-generated heading slug (which would break if the title's wording is ever edited). CommonMark's raw-HTML-block rule means the anchor tag **must** have a blank line on both sides of it — otherwise the following heading line gets absorbed into the same raw HTML block as literal text and silently stops rendering as a heading at all. This is not caught by Prettier, since it treats raw HTML as an opaque pass-through. If you add a new anchor, verify the blank lines are present.

## Reading comments in source and test files

Source and test-file comments across this codebase frequently cite "CLAUDE.md" (e.g. `// CLAUDE.md item 25`, `per CLAUDE.md's surface-data priority`), written before this restructuring. Read these as referring to **this project's specification as a whole** — root `CLAUDE.md` plus this linked documentation — not literally to content still physically present in the `CLAUDE.md` file today. The large majority cite a stable item number and remain precisely valid by that reading, since item numbers never change. A small number cite named, non-numbered content (a specific rule or precedent) that has since moved into one of the files here; those comments are not updated by this restructuring — touching source and test files was out of scope for it — but the content they refer to is still findable via this index and the item-number convention above.

## Archaeology

The complete history of the original, unsplit `CLAUDE.md` — including every revision before this restructuring — remains available through ordinary git history: `git log -p -- CLAUDE.md` up to and including commit `98501eb33a57690c25e5bd8fe0104024d1cede51`, the last commit where the file held everything in one place.
