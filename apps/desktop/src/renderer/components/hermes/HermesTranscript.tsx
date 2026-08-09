import { useEffect, useState } from "react";
import type { HermesTranscriptMessage } from "../../../shared/hermes";
import {
	HERMES_CHAT_LAYOUT_CLASSES,
	HERMES_CHAT_OVERFLOW_CLASSES,
	type HermesProjectedActivity,
	type HermesProjectedCompaction,
	type HermesProjectedMessage,
	type HermesTranscriptProjectionItem,
	hermesUserMessageDisclosure,
} from "../../hermes/hermes-view-model";
import { HermesMarkdown } from "./HermesMarkdown";

function rawActivityDetails(message: HermesTranscriptMessage): string {
	return JSON.stringify(
		{
			role: message.role,
			toolName: message.toolName,
			status: message.status,
			text: message.text,
			workspaceArtifacts: message.workspaceArtifacts,
		},
		null,
		2
	);
}

export function HermesActivityGroup({ activity }: { activity: HermesProjectedActivity }) {
	const [expanded, setExpanded] = useState(activity.status !== "complete");
	useEffect(() => {
		if (activity.status !== "complete") setExpanded(true);
	}, [activity.status]);

	return (
		<details
			open={expanded}
			onToggle={(event) => setExpanded(event.currentTarget.open)}
			aria-label={activity.summary}
			data-hermes-align="frame-start"
			className={`${HERMES_CHAT_LAYOUT_CLASSES.activityColumn} group rounded-[10px] border px-3 py-2 text-[11px] ${
				activity.status === "failed"
					? "border-[var(--danger)]/20 bg-[var(--danger-subtle)] text-[var(--danger)]"
					: activity.status === "running"
						? "border-[var(--accent)]/20 bg-[var(--accent-subtle)] text-[var(--text-tertiary)]"
						: "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-quaternary)]"
			}`}
		>
			<summary className="cursor-pointer select-none list-none rounded outline-none [overflow-wrap:anywhere] focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50 [&::-webkit-details-marker]:hidden">
				<span className="mr-1.5 inline-block text-[9px] transition-transform group-open:rotate-90 motion-reduce:transition-none">
					▶
				</span>
				{activity.summary}
			</summary>
			<div className="mt-2 min-w-0 space-y-1.5 border-t border-[var(--border-subtle)] pt-2">
				{activity.messages.map((message) => (
					<details
						key={message.id}
						className="min-w-0 rounded-[6px] bg-[var(--bg-base)]/60 px-2 py-1.5"
					>
						<summary className="cursor-pointer list-none [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50 [&::-webkit-details-marker]:hidden">
							{message.toolName ?? message.role}
							{message.status ? ` · ${message.status}` : ""}
							<span className="sr-only"> — Raw details</span>
						</summary>
						<pre
							className={`mt-1 whitespace-pre-wrap rounded-[5px] bg-[var(--bg-base)] p-2 font-[var(--font-mono)] text-[10px] leading-4 text-[var(--text-tertiary)] [overflow-wrap:anywhere] ${HERMES_CHAT_OVERFLOW_CLASSES.technicalDetail}`}
						>
							{rawActivityDetails(message)}
						</pre>
					</details>
				))}
			</div>
		</details>
	);
}

function HermesCompactionEvent({ item }: { item: HermesProjectedCompaction }) {
	const merged = item.summaryType === "merged";
	const label =
		item.summaryType === "standalone" ? "Earlier context summarized" : "Context compacted";
	const preview = item.text.trim().replace(/\s+/g, " ").slice(0, 180);
	const timestamp = item.createdAt === null ? null : new Date(item.createdAt);
	const validTimestamp = timestamp && Number.isFinite(timestamp.getTime()) ? timestamp : null;

	return (
		<div
			className="flex w-full min-w-0 items-center gap-3 text-[11px] text-[var(--text-quaternary)]"
			data-hermes-item="compaction"
			data-hermes-role="neutral"
		>
			<div aria-hidden="true" className="h-px min-w-4 flex-1 bg-[var(--border-subtle)]" />
			<details
				open={merged}
				className="group min-w-0 max-w-[66ch] rounded-[10px] px-2 py-1 text-center"
			>
				<summary className="cursor-pointer list-none rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50 [&::-webkit-details-marker]:hidden">
					<span className="font-medium text-[var(--text-tertiary)]">{label}</span>
					{merged && (
						<span className="ml-1.5 font-medium text-[var(--text-secondary)]">
							· Includes retained turn/context content
						</span>
					)}
					<span className="ml-1.5 text-[10px]">
						{item.generation !== null ? `Generation ${item.generation}` : null}
						{item.generation !== null && validTimestamp ? " · " : null}
						{validTimestamp && (
							<time dateTime={validTimestamp.toISOString()}>{validTimestamp.toLocaleString()}</time>
						)}
					</span>
					{preview && (
						<span className="mt-0.5 block max-w-full truncate text-[10px] text-[var(--text-quaternary)]">
							{preview}
						</span>
					)}
					<span className="mt-1 block text-[10px] text-[var(--text-tertiary)] group-open:hidden">
						Show full summary
					</span>
				</summary>
				<div
					className={`mt-2 min-w-0 border-t border-[var(--border-subtle)] pt-3 text-left text-[13px] leading-5 text-[var(--text-secondary)] ${HERMES_CHAT_OVERFLOW_CLASSES.arbitraryContent}`}
				>
					<HermesMarkdown content={item.text} />
				</div>
			</details>
			<div aria-hidden="true" className="h-px min-w-4 flex-1 bg-[var(--border-subtle)]" />
		</div>
	);
}

