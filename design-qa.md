# Mobile-first Swipe Card — iPhone 17 Pro

- Source visual truth: `/var/folders/dh/xsqhzxxx59x8k29s9rblhz280000gn/T/codex-clipboard-9f53f7ae-c8b1-4973-898f-1c8bdb728372.png` and `/var/folders/dh/xsqhzxxx59x8k29s9rblhz280000gn/T/codex-clipboard-f3ca1708-a11a-4de6-89ed-585e8c511393.png`
- Browser implementation screenshots: `/private/tmp/investmade-iphone17-closed.png` and `/private/tmp/investmade-iphone17-details.png`
- Combined comparison: `/private/tmp/investmade-mobile-comparison.png`
- Viewport: 402 × 874 CSS px, iPhone 17 Pro reference size
- Source pixels: 1034 × 1386 closed and 1028 × 1270 details-open
- Implementation pixels: 503 × 1091 for each state, captured at 1.25 browser density and representing 402 × 874 CSS px
- Density normalization: the source screenshots document the defects at a wider browser capture; the implementation is judged at the requested device viewport. The paired comparison normalizes each image to its column width and preserves top alignment.
- State: authenticated Solana basket feed, closed and details-open card states

## Findings

- No actionable P0, P1, or P2 issue remains.
- P3: the persistent action bar and bottom navigation intentionally remain fixed while the details-open card scrolls behind them; this preserves the mobile conversion controls.

## Full-view comparison

The closed card no longer inherits the 758 px fixed minimum that created the oversized empty panel. At 402 × 874 CSS px it measures 442 px, keeps the full chart readable, and leaves the budget rail and primary actions reachable. The details-open card grows to its content at 624 px rather than holding a large empty tail.

## Focused region comparison

The details-open chart is the focused region because the source showed all four price labels collapsing into one line. The implementation reserves a 150 px chart plot; all four labels have distinct non-overlapping vertical bounds. The timeframe controls, information toggle, evidence panel, and links remain readable without horizontal overflow.

## Required fidelity surfaces

- Fonts and typography: existing Instrument Serif and DM Sans hierarchy is preserved; no mobile text wraps or truncates unexpectedly in the checked states.
- Spacing and layout rhythm: the card is content-sized, the closed chart uses `clamp(280px, 39dvh, 340px)`, and details use a dedicated 150 px plot instead of a collapsed flex child.
- Colors and visual tokens: the existing Solana dark surfaces, mint actions, coral skip state, borders, and muted labels are unchanged.
- Image quality and asset fidelity: existing provider-backed asset marks and chart SVG output remain sharp; no replacement or placeholder asset was introduced.
- Copy and content: asset name, price, period, allocation, evidence, budget, and action copy are unchanged.

## Interaction and accessibility checks

- Page identity is `investmade.fun` at `http://localhost:5173/?mobile-card=iphone17`.
- The meaningful basket screen renders without a Vite/framework overlay.
- Toggling `Asset information` expands the evidence panel and preserves a 150 px chart plot.
- Adding SPYx advances to cbBTC and preserves the open information state.
- Closed state: 442 px card, 340 px chart, no horizontal overflow.
- Open state: 624 px card, 150 px plot, no overlapping price labels, no horizontal overflow.
- Persistent actions remain inside the 402 × 874 viewport.
- Desktop check at 1280 × 900 retains the 505 px desktop minimum and has no horizontal overflow.
- Console: no errors; only the pre-existing duplicate WalletConnect initialization warning.
- Typecheck, production build, and `git diff --check` pass.

## Comparison history

1. The source state used a 758 px mobile minimum, producing a large empty card below the chart.
2. Removed that fixed minimum and made the closed chart viewport-responsive.
3. The source details-open state collapsed the chart plot, stacking four price labels.
4. Reserved a 150 px details plot and confirmed label bounds do not overlap.
5. The final paired comparison shows no remaining P0, P1, or P2 mismatch.

