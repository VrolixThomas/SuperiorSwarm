import type { ComponentProps } from "react";
import { StepDiff } from "../step/StepDiff";
type ChangesViewProps = Omit<ComponentProps<typeof StepDiff>, "threads"> & {
	allThreads: ComponentProps<typeof StepDiff>["threads"];
};
export function ChangesView({ allThreads, ...props }: ChangesViewProps) {
	return <StepDiff {...props} threads={allThreads} />;
}