function HermesUserMessage({ item }: { item: HermesProjectedMessage }) {
	const [expanded, setExpanded] = useState(false);
	const disclosure = hermesUserMessageDisclosure(item.text, expanded);
	const contentId = `hermes-user-message-${item.id}`;

	return (
		<div className="w-full min-w-0" data-hermes-turn="user">
			<div
				data-hermes-user-bubble="true"
				className={`${HERMES_CHAT_LAYOUT_CLASSES.userBubble} rounded-[16px] rounded-br-[5px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 text-[14px] leading-5 text-[var(--text)] ${HERMES_CHAT_OVERFLOW_CLASSES.arbitraryContent}`}
			>
				{item.attachments.length > 0 && (
					<div className="mb-2 flex min-w-0 flex-wrap justify-end gap-1.5">
						{item.attachments.map((attachment) => (
							<div
								key={attachment.id}
								className="max-w-full min-w-0 rounded-[7px] border border-[var(--border-subtle)] bg-[var(--bg-base)]/45 px-2 py-1 text-left text-[10px] leading-4 text-[var(--text-secondary)] [overflow-wrap:anywhere]"
							>
								<div className="font-medium">{attachment.name}</div>
								{attachment.refText && (
									<div className="font-[var(--font-mono)] text-[9px] text-[var(--text-quaternary)]">
										{attachment.refText}
									</div>
								)}
							</div>
						))}
					</div>
				)}
				<div
					id={contentId}
					inert={disclosure.collapsed ? true : undefined}
					className={disclosure.collapsed ? "relative max-h-[240px] overflow-hidden" : undefined}
				>
					<HermesMarkdown content={item.text} />
					{disclosure.collapsed && (
						<div
							aria-hidden="true"
							className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[var(--bg-elevated)] to-transparent"
						/>
					)}
				</div>
				{disclosure.collapsible && (
					<button
						type="button"
						aria-expanded={disclosure.ariaExpanded}
						aria-controls={contentId}
						onClick={() => setExpanded((current) => !current)}
						className="mt-2 rounded-[5px] text-[11px] font-medium text-[var(--text-secondary)] outline-none hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50"
					>
						{disclosure.label}
					</button>
				)}
			</div>
			{item.delivery && (
				<div
					aria-live="polite"
					className="mt-1 text-right text-[9px] text-[var(--text-quaternary)]"
				>
					{item.delivery === "pending" ? "Sending…" : "Accepted by agent"}
				</div>
			)}
		</div>
	);
}

export function HermesTranscript({ items }: { items: HermesTranscriptProjectionItem[] }) {
	return (
		<div className="flex min-w-0 flex-col gap-7">
			{items.map((item) => {
				if (item.kind === "activity") {
					return <HermesActivityGroup key={item.id} activity={item} />;
				}
				if (item.kind === "compaction") {
					return <HermesCompactionEvent key={item.id} item={item} />;
				}
				if (item.role === "user") {
					return <HermesUserMessage key={item.id} item={item} />;
				}
				return (
					<div
						key={item.id}
						className={`${HERMES_CHAT_LAYOUT_CLASSES.assistantColumn} text-[15px] leading-[22px] text-[var(--text-secondary)] ${HERMES_CHAT_OVERFLOW_CLASSES.arbitraryContent}`}
						data-hermes-turn="assistant"
						data-hermes-align="frame-start"
					>
						<HermesMarkdown content={item.text} />
					</div>
				);
			})}
		</div>
	);
}