## Follow-up polish

- None required for the requested mobile card states.

final result: passed

---

# Previous Design QA

- Source visual truth: `/var/folders/dh/xsqhzxxx59x8k29s9rblhz280000gn/T/codex-clipboard-9f55e1d3-91e7-46ed-9d4e-a997ce528c93.png`
- Implementation screenshot: `/private/tmp/investmade-dot-loading-final.png`
- Focused chart crop: `/private/tmp/investmade-dot-loading-final-chart.png`
- Viewport: 410 × 863 CSS px at 1×
- Source pixels: 718 × 770
- Implementation pixels: 410 × 863
- Focused crop pixels: 370 × 320
- Density normalization: both captures are 1×; the reference is a visual motif rather than the same product frame, so comparison is limited to the chart-loading texture and motion treatment.
- State: connected mobile feed, STEEL card, `1H` timeframe loading

## Full-view comparison

The loading treatment sits inside the existing chart footprint without moving the asset header, metadata, timeframe controls, coverage note, budget rail, or fixed actions. The former directional scanner is absent. The loading chart now uses a quiet 8 × 4 field of small neutral-grey dots and retains the subtle dashed horizontal guide visible in the reference.

## Focused region comparison

The source and implementation were viewed together, with the chart region checked separately because the requested change is intentionally limited to the loading texture:

- Dot scale is small and understated rather than spinner-like.
- Neutral grey replaces the previous semantic green/red scanner color.
- Staggered negative delays make the pulse wave visible immediately instead of starting from a uniformly faint frame.
- Opacity varies softly across the grid, matching the reference’s low-contrast chart background.
- No scanner line, glow, sweep trail, or scanner keyframes remain.

## Required fidelity surfaces

- Fonts and typography: unchanged; the loader introduces no text and does not disturb the existing hierarchy.
- Spacing and layout rhythm: the dots occupy the existing chart loading region and preserve the surrounding card geometry.
- Colors and visual tokens: dots use neutral grey `#aeb5c0` with low animated opacity; no asset-performance color leaks into the loading state.
- Image quality and asset fidelity: no raster placeholder or generated asset is required for this native loading-state pattern; the supplied reference remains the visual source.
- Copy and content: the accessible loading announcement remains present and visually hidden.

## Interaction and accessibility checks

- Selected `1H` and captured the live loading state before the chart resolved.
- Confirmed 32 loading dots render during the request.
- Confirmed staggered pulsing starts immediately.
- Confirmed `prefers-reduced-motion` removes the pulse animation and leaves a static grey dot field.
- Browser console warnings/errors: none.
- Lint, typecheck, diff check, and all 54 tests passed.

## Comparison history

1. Earlier loading treatment used a directional scanner line and glow, which conflicted with the new reference.
2. Replaced the scanner with a 32-dot grey grid and removed all scanner animation rules.
3. The first dot pass used positive delays, making the first captured frame too uniformly faint.
4. Switched to staggered negative delays; the final browser capture shows an immediate, varied pulse wave with no remaining P0, P1, or P2 mismatch.

## Follow-up polish

- P3: dot spacing can be made denser later if the chart footprint grows on tablet layouts.

final result: passed

---

# Settled Receipt — Option 3

- Source visual truth: `/Users/khuanmatusso/.codex/generated_images/019fafe8-99f8-7182-9c50-2d1c2a40d4a6/call_HikosaJfg83xXWbQHuN6fTCL.png`
- Browser implementation screenshot: `/private/tmp/investmade-receipt-variant3-final.png`
- Active-confetti screenshot: `/private/tmp/investmade-receipt-confetti.png`
- Side-by-side comparison: `/private/tmp/investmade-receipt-variant3-comparison-final.png`
- Viewport: 390 × 844 CSS px at 1×
- Source pixels: 853 × 1844, normalized to a 390 × 844 top-aligned comparison frame
- Implementation pixels: 390 × 844
- State: authenticated Robinhood Chain receipt with four successfully settled assets

