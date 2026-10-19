# Current status — archive, second volume: dated records from 12 to 16 October 2026

This file is **a continuation of [`current-status.md`](current-status.md)'s dated acceptance record**, between it and [`current-status-archive.md`](current-status-archive.md). That first archive holds the records from 7 October back to 10 September 2026 and is full, so the 12 October 2026 record moved here, unchanged and in the same order, on 15 October 2026, the 15 October record and the two 14 October 2026 records on 16 October 2026, and the 16 October 2026 record on 19 October 2026 — only because `current-status.md` was nearing the size at which it can no longer be loaded whole. It is the same single ledger, not a parallel record: `current-status.md` stays the only entry point, holds the open installed-iPhone checklist, and is the only place new evidence is recorded. Read the dated record newest first: `current-status.md`, then this file, then `current-status-archive.md`.

Links in the moved records are relative to `docs/project/`, as they were, and still resolve, and a "Session" named in them is a session of `current-status.md`'s checklist. Records moved here later go above the older ones, keeping that order.

---

### Installed-iPhone VoiceOver check of the concise GPX notice (`0.4.72`, build `669143d`, reported 16 October 2026)

**Device and build.** An iPhone 13 on iOS 26.6.1, the installed Home Screen PWA, with `0.4.72` / `669143d` confirmed as the current version and build. `669143d` changed CI and documentation only, so its application is `7e6246a`'s.

**What the rider reported** of the concise GPX notice, "No turn guidance available." / "Keine Abbiegehinweise verfügbar." (items 97 and 145), with VoiceOver on:

- it is announced once;
- it is completely readable when selected;
- it produces no unwanted repetition;
- it causes no unexpected focus movement.

**What this accepts:** the notice's checked VoiceOver behaviour on `0.4.72` / `669143d`, in that device context. The language used was not reported, so no language matrix is inferred, and nothing here accepts screen-reader behaviour of the rest of the riding screen or of the app. The visual and functional checks reported on 15 October 2026 stay accepted, and no repeat phone check is needed.

**Unchanged by it:** item 145 and its four rider-visibility cases stay open, and `677a03e` remains the broad phone-accepted build. Further manual VoiceOver checks are not requested ([how to read this ledger](current-status.md#how-to-read-this-ledger)).

### Installed-iPhone check of `0.4.72` (build `7e6246a`, item 145's short-map slice, reported 15 October 2026)

**Device and build.** An iPhone 13 on iOS 26.6.1, the installed Home Screen PWA, on `0.4.72` / `7e6246a`, in English and German, stationary.

**Every requested check passed** ([slice](backlog.md#item-145-short-map-slice)):

- the concise GPX notice;
- ordinary route riding and free roam, under standard and enlarged Display Zoom;
- Map/Profile switching and the selector's fit;
- the attribution, the map controls and Screen on;
- pan, North-up and zoom.

**Two observations, recorded as explained behaviour:**

- **In German, the climb cue rises slightly when `Folgemodus pausiert.` appears.** That is consistent with the space already reserved above the paused-Follow toast.
- **Under enlarged Display Zoom, the English status card wraps `Screen on` below its text.**
  - That leaves a shorter map, so the cue takes its upper placement.
  - German keeps enough map height for the lower right.
  - The status card and its wrapping rules were unchanged by this release.

**The climb cue.** The screenshots are positive native evidence for the cue states they show. They are not acceptance of its behaviour in failure states, or a full riding field check; Session 2 keeps its ride checks.

**Not verified:**

- VoiceOver, which was not tested;
- a refused Screen on and a failed End, which were not exercised. Item 145 and its four rider-visibility cases stay open.

**Unchanged by it:** the selector's acceptance stays with `0.4.70` / `5209fe7`, and `677a03e` remains the broad phone-accepted build.

### Installed-iPhone check of `0.4.71` (build `72f1084`, item 145's refused Screen on layout, reported 14 October 2026)

**Device and build.** An iPhone 13 on iOS 26.6.1, with `0.4.71` / `72f1084` confirmed as the current version and build, in German.

**Every requested check passed:**

- `Display an` off and on, with the familiar status card;
- the remaining ascent, `Karte` / `Profil` switching and the accepted selector;
- the ordinary presentation under enlarged Display Zoom.

**What this verifies:** the ordinary behaviour and presentation around candidate B ([record](backlog.md#item-145-refused-screen-on-slice)).

**What it does not verify:** physical acceptance of the refused state itself. No refusal has been observed on that device, and no reliable way to produce one through its ordinary interface is established, so the refused state's native verification stays outstanding.

**Unchanged by it:**

- the selector's acceptance stays with `0.4.70` / `5209fe7`;
- `677a03e` remains the broad phone-accepted build;
- item 145's four rider-visibility cases stay unresolved and unaccepted.

### Installed-iPhone acceptance of `0.4.70` (build `5209fe7`, item 145's selector, reported 14 October 2026)

**Device and build.** An iPhone 13 on iOS 26.6.1, the installed Home Screen PWA, with version `0.4.70` and build `5209fe7` read from Status.

**What was accepted:** item 145's narrow correction to the active Profile selector ([record](backlog.md#item-145-selector-slice)), its 4 px inline padding. Every requested check passed:

- the labels fit inside their buttons, in one row;
- every button works;
- nothing scrolls sideways;
- the Map/Profile switcher stays visible;
- no newly introduced scrolling.

The German selector was checked under both ordinary and enlarged Display Zoom.

**Not inferred from it:** VoiceOver, physical Android, 150% Page Zoom, or any layout other than this selector's. **Item 145 stays open.** `677a03e` remains the broad phone-accepted build, with `5209fe7` accepted for this selector only.

**A design observation, not a regression.** With screenshots, the rider asked about apparently increased vertical spacing. `5209fe7` changed only the selector buttons' inline padding, and the screenshots are consistent with Display Zoom magnifying the existing spacing. It is recorded as an observation for design review, not as a confirmed defect or a request to compact the interface.

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
