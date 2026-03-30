import { useState } from "react";
import { FileIcon } from "./icons";
import { BRANCH_FILES, COMMITS, FILE_TREE, PR_COMMENTS, WORKING_CHANGES } from "./mock-data";
import { TOTAL_ADDITIONS, extColor } from "./utils";

type PanelView = "changes" | "files" | "comments" | "overview";

const changesIcon = (
	<svg
		width="14"
		height="14"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.5"
		strokeLinecap="round"
		aria-hidden="true"
	>
		<path d="M4 6h8M4 10h5" />
		<circle cx="13" cy="10" r="1.5" fill="currentColor" stroke="none" />
	</svg>
);

const filesIcon = (
	<svg
		width="14"
		height="14"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.5"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<path d="M2 3h5l2 2h5v8H2z" />
	</svg>
);

const commentsIcon = (
	<svg
		width="14"
		height="14"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.5"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<path d="M3 3h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6l-3 3V4a1 1 0 0 1 1-1z" />
	</svg>
);

const sparkleIcon = (
	<svg
		width="14"
		height="14"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.5"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<path d="M6 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1zM11 8l.5 1.5L13 10l-1.5.5L11 12l-.5-1.5L9 10l1.5-.5z" />
	</svg>
);

const panelIcons: Record<PanelView, React.ReactNode> = {
	changes: changesIcon,
	files: filesIcon,
	comments: commentsIcon,
	overview: sparkleIcon,
};

const panelLabels: Record<PanelView, string> = {
	changes: "Changes",
	files: "Files",
	comments: "Comments",
	overview: "Overview",
};

const views: PanelView[] = ["changes", "files", "comments", "overview"];

function PanelToolbar({
	activeView,
	onSetView,
}: {
	activeView: PanelView;
	onSetView: (v: PanelView) => void;
}) {
	return (
		<div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
			<div className="flex rounded-md bg-bg-base p-0.5">
				{views.map((v) => (
					<button
						key={v}
						type="button"
						onClick={() => onSetView(v)}
						title={panelLabels[v]}
						aria-label={panelLabels[v]}
						className={[
							"flex items-center gap-1 rounded px-2 py-1 transition-all duration-100",
							activeView === v
								? "bg-bg-elevated text-text-secondary shadow-sm"
								: "text-text-faint hover:text-text-muted",
						].join(" ")}
					>
						{panelIcons[v]}
					</button>
				))}
			</div>
			<div className="flex-1" />
		</div>
	);
}

function BranchChangesCard({ className }: { className?: string }) {
	return (
		<div
			className={`mx-1.5 overflow-hidden rounded-lg border border-border bg-bg-elevated ${className ?? ""}`}
		>
			<div className="flex items-center gap-2 px-3 py-2 hover:bg-bg-overlay">
				<span className="text-[10px] text-text-faint">&#x25BE;</span>
				<span className="text-[11px] font-medium uppercase tracking-wider text-text-faint">
					Branch Changes
				</span>
				<span className="rounded-full bg-bg-overlay px-1.5 py-px text-[10px] text-text-muted">
					{BRANCH_FILES.length} files
				</span>
				<div className="flex-1" />
				<span className="text-[11px]">
					<span className="text-green">+{TOTAL_ADDITIONS}</span>
					<span className="mx-1 text-text-faint">/</span>
					<span className="text-red">-0</span>
				</span>
			</div>
			<div className="border-t border-border px-1 py-1">
				{BRANCH_FILES.map((file) => (
					<div
						key={file.name}
						className="flex items-center gap-1.5 rounded px-2 py-0.5 text-[12px] text-text-secondary hover:bg-bg-overlay"
					>
						<span className="size-1.5 shrink-0 rounded-full bg-accent" />
						<span className="min-w-0 flex-1 truncate">
							{file.path}
							{file.name}
						</span>
						<span className="shrink-0 text-[10px] text-green">+{file.additions}</span>
					</div>
				))}
			</div>
		</div>
	);
}

