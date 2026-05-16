// s8SolveResult — continuation of s7's Solve Review tab. Same component;
// timing-driven differentiation lives inside SolveReviewTab + its children.

import { SolveReviewTab } from "../../build-real/SolveReviewTab";

export function SolveResultFull() {
	return (
		<div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
			<SolveReviewTab />
		</div>
	);
}
