// s7PRComment renders the full Solve Review tab (mirrors apps/desktop/.../
// SolveReviewTab.tsx) as a fullscreen workspace view. The same scene is
// repeated in s8SolveResult with later animation timing — together they form
// one continuous 14-second "Solve Review" arc.

import { SolveReviewTab } from "../../build-real/SolveReviewTab";

export function WithCommentsPR() {
	return (
		<div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
			<SolveReviewTab />
		</div>
	);
}
