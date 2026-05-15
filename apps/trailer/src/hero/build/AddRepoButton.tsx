import { C } from "./colors";

interface Props {
	opacity?: number;
}

// Mirrors the "Add Repository" button at bottom of Repos sidebar segment.
export function AddRepoButton({ opacity = 1 }: Props) {
	return (
		<div
			style={{
				margin: "12px 8px 0",
				padding: "6px 12px",
				borderRadius: 6,
				display: "flex",
				alignItems: "center",
				gap: 8,
				fontSize: 12,
				color: C.textQuaternary,
				opacity,
			}}
		>
			<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
				<path
					d="M8 3v10M3 8h10"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
				/>
			</svg>
			Add Repository
		</div>
	);
}
