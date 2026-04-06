import { useCallback, useEffect, useRef, useState } from "react";
import { useActionStore } from "../stores/action-store";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { parseAccelerator } from "../utils/parse-accelerator";

const EMPTY_ACTIONS: never[] = [];

export function resolveQuickActionCwd(cwd: string | null, repoPath: string): string {
	if (!cwd) return repoPath;
	return cwd.startsWith("/") ? cwd : `${repoPath}/${cwd}`;
}

interface QuickActionBarProps {
	projectId: string;
	repoPath: string;
	workspaceId: string;
	onAddClick: () => void;
}

export function QuickActionBar({
	projectId,
	repoPath,
	workspaceId,
	onAddClick,
}: QuickActionBarProps) {
	const actionsQuery = trpc.quickActions.list.useQuery({ projectId });
	const reorderMutation = trpc.quickActions.reorder.useMutation({
		onSuccess: () => utils.quickActions.list.invalidate(),
	});
	const utils = trpc.useUtils();
	const addTerminalTab = useTabStore((s) => s.addTerminalTab);

	const [dragId, setDragId] = useState<string | null>(null);
	const [dropTarget, setDropTarget] = useState<string | null>(null);
	const dragCounterRef = useRef(0);

	const handleRun = useCallback(
		(command: string, label: string, cwd: string | null) => {
			const resolvedCwd = resolveQuickActionCwd(cwd, repoPath);
			const tabId = addTerminalTab(workspaceId, resolvedCwd, label);
			setTimeout(() => {
				window.electron.terminal.write(tabId, `${command}\n`);
			}, 300);
		},
		[repoPath, workspaceId, addTerminalTab]
	);

	const actions = actionsQuery.data ?? EMPTY_ACTIONS;

	useEffect(() => {
		const store = useActionStore.getState();
		const registeredIds = actions.map((a) => `quick.${a.id}`);

		store.registerMany(
			actions.map((action) => ({
				id: `quick.${action.id}`,
				label: action.label,
				category: "Quick Actions" as const,
				shortcut: parseAccelerator(action.shortcut) ?? undefined,
				execute: () => handleRun(action.command, action.label, action.cwd),
				keywords: ["run", "quick action", action.command],
			}))
		);

		return () => {
			useActionStore.getState().unregisterMany(registeredIds);
		};
	}, [actions, handleRun]);

	const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
		setDragId(id);
		e.dataTransfer.effectAllowed = "move";
		e.dataTransfer.setData("text/plain", id);
		// Slight delay so the dragged element renders before going ghost
		requestAnimationFrame(() => {
			const el = e.target as HTMLElement;
			el.style.opacity = "0.3";
		});
	}, []);

	const handleDragEnd = useCallback((e: React.DragEvent) => {
		(e.target as HTMLElement).style.opacity = "";
		setDragId(null);
		setDropTarget(null);
		dragCounterRef.current = 0;
	}, []);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = "move";
	}, []);

	const handleDragEnter = useCallback((id: string) => {
		dragCounterRef.current++;
		setDropTarget(id);
	}, []);

	const handleDragLeave = useCallback(() => {
		dragCounterRef.current--;
		if (dragCounterRef.current <= 0) {
			setDropTarget(null);
			dragCounterRef.current = 0;
		}
	}, []);

	const handleDrop = useCallback(
		(e: React.DragEvent, targetId: string) => {
			e.preventDefault();
			const sourceId = e.dataTransfer.getData("text/plain");
			if (!sourceId || sourceId === targetId) {
				setDragId(null);
				setDropTarget(null);
				return;
			}

			// Reorder: move source to target's position
			const ids = actions.map((a) => a.id);
			const sourceIdx = ids.indexOf(sourceId);
			const targetIdx = ids.indexOf(targetId);
			if (sourceIdx === -1 || targetIdx === -1) return;

			ids.splice(sourceIdx, 1);
			ids.splice(targetIdx, 0, sourceId);

			reorderMutation.mutate({ orderedIds: ids });
			setDragId(null);
			setDropTarget(null);
		},
		[actions, reorderMutation]
	);

	if (actions.length === 0) {
		return (
			<button
				type="button"
				onClick={onAddClick}
				className="app-no-drag shrink-0 rounded-[var(--radius-sm)] px-2 py-1 text-[12px] text-[var(--text-quaternary)] transition-colors duration-[var(--transition-fast)] hover:text-[var(--text-secondary)]"
			>
				+
			</button>
		);
	}

	return (
		<>
			<span className="shrink-0 text-[var(--text-quaternary)]">|</span>
			<div className="app-no-drag flex min-w-0 items-center overflow-x-auto [&::-webkit-scrollbar]:hidden">
				{actions.map((action) => {
					const isDragging = dragId === action.id;
					const isDropTarget = dropTarget === action.id && dragId !== action.id;

					return (
						<button
							key={action.id}
							type="button"
							draggable
							onClick={() => handleRun(action.command, action.label, action.cwd)}
							onContextMenu={(e) => {
								e.preventDefault();
								window.dispatchEvent(
									new CustomEvent("quick-action-context", {
										detail: { action, x: e.clientX, y: e.clientY, allActions: actions },
									})
								);
							}}
							onDragStart={(e) => handleDragStart(e, action.id)}
							onDragEnd={handleDragEnd}
							onDragOver={handleDragOver}
							onDragEnter={() => handleDragEnter(action.id)}
							onDragLeave={handleDragLeave}
							onDrop={(e) => handleDrop(e, action.id)}
							className={[
								"shrink-0 whitespace-nowrap rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[12px] transition-all duration-100",
								isDragging ? "opacity-30" : "opacity-100",
								isDropTarget
									? "bg-[rgba(10,132,255,0.15)] text-[var(--accent)]"
									: "text-[var(--text-tertiary)] hover:text-[var(--text)]",
								"cursor-grab active:cursor-grabbing",
							].join(" ")}
						>
							{action.label}
						</button>
					);
				})}
			</div>
			<button
				type="button"
				onClick={onAddClick}
				className="app-no-drag shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[12px] text-[var(--text-quaternary)] transition-colors duration-[var(--transition-fast)] hover:text-[var(--text-secondary)]"
			>
				+
			</button>
		</>
	);
}
