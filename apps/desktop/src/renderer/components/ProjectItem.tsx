import {
	DndContext,
	type DragEndEvent,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	arrayMove,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "../../main/db/schema";
import type { OrchestratorGroupNode } from "../../shared/types";
import { useOrchestratorColor } from "../hooks/useOrchestratorColor";
import { useAgentAlertStore } from "../stores/agent-alert-store";
import { useProjectStore } from "../stores/projects";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { OrchestratorGroup } from "./OrchestratorGroup";
import { OrchestratorRow } from "./OrchestratorRow";
import { ProjectContextMenu } from "./ProjectContextMenu";
import { RepoGroup } from "./RepoGroup";
import { WorkspaceItem } from "./WorkspaceItem";

function SortableWorkspace({
	id,
	children,
}: {
	id: string;
	children: ReactNode;
}) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id,
	});
	return (
		<div
			ref={setNodeRef}
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
				opacity: isDragging ? 0.5 : 1,
			}}
			{...attributes}
			{...listeners}
		>
			{children}
		</div>
	);
}

interface ProjectItemProps {
	project: Project;
	isExpanded: boolean;
	onToggle: () => void;
}

export function ProjectItem({ project, isExpanded, onToggle }: ProjectItemProps) {
	const isCloning = project.status === "cloning";
	const isReady = project.status === "ready";

	// Poll clone progress when cloning
	const { data: progress } = trpc.projects.cloneProgress.useQuery(
		{ id: project.id },
		{ enabled: isCloning, refetchInterval: 1000 }
	);

	// Poll project status to detect when clone completes.
	// IMPORTANT: do NOT put `invalidate()` in a `select` callback — TanStack Query v5
	// re-runs `select` on every render when the function reference changes (which it
	// does for inline arrows), creating an infinite invalidate→refetch→render loop.
	// (See queryObserver.cjs:253-267 — the memoization check requires
	// `options.select === _selectFn`, which fails for inline arrows.)
	// Instead, observe the polled status in a `useEffect` and invalidate once per
	// cloning episode.
	const utils = trpc.useUtils();
	const projectStatusQuery = trpc.projects.getById.useQuery(
		{ id: project.id },
		{
			enabled: isCloning,
			refetchInterval: 2000,
		}
	);

	// Fire `projects.list.invalidate()` exactly once per cloning episode, the
	// first time the polled status reads as non-cloning. The ref resets whenever
	// `isCloning` flips back to false (i.e. the parent has picked up the new
	// status), so a future re-clone of the same project still works.
	//
	// We deliberately do NOT require observing a `cloning → ready` transition:
	// the cache for `getById({id})` may already be warm with `status="ready"`
	// from `CreateWorktreeModal` or `SharedFilesPanel`, in which case the very
	// first read after this `ProjectItem` enters cloning mode will already be
	// non-cloning. We still want to fire once in that case so the parent's
	// `projects.list` refetches and the sidebar transitions out of "Cloning…".
	const hasInvalidatedRef = useRef(false);
	useEffect(() => {
		if (!isCloning) {
			hasInvalidatedRef.current = false;
			return;
		}
		const status = projectStatusQuery.data?.status;
		if (status && status !== "cloning" && !hasInvalidatedRef.current) {
			hasInvalidatedRef.current = true;
			utils.projects.list.invalidate();
		}
	}, [isCloning, projectStatusQuery.data?.status, utils]);

	// Fetch workspaces (as tree) when expanded and project is ready
	const { data: tree } = trpc.workspaces.listByProject.useQuery(
		{ projectId: project.id },
		{ enabled: isExpanded && isReady, refetchInterval: 60_000 }
	);

	const orchestrators = tree?.orchestrators ?? [];
	const loose = tree?.loose ?? [];
	const allOrchestratorIds = orchestrators.map((o) => o.workspace.id);

	const activeWorkspaceIdLocal = useTabStore((s) => s.activeWorkspaceId);

	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

	const reorderTopLevelMut = trpc.workspaces.reorderTopLevel.useMutation({
		onSuccess: () => utils.workspaces.listByProject.invalidate({ projectId: project.id }),
	});
	const reorderChildrenMut = trpc.workspaces.reorderChildren.useMutation({
		onSuccess: () => utils.workspaces.listByProject.invalidate({ projectId: project.id }),
	});
	const attachMut = trpc.workspaces.attachToOrchestrator.useMutation({
		onSuccess: () => utils.workspaces.listByProject.invalidate({ projectId: project.id }),
	});
	const detachMut = trpc.workspaces.detachFromOrchestrator.useMutation({
		onSuccess: () => utils.workspaces.listByProject.invalidate({ projectId: project.id }),
	});

	function onDragEnd(e: DragEndEvent) {
		const activeId = String(e.active.id);
		const overId = e.over ? String(e.over.id) : null;
		if (!overId || activeId === overId) return;

		const isOrch = (id: string) => orchestrators.some((o) => o.workspace.id === id);
		const orchOfChild = (id: string) =>
			orchestrators.find((o) => o.children.some((c) => c.id === id))?.workspace.id;
		const isLoose = (id: string) => loose.some((w) => w.id === id);
		const overIsOrch = isOrch(overId);
		const overIsChild = orchOfChild(overId);
		const overIsLoose = isLoose(overId);

		// Case 1: reorder orchestrators among themselves
		if (isOrch(activeId) && overIsOrch) {
			const ids = orchestrators.map((o) => o.workspace.id);
			const from = ids.indexOf(activeId);
			const to = ids.indexOf(overId);
			const next = arrayMove(ids, from, to);
			reorderTopLevelMut.mutate({
				projectId: project.id,
				orderedIds: [...next, ...loose.map((w) => w.id)],
			});
			return;
		}

		// Case 2: reorder loose worktrees among themselves
		if (isLoose(activeId) && overIsLoose) {
			const ids = loose.map((w) => w.id);
			const from = ids.indexOf(activeId);
			const to = ids.indexOf(overId);
			const next = arrayMove(ids, from, to);
			reorderTopLevelMut.mutate({
				projectId: project.id,
				orderedIds: [...orchestrators.map((o) => o.workspace.id), ...next],
			});
			return;
		}

		// Case 3: loose worktree dropped onto an orchestrator row → attach
		if (isLoose(activeId) && overIsOrch) {
			attachMut.mutate({ orchestratorId: overId, workspaceId: activeId });
			return;
		}

		// Case 4: loose worktree dropped onto a child row → attach to that child's orchestrator
		if (isLoose(activeId) && overIsChild) {
			attachMut.mutate({ orchestratorId: overIsChild, workspaceId: activeId });
			return;
		}

		// Case 5: child dragged onto another orchestrator → move (or reorder within same group)
		if (orchOfChild(activeId) && (overIsOrch || overIsChild)) {
			const target = overIsOrch ? overId : (overIsChild as string);
			const fromOrch = orchOfChild(activeId);
			if (!fromOrch) return;
			if (target === fromOrch) {
				const node = orchestrators.find((o) => o.workspace.id === fromOrch);
				if (!node) return;
				const ids = node.children.map((c) => c.id);
				const from = ids.indexOf(activeId);
				const to = overIsChild ? ids.indexOf(overId) : ids.length - 1;
				const next = arrayMove(ids, from, to);
				reorderChildrenMut.mutate({ orchestratorId: fromOrch, orderedIds: next });
			} else {
				attachMut.mutate({ orchestratorId: target, workspaceId: activeId });
			}
			return;
		}

		// Case 6: child dragged into loose zone → detach
		if (orchOfChild(activeId) && overIsLoose) {
			detachMut.mutate({ workspaceId: activeId });
			return;
		}

		// Default: no-op
	}

	const isActiveProject =
		orchestrators.some(
			(o) =>
				o.workspace.id === activeWorkspaceIdLocal ||
				o.children.some((c) => c.id === activeWorkspaceIdLocal)
		) || loose.some((w) => w.id === activeWorkspaceIdLocal);

	const openCreateWorktreeModal = useProjectStore((s) => s.openCreateWorktreeModal);

	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
	} | null>(null);

	return (
		<>
			<RepoGroup
				name={project.name}
				isActive={isActiveProject}
				isExpanded={isExpanded}
				onToggle={isReady ? onToggle : undefined}
				onContextMenu={(e) => {
					e.preventDefault();
					setContextMenu({ x: e.clientX, y: e.clientY });
				}}
				subTitle={
					isCloning ? (
						<div className="text-[11px] text-[var(--text-quaternary)]">
							{progress ? `${progress.stage}... ${progress.progress}%` : "Cloning..."}
						</div>
					) : undefined
				}
				rightContent={
					isReady ? (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								openCreateWorktreeModal(project.id);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.stopPropagation();
									openCreateWorktreeModal(project.id);
								}
							}}
							className={[
								"flex h-5 w-5 shrink-0 items-center justify-center rounded text-[14px]",
								"transition-colors duration-[120ms]",
								isActiveProject
									? "text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
									: "text-[#3a3a42] hover:text-[#505058]",
							].join(" ")}
							title="New Worktree"
						>
							+
						</button>
					) : undefined
				}
			>
				{isReady && tree && (
					<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
						<SortableContext
							items={orchestrators.map((o) => o.workspace.id)}
							strategy={verticalListSortingStrategy}
						>
							<div className="flex flex-col pt-0.5">
								{orchestrators.map((node) => (
									<SortableWorkspace key={node.workspace.id} id={node.workspace.id}>
										<OrchestratorGroupBlock
											node={node}
											projectId={project.id}
											projectName={project.name}
											projectRepoPath={project.repoPath}
											isActiveProject={isActiveProject}
											allOrchestratorIds={allOrchestratorIds}
											activeWorkspaceId={activeWorkspaceIdLocal ?? ""}
										/>
									</SortableWorkspace>
								))}
							</div>
						</SortableContext>
						<SortableContext items={loose.map((w) => w.id)} strategy={verticalListSortingStrategy}>
							<div className="flex flex-col">
								{loose.map((ws) => (
									<SortableWorkspace key={ws.id} id={ws.id}>
										<WorkspaceItem
											workspace={ws}
											projectId={project.id}
											projectName={project.name}
											projectRepoPath={project.repoPath}
											isInActiveProject={isActiveProject}
										/>
									</SortableWorkspace>
								))}
							</div>
						</SortableContext>
					</DndContext>
				)}
			</RepoGroup>

			{contextMenu && (
				<ProjectContextMenu
					project={project}
					position={contextMenu}
					onClose={() => setContextMenu(null)}
				/>
			)}
		</>
	);
}