function GitChangesView() {
	const [commitsCollapsed, setCommitsCollapsed] = useState(false);

	return (
		<div className="flex flex-1 flex-col overflow-y-auto">
			{/* Smart header bar — branch selector */}
			<div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-1.5">
				<svg
					aria-hidden="true"
					width="10"
					height="10"
					viewBox="0 0 16 16"
					fill="currentColor"
					className="shrink-0 text-text-faint"
				>
					<path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" />
				</svg>
				<span className="truncate text-[12px] text-text-secondary">feature/inline-agent-chat</span>
				<span className="text-[11px] text-text-faint">&rarr;</span>
				<span className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-text-muted hover:bg-bg-elevated">
					main
					<svg
						aria-hidden="true"
						width="8"
						height="8"
						viewBox="0 0 16 16"
						fill="currentColor"
						className="shrink-0"
					>
						<path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z" />
					</svg>
				</span>
			</div>

			<div className="flex-1 overflow-y-auto">
				{/* Working changes card */}
				<div className="mx-1.5 mt-2 overflow-hidden rounded-lg border border-border bg-bg-elevated">
					<div className="flex items-center gap-2 px-3 py-1.5">
						<span className="text-[11px] font-medium uppercase tracking-wider text-text-faint">
							Working Changes
						</span>
						<span className="rounded-full bg-bg-overlay px-1.5 py-px text-[10px] text-text-muted">
							{WORKING_CHANGES.length}
						</span>
						<div className="flex-1" />
						<span className="text-[11px] text-text-faint hover:text-text-secondary">Stage All</span>
					</div>
					<div className="px-1 pb-1">
						{WORKING_CHANGES.map((file) => (
							<div
								key={file.name}
								className="flex items-center gap-1.5 rounded px-2 py-0.5 text-[12px] text-text-secondary hover:bg-bg-overlay"
							>
								<div className="flex size-3.5 shrink-0 items-center justify-center rounded border border-text-faint" />
								<span className="size-1.5 shrink-0 rounded-full bg-green" />
								<span className="min-w-0 flex-1 truncate">{file.name}</span>
							</div>
						))}
					</div>

					{/* Commit footer */}
					<div className="border-t border-border px-2 py-2">
						<div className="w-full rounded border border-border bg-bg-base px-2 py-1.5 text-[12px] text-text-faint">
							Commit message...
						</div>
						<div className="mt-1.5 flex gap-1.5">
							<div className="flex-1 rounded bg-accent px-2 py-1 text-center text-[11px] font-medium text-white opacity-40">
								Commit
							</div>
							<div className="rounded border border-border px-2 py-1 text-[11px] text-text-secondary">
								Push &uarr;
							</div>
						</div>
					</div>
				</div>

				{/* Commits section */}
				<div className="mt-3 flex flex-col gap-1 pb-2">
					<button
						type="button"
						onClick={() => setCommitsCollapsed((c) => !c)}
						className="flex items-center gap-2 px-3 py-1.5"
					>
						<span
							className="text-[10px] text-text-faint transition-transform duration-150"
							style={{
								transform: commitsCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
							}}
						>
							&#x25BE;
						</span>
						<span className="text-[11px] font-medium uppercase tracking-wider text-text-faint">
							Commits
						</span>
						<span className="rounded-full bg-bg-overlay px-1.5 py-px text-[10px] text-text-muted">
							{COMMITS.length}
						</span>
					</button>

					{!commitsCollapsed &&
						COMMITS.map((commit) => (
							<div
								key={commit.hash}
								className="mx-1.5 overflow-hidden rounded-lg border border-border bg-bg-surface"
							>
								<div className="flex flex-col gap-0.5 px-3 py-1.5 hover:bg-bg-elevated">
									<div className="flex items-center gap-2">
										<span className="shrink-0 font-mono text-[11px] text-text-faint">
											{commit.hash}
										</span>
										<span className="min-w-0 flex-1 truncate text-[12px] text-text-secondary">
											{commit.message}
										</span>
										<span className="shrink-0 text-[11px] text-text-faint">{commit.time}</span>
									</div>
									<div className="flex items-center gap-2">
										<span className="text-[11px]">
											<span className="text-green">+{commit.additions}</span>
											<span className="ml-1 text-red">-{commit.deletions}</span>
										</span>
										<span className="text-[11px] text-text-faint">
											&middot; {commit.files} file
											{commit.files !== 1 ? "s" : ""}
										</span>
									</div>
								</div>
							</div>
						))}
				</div>

				{/* Branch changes section */}
				<BranchChangesCard className="mt-1 mb-4" />
			</div>
		</div>
	);
}

