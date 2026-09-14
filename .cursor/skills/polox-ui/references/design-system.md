# Miao UI design system

## Visual thesis

Miao is a focused AI creation console. The persistent sidebar organizes projects and tools; the infinite canvas keeps visual work primary while the conversation lives in a right-side panel. The interface should feel quiet until the user reaches a primary action.

## Tokens

Use the CSS variables in `app/assets/css/tailwind.css` as the source of truth.

| Role | Light value | Usage |
|---|---:|---|
| Canvas | `#f7f7f4` | Main page and infinite canvas |
| Sidebar | `#fafaf7` | Persistent navigation |
| Panel | `#ffffff` | Conversation and cards |
| Raised field | `#f0efe9` | Prompt field and selected controls |
| Hover | `#ecebe6` | Hover and selected navigation |
| Border | `#e6e5e0` | Hairline dividers and panel outlines |
| Primary text | `#26251e` | Headings and important labels |
| Secondary text | `#5a5852` | Descriptions and inactive controls |
| Action | `#26251e` | Default solid buttons, selected ink controls |
| Brand | `#d2e24a` | Scarce acid-lime CTA, focus, generating |
| Success | `#1a7a59` | Connected / verified states only |

## Layout

- Desktop sidebar: 256px. Use the existing sidebar primitives and responsive off-canvas behavior.
- Header: 54px, one bottom border, no heavy shadow.
- Main content: cap task content near 1120px, keep at least 24px desktop gutters and 16px mobile gutters.
- Hero: left-aligned editorial display, 400 weight, tight negative tracking, about 1.05 line height; description no wider than 36rem.
- Workspace: infinite canvas on the left; 400–460px resizable conversation panel on the right. On mobile, place conversation below the canvas.

## Components

- Buttons: 32–36px high for utility actions; ink primary, tonal secondary, bordered white outline. Use acid-lime only for one brand CTA per view.
- Segmented controls: 32px container, 28px options, subtle active surface, never a large pill.
- Inputs: tonal raised surface, quiet placeholder, lime focus ring. Keep them distinct from white panels.
- Cards/panels: 16px radius, 1px border, no floating shadow. Use nested tonal surfaces for hierarchy.
- Navigation: 32px rows, active row `#ecebe6`, 8px radius, icon and label aligned on a 16px rhythm.
- Status chips: compact and semantic. Keep the lime `New` badge only for genuinely new features.

## Motion and states

- Use 150–200ms color/opacity transitions.
- Do not animate layout for decoration. Respect `prefers-reduced-motion`.
- Hover changes one tonal step. Active controls remain obvious without glow.
- Disabled actions retain the accent hue at reduced opacity so action location stays legible.

## Responsive behavior

- Below tablet width, collapse navigation into the existing sheet.
- Scale the hero down before reducing page gutters.
- Stack workspace controls; keep the primary action full-width when it prevents crowding.
- Never allow toolbar controls or uploaded-image previews to force horizontal page scrolling.

## Canonical implementation points

- Theme tokens: `app/assets/css/tailwind.css`
- Shell: `app/layouts/default.vue`
- Header and navigation: `app/components/layout/`
- Hero: `app/pages/index.vue`
- Creation workspace: `app/components/ai-generator/AiGeneratorForm.vue`
- Segmented controls: `app/components/ai-generator/AiGeneratorCategoryTabs.vue` and `AiGeneratorTaskTabs.vue`

## Visual review checklist

- Does the main action win without making the rest of the interface green?
- Are nested surfaces separated by tone and a single hairline, not shadows?
- Are all radii from the 8/12/16px system?
- Is muted copy readable without competing with the heading?
- Do focus, hover, active, disabled, empty, and loading states remain distinct?
- Does the page remain usable at 375px and at a typical 1440px desktop viewport?
