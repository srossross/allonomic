# UI Style Guide: Desktop / IDE Flat Design

## 1. Core Principle: Anti-"Carditis" (No Nested Cards)

- **Problem**: Default AI/web UI tends to wrap every single item, row, and list entry inside a bordered, padded, shadowed card (`border bg-card p-4 rounded-xl shadow`). This creates chunky, cluttered "box-in-a-box" layouts.
- **Rule**: **Flat layouts first.** Use simple flat list rows, subtle dividers (`divide-border/30`), or pure whitespace. Never wrap individual list items in separate cards unless they are distinct draggable widgets or canvas items.

## 2. Radii (Crisp, Small Corners)

- **Rule**: Use small, crisp border radii:
  - Standard elements (inputs, buttons, rows, tabs): `rounded-sm` (2px–4px) or `rounded-xs`.
  - Panels / windows: `rounded-none` or `rounded-sm`.
  - **Never use**: `rounded-xl`, `rounded-2xl`, or `rounded-3xl` for list items, tabs, or rows.

## 3. Density & Spacing (cmux / IDE Density)

- **Padding**: Tight, efficient padding:
  - Rows / list items: `py-1.5 px-2` or `py-1 px-2`.
  - Headers / bars: `h-9` or `h-10`.
  - Panel padding: `p-3` (avoid giant `p-6` or `p-8` empty voids).
- **Typography**:
  - Headers: `text-xs font-medium` or `text-sm font-semibold`.
  - Body / items: `text-xs`.
  - Metadata / shortcuts: `text-[10px]` or `text-[11px]`.

## 4. Tabs & Navigation

- Flat, minimal tabs.
- No bulky pill-inside-pill containers.
- Clean active indicator via border or subtle background highlight (`bg-muted/50 text-foreground`).

## 5. Visual Hierarchy

- Use alignment, typography weight, and subtle opacity (`text-muted-foreground`) to define structure—not heavy borders and background boxes.
