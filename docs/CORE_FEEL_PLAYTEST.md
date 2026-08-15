# Splint Core Feel Playtest — Phase 0/1

Status: **technical prototype; enjoyment is not yet validated**.

## Decision this test must make

Can a player enjoy and own one manual `Player-Authored Reveal Beat` on Astro Whale without Special Cells, XP, streaks, achievements, or forced camera movement — and want to reveal the next fragment?

This test does **not** decide whether to add Phase 2 systems. A positive result only earns the right to select and refine one core-feel variant.

## Participants

- 8–12 people who have not used the current Splint build.
- Mobile-first; at least 4 sessions inside a real Telegram Mini App WebView.
- Include both people who use relaxing/coloring apps and people who do not.
- Do not teach color-by-number rules before launch.

## Build and identities

The experiment is gated. In development it is available through the URL; a deployed build additionally requires `VITE_CORE_FEEL_EXPERIMENT_ENABLED=true`.

Use one fresh `coreSubject` per participant and condition. Only lowercase letters, digits, `_`, and `-` are supported.

| Condition | URL | Purpose |
| --- | --- | --- |
| Control | `/?coreFeel=control&coreSubject=corefeel_p01_control` | Same artwork and clean first-minute frame, existing flat stroke/automatic guidance |
| A | `/?coreFeel=a&coreSubject=corefeel_p01_a` | Crisp joined stroke + edge settle + ownership pause |
| B | `/?coreFeel=b&coreSubject=corefeel_p01_b` | Soft material response + tonal breathe + ownership breathe |
| C | `/?coreFeel=c&coreSubject=corefeel_p01_c` | Luminous stroke edge + luminous reveal + ownership pause |

Sound is off by default. Test it only after the silent visual comparison with `&coreSound=on`. Haptics can be disabled with `&coreHaptics=off`.

## Design

Use a balanced, blinded within-subject comparison:

1. Randomize the order of Control/A/B/C for each participant.
2. Give each condition a fresh identity so progress never leaks between variants.
3. Call them only “version 1/2/3/4”; do not reveal which is the new design.
4. Let the participant act without instruction for the first 60 seconds.
5. If fully stuck for 10 seconds, use exactly one neutral prompt: “Попробуй провести по подсвеченному участку.”
6. Stop each condition after the first ownership pause or after 90 seconds.
7. Do not ask for preference until all conditions have been experienced.

Avoid testing all four variants with fatigued participants in one unbroken run. Insert a short visual reset between conditions.

## Observer sheet

Record timestamps from video or the event stream; do not infer enjoyment from E2E.

| Measure | Record |
| --- | --- |
| Open → first handmade action | seconds; whether a prompt was required |
| First action → manual fragment reveal | seconds |
| Gesture pattern | taps / continuous strokes / mixed |
| Wrong or abandoned gestures | count and cause |
| Reveal recognition | spontaneous reaction, or “did not notice” |
| Agency | “I did it” / “the app did it” / unclear |
| Reveal → choice | Next fragment / Stop / hesitation time |
| Camera | helped / stole control / unnoticed |
| Manual vs assisted progress | manual cells; assisted must remain 0 in this slice |
| Resume | time from reopen to next meaningful action |

Instrumented experiment events:

- `core_feel_experiment_open`
- `core_feel_first_handmade_action`
- `core_feel_resume_action`
- `core_feel_manual_fragment_reveal`
- `core_feel_next_beat_selected`
- `core_feel_session_stop`

The experiment intentionally does not emit generic per-stroke analytics.

## Questions after each condition

Use a 1–7 scale, then ask “why?” once.

1. Насколько приятно было само движение пальцем?
2. Насколько ясно ты чувствовал, что именно ты раскрыл фрагмент?
3. Насколько заметным был момент завершения фрагмента?
4. Насколько камера помогала, а не управляла тобой?
5. Хотелось ли нажать «Следующий фрагмент»?

After all conditions:

- Which version would you voluntarily continue for three more minutes?
- Which felt most calm? Which felt most responsive?
- Did any version feel decorative, arcade-like, or tiring?
- What did you think would happen after the fragment was completed?

## Physical Telegram gate

Run on at least one real iPhone and one real Android phone inside Telegram:

- first launch reaches Astro Whale without catalog/modal detours;
- tap, long stroke, and rapid short strokes stay under the finger;
- two-finger pinch/pan does not scroll or close the Mini App;
- ownership pause is readable above safe areas and does not accept accidental painting;
- back and “Остановиться здесь” save progress and produce a natural closure;
- reopening resumes on the unfinished authored fragment;
- haptics are calm, occur on a continuous stroke/fragment rather than every tap, and degrade safely when unsupported;
- sound starts only after user interaction, respects sound-off, and does not fight Telegram audio;
- reduced-motion removes breathe/settle motion without removing the completed-state signal;
- offline/pending save state remains truthful, and reload does not lose acknowledged progress.

## Pass / fail gate

Advance only if at least one enhanced variant beats Control on all of these without a material input regression:

- median time to first manual reveal is 90 seconds or less;
- at least 8 of 12 participants notice the reveal without being told;
- at least 8 of 12 describe the result as primarily their action;
- at least 7 of 12 voluntarily choose the next fragment;
- no more than 2 of 12 report camera steal as a major irritation;
- no repeated physical-device input, safe-area, save, sound, or haptic blocker.

If no variant clears the gate, do not average the variants or add Special Cells. Diagnose whether the failure is gesture legibility, fragment composition, reveal strength, or camera ownership, and run a narrower Phase 1 iteration.

## Explicit non-claims

- Automated tests prove correctness, not fun.
- Emulated iPhone/Pixel projects are not physical Telegram WebViews.
- One reference artwork does not validate the full catalog.
- A successful first reveal does not validate retention, progression, monetization, or Phase 2 mechanics.
