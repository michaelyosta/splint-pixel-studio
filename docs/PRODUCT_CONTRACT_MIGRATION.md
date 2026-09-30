# Product contract migration

Status: CANONICAL
Authority: Stable product IA and intentional contract replacements.

Navigation: [INDEX.md](INDEX.md) · Current state: [CURRENT_STATE.md](CURRENT_STATE.md)

| Old contract | New contract |
| --- | --- |
| Home tab | Removed; Catalog is the default surface. |
| Feed / Community tab | Removed from primary IA. |
| Five-tab bottom navigation | Exactly three tabs: Catalog, Create, Profile. |
| Gallery primary destination | Profile collection and owner-created shelf. |
| Store destination | Marketplace-ready premium surface inside Catalog. |
| Achievements screen | Removed from the product surface. |
| XP / level / streak profile | Content showcase profile with artwork-based metrics. |
| Manual Draw primary Create option | Removed from primary Create UX. |
| Creator import | Primary Create path with a recommended preview first. |
| Completion rewards / directed progression | Finished work joins Profile; continue through Profile or Catalog. |

Test changes must cite one of these intentional contract replacements. Painting, persistence, upload, auth, entitlement, storage, tiled rendering, and payment fail-closed behavior are unchanged contracts.

## Create collections assertion

OLD CONTRACT

Primary Create CTA `Мои коллекции`.

→ NEW CONTRACT

Secondary owner action `Управлять коллекциями` below the import-first CTA.

→ WHY INTENTIONAL

Collections are no longer a competing primary Create destination; image import remains the single primary action while existing owner management stays available.

→ WHERE NEW BEHAVIOR IS COVERED

`e2e/creator.spec.js` — `Create hub keeps free creator paths without commercial promises`; owner collection/profile management remains covered by the creator collections and guided Profile journeys.

## Completion action assertion

OLD CONTRACT

Completion overlay exposed `Опубликовать в ленту` as a completion action.

→ NEW CONTRACT

Completion overlay exposes `Поделиться`, `Сохранить результат`, the recommended `Открыть в профиле` choice, `Выбрать следующую`, and `К каталогу`; it explicitly has no `Опубликовать в ленту` CTA.

→ WHY INTENTIONAL

Feed / Community was removed from primary IA. Completion now hands finished work to the owner's Profile collection; owner publication remains a Profile management action, while Catalog remains the next-browse destination. This is an intentional contract migration, not a missing control.

→ WHERE NEW BEHAVIOR IS COVERED

`e2e/creator.spec.js` — `9. Completion flow: 100% → overlay → Escape → buttons` asserts Share, Save, the recommended `open_profile` action, `browse_catalog`, Catalog, and absence of the old publish/feed CTA. `e2e/tiled-completion.spec.js` independently covers `open_profile` and absence of publish/progression metadata on the same completion overlay. `e2e/guided-path.spec.js` — `completion hands the finished work to profile or catalog without progression rewards` confirms selecting `open_profile` reaches the owner showcase and reopens the artwork.

## Session-goal evidence contract

OLD CONTRACT → The player rendered a session-goal card before the first
stroke, started a local timer after painting, advanced through goal
celebrations, and exposed XP/streak copy plus `splint:session-goals:*`
localStorage state.

NEW CONTRACT → The player hard-disables the session-goal card, timer,
celebration, XP/streak copy, and `splint:session-goals:*` storage, including
when a retired `?sessionGoals=control` link is opened. Painting, contextual
guidance, autosave, server revisions, reopen/persistence, and the normal
completion overlay remain available.

WHY INTENTIONAL → Session goals and their timer/reward loop were removed as a
deliberate product simplification. The player should support calm painting and
durable work continuity without inventing replacement gamification or silently
creating hidden goal state.

WHERE NEW BEHAVIOR IS COVERED → `e2e/session-goals-evidence.spec.js` captures
the no-goal player at 360px, 390px, and 430px, verifies the retired control
query cannot restore the surface, proves a saved revision survives reload,
and completes a deterministic fixture without a goal celebration or XP copy.
`e2e/session-goals.spec.js` remains the behavioral companion for the migrated
no-card contract, painting/save/revision behavior, reopen handling, and
completion integrity.

## Creator import-first and preview copy assertion

OLD CONTRACT

The Create hub treated image import, manual drawing, and collection assembly as peer entry points (`Из изображения`, `Нарисовать самому`, `Собрать бесплатную коллекцию`). Advanced preview controls were immediately exposed, and the expected preview path foregrounded technical copy (`по умолчанию выбран баланс 512`, `не автоматический`, `читаемость номеров`) and manual recalculation.