function FileTreeView() {
	const [expanded, setExpanded] = useState(true);

	return (
		<div className="flex flex-1 flex-col overflow-y-auto">
			{/* Search input */}
			<div className="shrink-0 px-3 py-2">
				<div className="flex items-center gap-2 rounded border border-border bg-bg-base px-2 py-1.5 text-[12px] text-text-faint">
					<svg
						aria-hidden="true"
						width="12"
						height="12"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
					>
						<circle cx="7" cy="7" r="4.5" />
						<path d="M10.5 10.5L14 14" />
					</svg>
					Search files...
				</div>
			</div>

			{/* Tree */}
			<div className="flex-1 overflow-y-auto px-1 py-1">
				{FILE_TREE.map((node) =>
					node.type === "dir" ? (
						<div key={node.name}>
							<button
								type="button"
								onClick={() => setExpanded((e) => !e)}
								className="flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-[12px] text-text-muted transition-colors hover:bg-bg-overlay"
							>
								<span
									className="text-[10px] text-text-faint transition-transform duration-150"
									style={{
										transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
									}}
								>
									&#x25BE;
								</span>
								{/* Folder icon */}
								<svg
									aria-hidden="true"
									width="14"
									height="14"
									viewBox="0 0 16 16"
									fill="currentColor"
									className="shrink-0 text-text-faint"
								>
									{expanded ? (
										<>
											<path
												d="M1.75 2.5A.75.75 0 012.5 1.75h4.035a.75.75 0 01.573.268l1.2 1.427a.25.25 0 00.191.089h5.001a.75.75 0 01.75.75v1.216H2.5v-3z"
												opacity="0.5"
											/>
											<path d="M1.5 5.5l1.197 7.182A.75.75 0 003.44 13.5h9.12a.75.75 0 00.743-.818L14.5 5.5H1.5z" />
										</>
									) : (
										<path d="M2.5 1.75A.75.75 0 013.25 1h4.035a.75.75 0 01.573.268l1.2 1.427a.25.25 0 00.191.089h4.001a.75.75 0 01.75.75v9.716a.75.75 0 01-.75.75H3.25a.75.75 0 01-.75-.75V1.75z" />
									)}
								</svg>
								<span className="truncate">{node.name}/</span>
								<span className="ml-auto text-[10px] text-text-faint">{node.children.length}</span>
							</button>
							{expanded &&
								node.children.map((child) => (
									<div
										key={child.name}
										className="flex items-center gap-1.5 rounded py-0.5 pl-7 pr-2 text-[12px] text-text-secondary hover:bg-bg-overlay"
									>
										<FileIcon color={extColor(child.name)} size={14} />
										<span className="min-w-0 flex-1 truncate">{child.name}</span>
									</div>
								))}
						</div>
					) : (
						<div
							key={node.name}
							className="flex items-center gap-1.5 rounded px-2 py-0.5 text-[12px] text-text-secondary hover:bg-bg-overlay"
						>
							<FileIcon color={extColor(node.name)} size={14} />
							<span className="min-w-0 flex-1 truncate">{node.name}</span>
						</div>
					)
				)}
			</div>
		</div>
	);
}

function PRCommentsView({
	prId,
	onFixClick,
}: {
	prId: number;
	onFixClick: () => void;
}) {
	const totalThreads = PR_COMMENTS.reduce((s, f) => s + f.threads.length, 0);

	return (
		<div className="flex flex-1 flex-col overflow-y-auto">
			{/* Header */}
			<div className="shrink-0 border-b border-border px-3 py-3">
				<h2 className="text-[14px] font-semibold text-text-primary">Pull Request</h2>
				<p className="mt-0.5 text-[11px] text-text-muted">
					#{prId} &middot; {totalThreads} comments
				</p>
			</div>

			{/* Thread count + filter */}
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
				<span className="text-[11px] text-text-muted">{totalThreads} threads</span>
				<div className="flex-1" />
				<span className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-text-faint hover:bg-bg-elevated">
					By file
					<svg aria-hidden="true" width="8" height="8" viewBox="0 0 16 16" fill="currentColor">
						<path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z" />
					</svg>
				</span>
			</div>

			{/* Comment threads grouped by file */}
			<div className="flex-1 overflow-y-auto">
				{PR_COMMENTS.map((fileGroup) => (
					<div key={fileGroup.file}>
						{/* File section header */}
						<div className="sticky top-0 bg-bg-surface px-3 py-1.5">
							<span className="text-[10px] font-medium uppercase tracking-wider text-text-faint">
								{fileGroup.file.toUpperCase()}
							</span>
						</div>

						{/* Individual comment cards */}
						{fileGroup.threads.map((thread, i) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: static mock data
								key={i}
								className="mx-1.5 mb-1.5 rounded-lg border border-border bg-bg-elevated p-2.5"
							>
								{/* Card header: file:line + actions */}
								<div className="flex items-center gap-2">
									<span className="font-mono text-[11px] text-accent">
										{fileGroup.file.split("/").pop()}:{thread.line}
									</span>
									<div className="flex-1" />
									<span className="text-[10px] text-green hover:text-green/80">Resolve</span>
									<span className="text-[10px] text-text-faint hover:text-text-muted">Skip</span>
								</div>

								{/* Author + date */}
								<div className="mt-1 flex items-center gap-1.5 text-[10px] text-text-muted">
									<span className="font-medium text-text-secondary">{thread.author}</span>
									<span>&middot;</span>
									<span>{thread.date}</span>
								</div>

								{/* Comment text */}
								<p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">{thread.text}</p>

								{/* Reply input */}
								<div className="mt-2 rounded border border-border bg-bg-base px-2 py-1 text-[11px] text-text-faint">
									Reply...
								</div>
							</div>
						))}
					</div>
				))}
			</div>

			{/* Solve with AI button */}
			<div className="shrink-0 border-t border-border px-3 py-2">
				<button
					type="button"
					onClick={onFixClick}
					className="w-full rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
				>
					Solve with AI ({totalThreads} comments)
				</button>
			</div>
		</div>
	);
}

