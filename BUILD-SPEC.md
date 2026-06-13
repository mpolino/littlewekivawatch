# LittleWekivaWatch — Build Spec

Self-contained build brief. A fresh Claude Code session can execute this without prior conversation context.

## Goal
Public, mobile-first web page showing the Little Wekiva River level at Mark's property, framed as **depth above the river bottom** (low ≈ <1 ft), with a trend chart and a red banner for tropical-storm / hurricane watches or warnings. Free hosting, no paid domain.

## Established facts (verified — do not re-derive)
- USGS gauge **02234990**, ~1.5 mi downstream of the property.
- Address: **677 Little Wekiva Rd, Altamonte Springs FL 32714**, Spring Oaks subdivision. Mark: show the address; privacy is not a concern.
- Point coords: **28.6716, -81.4131**.
- Bank height **10.3 ft** (channel floor 37.1 → bank top 47.4 ft NAVD88).
- Record crest **Hurricane Ian, 31.09 ft gage, 2022-09-29**; eyewitness ~1 ft below the bank lip (~9.3 ft local depth).
- Today's baseline ≈ **23.41 ft gage = <1 ft actual depth** (Mark's direct observation).
- Other verified peaks (gage height): Irma 2017 = 29.66 · Milton 2024 = 30.08 · 1994 era-record = 30.58 · Fay 2008 = 29.37 · 2019 max (July rain) = 27.23.

## Display metric — depth above river bottom
Live USGS reports an arbitrary-datum gage height. Convert to intuitive local depth with a 2-point empirical fit (today + Ian):

```
local_depth_ft = 0.5 + 1.146 * (gage_height - 23.41)
```
- Anchors: gage 23.41 → 0.5 ft; gage 31.09 (Ian) → 9.3 ft.
- Hero number = current depth, "X.X ft above river bottom." Low ≈ <1 ft.
- Show raw gage height small, for reference.
- Label it an estimate (gauge is downstream; 2-point empirical fit).

## Threshold ladder (local depth → color/state)
| Depth | Gage | State | Color |
|---|---|---|---|
| <1 ft | 23.4 | Normal | green |
| ~6.3 ft | 28.5 | Watch (NWS minor flood) | yellow |
| ~7.7 ft | 29.7 | Elevated (Irma level) | amber |
| ~8.1 ft | 30.0 | Prep | orange |
| ~9.3 ft | 31.1 | Record (Ian level) | deep orange |
| ~10.3 ft | 32.5 | Bank overtop | red |

Show current state + "X.X ft below bank top."

## Data sources (all free, no key, client-side CORS-OK)
1. **River level:** `https://nwis.waterservices.usgs.gov/nwis/iv/?sites=02234990&parameterCd=00065&format=json`
   - Use the `nwis.` host directly — the bare `waterservices.usgs.gov` host 301-redirects.
   - Append `&period=P1D` / `P7D` / `P30D` for the chart ranges.
2. **Storm alerts:** `https://api.weather.gov/alerts/active?point=28.6716,-81.4131`
   - Red banner triggers if any active alert `event` is in {Hurricane Warning, Hurricane Watch, Tropical Storm Warning, Tropical Storm Watch}.
   - Show alert headline + expiry. Hidden when none active.
   - NWS API is free, no key. It requests a User-Agent; the browser sets one automatically.

## Chart
- **Default: rolling 7-day line** (best trend-vs-clutter balance for storm-watching).
- Toggle: 24h / 7d / 30d (USGS `period=P1D/P7D/P30D`).
- Plot local depth (converted), not raw gage height.
- Chart.js via CDN is the easy path; dependency-free inline SVG is the no-deps alternative. Default to Chart.js.

## Page furniture
- Web app manifest + apple-touch tags so "Add to Home Screen" works full-screen like an app.
- Auto-refresh every ~10-15 min; display last-reading timestamp.
- Location note: "USGS gauge 02234990, ~1.5 mi downstream; displayed depth is an estimate."
- Footer: "Data: USGS (provisional) + NWS. Not an official flood forecast. For emergencies see NWS / Seminole County."

## Hosting (free, public) — DECIDED
- Public GitHub repo **`littlewekivawatch`** (already created at https://github.com/mpolino/littlewekivawatch).
- **Cloudflare Pages** connected to the repo → free hostname **`littlewekivawatch.pages.dev`**, auto-deploys on push.
- One manual step: Mark clicks once to authorize Cloudflare ↔ GitHub on first connect.

## Build steps (for the new session)
1. 🟡 Brooklyn (web-artifacts-builder) builds `index.html` + CSS + JS + manifest in this repo.
2. Commit + push to `mpolino/littlewekivawatch`.
3. Connect Cloudflare Pages to the repo (Mark authorizes once), confirm `littlewekivawatch.pages.dev` is live.
4. Verify on phone: live reading renders, chart loads, "Add to Home Screen" works, alert banner logic correct.

## Confirmed decisions
- Hostname: **Cloudflare `littlewekivawatch.pages.dev`** (decided).
- Chart: **Chart.js** (default; switch to SVG only if Mark wants zero deps).
