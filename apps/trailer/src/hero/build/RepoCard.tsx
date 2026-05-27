import { C } from "./colors";
import { useEntry } from "./useEntry";

interface Props {
	name: string;
	entryFrame: number;
	expanded?: boolean;
	active?: boolean;
}

// Mirrors apps/desktop/src/renderer/components/RepoGroup.tsx
export function RepoCard({ name, entryFrame, expanded = false, active = false }: Props) {
	const entry = useEntry({ from: entryFrame, dy: -10 });
	const showActiveChrome = active && expanded;

	return (
		<div
			style={{
				borderLeft: showActiveChrome ? `2px solid ${C.accentSubtle}` : "2px solid transparent",
				borderRadius: showActiveChrome ? 2 : 0,
				...entry,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					padding: "6px 12px",
					margin: "0 4px",
					borderRadius: showActiveChrome ? "0 8px 8px 0" : 8,
					background: showActiveChrome ? C.bgElevated : "transparent",
					color: active ? C.text : C.textQuaternary,
				}}
			>
				<div style={{ minWidth: 0, flex: 1 }}>
					<div
						style={{
							fontSize: 13,
							fontWeight: 600,
							whiteSpace: "nowrap",
							overflow: "hidden",
							textOverflow: "ellipsis",
						}}
					>
						{name}
					</div>
				</div>
				<svg
					width="10"
					height="10"
					viewBox="0 0 10 10"
					fill="none"
					aria-hidden="true"
					style={{
						color: C.textQuaternary,
						transform: `rotate(${expanded ? 90 : 0}deg)`,
						transition: "transform 200ms",
					}}
				>
					<path
						d="M3 1.5L7 5L3 8.5"
						stroke="currentColor"
						strokeWidth="1.3"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			</div>
		</div>
	);
}