→ NEW CONTRACT

The Create hub is import-first (`Загрузить изображение`); manual drawing is not a primary hub action and collection management is secondary owner management (`Управлять коллекциями`). Advanced settings start collapsed. Upload automatically prepares the recommended 512×512/16-colour preview; other resolutions remain explicit user selections. User-facing copy says `Рекомендуем: 512` and `удобство`, and the save action is `Сохранить работу`.

→ WHY INTENTIONAL

The approved simplification makes image import the single primary creation path, keeps manual drawing out of the primary hub, and keeps owner collections discoverable without competing with creation. Collapsing advanced settings and replacing implementation-oriented copy reduces technical dominance while preserving preview choice, upload, save, and player entry behavior; no creator journey or security boundary is weakened.

→ WHERE NEW BEHAVIOR IS COVERED

`e2e/creator.spec.js` — `Create hub keeps free creator paths without commercial promises`, `3. File upload shows grid, crop, and color controls`, `3a. Photo creator defaults to the detail-preserving 512×512/16-colour mode`, `5. Grid and color controls update state`, `6. Compute shows previews and quality indicator`, and `8. Save flow: saves, confirms, and opens play view` cover the import-first hub, collapsed advanced controls, recommended preview, user copy, and preserved save flow. `e2e/creator-preview-visual.spec.js` — `creator preview is readable without overflow at 390px` and `... at 430px` assert `удобство` and reject pipeline/fingerprint/fragmentation copy. The accessibility, tiled-stroke, and zone visual specs use the migrated labels while retaining upload, compute, save, and paint coverage.

## Gallery to Profile owner shelf assertion

OLD CONTRACT

An owner-created coloring was reached through the Gallery list (`Смотреть все`, `.gallery-list`, `.gallery-row`), treating Gallery as the primary owner destination.

→ NEW CONTRACT

Completed and created work is presented in the owner's Profile showcase (`.profile-created-section`, `.profile-showcase-card`); public profile deep links are content-first, while collection discovery is available through Catalog and Profile. Opening and deleting owner work remain available, and owner publication remains a Profile management action.

→ WHY INTENTIONAL

Gallery is no longer a primary IA surface. Profile is the durable owner-created shelf and Catalog is the discovery surface, so the destination changes without removing ownership, opening, deletion, or public-profile behavior.

→ WHERE NEW BEHAVIOR IS COVERED

`e2e/creator.spec.js` — `9. Completion flow: 100% → overlay → Escape → buttons` reopens the completed fixture from the Profile showcase, and `11. Delete a user-created coloring from profile` proves Profile listing, owner deletion, API deletion, and 404 cleanup. `e2e/guided-path.spec.js` — `public profile deep link opens a content-first showcase without progression UI` proves public/owner showcase separation and preserves the no-resume-steal deep link journey. `e2e/unlocks-recommendations.spec.js` — `normal collection navigation hides premium entries from collection surfaces` covers Catalog collection discovery and the Profile collection surface without changing entitlement behavior.

## Home to Catalog and three-tab primary IA assertion

OLD CONTRACT

The root opened Home and the primary shell exposed Home/Feed/Gallery/Store/Achievements-oriented navigation and Home recommendation/choice surfaces; player entry tests therefore located Home cards.

→ NEW CONTRACT

The cold root opens Catalog. Primary navigation has exactly three tabs — Catalog, Create, Profile — and excludes Home, Community/Feed, Gallery, Store, and Achievements labels. Catalog owns artwork-first discovery, curated Popular/New/Collections surfaces, and collection deep links; resume and direct player/profile deep links remain valid.

→ WHY INTENTIONAL

The approved IA removes retired primary surfaces and concentrates discovery, creation, and ownership into three stable destinations. This is a shell/destination migration, not a removal of the player, save, resume, or deep-link journeys; those behaviors remain explicitly exercised.

→ WHERE NEW BEHAVIOR IS COVERED

`e2e/guided-path.spec.js` — `catalog is the default and primary navigation has exactly three product tabs` asserts the three labels, absence of retired labels, artwork-first Catalog, and collection deep-link handling. `e2e/creator.spec.js` — `12. Community is absent from primary IA`, `13. Stable shell width across views`, and `14. Player guided mode keeps the canvas clear of persistent metrics` cover the three-tab shell, removed Community tab, and Catalog-to-player entry. `e2e/stabilization.spec.js` continues all opening journeys through Catalog, while accessibility and session-goal evidence helpers adapt Home-card selectors to Catalog cards without weakening canvas, paint, save, or persistence assertions.

## Feed and Community UI removal with social API preservation

