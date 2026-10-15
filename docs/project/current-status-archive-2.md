# Current status — archive, second volume: dated records from 12 October 2026

This file is **a continuation of [`current-status.md`](current-status.md)'s dated acceptance record**, between it and [`current-status-archive.md`](current-status-archive.md). That first archive holds the records from 7 October back to 10 September 2026 and is full, so the 12 October 2026 record moved here, unchanged and in the same order, on 15 October 2026 — only because `current-status.md` was nearing the size at which it can no longer be loaded whole. It is the same single ledger, not a parallel record: `current-status.md` stays the only entry point, holds the open installed-iPhone checklist, and is the only place new evidence is recorded. Read the dated record newest first: `current-status.md`, then this file, then `current-status-archive.md`.

Links in the moved record are relative to `docs/project/`, as they were, and still resolve. Records moved here later go above the older ones, keeping that order.

---

### Installed-iPhone observations of text-enlargement mechanisms (item 145, reported 12 October 2026)

**Device and build.** The installed Home Screen ACN on an iPhone 13, iOS 26.6.1, in German, on `0.4.69` / build `4164bcc`, stationary and in portrait, as reported. These are the five checks proposed by item 145's [support report](../design/route-riding-map-space/text-enlargement-support.md#stationary-check-on-the-installed-iphone). **They are mechanism observations and defect reports, not acceptance:** not of E2, not of any support policy, and not of item 145's closure. `677a03e` remains the broad phone-accepted build.

**The rider's report, check by check:**

1. **Larger Text**, its slider fully to the right: **no visible change**, which the supplied Routes screenshots support. A full close and reopen was confirmed.
2. **Control Centre's Text Size**, which offered the scopes "Nur Web" and "Alle Apps". With "Nur Web" selected, 3/11 was compared with 11/11 after a full close and reopen: **Routes, Planning and Status showed no visible enlargement.** The slider positions are recorded as reported, not as percentages, and "Nur Web" is not assumed to apply to ACN alone.
3. **Display Zoom:** a **visible enlargement and reflow**.
   - In Profile, `Gesamt` extended beyond its button and `Anstieg` was fully visible only after horizontal scrolling; both responded to taps. Which element scrolled, and which overflowed, was not measured on the phone.
   - In the supplied views, the `Karte` / `Profil` switcher stayed visible, and the route-riding and free-roam maps kept the rider and their four controls.
   - In the navigation, `Einstellungen` wrapped, its final "n" on a line of its own.
4. **Safari's Page Zoom setting at 150%**, with ACN confirmed as the installed app launched from the Home Screen and Display Zoom restored: **the setting reaches this installed configuration.**
   - The Profile selector overflow recurred.
   - `Display an` moved below the status text.
   - With a turn instruction displayed at 0 m, the route-riding map became a **narrow strip**: the upper controls partly clipped, the rider and the lower controls not visible. No failed End was shown, and the `Karte` / `Profil` switcher stayed visible.
   - Free roam kept substantially more map.
5. **Pinch zoom**, reported without screenshots: the whole page magnified and its edges and the navigation left the visible area; it could be panned, the buttons stayed responsive, pinching back restored it, and closing and reopening reset it.

**Closing and reopening:** a full close and reopen is confirmed for checks 1, 2 and 5. Check 4 confirms a launch from the Home Screen. No cold reopen is claimed for checks 3 and 4.

**What this establishes, for this device, iOS version, build, language and these settings only:**

- the two text-size controls tested produced no visible enlargement;
- Display Zoom and Safari's Page Zoom setting visibly change the installed app;
- pinch zoom works and can be reversed. It leaves the layout unchanged, and that does not keep the navigation inside the magnified area.

**Not established:** VoiceOver; Larger Accessibility Sizes; Control Centre's "Alle Apps" scope; English; any other device or iOS version; the CSS viewport that Display Zoom or Page Zoom produces; any geometry measured on the phone.

**Investigated the same day, with automated proxies only** ([findings](../design/route-riding-map-space/device-zoom-findings.md)). The investigation diagnosed the selector overflow, the map strip and the navigation wrap. It also found the refused Screen on retry partly off screen at ordinary German text, an automated-only finding recorded under [item 145](backlog.md#item-145). Its proposals await the rider's review, and nothing is implemented. On 13 October 2026 the rider revised item 145's direction, and a proposal for Regular and Larger text modes followed, documentation only ([proposal](../design/route-riding-map-space/text-modes-proposal.md)); P1 and P3 are paused.
