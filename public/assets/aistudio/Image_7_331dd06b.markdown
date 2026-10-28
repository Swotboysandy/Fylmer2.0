---
name: High-Contrast Tactile Studio
colors:
  surface: '#111316'
  surface-dim: '#111316'
  surface-bright: '#37393d'
  surface-container-lowest: '#0c0e11'
  surface-container-low: '#1a1c1f'
  surface-container: '#1e2023'
  surface-container-high: '#282a2d'
  surface-container-highest: '#333538'
  on-surface: '#e2e2e6'
  on-surface-variant: '#bdc8d1'
  inverse-surface: '#e2e2e6'
  inverse-on-surface: '#2f3034'
  outline: '#87929a'
  outline-variant: '#3e484f'
  surface-tint: '#7bd0ff'
  primary: '#8ed5ff'
  on-primary: '#00354a'
  primary-container: '#38bdf8'
  on-primary-container: '#004965'
  inverse-primary: '#00668a'
  secondary: '#ffb95f'
  on-secondary: '#472a00'
  secondary-container: '#ee9800'
  on-secondary-container: '#5b3800'
  tertiary: '#56e5a9'
  on-tertiary: '#003824'
  tertiary-container: '#30c88f'
  on-tertiary-container: '#004e34'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#c4e7ff'
  primary-fixed-dim: '#7bd0ff'
  on-primary-fixed: '#001e2c'
  on-primary-fixed-variant: '#004c69'
  secondary-fixed: '#ffddb8'
  secondary-fixed-dim: '#ffb95f'
  on-secondary-fixed: '#2a1700'
  on-secondary-fixed-variant: '#653e00'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#111316'
  on-background: '#e2e2e6'
  surface-variant: '#333538'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 34px
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-sm:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
  body-bold:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '700'
    lineHeight: 26px
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: 0.02em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.03em
  shortcut-key:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-sm: 1rem
  gutter-lg: 2rem
  margin: 2rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

The design system establishes a high-performance creative workspace engineered specifically for blind, low-vision, and multimodal filmmakers. The visual language blends precision audio-visual tooling with uncompromising accessibility standards, surpassing standard WCAG AAA thresholds. It rejects generic dark modes in favor of an intentional, glare-free, deep-slate studio environment where every element communicates status, spatial orientation, and keyboard focus without ambiguity.

The style merges **High-Contrast Structuralism** with **Tactile Functionalism**. Surfaces are anchored by crisp structural borders rather than diffuse shadows, ensuring edge detection remains effortless across varied assistive visual technologies. The interface evokes the confidence, authority, and tactile feedback of broadcast-grade mastering hardware, pairing expressive audio waveforms and screen-reader visual telemetry with ultra-sharp typographic hierarchy.

## Colors

The palette is tuned for extreme contrast, dark-room comfort, and visual clarity:

- **Canvas & Surfaces:**
  - Base Studio Background: `#121417` (Deep charcoal canvas minimizing ocular fatigue).
  - Surface Card / Module: `#1E232B` (Elevated slate for working storyboard panels, asset bays, and inspector docks).
  - Inactive / Recessed Well: `#16191E` (Timeline tracks and inactive audio lanes).

- **Structural Outlines:**
  - Base Separation Border: `#323A46` (3:1 minimum contrast against base background).
  - High-Definition Contrast Border: `#4B5563` (Emphasizes interactable card boundaries and active splits).

- **Accents & Action Signals:**
  - Primary Electric Sky: `#38BDF8` (Focus indicators, primary action handles, playhead position, and audio scrub heads; meets AAA contrast on `#121417` when weighted properly).
  - Discrepancy & Alert Amber: `#F59E0B` (Warning badges, continuity mismatch flags, voice recognition ambiguity).
  - Discrepancy Text / Accent Highlight: `#FDE047` (Maximum legibility warning text and waveform mismatch slices).
  - Consistency & Success Emerald: `#10B981` (Voice parse confirmation, spatial sync verified, export status).
  - Verified Highlight Green: `#34D399` (Active audio input waveforms and live transcript capture).

- **Typography & High Contrast:**
  - Dominant Text: `#FFFFFF` (Headings, active metrics, primary labels — 15:1+ contrast ratio).
  - Secondary Readout Text: `#E2E8F0` (Body, descriptions, transcript logs, and system feedback).
  - Keyboard Badge Accent: `#94A3B8` on `#0F172A` background.

## Typography

The type system prioritizes immediate legibility, zero glyph ambiguity, and clear distinction between user content, system telemetry, and keyboard interaction cues.

- **Baseline Rule:** Body copy never scales below `16px`. Line heights are generously proportioned (minimum 1.5x) to maintain clear word-shape recognition under high magnification.
- **Primary Typeface (`Inter`):** Selected for tall x-height, open apertures, and distinctive character counters, preventing misreading under screen filters or extreme zoom.
- **Telemetry & Shortcuts (`JetBrains Mono`):** Applied to audio timecodes, screen reader state badges, and inline physical keycap prompts (e.g., `[SPACE]`, `[ENTER]`, `[Y]`, `[N]`). The fixed-width pitch guarantees visual alignment during timeline scrubbing and live voice transcription.

