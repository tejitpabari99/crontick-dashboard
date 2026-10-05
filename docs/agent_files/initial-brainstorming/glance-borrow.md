---
status: draft
summary: Cheap, generic Glance UX patterns worth borrowing in v1 (visited-link colour, show-more, relative time, truncation) plus visited-link mechanism notes; ranked.
date: 2026-10-05
---

# Glance: borrowable generic patterns

Source: `glanceapp/glance` shallow clone (paths below relative to repo root; `static/` = `internal/glance/static/`). Only cross-cutting UX; data widgets ignored.

## Ranked table

| # | Pattern | What | Glance evidence | Cost | Fit | Lands in | Rec |
|---|---------|------|-----------------|------|-----|----------|-----|
| 1 | Visited-link colour | Unvisited links accent colour, visited fall back to muted base text | `static/css/utils.css:495` `.color-primary-if-not-visited:not(:visited){color:var(--color-primary)}`; base `a{color:inherit}` `static/css/site.css:119`; used on all list titles (e.g. `templates/rss-list.html:7`) | S (3 CSS lines in `CardLink`) | High. Pure CSS, no state, matches owner's observation | 03 `CardLink` (04 inherits) | **v1** |
| 2 | Visited ↗ indicator | Trailing ↗ glyph, accent if unvisited, base if visited; for truncated text uses `::before` + `direction:rtl` so ellipsis sits at the start | `utils.css:241-258` `.visited-indicator` | S | High; we already plan ↗ on hover (03 PRD L41). Make it always-on but tinted by visited | 03 `CardLink` | **v1** (optional: always-visible vs hover-only is a taste call) |
| 3 | Show more / collapse-after-N | Lists render first N items, rest hidden behind "Show more/less" toggle, sticky when expanded, 20ms staggered reveal | `static/js/page.js:343` `attachExpandToggleButton`, `:387` `setupCollapsibleLists` (reads `data-collapse-after`); CSS `utils.css:279-345`; config `collapse-after` default 5 (`docs/configuration.md:785`) | S-M (list + table; we have scroll + fullscreen already) | Medium-high. Anti-crowding. But PRD 04 says compact caps + fullscreen-for-all and bodies scroll (03 L38). Toggle in place would change card height/body-scroll rule | 04 list/table (compact cap: add "+N more" row that opens fullscreen, not inline expand); optional 01 `collapseAfter` hint | **v1 as "+N more → fullscreen"**; inline expand later |
| 4 | Relative timestamps, auto-updating | Server emits unix ts attr; client rewrites text "2h ago" every 60 s, pauses when tab hidden, refreshes on `visibilitychange` | `page.js:209-240` `setupDynamicRelativeTime`, `:84` `updateRelativeTimeForElements`; Go helper `internal/glance/templates.go:89` `dynamicRelativeTimeAttrs` | S (one `<RelTime ts>` component + 60 s tick) | High. Agents write ISO dates; "updated 2h ago" in card title bar makes staleness obvious (complements D19). Table cells typed as date could opt in | 03 title bar (`updatedAt`), 04 table date cols, 01 optional `type:"date"` col hint | **v1** (title bar `updatedAt`); date columns later |
| 5 | Truncation + tooltip | `.text-truncate` single-line ellipsis; `.text-truncate-2/3-lines` via `-webkit-line-clamp`; native `title` for full text | `utils.css:219-239`; `title=` e.g. `templates/monitor-compact.html:27` | S | High; already in 04 table spec. Add 2-line clamp for list `text`/`subtitle` | 04 shared styles | **v1** (already mostly planned) |
| 6 | Hide-header option | Per-widget `hide-header` removes title bar | `templates/widget-base.html:3`; `configuration.md:733` | S | Medium: our frame carries Done/hide/fullscreen actions so header cannot vanish; could hide title text only for kpi tiles | 01 optional `hideTitle`, 03 frame | later |
| 7 | Widget title link | `title-url` makes widget header a link | `widget-base.html:5-6`; `configuration.md:730` | S | Medium. Cards already link per row; a card-level `link` (e.g. "open in Outlook") is cheap and useful. Contract currently only row/item link | 01 card-level `link`, 03 title uses `CardLink` | later (cheap if 01 is still open) |
| 8 | Same-tab vs new-tab link | Per-link `same-tab` flag (monitor widget); default new tab with `rel=noreferrer` | `configuration.md:2022`; all templates `target="_blank" rel="noreferrer"` | S | Low; locked to new tab + noopener (03 L41). `noreferrer` also hides our localhost URL from targets: consider adding | 03 `CardLink` | no (adopt `noreferrer` only) |
| 9 | Keyboard shortcut for search | Press `S` focuses search unless in an input; Esc blurs | `page.js:196-203`; docs `configuration.md:1216-1219` | S | High: we have global search (D24). Use `/` and `S`? pick one; Esc clears | 03 header search | **v1** |
| 10 | Page enter motion / lazy images | Content fade-in after ready; `img[loading=lazy]` fade-in on load, cached skip | `static/css/site.css:10-16,161-190`; `page.js:312-340` `setupLazyImages` | S | Medium. PRD already has mount fade; media already `loading=lazy`. Image fade-in is a nicety | 04 media | later |
| 11 | Custom CSS file | `theme.custom-css-file`, plus per-widget `css-class` | `configuration.md:462,489,507,754` | S (server serves one file from data dir, UI links it) | Medium: powers owner tweaks without PRs; no security issue single-user local. Extends tokens story | 02 static serve, 03 `<link>`, 06 docs | later (cheap, after tokens settle) |
| 12 | Theme presets / picker | Named presets selectable in UI, persisted server-side | `page.js:671-739` `changeTheme`; `configuration.md:513`; `docs/themes.md` | M | Already in futures.md and PRD 03 DEFERRED | 03 | no (deferred) |
| 13 | Error/notice icon on header | Header icon with tooltip when data loaded but last refresh failed ("showing cached") | `widget-base.html:26-30`; `.notice-icon-major/minor` | S | **Conflicts D19**: we never show stale data; Broken replaces body. Reuse only the *minor notice* idea for non-fatal agent `notice` text | 01 optional `notice`, 03 frame | no (D19) |
| 14 | Icons on links | `icon:` prefixes (`si:`, `di:`, `mdi:`) from jsdelivr CDN; `auto-invert` | `configuration.md:189-215` | M | **Conflicts** 03 "no external fonts/scripts" and no-fetch stance. Agent-supplied `icon` emoji/char string would be S and safe | 01 optional `icon` (emoji only), 04 | no (CDN); emoji later |
| 15 | Popover tooltips | Rich hover popovers (`data-popover-*`) | `static/js/popover.js`; e.g. `templates/dns-stats.html:20,44` | M | Low; native `title` + fullscreen suffice | 03 | no |
| 16 | Mobile bottom nav / collapse | <1190px columns stack; bottom nav; PWA standalone tweaks | `static/css/mobile.css:1,161,199`; `manifest.json` | M-L | Mobile is a v1 cut (D31) | n/a | no (deferred) |
| 17 | Column size small/full | Page columns `small`/`full` widths (narrow-wide-narrow) | page config; `.page-column-small` `mobile.css:6-10` | n/a | Already borrowed (D25) | 03 | done |
| 18 | Density / spacing tokens | Single `--widget-gap` (23px), `--widget-content-padding` CSS vars, no density toggle | `static/css/main.css:20-23` | S | Low: expose as tokens only; no toggle | 03 tokens | later |
| 19 | Per-widget cache / refresh | `cache: 30s..1d` per widget; full-page reload on refresh; no live push | `configuration.md:740-752` | n/a | Data-fetch concern; ours is file watch + poll (D29) | n/a | no |
| 20 | Loading skeleton | Only a spinner (`page-loading-container`, 150 ms delay before showing), no skeletons | `site.css:161-190` | S | Delay-then-spinner is the nice detail: avoid spinner flash on fast loads | 03 | v1 (tiny) |

