# Linear Status Category Icons — Design Doc

## Problem

Issue rows in the sidebar display a plain 8x8px colored dot to indicate status. The dot conveys color but not category — users cannot tell at a glance whether an issue is in Backlog, In Progress, Done, or Cancelled without reading the status text (only visible via the context menu state picker). Linear's own UI uses distinct icon shapes per category, making status instantly recognizable.

## Solution

Replace the colored dot with category-specific SVG icons that match Linear's visual language. Each of Linear's 6 fixed state categories (`triage`, `backlog`, `unstarted`, `started`, `completed`, `cancelled`) gets a distinct icon shape, colored with the issue's `stateColor`.

## Design

### New Component: `StateIcon.tsx`

A pure, stateless component that maps `stateType` to an SVG icon.

**Props:**
```typescript
interface StateIconProps {
  type: string;       // Linear stateType value
  color: string;      // Linear stateColor hex value (e.g. "#e2e2e2")
  size?: number;      // Icon size in px (default: 14)
}
```

**Icon mappings (all 14x14, `viewBox="0 0 14 14"`, `aria-hidden="true"`):**

| `stateType`  | Icon Shape                                          | Visual Description                        |
|-------------|-----------------------------------------------------|-------------------------------------------|
| `triage`    | Dashed circle (`stroke-dasharray`)                   | Dotted circle outline — urgency/attention |
| `backlog`   | Thin circle (stroke only, `strokeWidth="1.5"`)       | Empty ring — nothing started              |
| `unstarted` | Filled circle outline with inner dot                 | Ring with center dot — queued up          |
| `started`   | Half-filled circle (arc path)                        | Half-filled ring — work in progress       |
| `completed` | Filled circle with white checkmark                   | Solid circle + check — done              |
| `cancelled` | Circle with X through it                             | Crossed-out circle — won't do            |

**Color application:**
- `color` prop applied as `stroke` for outline icons (`triage`, `backlog`, `unstarted`)
- `color` prop applied as both `fill` and `stroke` for filled icons (`started`, `completed`, `cancelled`)
- The checkmark in `completed` uses white (`#fff`) stroke for contrast against the filled circle

**Fallback:** Unknown `stateType` values render a basic filled dot (backward-compatible with current behavior).

**Styling:** `shrink-0` applied to the outer `<svg>` element to prevent layout compression in flex rows.

### Integration in `LinearIssueList.tsx`

Replace the existing status dot:

```tsx
{/* Before — plain colored dot */}
<span
  className="h-2 w-2 shrink-0 rounded-full"
  style={{ backgroundColor: issue.stateColor }}
/>

{/* After — category icon */}
<StateIcon type={issue.stateType} color={issue.stateColor} />
```

No other changes to `LinearIssueList.tsx`.

### Scope

- **In scope:** Issue list rows in `LinearIssueList.tsx` only
- **Out of scope:** Context menu state picker, `CreateBranchFromIssueModal` status pill, any other status indicators

## Files Changed

| File | Action |
|------|--------|
| `src/renderer/components/StateIcon.tsx` | Create |
| `src/renderer/components/LinearIssueList.tsx` | Modify (swap dot for StateIcon) |

## Out of Scope

- Animations or transitions on state change
- Tooltip showing state name on hover
- Using StateIcon in the context menu state picker
- Using StateIcon in CreateBranchFromIssueModal
- Adding a `stateType` union type or enum (keeping `string` for now)