## Layout & Spacing

The layout architecture uses a responsive workspace grid with persistent safe zones for voice status notifications and accessibility docking:

- **Desktop (1200px+):** A 12-column persistent workspace with a 320px fixed left panel for live voice transcript and audio telemetry, a central 6-to-8 column adaptive storyboard stage with audio scrubbing tracks, and a right inspector panel. Canvas margins remain fixed at `margin` (`2rem`) with `gutter` (`1.5rem`).
- **Tablet (768px - 1199px):** An 8-column layout. The live transcript docks to a persistent top bar (minimum 56px touch height), collapsing secondary tools into a bottom drawer.
- **Mobile (< 768px):** A single-column linear stack. Storyboard frames transition to a vertical audio-first card list. Touch targets enforce a strict 48px by 48px hit-box minimum with `space-sm` (`0.5rem`) clear space between interactive elements.
- **Touch & Focus Boundaries:** Every interactive cluster preserves at least `space-md` (`1rem`) separation to prevent accidental pointer misclicks or voice-navigation ambiguous hits.

## Elevation & Depth

To avoid blur-based visual clutter that degrades legibility for low-vision users, the design system minimizes soft dropshadows in favor of **Crisp Dual-Border Stratification and High-Contrast Tonal Tiers**:

- **Tier 0 (Canvas):** `#121417` base.
- **Tier 1 (Panels & Storyboard Cells):** `#1E232B` filled surface bounded by a continuous `1px` solid `#323A46` border.
- **Tier 2 (Modals, Contextual Voice Heads-Up, Overlays):** `#1E232B` background with a prominent `2px` solid `#4B5563` border and an ambient, crisp backing shadow (`0 0 0 1px #000000, 0 16px 32px rgba(0, 0, 0, 0.75)`).
- **Focus Elevation:** Focused interactive components do not rely on elevation depth alone; they activate a non-negotiable `3px` solid `#38BDF8` focus ring with a `2px` transparent outer offset, ensuring compliance across all operating system high-contrast modes.

## Shapes

The design system adopts a **Soft Geometric (`1`)** approach with small corner radii (`0.25rem` / `4px` default, `0.5rem` / `8px` on main container cards).

Sharp, distinct boundaries ensure screen magnifier users can detect the start and end of component regions without rounding distortion. Keycaps and tag chips use strict `4px` corners, maintaining a dense, hardware-inspired character.

## Components

### Buttons
- **Primary Action:** Solid `#38BDF8` background, `#121417` bold typography. Hover shifts to `#7DD3FC`. Active/Pressed shifts to `#0284C7`. Focus state adds a `3px` outline with `#FFFFFF` inner ring. Minimum height: 48px.
- **Secondary / Action Frame:** Surface `#1E232B`, 2px solid `#4B5563` border, `#FFFFFF` text. Focus elevates border to `#38BDF8`.
- **Keyboard Badges inside Buttons:** Nested right-aligned chip styled in `#0F172A` with `#38BDF8` text (e.g., `[Enter]`).

### Storyboard Cards
- Containers use `#1E232B` with a `2px` solid `#323A46` border.
- Active/Selected frame receives a `3px` solid `#38BDF8` perimeter and an automatic top-right status beacon showing frame index and audio status.
- Card interiors feature visual masks with high-contrast segmented outlines (`#38BDF8` dashed or `#F59E0B` warning outline if camera movement or composition has discrepancies).

### Live Screen Reader / Voice Status Indicator
- A persistent high-contrast status dock anchored at the interface perimeter.
- Contains an audio waveform visualizer (real-time rendering in `#34D399` when listening, `#F59E0B` during processing, `#38BDF8` during live speech feedback).
- Live text transcript presented in `label-lg` with `aria-live="polite"` support.

### Audio Scrubbing Timeline
- Track well in `#16191E` with a `1px` border in `#323A46`.
- Rendered waveform blocks in `#38BDF8` (80% opacity) against high-contrast tick marks (`#E2E8F0`).
- Playhead marker: `4px` thick solid `#38BDF8` vertical bar extending through all tracks, capped by a keyboard-focusable thumb labeled with current timecode in JetBrains Mono.

### Chips & Discrepancy Indicators
- **Consistency Verified:** `#10B981` border with a subtle green tint background, `#FFFFFF` text, prepended by a check icon and shortcut cue `[Y]`.
- **Discrepancy / Warning:** `#F59E0B` thick 2px border, `#FDE047` high-contrast text, prepended by alert triangle and shortcut cue `[N]`.

### Form Fields & Inputs
- Background `#16191E`, continuous 2px border in `#323A46`. Text in `#FFFFFF`. Placeholder text in `#94A3B8` (maintaining 4.5:1 ratio).
- Focus state instantly triggers 3px solid `#38BDF8` border with a subtle `#38BDF8` glow ring.