OLD CONTRACT

The primary UI exposed a Feed/Community post journey and its E2E contract required visible posts with like, comment, and follow interactions; completion also exposed a publish-to-feed CTA.

→ NEW CONTRACT

Feed/Community UI and its primary navigation entry are absent. The backend posts, comments, likes, follows, feed compatibility, and public Profile follow semantics remain available; owner publication is managed from Profile, and completion no longer offers `Опубликовать в ленту`.

→ WHY INTENTIONAL

Social UI was intentionally removed from the primary IA, not deleted from the service contract. Keeping the API and security boundaries preserves existing integrations and public-profile follow behavior while the product presents Catalog/Profile discovery instead of a social feed; no security or backend user journey is weakened.

→ WHERE NEW BEHAVIOR IS COVERED

`e2e/creator.spec.js` — `12. Community is absent from primary IA` asserts no Community button in the three-tab navigation; the completion block above asserts no publish/feed CTA. Backend compatibility remains covered by `server/test/api.integration.test.js` (post creation, comments, likes, and recommended feed around the completion flow) and `server/test/security-hardening.integration.test.js` — `public-alpha security boundaries`, including comment/report and authenticated social-route boundaries.

## Dormant recommendations and retired unlock journey assertion

OLD CONTRACT

Home rendered a visible recommendation strip with reason-coded cards and an unlock journey, and the E2E contract required both surfaces and their loading states to be visible.

→ NEW CONTRACT

Catalog is artwork-first: recommendation and unlock APIs still load bounded, reason-coded metadata, but the retired recommendation strip and unlock-journey UI are dormant and absent from the core surface. Curated Popular/New/Collections Catalog discovery replaces that visible guidance; no new gamification is introduced.

→ WHY INTENTIONAL

The visible Home recommendation/unlock journey was retired as part of the IA simplification while server-side recommendation, reason, history, and unlock semantics remain useful compatibility/data contracts. This keeps discovery bounded and avoids exposing progression UI without weakening direct links, server authorization, or content filtering.

→ WHERE NEW BEHAVIOR IS COVERED

`e2e/unlocks-recommendations.spec.js` — `cold-start catalog stays artwork-first while recommendation data remains bounded and dormant` verifies both APIs return 200, Catalog artwork appears, and recommendation/unlock surfaces are absent; `1200 in-progress history keeps recommendations and unlock state bounded` verifies bounded payloads, no recommendation UI, and no tile/manifest overfetch; `normal collection navigation hides premium entries from collection surfaces` covers curated Catalog/Profile collection discovery. Server-side reason and authorization semantics remain covered by `server/test/recommendations.test.js` — `cold start recommendations are deterministic, bounded, and exclude hidden/locked content` — and `server/test/unlocks-http.test.js` — `recommendations use tiled+legacy history, exclude locked/hidden/completed, and stay bounded`.

## Neutral progression-locked screen assertion

OLD CONTRACT

A direct progression-locked ID rendered level/completed-artwork requirement widgets and a progression CTA (`К следующей цели`) inside an actionable lock screen.

→ NEW CONTRACT

The direct ID remains fail-closed with `data-locked-reason="PROGRESSION_REQUIRED"`, no requirement/progress widgets, no XP/level/streak/achievement copy, and neutral actions `Выбрать доступную картину` and `В каталог`; it never opens a player or error toast.

→ WHY INTENTIONAL

Visible progression UX was retired with the old journey. The lock remains authoritative and navigable to safe Catalog content, so removing gamification does not weaken access control, authorization, or the user's ability to continue painting.

→ WHERE NEW BEHAVIOR IS COVERED

`e2e/unlocks-recommendations.spec.js` — `legacy progression-locked direct ID stays fail-closed without progression UX` asserts the locked state/reason, absence of requirement/progress/XP UI, neutral copy, no player/toast, and successful Catalog return. Server unlock authorization and reason semantics remain covered by `server/test/unlocks-http.test.js` — `unlock endpoints require auth and return a bounded snapshot` — and the unlock-service tests.

## XP bottom-sheet copy assertion

OLD CONTRACT

The player menu's secondary bottom sheet exposed an `XP:` progression summary.

→ NEW CONTRACT

The bottom sheet explains that progress `сохраняется автоматически` and contains no XP, level, or streak copy; its secondary painting actions and close behavior remain available.

→ WHY INTENTIONAL

XP/level/streak presentation was removed with session-goal progression. Replacing the summary with truthful autosave copy keeps the player oriented around durable work without adding a new reward loop or changing menu, paint, or save behavior.

→ WHERE NEW BEHAVIOR IS COVERED