## Findings

- No actionable P0, P1, or P2 mismatch remains.
- P3: the source includes decorative rays around the success check. The implementation keeps the product's existing icon language and uses the shared confetti component for celebration instead of introducing an approximate decorative asset.
- P3: the implementation retains Investmade's persistent mobile navigation. This adds a bottom navigation row that is absent from the concept image, while keeping both receipt actions visible above it.

## Full-view comparison

The selected design and final browser capture were placed in one comparison image. Both use the same status-led hierarchy: compact success hero, verified-chain band, unified asset ledger, secondary execution proof, transaction link, primary portfolio action, and quiet next-basket action. The final mobile receipt fits all of these sections in the 390 × 844 viewport without horizontal or vertical page overflow.

## Focused region comparison

The full-view comparison keeps the typography, asset rows, proof rows, and actions readable at the normalized size, so a separate crop was not needed. The receipt hero, all four asset outputs, the transaction receipt, and both actions were inspected directly in the paired image.

## Required fidelity surfaces

- Fonts and typography: Archivo Black preserves the selected design's bold outcome headline; DM Sans remains on financial amounts, support copy, rows, and controls. The compact mobile scale keeps the heading to two lines and preserves readable 11–16 px supporting text.
- Spacing and layout rhythm: the final pass reduces only receipt-local mobile spacing. Four 60 px asset rows, 52 px proof rows, and compact section margins keep the full receipt decision flow visible above the persistent navigation.
- Colors and visual tokens: the success check, verification band, primary action, green outputs, paper background, borders, and muted copy use the existing semantic Investmade tokens and match the acid-green reference direction.
- Image quality and asset fidelity: existing provider-backed asset marks and Lucide interface icons stay sharp at 1×. No placeholder, emoji, custom SVG, or CSS-drawn replacement was introduced.
- Copy and content: the receipt leads with `Done — your basket settled`, explains the total split, names the verified chain, shows allocation and received amounts, and moves technical proof behind `How this was executed`.

## Interaction and accessibility checks

- `How this was executed` resolves as one disclosure control and toggles the proof region.
- `See my portfolio` navigates to Portfolio; Activity returns to the receipt.
- Transaction explorer URL is chain-aware.
- Settlement confetti renders as one canvas for a fresh settled execution, runs once per execution per browser session, and is suppressed for `prefers-reduced-motion`.
- Mobile document width and scroll width are both 390 px.
- The dev console contains pre-existing Privy/WalletConnect duplicate-initialization warnings from the connected browser session; no receipt-specific runtime error was observed.
- Typecheck, lint, all 99 tests, and the production build pass.

## Comparison history

1. The first implementation matched the selected hierarchy but used desktop-derived mobile spacing, leaving execution details and actions below the initial viewport.
2. Tightened receipt-only mobile heading, verification, ledger, proof-row, and action spacing while keeping financial text readable.
3. The first confetti runtime check exposed React Strict Mode's effect replay consuming the session marker before the canvas remained mounted.
4. Added an execution-scoped ref so the replay re-arms the same one-shot effect without allowing repeat celebrations later in the session.
5. The final side-by-side capture shows the complete receipt and both actions in the intended viewport, with no remaining P0, P1, or P2 mismatch.

## Implementation Checklist

- [x] Friendly settled-state hierarchy
- [x] Compact four-asset ledger
- [x] Collapsible execution proof
- [x] Chain-aware explorer receipt
- [x] Portfolio-first primary action
- [x] One-shot, reduced-motion-safe confetti
- [x] Mobile fit and overflow validation
- [x] Typecheck, lint, tests, and production build

final result: passed

---

# Top Up Row Alignment Follow-up