Not found in Glance (so nothing to borrow): row/list-item dimming on visit, dynamic colour percentages in generic UI (only markets widget), per-item read-state storage, hide-on-device options exist only as `hide-desktop-navigation`/mobile CSS.

## Visited-link mechanism (answer to owner's observation)

Pure CSS, no JS, no localStorage:

- Global reset `a { color: inherit; text-decoration: none }` (`site.css:119`). So a link is the surrounding grey/base text colour by default.
- Opt-in class `color-primary-if-not-visited` = `:not(:visited) { color: var(--color-primary) }` (`utils.css:495`). Unvisited: accent. Visited: rule stops matching, falls back to inherited base colour, i.e. "turns grey after clicking".
- Arrow variant `.visited-indicator` (`utils.css:241-258`): `::after` (or `::before` when `.text-truncate`, with `direction:rtl`) renders ↗; `:not(:visited)::before/::after` tints it accent, visited keeps base colour.
- Browser privacy limits on `:visited` (spec "privacy-related restrictions"): only colour-type properties apply (`color`, `background-color`, `border-*-color`, `outline-color`, `text-decoration-color`, `fill`, `stroke`, `column-rule-color`); alpha is ignored; `getComputedStyle` and `:has()`/sibling/child combinators from a visited link lie or don't match, so JS cannot read it and a parent row cannot be styled via `:has(a:visited)`. Pseudo-elements of the link can be coloured (Glance relies on this). Chrome partitions visited-link history by (link URL, top-level site, frame origin); fine for us (top-level, same origin). History cleared / private window / stable repeated URLs (e.g. a constant "open PRs" link) stay visited forever or never.
- Applies only to history-tracked schemes: `http`/`https`. `mailto:` and `ms-outlook:` links are never reported visited, so they always look unvisited.

### Recommendation for us

| Item | Decision |
|------|----------|
| Link level | `CardLink` (03) sets `color: var(--primary)` and `a:visited { color: var(--text-muted) }`; ↗ tinted the same way. Declare `--link-visited` token so both themes meet AA contrast when muted. 04 gets it free (no hand-rolled anchors, per 03/04 PRDs) |
| Table row / list item dim | Not via CSS: row is a stretched link in first cell; `:has(a:visited)` is blocked. Style only the link text (first cell / item text) and ↗. Do not dim whole row in v1 |
| If row dim is later wanted | JS: on click add `href` hash (or `cardId+rowKey+updatedAt`) to localStorage `seenLinks` (try/catch, like `seen[id]`, 03 L40), render a `data-visited` attr. Resets naturally when card `updatedAt` changes, fixing the stable-URL problem. Cost M. Defer until real use shows need |
| Caveats to note in 03 PRD | `ms-outlook:`/`mailto:` never grey; stable URLs stay grey; add `noreferrer` to rel (Glance does) |
| Locked-decision conflicts | None for CSS-only. A localStorage row dim is UI-local state, consistent with `seen[id]`; no 02 change |

## Top v1 picks
1. Visited-link colour + ↗ tint in `CardLink` (S, 03).
2. "updatedAt ago" relative time, 60 s tick, pause when hidden (S, 03).
3. Compact "+N more" opening fullscreen for list/table (S, 04); inline Show more later.
4. Search shortcut + Esc (S, 03).
5. 2-line clamp + `title` tooltips; spinner shown only after 150 ms (S).