`e2e/creator.spec.js` — `15. Player menu opens and shows secondary actions` asserts the autosave copy, absence of XP/level/streak text, secondary action, and close behavior. `e2e/session-goals.spec.js` and `e2e/session-goals-evidence.spec.js` independently assert no goal/progression metadata while painting, saving, reopening, and completing fixtures.

## Premium entitlement preservation (not a contract migration)

The premium assertions are deliberately not classified as an OLD CONTRACT → NEW CONTRACT migration. `e2e/unlocks-recommendations.spec.js` — `premium direct ID shows a neutral unavailable state without payment CTA` — restores the server-derived premium requirement count (`[data-requirement-type="premium"]` count 1), updates only neutral unavailable copy, and continues to assert no Stars/Premium purchase CTA, no progress bar, and a Catalog return. `catalog showcase stays fail-closed without a mounted payment adapter` preserves the unavailable state and neutral `Сохранить желание` action. Stars remain OFF/fail-closed; entitlement, payment, and authorization semantics are preserved, not weakened.

## Mechanical selector changes (non-contract)

The following edits are mechanical adaptations to the intentional contracts above and do not represent additional product migrations: helper renames such as `openHome` → `openCatalog`, variable renames such as `firstHomeCard` → `firstCatalogCard`, and replacing Home-card locators with `.catalog-art-open` where the test still only opens the same player. Opening `.creator-advanced summary` is a prerequisite for reaching controls that are intentionally collapsed; it does not remove those controls. Updating selectors for the new `Загрузить изображение` / `Сохранить работу` labels, or for the Profile showcase card, is covered by the Creator and Gallery/Profile blocks above. No mechanical edit changes timeouts, retries, production behavior, security, payment, painting, persistence, or navigation coverage.

## Telegram host is never asked to authenticate through the browser handoff

OLD CONTRACT

The shell replaced its entire content with the authentication page for any host
that was not already authenticated, including a Telegram host whose bridge had
not yet exposed signed `initData` at first render.

→ NEW CONTRACT

The handoff page is rendered only for a plain browser (`platform.isBrowser`) with
no server session. A Telegram host always keeps the application shell, its
header, and its three-tab navigation; while signed `initData` is still
resolving, data surfaces show their own loading/error states and the server
remains the authorization authority (owner routes answer `401`). Platform
metadata still never authorizes anything by itself.

→ WHY INTENTIONAL

Inside Telegram the browser handoff is unreachable by design: it points at the
same bot the user already launched. The Telegram bridge can resolve its init
params after the first render, and a resize/`focus` re-evaluation was the only
recovery path, so the previous gate produced a dead-end login wall on a real
Mini App cold start.

→ WHERE NEW BEHAVIOR IS COVERED

`test/browserMiniAppFallback.test.js` asserts the handoff render is guarded by
`!canUseApp && browserAuth.platform.isBrowser` and that chrome/navigation is
shown for a Telegram host. `e2e/responsive-platform.spec.js` — `Telegram
wide-host stub uses the platform adapter without showing browser login` keeps
asserting that a Telegram stub renders the three-tab shell and no auth page.

→ UNCHANGED CONTRACTS

Server-side authorization, signed `initData` verification, browser sessions,
CSRF, entitlements, and fail-closed commerce are unchanged; no anonymous
persistent account is created.

## Three-tab navigation shares the bar equally

OLD CONTRACT

`.app-tab-bar--redesigned > button` kept the five-tab `width: 20%` rule, so the
three primary destinations occupied 60% of the bar with a dead 40% tail.

→ NEW CONTRACT

The three primary buttons share the bar equally (`flex: 1 1 0`, `width: auto`);
the legacy `width: 20%` rule remains only on the non-primary `.app-tab-bar`
selector.

→ WHY INTENTIONAL

The bar was simplified from five destinations to three, and the five-tab width
rule was never updated with it. Measured on the production build at 390×844:
buttons were 73px wide with ~49px gaps.

→ WHERE NEW BEHAVIOR IS COVERED

`test/primary-ia-contract.test.js` — `application shell keeps navigation in
normal flow for Telegram iOS reopen` asserts the equal-width rule and rejects a
percentage width on the redesigned button.

## Telegram navigation follows the stable viewport

OLD CONTRACT

The shell used `100dvh` while Telegram's menu-button Mini App could be animating
between compact and expanded heights. The bottom navigation was an absolutely
positioned child with a `backdrop-filter` layer.

→ NEW CONTRACT

The shell height uses Telegram's `--tg-viewport-stable-height` CSS variable,
falling back to `100dvh` outside Telegram. The navigation is in normal flow,
uses the existing safe-area margin, has no relative-position insets, and keeps
an opaque fill without `backdrop-filter`.