- Source visual truth: `/var/folders/dh/xsqhzxxx59x8k29s9rblhz280000gn/T/codex-clipboard-42616178-4f4d-4d31-90a6-a42c8c6d6aa6.png`
- Implementation screenshot: `/private/tmp/investmade-topup-same-row-final.png`
- Focused comparison: `/private/tmp/investmade-topup-row-comparison.png`
- Viewport: 390 × 844 CSS px at 1×
- Source pixels: 401 × 223
- Implementation pixels: 390 × 844
- Focused implementation card: 360 × 204 px
- Density normalization: the source was normalized to 360 × 200 and compared with the 360 × 204 implementation card crop.
- State: authenticated Account page with 0 USDG balance

## Full-view comparison

The Account page preserves its existing hierarchy and mobile card geometry. The address controls and Top up action now share one horizontal row, with Top up aligned against the card’s right content edge.

## Focused region comparison

The before reference and post-fix card were placed in one comparison image. The address and copy control remain a single left-side group, while Top up moves from a second row to the far right of that same row.

## Required fidelity surfaces

- Fonts and typography: unchanged; the button and wallet address retain their existing type styles.
- Spacing and layout rhythm: the action row spans the card width with `space-between`; both groups are vertically centered.
- Colors and visual tokens: unchanged.
- Image quality and asset fidelity: existing Lucide Copy and ArrowDownToLine icons are retained.
- Copy and content: unchanged.

## Interaction and accessibility checks

- Top up remains uniquely accessible and enabled.
- Clicking Top up opens the `Top up Investmade Wallet` dialog.
- Closing the dialog returns to the Account card.
- Mobile viewport has no horizontal overflow.
- Browser console warnings/errors: none.

## Comparison history

1. Earlier state placed Top up below the wallet address.
2. Replaced the address container grid with an inline flex row.
3. Added mobile `space-between` alignment and full-width row sizing.
4. Post-fix evidence shows no remaining P0, P1, or P2 mismatch for the requested alignment.

## Follow-up polish

- None required.

final result: passed

---

# Account Command Center Redesign

- Source visual truth: `/Users/khuanmatusso/.codex/generated_images/019fa997-f7ab-76a0-87f6-08d48e4aae07/call_iYmxsy4IhUHx0ARiMppodhPW.png`
- Implementation screenshot: `/private/tmp/investmade-account-option3-852.png`
- Side-by-side comparison: `/private/tmp/investmade-account-option3-comparison.png`
- State: authenticated Account page with connected smart and external wallets, Robinhood Chain, and live USDG balance

## Full-view comparison

The implementation preserves option 3's command-center hierarchy: status-led hero, acid investing-balance panel, distinct smart and external wallet roles, an immediately scannable rules summary, and a bordered new-basket action. Existing Investmade navigation and product typography remain intact.

## Required fidelity surfaces

- Typography: Archivo Black hero and action labels retain the product's existing bold visual voice.
- Spacing and structure: the screen now uses section dividers and list rows instead of separate dashboard cards.
- Colors: acid green, Robinhood blue, white, ink, and subtle grey rules match the selected direction.
- Assets: existing Lucide icons replace the concept-only Robinhood feather while preserving semantic meaning and visual weight.
- Copy: command-center, wallet-role, investment-rule, and basket-action copy matches the selected option.

## Interaction and accessibility checks

- Live USDG balance, wallet addresses, copy controls, and Top up remain connected to existing behavior.
- `Edit` expands the existing investment settings form; `Close` collapses it.
- Saving still uses the existing preference workflow and returns to the compact summary.
- Build another basket remains connected to the existing developer reset action.
- Regions and controls have unique accessible names.
- Typecheck, lint, and all 75 tests passed.

## Comparison history

1. Replaced the three disconnected Account cards with option 3's command-center structure.
2. Added wallet-role rows, row chevrons, status iconography, and blue rules icons to match the selected hierarchy.
3. Converted the full-time settings form into a compact live summary with a functional editor.
4. Verified the selected source and final implementation together in one comparison image.
5. No remaining P0, P1, or P2 mismatch blocks the selected design.

