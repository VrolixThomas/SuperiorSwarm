import { RailList, type RailListProps } from "./RailList";

/** Folder headers and file order are supplied exclusively by railItems(). */
export function FilesRail(props: RailListProps) {
	return <RailList {...props} />;
}
