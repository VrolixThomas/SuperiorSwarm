import { useEffect, useRef } from "react";
import type { WorkspaceQueueItem } from "../../../shared/activity-queue";
import { queueAge } from "../../lib/activity-queue-view";
import { type QueueConversationActions, QueueConversationReply } from "./QueueConversationReply";
import { QueueLinkedWorkContext } from "./QueueLinkedWorkContext";
import { QueuePermissionActions, type QueuePermissionActionsAPI } from "./QueuePermissionActions";
import { type AnswerQuestion, QueueQuestionReply } from "./QueueQuestionReply";
import { queueFocus } from "./QueueRow";
export const queueButton = `rounded-md px-3 py-2 text-[12px] transition-colors hover:bg-[var(--bg-elevated)] disabled:opacity-40 ${queueFocus}`;
export function QueuePanel({
	item,
	later,
	busy,
	canAct,
	open,
	snooze,
	done,
	bringBack,
	expanded,
	close,
	answer,
	conversationActions,
	permissionActions,
	refresh,
}: {
	item: WorkspaceQueueItem;
	later: boolean;
	busy: boolean;
	canAct: boolean;
	open: () => void;
	snooze: () => void;
	done: () => void;
	bringBack: () => void;
	expanded?: boolean;
	close?: () => void;
	answer?: AnswerQuestion;
	conversationActions?: QueueConversationActions;
	permissionActions?: QueuePermissionActionsAPI;
	refresh: () => Promise<unknown>;
}) {
	const closeButton = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (expanded) closeButton.current?.focus();
	}, [expanded]);
	return (
		<aside
			aria-label="Queue item details"
			id="queue-item-details"
			onKeyDown={(event) => {
				if (event.key === "Escape" && expanded) {
					event.preventDefault();
					event.stopPropagation();
					close?.();
				}
				if (event.key === "Tab" && expanded && window.innerWidth < 1100) {
					const controls = Array.from(
						event.currentTarget.querySelectorAll<HTMLElement>(
							"button:not(:disabled), textarea:not(:disabled), [tabindex='0']"
						)
					).filter((control) => control.getBoundingClientRect().height > 0);
					const first = controls[0];
					const last = controls.at(-1);
					if (
						(!event.shiftKey && document.activeElement === last) ||
						(event.shiftKey && document.activeElement === first)
					) {
						event.preventDefault();
						(event.shiftKey ? last : first)?.focus();
					}
				}
			}}
			className={`${expanded ? "absolute inset-0 z-10 flex" : "hidden"} min-h-0 min-w-0 shrink-0 flex-col overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] min-[1100px]:static min-[1100px]:flex min-[1100px]:w-[420px]`}
		>
			<div className="px-6 py-6">
				<button
					ref={closeButton}
					type="button"
					onClick={close}
					className={`${queueButton} mb-3 min-[1100px]:hidden`}
				>
					Back to queue items
				</button>
				<p className="mb-6 flex min-w-0 items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
					<span
						className="size-2 shrink-0 rounded-sm"
						style={{
							background: item.context.projectColor || `var(--orch-${item.context.projectTint})`,
						}}
					/>
					<span
						className="truncate"
						title={`${item.context.projectName} › ${item.context.workspaceName}`}
					>
						{item.context.projectName} <span className="px-1 text-[var(--text-quaternary)]">›</span>{" "}
						{item.context.workspaceName}
					</span>
				</p>
				<div className="mb-4 space-y-1 break-words text-[11px] text-[var(--text-tertiary)]">
					<p>
						{item.context.role === "coordinator"
							? "Coordinator directory"
							: item.context.projectKind === "folder"
								? "Folder"
								: item.context.projectKind === "repo"
									? "Repository"
									: "Project"}
						{item.context.projectPath ? ` · ${item.context.projectPath}` : " · Path unavailable"}
					</p>
					<p>
						{item.context.role ?? "workspace"} · {item.context.workspaceName}
					</p>
					{item.context.terminalTitle && <p>Chat: {item.context.terminalTitle}</p>}
					{item.context.linkedProjects?.map((project) => (
						<p key={project.id}>
							Linked {project.kind === "folder" ? "folder" : "repository"}: {project.name} ·{" "}
							{project.path}
						</p>
					))}
					<QueueLinkedWorkContext items={item.context.linkedWork} />
					{!!item.providerEvidence?.length && (
						<details className="text-[10px] text-[var(--text-tertiary)]">
							<summary className="cursor-pointer">Source details</summary>
							{item.providerEvidence.map((value, index) => (
								<p key={`${value.sourceField}-${index}`} className="mt-1 break-words">
									{value.provider}: {value.rawEvent} / {value.sourceField}
								</p>
							))}
						</details>
					)}
					{item.context.identityCapability === "missing-owner" && (
						<p>Reporting conversation is unknown. No sibling chat is assumed to own this item.</p>
					)}
				</div>
				<h2 className="break-words text-[20px] font-medium leading-7 tracking-tight text-[var(--text)]">
					{item.subject}
				</h2>
				<p className="mt-3 break-words text-[13px] leading-6 text-[var(--text-secondary)]">
					{item.why}
				</p>
				<p className="mt-1 text-[11px] text-[var(--text-quaternary)]">
					{item.sourceLabel} · {queueAge(item.occurredAt)}
				</p>
				<div className="mb-4 mt-6">
					<h3 className="text-[11px] font-medium text-[var(--text-tertiary)]">Next step</h3>
					<p className="mt-2 text-[13px] leading-6 text-[var(--text)]">{item.nextAction}</p>
				</div>
				<button
					type="button"
					disabled={busy}
					onClick={open}
					className={`${queueButton} w-full border border-[var(--border)] bg-[var(--bg-elevated)] text-left text-[var(--text)]`}
				>
					{item.openLabel} <kbd className="float-right text-[var(--text-tertiary)]">↵</kbd>
				</button>
				<div className="my-7 space-y-3 border-y border-[var(--border-subtle)] py-5">
					<h3 className="text-[11px] font-medium text-[var(--text-tertiary)]">
						{item.detailLabel}
					</h3>
					{item.missingContext && (
						<p className="text-[12px] leading-5 text-[var(--text-secondary)]">
							{item.missingContext}
						</p>
					)}
					{item.evidence.map((line, i) => (
						<div key={`${i}-${line}`}>
							<p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--text-secondary)]">
								{line}
							</p>
							{item.providerEvidence
								?.filter((value) => value.text === line)
								.map((value, index) => (
									<p
										key={`${value.sourceField}-${index}`}
										className="mt-1 break-words text-[10px] text-[var(--text-tertiary)]"
									>
										{value.provider} · {value.kind}
										{value.truncated ? " · Truncated excerpt" : ""}
										{value.redacted ? " · Sensitive text redacted" : ""}
									</p>
								))}
						</div>
					))}
					{item.permission && (
						<p className="text-[11px] text-[var(--text-tertiary)]">
							{item.permission.outcome === "unconfirmed"
								? "Permission outcome unknown"
								: `Permission: ${item.permission.outcome}`}
							{item.permission.requestId ? ` · ${item.permission.requestId}` : ""}. This status does
							not confirm that the requested action ran.
						</p>
					)}
					{item.ordering === "uncertain" && (
						<p className="text-[11px] text-[var(--text-tertiary)]">
							The timing of this update could not be confirmed. Check its current state in the chat.
						</p>
					)}
				</div>

				{item.members && item.members.length > 1 && (
					<p className="text-[11px] leading-5 text-[var(--text-tertiary)]">
						Combined report and turn update from this exact conversation. Done and Later apply to
						both updates.
					</p>
				)}
				<QueuePermissionActions
					item={item}
					available={canAct && !busy}
					actions={permissionActions}
					onOpen={open}
					refresh={refresh}
				/>
				<QueueConversationReply
					item={item}
					available={canAct && !busy}
					actions={conversationActions}
					refresh={refresh}
				/>
				<QueueQuestionReply
					item={item}
					available={canAct && !busy}
					answer={answer}
					refresh={refresh}
				/>
				<div className="mt-3 flex items-center gap-1 text-[var(--text-tertiary)]">
					{later ? (
						<button
							type="button"
							disabled={busy || !canAct}
							onClick={bringBack}
							className={queueButton}
						>
							Bring back <kbd>B</kbd>
						</button>
					) : (
						<>
							<button
								type="button"
								disabled={busy || !canAct}
								onClick={snooze}
								className={queueButton}
							>
								Later <kbd>H</kbd>
							</button>
							<button
								type="button"
								disabled={busy || !canAct}
								onClick={done}
								className={queueButton}
							>
								Done <kbd>E</kbd>
							</button>
						</>
					)}
				</div>
				<p className="mt-2 text-[11px] leading-5 text-[var(--text-quaternary)]">
					{item.clearsWhen}
				</p>
			</div>
		</aside>
	);
}