function BranchOverviewView() {
	const [suggestionsExpanded, setSuggestionsExpanded] = useState(false);

	return (
		<div className="flex flex-1 flex-col overflow-y-auto">
			{/* Branch info header */}
			<div className="shrink-0 border-b border-border px-3 py-3">
				<div className="flex items-center gap-1.5">
					<svg
						aria-hidden="true"
						width="12"
						height="12"
						viewBox="0 0 16 16"
						fill="currentColor"
						className="text-text-faint"
					>
						<path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" />
					</svg>
					<span className="text-[12px] text-text-secondary">feature/inline-agent-chat</span>
					<span className="text-[11px] text-text-faint">&rarr;</span>
					<span className="text-[12px] text-text-muted">main</span>
				</div>
			</div>

			<div className="flex-1 overflow-y-auto">
				{/* Branch changes section */}
				<BranchChangesCard className="mt-2" />

				{/* Commits section */}
				<div className="mt-3 flex flex-col gap-1 pb-2">
					<div className="flex items-center gap-2 px-3 py-1.5">
						<span className="text-[11px] font-medium uppercase tracking-wider text-text-faint">
							Commits
						</span>
						<span className="rounded-full bg-bg-overlay px-1.5 py-px text-[10px] text-text-muted">
							{COMMITS.length}
						</span>
					</div>
					{COMMITS.slice(0, 4).map((commit) => (
						<div
							key={commit.hash}
							className="mx-1.5 rounded-lg border border-border bg-bg-surface px-3 py-1.5"
						>
							<div className="flex items-center gap-2">
								<span className="shrink-0 font-mono text-[11px] text-text-faint">
									{commit.hash}
								</span>
								<span className="min-w-0 flex-1 truncate text-[12px] text-text-secondary">
									{commit.message}
								</span>
							</div>
						</div>
					))}
					{COMMITS.length > 4 && (
						<div className="px-3 py-0.5 text-[11px] text-text-faint">
							+{COMMITS.length - 4} more commits
						</div>
					)}
				</div>

				{/* AI suggestions */}
				<div className="mx-1.5 mt-1 mb-2 overflow-hidden rounded-lg border border-border bg-bg-elevated">
					<button
						type="button"
						onClick={() => setSuggestionsExpanded((e) => !e)}
						className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-bg-overlay"
					>
						<span
							className="text-[10px] text-text-faint transition-transform duration-150"
							style={{
								transform: suggestionsExpanded ? "rotate(0deg)" : "rotate(-90deg)",
							}}
						>
							&#x25BE;
						</span>
						<svg
							aria-hidden="true"
							width="12"
							height="12"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
							className="text-accent"
						>
							<path d="M6 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1z" />
						</svg>
						<span className="text-[11px] font-medium text-accent">AI 3 suggestions</span>
					</button>
					{suggestionsExpanded && (
						<div className="border-t border-border px-3 py-2 text-[11px] text-text-muted">
							<div className="flex flex-col gap-1.5">
								<div className="flex items-start gap-1.5">
									<span className="mt-0.5 text-yellow">&#x25CF;</span>
									<span>Add rate limiting to chat-service.ts WebSocket messages</span>
								</div>
								<div className="flex items-start gap-1.5">
									<span className="mt-0.5 text-yellow">&#x25CF;</span>
									<span>ChatPanel.tsx should debounce scroll-to-bottom on resize</span>
								</div>
								<div className="flex items-start gap-1.5">
									<span className="mt-0.5 text-yellow">&#x25CF;</span>
									<span>useAgentChat hook missing error boundary integration</span>
								</div>
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Submit review button */}
			<div className="shrink-0 border-t border-border px-3 py-2">
				<button
					type="button"
					className="w-full rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
				>
					Submit Review
				</button>
			</div>
		</div>
	);
}

export function ReviewPanel({
	prId,
	onFixClick,
	segment,
}: {
	prId: number;
	onFixClick: () => void;
	segment: string;
}) {
	const defaultView: PanelView = segment === "prs" ? "comments" : "changes";
	const [activeView, setActiveView] = useState<PanelView>(defaultView);

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<PanelToolbar activeView={activeView} onSetView={setActiveView} />
			{activeView === "changes" && <GitChangesView />}
			{activeView === "files" && <FileTreeView />}
			{activeView === "comments" && <PRCommentsView prId={prId} onFixClick={onFixClick} />}
			{activeView === "overview" && <BranchOverviewView />}
		</div>
	);
}