→ WHY INTENTIONAL

Physical Telegram iOS reports show a blank panel with working hit targets on a
cold menu-button launch; background/resume or fullscreen causes the contents to
paint. Telegram documents that `viewportHeight` changes during gestures and
animations and is not suitable for bottom-pinned UI, while
`viewportStableHeight` changes only after the viewport reaches its stable size.
The shell therefore follows that supported stable measurement, keeps the nav
in flow, and removes an unnecessary backdrop layer. The exact WebKit failure
mode is not isolated by available physical evidence; the launch-path/lifecycle
interaction is the supported root-cause class. Existing `expand()` behavior is
preserved.

→ WHERE NEW BEHAVIOR IS COVERED

`test/primary-ia-contract.test.js` — `application shell keeps navigation in
normal flow for Telegram iOS reopen` asserts the stable-height shell and flow
layout. `e2e/guided-path.spec.js` sets a synthetic stable-height CSS variable
and verifies the shell uses it while the navigation remains bounded and
actionable. `src/lib/telegram.test.js` asserts existing ready-then-expand
behavior. A fresh physical cold-start check in real Telegram remains the
strongest platform-specific validation.

→ UNCHANGED CONTRACTS

The primary IA, `z-index`, equal three-tab widths, and hit targets are
unchanged. The shell still auto-expands as before; only its sizing source
changes when Telegram provides a stable viewport value.

## Navigation is outside the clipping content container

OLD CONTRACT

The three-button navigation was the last flex child of `.app-container` inside
`.telegram-frame`, and `.telegram-frame` clipped the whole column with
`overflow: hidden`. On Telegram iOS the bar's paint layer could stay unpainted
after the half-sheet expanded even though its hit targets kept working.

→ NEW CONTRACT

The bar is a direct flex child of `.telegram-frame` and a sibling of
`.app-container`, so the only clipping ancestor in the tree (`overflow: hidden`
plus the inherited frame radius) lives on the content container and no longer
wraps the bar. `.telegram-frame` keeps the 2026-09-29 viewport cap
`min(var(--tg-viewport-stable-height, 100dvh), 100%)` and adds no clipping,
transform, filter, or paint containment. Navigation state uses color, opacity,
background, and border only, with no transition, transform, or animation
anywhere in the navigation subtree.

→ WHY INTENTIONAL

Telegram iOS showed the navigation paint disappear while its hit targets still
worked after the expansion. The previous layout coupled the bar's paint to a
clipping ancestor. Moving the bar out of the clipping element removes that
dependency while keeping the existing viewport sizing, phone-frame decoration,
and normal document flow.

→ WHERE NEW BEHAVIOR IS COVERED

`test/primary-ia-contract.test.js` asserts the frame/container/nav sibling
structure, the retained viewport cap, the content-only clip, and the absence of
clipping, transforms, and transitions on the navigation ancestor chain.
`e2e/responsive-platform.spec.js` walks Catalog → Create → Profile → Catalog at
400×640 and 400×844, asserting the bar stays visible, inside the viewport, and
hit-testable, and saves screenshots at both heights. That is browser evidence,
not physical Telegram iOS proof.

→ UNCHANGED CONTRACTS

The three primary destinations, equal-width buttons, safe-area margin,
accessibility labels, hit targets, active route semantics, Telegram ready and
expand behavior, and the no-route-animation Telegram rule remain unchanged.
Painting, save/resume, auth, entitlements, and commerce are untouched.

## Catalog action and visual hierarchy polish

OLD CONTRACT

The Catalog hero split its headline/copy and three small statistics into
columns, compressing the first action on phone widths. Search, chips, shelves,
and the premium surface used closely spaced and low-contrast treatments.

→ NEW CONTRACT

The existing hero presents headline and guidance first, three aligned summary
values second, and the dominant `Начать раскрашивать` action as a full-width
button. Search, filters, shelf headings, cards, and Premium Gallery use clearer
spacing and text contrast. Hero and content surfaces use gradient fills,
light borders, and inset highlights; content can use subtle transitions while
the navigation remains static.

→ WHY INTENTIONAL

The owner reported that Catalog felt crowded and did not make the next action
clear. Reordering visual emphasis and increasing section separation address
that confusion without replacing the existing staged showcase or redesigning
other destinations.

→ WHERE NEW BEHAVIOR IS COVERED

