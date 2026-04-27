import type { SolveCommentInfo } from "../../../shared/solve-types";
import { SolveCommentCard } from "./SolveCommentCard";

interface Props {
	comment: SolveCommentInfo;
	workspaceId: string;
	isActive?: boolean;
}

export function SolveCommentWidget({ comment, workspaceId, isActive }: Props) {
	return (
		<SolveCommentCard
			comment={comment}
			workspaceId={workspaceId}
			variant="inline"
			isActive={isActive}
		/>
	);
}