function OrchestratorGroupBlock({
	node,
	projectId,
	projectName,
	projectRepoPath,
	isActiveProject,
	allOrchestratorIds,
	activeWorkspaceId,
}: {
	node: OrchestratorGroupNode;
	projectId: string;
	projectName: string;
	projectRepoPath: string;
	isActiveProject: boolean;
	allOrchestratorIds: string[];
	activeWorkspaceId: string;
}) {
	const utils = trpc.useUtils();
	const colorIndex = useOrchestratorColor(node.workspace.id, projectId, allOrchestratorIds);

	const unsetOrchestratorMut = trpc.workspaces.unsetOrchestrator.useMutation({
		onSuccess: () => utils.workspaces.listByProject.invalidate({ projectId }),
	});

	const handleUnsetOrchestrator = useCallback(() => {
		unsetOrchestratorMut.mutate({ projectId, workspaceId: node.workspace.id });
	}, [node.workspace.id, projectId, unsetOrchestratorMut]);

	const expandedKey = `orchExpand:${node.workspace.id}`;
	const expandedQuery = trpc.workspaces.getOrchestratorExpand.useQuery(
		{ key: expandedKey },
		{ staleTime: Number.POSITIVE_INFINITY }
	);
	const setExpanded = trpc.workspaces.setOrchestratorExpand.useMutation({
		onSuccess: (_data, { key, value }) => {
			utils.workspaces.getOrchestratorExpand.setData({ key }, value);
		},
	});
	const expanded = expandedQuery.data ?? true;

	const activeChild = node.children.find((c) => c.id === activeWorkspaceId);
	const hasActiveChild = activeChild !== undefined;

	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();

	const handleActivate = useCallback(() => {
		useAgentAlertStore.getState().clearAlert(node.workspace.id);
		const cwd = node.workspace.worktreePath ?? projectRepoPath;
		const store = useTabStore.getState();
		store.setActiveWorkspace(node.workspace.id, cwd);
		const existing = store.getTabsByWorkspace(node.workspace.id);
		const hasTerminal = existing.some((t) => t.kind === "terminal");
		if (!hasTerminal) {
			const title = `${projectName}: ${node.workspace.name}`;
			const tabId = store.addTerminalTab(node.workspace.id, cwd, title);
			attachTerminal.mutate({ workspaceId: node.workspace.id, terminalId: tabId });
		}
	}, [
		node.workspace.id,
		node.workspace.name,
		node.workspace.worktreePath,
		projectName,
		projectRepoPath,
		attachTerminal,
	]);

	return (
		<>
			<OrchestratorRow
				workspace={node.workspace}
				colorIndex={colorIndex}
				childCount={node.children.length}
				expanded={expanded}
				onToggle={() => {
					const next = !expanded;
					utils.workspaces.getOrchestratorExpand.setData({ key: expandedKey }, next);
					setExpanded.mutate({ key: expandedKey, value: next });
				}}
				onActivate={handleActivate}
				activeChildName={!expanded && activeChild ? activeChild.name : undefined}
				onUnsetOrchestrator={handleUnsetOrchestrator}
			/>
			{expanded && (
				<OrchestratorGroup colorIndex={colorIndex} hasActiveChild={hasActiveChild}>
					<SortableContext
						items={node.children.map((c) => c.id)}
						strategy={verticalListSortingStrategy}
					>
						{node.children.map((c) => (
							<SortableWorkspace key={c.id} id={c.id}>
								<WorkspaceItem
									workspace={c}
									projectId={projectId}
									projectName={projectName}
									projectRepoPath={projectRepoPath}
									isInActiveProject={isActiveProject}
									indentLevel={1}
								/>
							</SortableWorkspace>
						))}
					</SortableContext>
				</OrchestratorGroup>
			)}
		</>
	);
}
