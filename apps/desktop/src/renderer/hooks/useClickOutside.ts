import { useEffect, type RefObject } from "react";

export function useClickOutside(
	ref: RefObject<HTMLElement | null>,
	onClickOutside: () => void,
	enabled = true
): void {
	useEffect(() => {
		if (!enabled) return;
		function handleMouseDown(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				onClickOutside();
			}
		}
		document.addEventListener("mousedown", handleMouseDown);
		return () => document.removeEventListener("mousedown", handleMouseDown);
	}, [ref, onClickOutside, enabled]);
}
