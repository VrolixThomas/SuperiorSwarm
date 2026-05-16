import { useCurrentFrame } from "remotion";
import { AppWindowV4 } from "./AppWindowV4";
import { selectView } from "./WorkspaceViewSelector";
import { type ThemeModeV4, ThemeProviderV4, useColorsV4 } from "./colors-v4";

// Placeholder view stub used during Task 6 only. Replaced by real views in Tasks 7-16.
function ViewStub({ name }: { name: string }) {
	const c = useColorsV4();
	return (
		<div
			style={{
				flex: 1,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				color: c.textSecondary,
				fontFamily: "monospace",
				fontSize: 24,
			}}
		>
			{name}
		</div>
	);
}

interface Props {
	mode?: ThemeModeV4;
}

export function WorkspaceShellV4({ mode = "dark" }: Props) {
	const frame = useCurrentFrame();
	const viewKey = selectView(frame);
	return (
		<ThemeProviderV4 value={mode}>
			<AppWindowV4>
				<ViewStub name={viewKey} />
			</AppWindowV4>
		</ThemeProviderV4>
	);
}