`test/primary-ia-contract.test.js` protects the separate navigation contract.
`test/catalogShowcaseHierarchy.test.js` and `test/firstRunClarity.test.js`
preserve the staged order and dominant free-first CTA. The viewport-growth walk
in `e2e/responsive-platform.spec.js` captures the Catalog surface at both
tested heights.

→ UNCHANGED CONTRACTS

The staged section order, hero action and onboarding copy, nine-shelf budget,
collapsed all-works section, collections, 172 free / 148 premium split,
Stars-based server-owned price and fail-closed payment gate, and three-tab IA
remain unchanged. No catalog data, product rules, or other views are changed.

## Catalog showcase hierarchy (default view)

OLD CONTRACT

The default Catalog view rendered hero copy, then immediately dumped a
12-artwork grid (`catalog-featured-grid`), then new/free/premium shelves, the
premium teaser, six more shelves, and an 8-collection slice. Premium artwork
cards opened the coloring directly.

→ NEW CONTRACT

The default view is a staged showcase: hero → search/chips (unchanged) →
Popular + New horizontal shelves → a dedicated Premium Gallery block (crown,
server-owned price in Stars, unchanged teaser) → free/premium shelves plus
fill to a nine-shelf budget → the full collections grid → the complete artwork
grid only behind an explicit `Показать все работы (N)` expander with the
existing `visibleCount` show-more inside. Locked premium artwork cards (no
progress) carry a Premium crown badge and route to the Premium Gallery
showcase instead of opening the coloring; premium work already in progress
still opens directly.

→ WHY INTENTIONAL

The owner asked to end the one-long-dumping-sheet catalog: 320 works rendered
as an immediate wall with no hierarchy and no paid story. Staging discovery
(shelves → collections → full grid on demand) keeps the first paint light on
Telegram iOS WebViews while preserving every artwork, collection, and the
fail-closed premium boundary. Routing locked premium cards to the showcase
replaces a neutral locked dead-end with the value proposition; no payment path
is added or activated.

→ WHERE NEW BEHAVIOR IS COVERED

`test/catalogShowcaseHierarchy.test.js` asserts the section order, the
nine-shelf budget with popular/new pinned on top, the expander, the premium
badge/routing, and the unchanged chips/hero/teaser contracts.
`e2e/catalog-merchandising.spec.js` keeps asserting hero `320 сцен`, nine
shelves, free `172` / premium `148` shelf totals, the 16-collection tab, and
the teaser → showcase → `120 Stars` journey. E2E catalog-entry helpers
(`creator`, `stabilization`, `session-goals`, `accessibility`,
`accessibility-evidence`, `responsive-platform`) expand `Все работы` before
addressing `.catalog-art-card`, which is a mechanical adaptation to the same
contract.

→ UNCHANGED CONTRACTS

Chips (`Все`/`Бесплатно`/`Коллекции`), search, shelf rendering and counts,
collection-tab and shelf/collection-detail grids, the premium teaser and
showcase, entitlement/Stars fail-closed semantics, the 172/148 split, and the
three-tab IA are unchanged. No XP/levels/achievements/progression UI added.

## First-run clarity: hero CTA and static guide

OLD CONTRACT

The default Catalog hero rendered copy and stats with no action: a cold-start
user saw shelves and grids with no single dominant next step. Loading showed a
bare skeleton and the empty catalog said only to wait and retry. No app-level
first-run guidance existed (only the player-local `useColoringSession`
onboarding).

→ NEW CONTRACT

The hero carries one dominant primary CTA, `Начать раскрашивать`
(`data-catalog-hero-cta`), which opens the first paintable artwork preferring
free items and tracks `hero_cta_open`; it never opens a locked premium item
directly. A static inline first-run card (`data-first-run-guide`, max 3 steps:
pick artwork → paint → create/collect) renders above the hero on the default
showcase only, dismisses via `Понятно, начать`, and persists dismissal in
`localStorage` under `splint:first-run-guide:v1` so it never shows again.
Restricted storage is treated as valid (the card simply reappears next cold
start). Loading and empty states now name the next step (pick any artwork and
press the CTA; empty: press `Обновить`, then pick and paint).

→ WHY INTENTIONAL

Owner verdict: the interface does not guide by the hand; a cold-start user
cannot tell what to do first. One dominant open-and-paint path plus
dismissible static orientation fixes the 10-second comprehension gap without
adding progression, rewards, streaks, or a gamified funnel.

→ WHERE NEW BEHAVIOR IS COVERED

`test/firstRunClarity.test.js` asserts the single hero CTA with free-first
selection and tracking, the 3-step static guide with persisted dismissal and
no progression/animation surface, inline placement above the hero, next-step
loading/empty copy, and preserved hero/teaser/premium fail-closed contracts.