## Follow-up polish

- P3: the generated source uses a concept-only Robinhood feather; the implementation intentionally uses the product's installed security icon rather than adding an unverified brand asset.

final result: passed

---

# Wallet Address Row Follow-up

- Source visual truth: `/var/folders/dh/xsqhzxxx59x8k29s9rblhz280000gn/T/codex-clipboard-900b910d-8f4a-42db-b540-9e8d909169dd.png`
- Implementation screenshot: `/private/tmp/investmade-account-mobile-after.png`
- Focused comparison: `/private/tmp/investmade-wallet-card-comparison.png`
- Viewport: 390 × 844 CSS px at 1×
- Source pixels: 894 × 568
- Implementation pixels: 390 × 844
- Focused implementation card: 360 × 242 CSS px
- Density normalization: the source was normalized to 447 × 284 and the focused implementation card to 447 × 300 for a side-by-side layout comparison.
- State: authenticated Account page with a ready Investmade smart wallet and 0 USDG balance

## Full-view comparison

The updated balance card preserves the existing mobile hierarchy, padding, acid background, border, typography, description, and Top up action. The requested information label now reads `Investmade Wallet · Robinhood Chain`.

## Focused region comparison

The source and implementation were placed together in one comparison image. The implementation fixes the source mismatch by keeping the shortened wallet address and copy control on the same row. The Top up control remains on its own row below, matching the intended card structure.

## Required fidelity surfaces

- Fonts and typography: existing Archivo Black and DM Sans hierarchy is preserved; the replacement label uses the same uppercase account-label styling.
- Spacing and layout rhythm: address and copy icon align vertically with a 7 px gap; the Top up button remains 10 px below.
- Colors and visual tokens: existing acid, blue, ink, white, and border tokens are unchanged.
- Image quality and asset fidelity: no raster or generated asset was needed; the existing Lucide copy and confirmation icons remain sharp and consistent.
- Copy and content: label changed to `Investmade Wallet · Robinhood Chain`; wallet balance and explanatory copy remain unchanged.

## Interaction and accessibility checks

- Copy control remains uniquely accessible as `Copy Investmade Wallet address`.
- Clicking the copy control changes its accessible name to `Address copied`.
- Mobile viewport has no horizontal overflow: document width and scroll width are both 390 px.
- Browser console warnings/errors: none.

## Comparison history

1. Source state stacked the wallet address and copy icon on separate rows.
2. Scoped the broad balance-card grid rule to the balance-content column.
3. Added a dedicated inline address row while leaving Top up below it.
4. Post-fix capture confirms no remaining P0, P1, or P2 mismatch for the requested change.

## Follow-up polish

- None required for this scoped change.

final result: passed

---

# Settled Receipt Title Follow-up

- Source visual truth: `/Users/khuanmatusso/.codex/generated_images/019fafe8-99f8-7182-9c50-2d1c2a40d4a6/call_HikosaJfg83xXWbQHuN6fTCL.png`
- Browser implementation screenshot: `/private/tmp/investmade-basket-settled-title.png`
- Side-by-side comparison: `/private/tmp/investmade-basket-settled-comparison.png`
- Browser viewport: 451 × 863 CSS px at 1×
- Source pixels: 853 × 1844, normalized into a 451 × 863 top-aligned comparison frame
- Implementation pixels: 451 × 863
- State: authenticated Robinhood Chain receipt with three successfully settled assets

## Findings

- No actionable P0, P1, or P2 mismatch remains.
- P3: the user-directed `Basket settled` title is intentionally shorter than the selected concept's `Done — your basket settled`. The shorter copy improves scan speed and keeps the checkmark as the primary status signal.

## Full-view comparison

The source and updated browser capture were placed in one comparison image. The settled receipt keeps the selected checkmark-led hero, amount summary, verified-chain band, asset ledger, execution proof, transaction receipt, and primary actions. The shorter heading remains visually balanced with the checkmark and creates more breathing room without changing the rest of the receipt.

