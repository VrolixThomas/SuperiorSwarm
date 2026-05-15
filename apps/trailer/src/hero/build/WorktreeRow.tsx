import { interpolate, useCurrentFrame } from "remotion";
import { C } from "./colors";
import { SwarmIndicator } from "./SwarmIndicator";
import { useEntry } from "./useEntry";

interface Props {
	branch: string;
	entryFrame: number;
	active?: boolean;
	inActiveProject?: boolean;
	swarmEntryFrame?: number;
	swarmFlipToDoneAt?: number;
	statusEntryFrame?: number;
	statusFlipToDoneAt?: number;
}

export function WorktreeRow({
	branch,
	entryFrame,
	active = false,
	inActiveProject = true,
	swarmEntryFrame,
	swarmFlipToDoneAt,
	statusEntryFrame,
	statusFlipToDoneAt,
}: Props) {
	const frame = useCurrentFrame();
	const entry = useEntry({ from: entryFrame, dx: -16, dy: -6 });
	const swarmOp = swarmEntryFrame !== undefined
		? interpolate(frame, [swarmEntryFrame, swarmEntryFrame + 14], [0, 1], {
				extrapolateLeft: "clamp",
				extrapolateRight: "clamp",
			})
		: 0;
	const swarmState: "active" | "done" =
		swarmFlipToDoneAt !== undefined && frame >= swarmFlipToDoneAt ? "done" : "active";

	const statusVisible = statusEntryFrame !== undefined && frame >= statusEntryFrame - 4;
	const statusDone =
		statusFlipToDoneAt !== undefined && frame >= statusFlipToDoneAt;

	const nameColor = active
		? C.text
		: inActiveProject
			? C.textSecondary
			: C.textTertiary;

	return (
		<div
			style={{
				position: "relative",
				margin: "0 4px",
				padding: "7px 12px 7px 22px",
				borderRadius: 6,
				display: "flex",
				alignItems: "center",
				gap: 8,
				background: active ? C.accentSubtle : "transparent",
				...entry,
			}}
		>
			{active && inActiveProject && (
				<span
					style={{
						position: "absolute",
						left: 0,
						top: 4,
						bottom: 4,
						width: 3,
						borderRadius: "0 2px 2px 0",
						background: C.accent,
					}}
				/>
			)}
			<div style={{ flex: 1, minWidth: 0 }}>
				<div
					style={{
						fontSize: 13,
						fontWeight: active ? 500 : 400,
						color: nameColor,
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
					}}
				>
					{branch}
				</div>
				{statusVisible && (
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 4,
							marginTop: 2,
							fontSize: 10,
							color: C.textQuaternary,
						}}
					>
						{statusDone ? (
							<>
								<svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
									<path
										d="M5 8l2 2 4-4"
										stroke={C.termGreen}
										strokeWidth="1.5"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
								comments resolved
							</>
						) : (
							<>
								<svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
									<path
										d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V3z"
										stroke={C.textQuaternary}
										strokeWidth="1.3"
									/>
								</svg>
								solving comments
							</>
						)}
					</div>
				)}
			</div>
			{swarmEntryFrame !== undefined && (
				<div style={{ opacity: swarmOp }}>
					<SwarmIndicator state={swarmState} size={20} />
				</div>
			)}
		</div>
	);
}
