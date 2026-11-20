---
name: Calo Ingest
description: Vietnamese nutrition ledger for recorded meals and personal bot connections.
colors:
  pine: "#173f35"
  green: "#286a4c"
  muted: "#607269"
  line: "#e0e8e2"
  mint: "#e8f1e8"
  surface: "#fff"
  danger: "#a42b29"
  ink: "#23372f"
  canvas: "#f4f7f5"
  field-border: "#cbd8ce"
  primary-hover: "#28614c"
  secondary-border: "#cad9cf"
  quiet-hover: "#edf3ef"
  nav-text: "#cadcd1"
  nav-hover: "#244f42"
  nav-current: "#315b47"
  status-positive-bg: "#eaf2e8"
  status-positive-text: "#356044"
  status-paused-bg: "#f5eee2"
  status-paused-text: "#715a37"
  status-neutral-bg: "#edf1ed"
  status-neutral-text: "#617168"
typography:
  headline: {fontFamily: "Be Vietnam, system-ui, sans-serif", fontSize: "clamp(1.65rem, 2.7vw, 2.25rem)", fontWeight: 600, lineHeight: 1.4, letterSpacing: "-.035em"}
  title: {fontFamily: "Be Vietnam, system-ui, sans-serif", fontSize: "1.1rem", fontWeight: 600, letterSpacing: "-.02em"}
  body: {fontFamily: "Be Vietnam, system-ui, sans-serif", fontSize: "1rem", fontWeight: 400, lineHeight: 1.8}
  label: {fontFamily: "Be Vietnam, system-ui, sans-serif", fontSize: ".875rem", fontWeight: 600}
rounded: {badge: "5px", control: "8px", panel: "12px"}
spacing: {small: "8px", label: "9px", control-gap: "12px", compact: "18px", mobile: "20px", section: "24px", panel: "26px"}
components:
  button-primary: {backgroundColor: "{colors.pine}", textColor: "{colors.surface}", typography: "{typography.label}", rounded: "{rounded.control}", padding: "10px 18px"}
  button-primary-hover: {backgroundColor: "{colors.primary-hover}"}
  button-secondary: {backgroundColor: "{colors.surface}", textColor: "{colors.pine}", typography: "{typography.label}", rounded: "{rounded.control}", padding: "10px 18px"}
  button-secondary-hover: {backgroundColor: "{colors.mint}"}
  button-quiet: {backgroundColor: "transparent", textColor: "{colors.muted}", typography: "{typography.label}", rounded: "{rounded.control}", padding: "8px 10px"}
  button-quiet-hover: {backgroundColor: "{colors.quiet-hover}", textColor: "{colors.pine}"}
  input: {backgroundColor: "{colors.surface}", textColor: "{colors.ink}", rounded: "{rounded.control}", padding: "11px 13px"}
  nav-item: {textColor: "{colors.nav-text}", rounded: "{rounded.control}", padding: "13px 15px"}
  nav-current: {backgroundColor: "{colors.nav-current}", textColor: "{colors.surface}"}
  status-positive: {backgroundColor: "{colors.status-positive-bg}", textColor: "{colors.status-positive-text}", rounded: "{rounded.badge}", padding: "4px 9px"}
  status-paused: {backgroundColor: "{colors.status-paused-bg}", textColor: "{colors.status-paused-text}", rounded: "{rounded.badge}", padding: "4px 9px"}
  status-neutral: {backgroundColor: "{colors.status-neutral-bg}", textColor: "{colors.status-neutral-text}", rounded: "{rounded.badge}", padding: "4px 9px"}
  panel: {backgroundColor: "{colors.surface}", rounded: "{rounded.panel}", padding: "26px"}
---
# Design System: Calo Ingest

## Overview
**Creative North Star: "Vietnamese nutrition ledger"**
The shipped Operate-mode interface organizes recorded meals, nutrition totals, and personal bot connections into a calm working ledger. A pine navigation rail anchors white work surfaces; compact labels and aligned figures keep attention on the records.
This document describes the implemented system in `public/app.css` and `public/app.js`; its language records the chosen direction, without asserting additional user preferences.
**Key Characteristics:**
- Pine navigation, white surfaces, restrained green emphasis.
- Vietnamese text, clear form labels, tabular nutrition figures.
- Responsive records, honest empty states, visible operational status.

## Colors
Primary pine anchors navigation and primary actions; green marks links and field focus. Mint supports secondary-action hover. Neutral canvas, white surfaces, muted text, and pale dividers establish hierarchy. Semantic positive, paused, and neutral status pairs accompany text labels; danger is reserved for destructive actions.
**The Status Label Rule.** Pair every status color with readable status text.

## Typography
Self-hosted Be Vietnam Pro is registered as “Be Vietnam,” with system-ui and sans-serif fallbacks; regular and semibold are the reused weights. Use the frontmatter headline, title, body, and label roles. Supporting copy ranges from .75rem to .875rem; dense tables use .85rem. Metrics use semibold, tightly tracked figures with tabular numerals.
**The Numeric Alignment Rule.** Use tabular numerals and right alignment for comparable table values; keep units visible.

## Layout
Desktop uses a sticky full-height rail (238px), an 86px top bar, and a centered work area capped at 1600px with 42px horizontal padding. Four summary metrics share a bordered strip; analytics use a two-to-one grid and 24px section gaps. Settings pair the main form with a 300px help column.
At 1180px the rail narrows to 205px, work padding becomes 28px, and settings stack. At 760px navigation moves above the work area into two columns, metrics form a two-by-two grid, analytics and forms stack, and content uses 20px side padding. Wide record tables scroll within their container.
Login uses equal white/pine columns on desktop and stacked sections on mobile.

## Elevation & Depth
Work surfaces stay flat: borders, tonal separation, and spacing establish depth. Only transient toast feedback uses a soft shadow. Desktop content arrives briefly; buttons change color quickly. Reduced-motion preference removes animations and transitions.

## Shapes
Controls and navigation have gently rounded corners; panels use a slightly larger radius, and small status labels use the compact badge radius. Avatars are circular. Thin borders divide records and group related measures.

## Components
Buttons share semibold labels, inline icons, and primary, bordered secondary, or quiet treatments. Main buttons have a 44px minimum height, rising to 46px on mobile; disabled submission buttons visibly dim and show a processing label.
Inputs and selects use white surfaces, a thin field border, visible labels, and muted hints. Focus changes the field border to green; retain a visible keyboard-focus indicator for all controls.
Navigation pairs outline icons with text and uses `aria-current="page"` for the filled active state. The mobile layout retains these labels in its two-column grid.
Panels group charts, forms, and tables. Status badges label operational states, counts, and estimate confidence with the corresponding semantic pair.
The daily bar chart is derived from recorded kcal, includes zero-value days, and offers an expandable daily data table. Macro bars represent the recorded mass proportions, with explanatory text rather than an implied goal.

## Do's and Don'ts
- **Do** reuse the pine rail, white bordered work surfaces, and Be Vietnam typography.
- **Do** preserve Vietnamese labels, visible units, keyboard focus, and responsive table scrolling.
- **Don't** present fabricated nutrition values as recorded meals.
- **Don't** use color alone to communicate status or estimate confidence.