→ UNCHANGED CONTRACTS

Chips, search, shelf rendering and counts, collections, the premium teaser and
showcase, entitlement/Stars fail-closed semantics, the 172/148 split, the
three-tab IA, and player-local onboarding are unchanged. No
XP/levels/achievements/streaks/session-goal UI added; the guide is static
guidance, not progression.

## Special-cell one-tap resolution and effect feedback

OLD CONTRACT

Painting a Special Cell created an offer and paused ordinary progress. The
player then had to choose a target, nudge a Bomb center, choose a Choice/Hazard
option, or press a separate use/disarm confirmation. The grid used one shared
wave treatment for Spark and Bomb; Fuse, Artifact, Choice, and Hazard had no
distinct applied-effect animation.

→ NEW CONTRACT

The committed tap that claims a Special Cell resolves it automatically through
the existing `/progress/actions` action envelope. Spark applies the persisted
server default target. Bomb uses the special cell's own coordinates. Fuse
disarms successive persisted links automatically until the server closes the
offer. Choice uses the first server option; Hazard disarms by default. Artifact
is consumed atomically with its claim. There is no target picker, nudge, skip,
confirm, or undo in the normal activation flow. The special is spent on tap.

After a server-confirmed response, the grid shows a bounded kind-specific
effect: Spark's area fill burst, Bomb's radius ring and cell flash, Fuse's
link-by-link dissolve, Choice's reveal sweep, Artifact's collect glow, or
Hazard's warning pulse. The effect is driven by `special_applied_changes` (and
the server-confirmed Artifact discovery). If the affected region lies outside
the current viewport, its changed-cell pattern is projected into the visible
field for the short effect; otherwise the real affected cells are highlighted.
The effect does not intercept pointers or shift layout, and keeps a static
legible mark for reduced motion.

→ WHY INTENTIONAL

The owner wants the Special Cell itself to be the single user action, with an
immediate visual explanation. The one-way spend on tap is the explicit tradeoff
for removing confirmation and target selection; a failed server action remains
server-authoritative and cannot produce client-only progress.

→ WHERE NEW BEHAVIOR IS COVERED

`src/lib/specialCellsGameplay.test.js` checks deterministic action envelopes
for every current offer kind. `e2e/special-cells-long-journey.spec.js` paints
every kind present in the deterministic fixture, asserts automatic server
actions and absence of manual controls, and captures each effect at 390×844
plus a reduced-motion Hazard capture. The legacy Choice fixture additionally
covers Choice when explicitly enabled for the local screenshot run.
`e2e/special-bomb-tiled.spec.js`,
`e2e/special-bomb-artifact-reload.spec.js`,
`e2e/phase2-session-game.spec.js`,
`e2e/special-cells-gameplay-v1.spec.js`,
`e2e/special-glyph-parity.spec.js`, and
`e2e/special-cells-visual-audit.spec.js` cover reload, legacy/tiled delivery,
the default server option, effect feedback, and the removed selectors.

→ UNCHANGED CONTRACTS

The server remains authoritative for effect calculation and changed cells.
The exact `/progress/actions` action types and offer token remain in use;
idempotency, replay protection, ownership checks, revision/CAS, the Bomb cap of
32, Spark cap of 144, and `INITIAL_TARGET`'s earliest Spark remain unchanged.
No effect is computed locally, no XP/levels/streaks/achievements are added, and
payments, entitlements, authentication, and commerce are untouched.
## Catalog hero adapts to viewer state and recommends unfinished public work

OLD CONTRACT

The same full-size Catalog hero rendered for every viewer and every visit.
Its CTA selected the first non-premium item from the popularity order, which
could be a completed work or an artwork created by the viewer.

→ NEW CONTRACT

Fresh viewers keep the onboarding hero, its counts, and the single
`Начать раскрашивать` action. Viewers with unfinished work get a compact
resume hero showing that artwork, its paint percentage, and one resume action.
Viewers with only finished or created work get a compact shelf message and one
action for a new public free artwork. The CTA selection excludes completed and
viewer-created work, prefers an unstarted free artwork, then an unfinished free
artwork, and otherwise has no action if no eligible free artwork exists.

→ WHY INTENTIONAL

The permanent banner consumes the first viewport after onboarding, and the
arbitrary popularity choice can send a viewer back to completed or self-created
work. Adapting to existing resume state makes the hero relevant while retaining
the approved first-run guidance and free-first entry point.

→ WHERE NEW BEHAVIOR IS COVERED

