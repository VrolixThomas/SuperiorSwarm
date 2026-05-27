import { interpolate, useCurrentFrame } from "remotion";
import { C } from "./colors";
import { INTER } from "./fonts";

interface JiraProject {
	id: string;
	key: string;
	count: number;
}

interface LinearTeam {
	id: string;
	name: string;
	count: number;
}

const JIRA_PROJECTS: JiraProject[] = [
	{ id: "sup", key: "SUP", count: 12 },
	{ id: "inf", key: "INF", count: 4 },
];

const LINEAR_TEAMS: LinearTeam[] = [
	{ id: "superiorswarm", name: "SuperiorSwarm", count: 18 },
	{ id: "platform", name: "Platform", count: 6 },
	{ id: "growth", name: "Growth", count: 3 },
];

const TOTAL_COUNT =
	JIRA_PROJECTS.reduce((acc, p) => acc + p.count, 0) +
	LINEAR_TEAMS.reduce((acc, t) => acc + t.count, 0);

interface Props {
	entryFrame: number;
}

interface RowAnim {
	opacity: number;
	transform: string;
}

function useRowAnim(start: number): RowAnim {
	const frame = useCurrentFrame();
	const opacity = interpolate(frame, [start, start + 12], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const x = interpolate(frame, [start, start + 12], [-8, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	return { opacity, transform: `translateX(${x}px)` };
}

function SectionHeader({ label, anim }: { label: string; anim: RowAnim }) {
	return (
		<div
			style={{
				padding: "6px 12px 4px 12px",
				fontSize: 10,
				fontWeight: 600,
				letterSpacing: "0.05em",
				textTransform: "uppercase",
				color: C.textQuaternary,
				opacity: anim.opacity,
				transform: anim.transform,
			}}
		>
			{label}
		</div>
	);
}

function Divider() {
	return (
		<div
			style={{
				height: 1,
				margin: "4px 12px",
				background: C.borderSubtle,
			}}
		/>
	);
}

function CountLabel({ value, active }: { value: number; active: boolean }) {
	return (
		<span
			style={{
				fontSize: 10,
				fontVariantNumeric: "tabular-nums",
				color: active ? C.textSecondary : C.textQuaternary,
				flexShrink: 0,
			}}
		>
			{value}
		</span>
	);
}

export function TicketsSidebarContent({ entryFrame }: Props) {
	const allAnim = useRowAnim(entryFrame);
	const jiraHeaderAnim = useRowAnim(entryFrame + 10);
	const linearHeaderAnim = useRowAnim(entryFrame + 10 + (JIRA_PROJECTS.length + 1) * 8);

	return (
		<div style={{ display: "flex", flexDirection: "column", fontFamily: INTER }}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					margin: "0 8px",
					padding: "6px 8px",
					borderRadius: 6,
					background: C.accentSubtle,
					opacity: allAnim.opacity,
					transform: allAnim.transform,
				}}
			>
				<svg
					width="11"
					height="11"
					viewBox="0 0 16 16"
					fill="none"
					style={{ flexShrink: 0, color: C.text }}
					aria-hidden="true"
				>
					<rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
					<rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
					<rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
					<rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
				</svg>
				<span
					style={{
						flex: 1,
						fontSize: 11,
						fontWeight: 500,
						color: C.text,
					}}
				>
					All Tickets
				</span>
				<CountLabel value={TOTAL_COUNT} active={true} />
			</div>

			<Divider />

			<SectionHeader label="Jira" anim={jiraHeaderAnim} />
			<div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
				{JIRA_PROJECTS.map((p, i) => {
					const start = entryFrame + 18 + i * 8;
					return <JiraRow key={p.id} project={p} start={start} />;
				})}
			</div>

			<Divider />

			<SectionHeader label="Linear" anim={linearHeaderAnim} />
			<div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
				{LINEAR_TEAMS.map((t, i) => {
					const start = entryFrame + 18 + (JIRA_PROJECTS.length + 1 + i) * 8;
					return <LinearRow key={t.id} team={t} start={start} />;
				})}
			</div>
		</div>
	);
}

function JiraRow({ project, start }: { project: JiraProject; start: number }) {
	const anim = useRowAnim(start);
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				margin: "0 8px",
				padding: "5px 8px",
				borderRadius: 6,
				opacity: anim.opacity,
				transform: anim.transform,
			}}
		>
			<div
				style={{
					width: 6,
					height: 6,
					borderRadius: 2,
					background: C.textQuaternary,
					flexShrink: 0,
				}}
			/>
			<span
				style={{
					flex: 1,
					fontSize: 11,
					color: C.textSecondary,
				}}
			>
				{project.key}
			</span>
			<CountLabel value={project.count} active={false} />
		</div>
	);
}

function LinearRow({ team, start }: { team: LinearTeam; start: number }) {
	const anim = useRowAnim(start);
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				margin: "0 8px",
				padding: "5px 8px",
				borderRadius: 6,
				opacity: anim.opacity,
				transform: anim.transform,
			}}
		>
			<div
				style={{
					width: 6,
					height: 6,
					borderRadius: 999,
					background: C.textQuaternary,
					flexShrink: 0,
				}}
			/>
			<span
				style={{
					flex: 1,
					fontSize: 11,
					color: C.textSecondary,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{team.name}
			</span>
			<CountLabel value={team.count} active={false} />
		</div>
	);
}
