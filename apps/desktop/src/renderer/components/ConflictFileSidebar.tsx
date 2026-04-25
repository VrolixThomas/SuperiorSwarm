import { useEffect, useRef, useState } from "react";
import type { ConflictFile } from "../../shared/branch-types";
import { shouldSkipShortcutHandling } from "../hooks/useShortcutListener";
import type { ConflictZone } from "./ConflictHintBar";

interface Props {
	files: ConflictFile[];
	activeFile: string | null;
	onSelectFile: (path: string) => void;
	zone: ConflictZone;
	onFocusEditor: () => void;
}

export function ConflictFileSidebar({
	files,
	activeFile,
	onSelectFile,
	zone,
	onFocusEditor,
}: Props) {
	const conflicting = files.filter((f) => f.status === "conflicting");
	const resolved = files.filter((f) => f.status === "resolved");
	const allFiles = [...conflicting, ...resolved];

	const [keyboardIndex, setKeyboardIndex] = useState(0);
	const [flashPaths, setFlashPaths] = useState<Set<string>>(new Set());
	const prevConflictingRef = useRef<Set<string>>(new Set(conflicting.map((f) => f.path)));

	// Flash files that just moved from conflicting → resolved
	useEffect(() => {
		const currentConflicting = new Set(
			files.filter((f) => f.status === "conflicting").map((f) => f.path)
		);
		const newlyResolved: string[] = [];
		for (const path of prevConflictingRef.current) {
			if (!currentConflicting.has(path)) newlyResolved.push(path);
		}
		prevConflictingRef.current = currentConflicting;

		if (newlyResolved.length === 0) return;
		setFlashPaths((prev) => new Set([...prev, ...newlyResolved]));
		const timer = setTimeout(() => {
			setFlashPaths((prev) => {
				const next = new Set(prev);
				for (const p of newlyResolved) next.delete(p);
				return next;
			});
		}, 600);
		return () => clearTimeout(timer);
	}, [files]);

	// Keep keyboardIndex in bounds when file list changes
	useEffect(() => {
		setKeyboardIndex((i) => Math.min(i, Math.max(0, allFiles.length - 1)));
	}, [allFiles.length]);

	// Refs so the keyboard handler always sees fresh values without re-registering
	const keyboardIndexRef = useRef(keyboardIndex);
	useEffect(() => {
		keyboardIndexRef.current = keyboardIndex;
	}, [keyboardIndex]);
	const filesRef = useRef(files);
	useEffect(() => {
		filesRef.current = files;
	}, [files]);

	// Sidebar keyboard navigation — only active when zone === "sidebar"
	useEffect(() => {
		if (zone !== "sidebar") return;

		function handleKeyDown(e: KeyboardEvent) {
			const target = e.target as HTMLElement;
			if (shouldSkipShortcutHandling(e, target) || target.isContentEditable) return;

			const currentFiles = filesRef.current;
			const conflictingFiles = currentFiles.filter((f) => f.status === "conflicting");
			const all = [...conflictingFiles, ...currentFiles.filter((f) => f.status === "resolved")];

			if (e.key === "j" || e.key === "ArrowDown") {
				e.preventDefault();
				setKeyboardIndex((i) => Math.min(i + 1, all.length - 1));
			} else if (e.key === "k" || e.key === "ArrowUp") {
				e.preventDefault();
				setKeyboardIndex((i) => Math.max(i - 1, 0));
			} else if (e.key === "Enter") {
				e.preventDefault();
				const file = all[keyboardIndexRef.current];
				if (file) {
					onSelectFile(file.path);
					onFocusEditor();
				}
			} else if (e.key === "n") {
				e.preventDefault();
				const nextConflicting = conflictingFiles[0];
				if (nextConflicting) {
					onSelectFile(nextConflicting.path);
					onFocusEditor();
				}
			} else if (e.key === "p") {
				e.preventDefault();
				const lastConflicting = conflictingFiles[conflictingFiles.length - 1];
				if (lastConflicting) {
					onSelectFile(lastConflicting.path);
					onFocusEditor();
				}
			}
		}

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [zone, onSelectFile, onFocusEditor]); // files and keyboardIndex accessed via refs

	const isDimmed = zone === "edit";

	return (
		<div
			className="flex w-[220px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-surface)] transition-opacity duration-150"
			style={{ opacity: isDimmed ? 0.5 : 1 }}
		>
			<div className="flex-1 overflow-y-auto p-2">
				{conflicting.length > 0 && (
					<div className="mb-2">
						<div className="px-2 py-1 text-[11px] uppercase tracking-wider text-[var(--text-quaternary)]">
							Conflicting
						</div>
						{conflicting.map((file, i) => {
							const isKeyboardFocused = zone === "sidebar" && keyboardIndex === i;
							return (
								<button
									key={file.path}
									type="button"
									onClick={() => {
										onSelectFile(file.path);
										onFocusEditor();
									}}
									className={[
										"flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-left text-[12px] transition-all duration-[var(--transition-fast)]",
										activeFile === file.path
											? "border border-[rgba(10,132,255,0.15)] bg-[rgba(10,132,255,0.1)] text-[var(--text)]"
											: isKeyboardFocused
												? "border border-[var(--border-active)] bg-[var(--bg-overlay)] text-[var(--text)]"
												: "text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)]",
									].join(" ")}
								>
									<svg
										aria-hidden="true"
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="var(--color-warning)"
										strokeWidth="2"
										className="shrink-0"
									>
										<circle cx="12" cy="12" r="10" />
										<path d="M12 8v4" />
										<path d="M12 16h.01" />
									</svg>
									<span className="min-w-0 truncate">{file.path.split("/").pop()}</span>
								</button>
							);
						})}
					</div>
				)}
				{resolved.length > 0 && (
					<div>
						<div className="px-2 py-1 text-[11px] uppercase tracking-wider text-[var(--text-quaternary)]">
							Resolved
						</div>
						{resolved.map((file, i) => {
							const globalIndex = conflicting.length + i;
							const isKeyboardFocused = zone === "sidebar" && keyboardIndex === globalIndex;
							const isFlashing = flashPaths.has(file.path);
							return (
								<button
									key={file.path}
									type="button"
									onClick={() => {
										onSelectFile(file.path);
										onFocusEditor();
									}}
									className={[
										"flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-left text-[12px] opacity-60 transition-all duration-[var(--transition-fast)]",
										isFlashing && activeFile !== file.path ? "bg-[rgba(48,209,88,0.12)]" : "",
										activeFile === file.path
											? "bg-[rgba(10,132,255,0.1)] text-[var(--text)]"
											: isKeyboardFocused
												? "border border-[var(--border)] bg-[var(--bg-overlay)] text-[var(--text-secondary)]"
												: "text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)]",
									].join(" ")}
								>
									<svg
										aria-hidden="true"
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="var(--color-success)"
										strokeWidth="2"
										className="shrink-0"
									>
										<circle cx="12" cy="12" r="10" />
										<path d="m9 12 2 2 4-4" />
									</svg>
									<span className="min-w-0 truncate line-through">
										{file.path.split("/").pop()}
									</span>
								</button>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
