# Product contract migration

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

## Contract coverage status

All substantive changed assertions identified in the audit map to the approved decisions above. OPEN GAP: none. Any future selector-only change should remain in the mechanical section; any new semantic assertion must add its own four-field migration block or be marked OPEN GAP rather than inferred as an intentional contract.