`test/firstRunClarity.test.js` verifies fresh, unfinished, completed, and
created viewer states plus CTA selection against completed, self-created,
started, unstarted, and premium fixtures. It asserts exactly one rendered CTA
contract, `data-catalog-hero-cta="true"`, and `hero_cta_open` tracking.

→ UNCHANGED CONTRACTS

The cold-start hero still includes the catalog count required by
`e2e/catalog-merchandising.spec.js`, the free-first singular CTA and static
guide remain, unfinished work still resumes, and the 172/148 split, catalog
content, payment, entitlement, authentication, and three-tab IA are unchanged.

## Catalog collection cards show covers, composition, and viewer progress

OLD CONTRACT

Collection cards rendered a small square thumbnail and repeated truncated
counts, so mobile cards concealed both their cover artwork and differences in
collection content.

→ NEW CONTRACT

Collection cards in the showcase and collections tab use a wide, stable cover
image, show an available description or catalog theme, display complete free
and Premium counts plus album/work totals, and show the server/local completed
count as `N из M раскрашено`.

→ WHY INTENTIONAL

Collections are a first-class discovery path and need to communicate their
visual subject and scope at phone width. Existing server completion summaries
and the shared progress helper provide useful distinctions without loading
artwork maps or creating new catalog data.

→ WHERE NEW BEHAVIOR IS COVERED

`test/catalogShowcaseHierarchy.test.js` asserts the cover aspect ratio,
non-truncated complete count labels, per-collection progress, and preserved
collection-open tracking and click-through.

→ UNCHANGED CONTRACTS

Collection-to-album navigation, Catalog section order, the nine-shelf budget,
all-work collapse behavior, catalog data, the 172/148 split, and every commerce,
authentication, entitlement, and payment boundary are unchanged.

## Premium offer states its one-time value and buyer CTA

OLD CONTRACT

The Premium surface spoke in development terms: it declared itself a hypothesis with no purchase, announced a disabled payment mode, and offered a single request-access CTA. A buyer could not tell what the money buys or how the set differs from free content.

NEW CONTRACT

The teaser and full view state the one-time promise (count, themes, 120 Stars, no subscription) and the primary action reads the buyer CTA for the paid state. Unavailable, locked, free, paid, and owned states keep distinct copy, and opening the surface scrolls to its heading with reduced-motion behavior.

WHY INTENTIONAL

Request-access wording describes an internal allowlist flow, not a purchase. With Stars control in production, the surface must sell the actual entitlement: the full Premium Gallery set for one Stars price, with exclusions stated.

WHERE NEW BEHAVIOR IS COVERED

e2e/catalog-merchandising.spec.js asserts the paid CTA and the store handoff; e2e/unlocks-recommendations.spec.js asserts no purchase CTA in the unavailable state and the allowlisted checkout path. Unit parity for premium unlocks and primary IA remains in the focused suite.

UNCHANGED CONTRACTS

Server-owned price (120 XTR), product allowlist, the 172/148 split, entitlement creation only from authoritative payment state, kill switches, idempotency, reconciliation, and the three-tab IA are unchanged. No payment, payout, or marketplace settlement behavior changes.

## Store detail no longer repeats a lone pack preview card

OLD CONTRACT

The store always rendered the pack list and, below it, a detail section whose head repeated the same cover, title, description, and counts. With a single showcase pack the two blocks duplicated each other, the head counts glued the English server rarity code to the metadata line (epicСредняя), and preview copy clipped mid-word on one line.

NEW CONTRACT

When the store holds exactly one pack, the detail section skips its head and description because the preview card directly above already shows them; payment notice, checkout status, and actions stay. The multi-pack detail head merges counts, a Russian rarity word, and the metadata line into one separated line. Preview titles, copy, and the cover badge wrap on two lines instead of clipping.

WHY INTENTIONAL

A duplicated header doubles reading cost on a phone and the glued epicСредняя reads as corrupted text. The preview card remains the single entry point, so hiding the repeated head removes no action or information.

WHERE NEW BEHAVIOR IS COVERED

test/storeDetailContract.test.js asserts the sole-pack gate, the merged counts line, the kept preview entry point, and the two-line clamp rules. src/lib/packStore.test.js covers the rarity word map and the sole-pack predicate.

UNCHANGED CONTRACTS

One paid showcase cap, fail-closed checkout, server price and product allowlist, entitlement only from authoritative payment state, pack preview entry and its price line, checkout status and retry/restore/share actions are unchanged.

## Contract coverage status

All substantive changed assertions identified in the audit map to the approved decisions above. OPEN GAP: none. Any future selector-only change should remain in the mechanical section; any new semantic assertion must add its own four-field migration block or be marked OPEN GAP rather than inferred as an intentional contract.
