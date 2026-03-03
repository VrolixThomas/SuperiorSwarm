# Linear Status Category Icons — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace plain colored dots with Linear-style category icons in the issue list sidebar.

**Architecture:** A new pure `StateIcon` component maps `stateType` strings to SVG icons. It's imported into `LinearIssueList.tsx` replacing the existing `<span>` dot. No state management, no API changes, no data model changes.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, inline SVGs (no icon libraries)

---

### Task 1: Create `StateIcon.tsx` component

**Files:**
- Create: `apps/desktop/src/renderer/components/StateIcon.tsx`

**Step 1: Create the StateIcon component**

Create `apps/desktop/src/renderer/components/StateIcon.tsx` with all 6 icon variants plus a fallback:

```tsx
interface StateIconProps {
	type: string;
	color: string;
	size?: number;
}

export function StateIcon({ type, color, size = 14 }: StateIconProps) {
	const svgProps = {
		"aria-hidden": "true" as const,
		width: size,
		height: size,
		viewBox: "0 0 14 14",
		fill: "none",
		className: "shrink-0",
	};

	switch (type) {
		case "triage":
			return (
				<svg {...svgProps}>
					<circle
						cx="7"
						cy="7"
						r="5.5"
						stroke={color}
						strokeWidth="1.5"
						strokeDasharray="3.14 3.14"
						fill="none"
					/>
				</svg>
			);

		case "backlog":
			return (
				<svg {...svgProps}>
					<circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.5" fill="none" />
				</svg>
			);

		case "unstarted":
			return (
				<svg {...svgProps}>
					<circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.5" fill="none" />
					<circle cx="7" cy="7" r="2" fill={color} />
				</svg>
			);

		case "started":
			return (
				<svg {...svgProps}>
					<circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.5" fill="none" />
					<path d="M7 1.5 A5.5 5.5 0 0 1 7 12.5" fill={color} />
				</svg>
			);

		case "completed":
			return (
				<svg {...svgProps}>
					<circle cx="7" cy="7" r="6" fill={color} />
					<path
						d="M4.5 7.2 L6.2 8.9 L9.5 5.5"
						stroke="#fff"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						fill="none"
					/>
				</svg>
			);

		case "cancelled":
			return (
				<svg {...svgProps}>
					<circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.5" fill="none" />
					<path
						d="M5 5 L9 9 M9 5 L5 9"
						stroke={color}
						strokeWidth="1.5"
						strokeLinecap="round"
					/>
				</svg>
			);

		default:
			return (
				<svg {...svgProps}>
					<circle cx="7" cy="7" r="4" fill={color} />
				</svg>
			);
	}
}
```

**Step 2: Run type-check**

Run: `bun run type-check` (from `apps/desktop/`)
Expected: PASS (no new errors)

**Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/StateIcon.tsx
git commit -m "feat: add StateIcon component with Linear-style status category icons"
```

---

### Task 2: Integrate StateIcon into LinearIssueList

**Files:**
- Modify: `apps/desktop/src/renderer/components/LinearIssueList.tsx:1` (add import)
- Modify: `apps/desktop/src/renderer/components/LinearIssueList.tsx:181-185` (swap dot for StateIcon)

**Step 1: Add import and swap the status dot**

In `LinearIssueList.tsx`:

1. Add import at the top (after existing imports, line 6):
```tsx
import { StateIcon } from "./StateIcon";
```

2. Replace the status dot span (lines 181-185):
```tsx
{/* Status dot */}
<span
	className="h-2 w-2 shrink-0 rounded-full"
	style={{ backgroundColor: issue.stateColor }}
/>
```
With:
```tsx
<StateIcon type={issue.stateType} color={issue.stateColor} />
```

**Step 2: Run type-check**

Run: `bun run type-check` (from `apps/desktop/`)
Expected: PASS (no new errors)

**Step 3: Run tests**

Run: `bun test` (from `apps/desktop/`)
Expected: All 178 tests pass

**Step 4: Run lint**

Run: `bun run check` (from repo root)
Expected: No new errors from our changes

**Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/LinearIssueList.tsx
git commit -m "feat: replace status dot with StateIcon in issue list"
```