## Focused region comparison

The success hero is large and readable in the full comparison, so a separate crop was unnecessary. The checkmark, heading, amount summary, and verification band were inspected together because their relative alignment is the requested change.

## Required fidelity surfaces

- Fonts and typography: `Basket settled` retains Archivo Black, the existing optical weight, and a single-line hierarchy at the captured width. Supporting financial copy remains DM Sans.
- Spacing and layout rhythm: the shorter heading preserves the existing checkmark grid and makes the hero more compact without shifting the ledger or actions.
- Colors and visual tokens: acid success green, ink, muted copy, paper surface, and verification tint remain unchanged.
- Image quality and asset fidelity: the existing sharp check and asset marks remain unchanged; no replacement or approximate asset was introduced.
- Copy and content: the settled-state heading now reads `Basket settled`; the amount summary and verification wording remain explicit.

## Interaction and accessibility checks

- The live accessibility tree exposes one level-one heading named `Basket settled`.
- The receipt remains authenticated and populated from the connected browser state.
- Browser width and document scroll width both measure 451 px, so the title change introduces no horizontal overflow.
- No interaction behavior changed in this copy-only refinement.

## Comparison history

1. The previous receipt used `Done — your basket settled`.
2. Replaced it with the user-directed, status-first `Basket settled` while retaining the checkmark.
3. The final browser comparison shows no remaining P0, P1, or P2 issue from the title change.

## Implementation Checklist

- [x] Checkmark retained
- [x] Settled title simplified
- [x] Amount summary retained
- [x] Mobile overflow checked
- [x] Source and implementation compared together

final result: passed

---

# Portfolio Sell Action Labels

- Source visual truth: `/var/folders/dh/xsqhzxxx59x8k29s9rblhz280000gn/T/codex-clipboard-2e5f5c9a-0065-42e6-a503-1aac06c14ec8.png`
- Rendered implementation: `/private/tmp/investmade-sell-label-mobile.png`
- Focused comparison: `/private/tmp/investmade-sell-label-comparison.png`
- Viewport: 455 x 800 CSS px, device scale factor 1
- Source pixels: 910 x 280 at 2x; normalized to 455 x 140
- Implementation pixels: 455 x 800 at 1x; the matching two-row region was cropped to 455 x 140
- State: Robinhood Portfolio with PIPEDOG reverse quote prepared and APLD in its normal sell state

## Full-view comparison evidence

The complete mobile Portfolio capture preserves the existing typography, spacing, colors, token artwork, borders, button dimensions, and responsive layout. The requested action-copy change is isolated to the sell buttons.

## Focused comparison evidence

The side-by-side two-row comparison confirms the intentional changes against the supplied before-state: PIPEDOG now shows plain `Confirm` with no icon, and APLD shows `Sell` followed by the existing hand-coins icon. No focused-region layout regression is visible.

## Findings

- No actionable P0, P1, or P2 differences.
- Fonts and typography: unchanged from the existing component; both labels retain the same weight, size, and alignment.
- Spacing and layout rhythm: button sizes and row geometry remain unchanged.
- Colors and visual tokens: existing sell-button colors, borders, and focus styling are preserved.
- Image quality and asset fidelity: token artwork is unchanged; the existing Lucide hand-coins icon is reused in the requested position.
- Copy and content: normal state is `Sell` plus the icon; quoted state is exactly `Confirm`.

## Interaction and console checks

- Opened Portfolio on localhost.
- Verified six normal `Sell` buttons in the captured state.
- Prepared a live PIPEDOG reverse quote without submitting a transaction and verified one `Confirm` button.
- Browser console errors: none.

## Comparison history

- Initial implementation matched the requested copy and icon order; no P0/P1/P2 correction loop was required.

## Follow-up polish

- None required for this scoped change.

final result: passed
