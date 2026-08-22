# 🪐 Astryx Design System Specification: FxAeon UI Architecture

FxAeon’s user interface is engineered using the principles of **Meta’s Astryx Design System** and **StyleX** architecture. It provides an agent-ready, accessible, high-performance design token cascade optimized for Telegram's compact mobile viewport and high-frequency financial trading.

---

## 1. Core Architectural Pillars

```
                      ╔═══════════════════════════════════════════════╗
                      ║          ASTRYX DESIGN SYSTEM MATRIX          ║
                      ╚═══════════════════════════════════════════════╝
                                              │
          ┌───────────────────┬───────────────┴───────────────┬───────────────────┐
          ▼                   ▼                               ▼                   ▼
   1. Surface Layers   2. Elevation Glows              3. Spring Physics   4. Accessible Tokens
      Subtle, Canvas,     Multi-layered shadows with      60fps cubic-bezier   WCAG 2.1 AAA contrast
      Default, Raised,    specular rim lighting &         haptic micro-taps   and visible focus
      Overlay & Glass     ambient accent reflections      (scale 0.975)       rings with 2px offset
```

1. **Customization Without Wrapping**: System tokens are defined as CSS Custom Properties in [`apps/mini-app/src/app/globals.css`](file:///c:/Users/dexen/Downloads/FxAeon-main/FxAeon-main/apps/mini-app/src/app/globals.css) and cascaded dynamically across 4 OLED palettes without altering component source code.
2. **Deterministic Elevation Cascade**: 4-tier elevation hierarchy (`--astryx-elevation-0` through `--astryx-elevation-3`) with specular edge highlights and ambient color halos.
3. **Agent-Ready Machine-Readable Contracts**: Strict, typed props contracts on all core primitives (`Button`, `Card`, `Stat`, `Segmented`, `HoloCard`, `HealthChip`).
4. **Spring Micro-Interactions**: Physics-modeled spring curves (`cubic-bezier(0.175, 0.885, 0.32, 1.15)`) coupled with Web Audio synthesizer feedback and Telegram native haptic pulses.

---

## 2. Design Token Dictionary

### A. Surface Hierarchy
| Token | Variable | Value (Default / Deep Space) | Purpose |
|---|---|---|---|
| **Canvas** | `--astryx-surface-canvas` | `#07070d` | Base viewport background for OLED pitch-black contrast. |
| **Subtle** | `--astryx-surface-subtle` | `#0e0e1a` | Low-emphasis inset containers, search bars, and code tags. |
| **Default** | `--astryx-surface-default` | `#12121e` | Standard card backgrounds and action tiles. |
| **Raised** | `--astryx-surface-raised` | `#181829` | Modals, active dropdowns, and bottom sheets. |
| **Overlay** | `--astryx-surface-overlay` | `#212038` | Floating tooltips, toasts, and dialog popovers. |
| **Glass** | `--astryx-surface-glass` | `rgba(18, 18, 30, 0.72)` | Blur-filtered frosted sheets with 16px saturation. |

### B. Specular Border Lighting & Radii
```css
--astryx-border-subtle:   rgba(255, 255, 255, 0.07);
--astryx-border-default:  rgba(255, 255, 255, 0.12);
--astryx-border-strong:   rgba(255, 255, 255, 0.22);
--astryx-border-specular: linear-gradient(180deg, rgba(255, 255, 255, 0.18) 0%, rgba(255, 255, 255, 0.04) 100%);
--astryx-border-glow:     rgba(139, 109, 255, 0.35);

--astryx-radius-sm:   8px;   /* Inline chips & small badges */
--astryx-radius-md:  14px;   /* Inputs, select buttons & tabs */
--astryx-radius-lg:  20px;   /* Standard content cards */
--astryx-radius-xl:  28px;   /* Floating modals & 3D Holo Cards */
--astryx-radius-full: 9999px; /* Pill buttons & status pills */
```

### C. Elevation & Lighting Shadows
* `--astryx-elevation-1`: `0 4px 16px -2px rgba(0, 0, 0, 0.5), 0 1px 3px rgba(0, 0, 0, 0.3)`
* `--astryx-elevation-2`: `0 12px 32px -4px rgba(0, 0, 0, 0.65), 0 2px 6px rgba(0, 0, 0, 0.4)`
* `--astryx-elevation-3`: `0 24px 56px -8px rgba(0, 0, 0, 0.8), 0 4px 12px rgba(0, 0, 0, 0.5)`
* `--astryx-elevation-glow`: `0 0 28px -4px var(--mint-glow)`

---

## 3. Component Architecture & API Contracts

### A. `<Card />`
```tsx
interface CardProps {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  elevation?: 1 | 2 | 3;
}
```
* **Render Model**: Applies Astryx specular border gradients with layered backdrop blurs (`backdrop-filter: blur(16px) saturate(160%)`).

### B. `<Button />`
```tsx
interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger' | 'outline' | 'glass';
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}
```
* **Interaction**: Integrated with Astryx spring physics (`scale(0.975)`), haptic pulses (`haptic('medium')`), and optional spin-locked loading states.

### C. `<HoloCard />` (3D Gyroscope Holographic Card)
```tsx
interface HoloCardProps {
  market?: string;
  side?: 'long' | 'short';
  leverage?: number;
  pnlPct?: number;
  pnlUsd?: number;
  entryPrice?: number;
  currentPrice?: number;
  traderName?: string;
  referralCode?: string;
  foil?: 'rainbow' | 'gold' | 'cyber' | 'darkmatter';
}
```
* **Physics Engine**: Calculates tilt via pointer coordinates or mobile `DeviceOrientationEvent` gamma/beta angles to deliver real-time 3D parallax lighting reflections.

---

## 4. Cyber Theme Cascades

The Astryx design token tree supports instant zero-bundle dynamic switching across 4 OLED palettes:

1. 🌌 **Deep Space Violet** (`accent: #8b6dff`, `canvas: #07070d`)
2. 📟 **Matrix Terminal** (`accent: #00ff88`, `canvas: #050906`)
3. ⚡ **Neon Velocity** (`accent: #ff2a85`, `canvas: #0a0610`)
4. 🪙 **Monochrome Titanium** (`accent: #e2e8f0`, `canvas: #09090b`)
