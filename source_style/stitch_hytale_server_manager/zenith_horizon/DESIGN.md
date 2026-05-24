---
name: Zenith Horizon
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#bbcac6'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#859490'
  outline-variant: '#3c4947'
  surface-tint: '#4fdbc8'
  primary: '#4fdbc8'
  on-primary: '#003731'
  primary-container: '#14b8a6'
  on-primary-container: '#00423b'
  inverse-primary: '#006b5f'
  secondary: '#ffb95f'
  on-secondary: '#472a00'
  secondary-container: '#ee9800'
  on-secondary-container: '#5b3800'
  tertiary: '#6bd8cb'
  on-tertiary: '#003732'
  tertiary-container: '#44b5a8'
  on-tertiary-container: '#00423c'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#71f8e4'
  primary-fixed-dim: '#4fdbc8'
  on-primary-fixed: '#00201c'
  on-primary-fixed-variant: '#005048'
  secondary-fixed: '#ffddb8'
  secondary-fixed-dim: '#ffb95f'
  on-secondary-fixed: '#2a1700'
  on-secondary-fixed-variant: '#653e00'
  tertiary-fixed: '#89f5e7'
  tertiary-fixed-dim: '#6bd8cb'
  on-tertiary-fixed: '#00201d'
  on-tertiary-fixed-variant: '#005049'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
    letterSpacing: -0.01em
  title-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.4'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '700'
    lineHeight: '1.0'
    letterSpacing: 0.05em
  code:
    fontFamily: monospace
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.6'
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 0.5rem
  sm: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  gutter: 1.5rem
  margin: 2rem
---

## Brand & Style

The design system is engineered for the high-performance Hytale server administrator. It balances the precision of a professional DevOps tool with the immersive, adventurous aesthetic of the Hytale universe. The personality is authoritative, reliable, and technologically advanced.

The visual style utilizes **Modern Glassmorphism** layered over a **Minimalist** foundation. It prioritizes data density and clarity while using translucent materials and glowing accents to evoke a "command center" atmosphere. This approach ensures that complex server metrics remain readable while feeling integral to the gaming ecosystem.

## Colors

The palette is anchored in **Deep Slates** to provide a sophisticated, low-strain environment for long sessions. 
- **Primary Teal (#14B8A6):** Used for primary actions, success states, and key navigational highlights. It represents the "energy" of the server.
- **Amber Accents (#F59E0B):** Reserved for warnings, update notifications, and secondary emphasis to create a high-contrast focal point against the cool base.
- **Neutral Slates:** Range from `#020617` (deep background) to `#1E293B` (component surfaces), providing a clear hierarchy of information depth.

## Typography

This design system utilizes **Inter** for its exceptional readability in data-heavy environments. The typographic scale is designed to distinguish between high-level server status and granular log data. 

Upper-case labels with slight letter spacing are used for metadata and categories to create a professional, "interface-grade" look. Monospaced fonts are integrated specifically for server console outputs and technical paths, maintaining a distinct visual boundary between UI text and system data.

## Layout & Spacing

The layout follows a **Fluid Grid** system with a 12-column structure for the main dashboard and a 4-column structure for sidebars. 

A tight 4px-based rhythm ensures the UI feels crisp and dense without becoming cluttered. Primary navigation is positioned in a slim left-hand sidebar, while the main content area utilizes cards to group related metrics (e.g., RAM usage, Player Count, and Console). Large margins (32px) are used to frame the main workspace, providing breathing room against the dark background.

## Elevation & Depth

This design system uses **Tonal Layering** and **Glassmorphism** to communicate hierarchy. 
1. **Level 0 (Background):** Deepest slate `#020617`, solid and matte.
2. **Level 1 (Cards):** `#0F172A` with a subtle 1px border of `white/10%`. This layer uses a subtle backdrop blur (8px) to feel light yet structured.
3. **Level 2 (Popovers/Tooltips):** `#1E293B` with a slightly more pronounced shadow (0 10px 25px -5px rgba(0,0,0,0.5)).

All elevated surfaces should feature a "rim light"—a subtle top-border highlight—to simulate a light source from above, giving the elements a physical, machined quality.

## Shapes

The design system uses **Soft (0.25rem)** roundedness to maintain a precise, professional aesthetic. While Hytale's world is blocky, the manager UI uses subtle rounding to soften the digital experience and differentiate the tool from the game itself.

- **Standard Elements:** 4px radius (Buttons, Inputs, Small Cards).
- **Large Containers:** 8px radius (Main Dashboard Panels).
- **Status Indicators:** Full pill-shape for high-visibility status chips.

## Components

### Buttons & Actions
- **Primary:** Solid Teal background with white text. On hover, apply a subtle outer glow using the primary color.
- **Secondary:** Transparent background with a Teal 1px border.
- **Ghost:** No background/border; only visible on hover with a `white/5%` fill.

### Status Indicators
- **Running:** A Teal pill with a small "pulse" animation dot.
- **Stopped:** A Slate-400 pill for inactive states, or Red for errors.
- **Updating:** An Amber pill with a rotating "sync" icon.

### Cards & Modules
All cards should use the Level 1 elevation (subtle glassmorphism). Headers within cards should have a thin bottom-border separator (`white/5%`).

### Inputs & Terminal
Input fields use the `surface_slate_900` fill with a `white/10%` border that glows Teal on focus. The console/terminal component should have a distinct `#000000` background with Teal or Amber text to simulate a vintage high-tech monitor.

### Lists & Tables
Rows should feature a hover state of `white/2%` and utilize a 1px divider. Data density is high; vertical padding in lists should be kept to `xs` or `sm` increments.