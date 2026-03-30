import { useState } from "react";
import { FileIcon } from "./icons";

type CenterTab = "terminal" | "ChatPanel.tsx" | "chat-service.ts";

export function TerminalView() {
	const [activeTab, setActiveTab] = useState<CenterTab>("terminal");

	return (
		<div className="flex flex-1 flex-col">
			{/* Pane tab bar — matches real app PaneTabBar */}
			<div className="flex h-[36px] shrink-0 items-center border-b border-border bg-bg-elevated">
				{/* Pane index */}
				<div className="flex h-full w-[28px] shrink-0 items-center justify-center text-[11px] font-medium text-text-faint">
					1
				</div>

				{/* Terminal tab */}
				<TabPill
					active={activeTab === "terminal"}
					onClick={() => setActiveTab("terminal")}
					icon={<span className="shrink-0 font-mono text-[10px] text-text-faint">&gt;_</span>}
					label="* Claude Code"
				/>

				{/* ChatPanel.tsx tab */}
				<TabPill
					active={activeTab === "ChatPanel.tsx"}
					onClick={() => setActiveTab("ChatPanel.tsx")}
					icon={<FileIcon color="#3178c6" />}
					label="ChatPanel.tsx"
				/>

				{/* chat-service.ts tab */}
				<TabPill
					active={activeTab === "chat-service.ts"}
					onClick={() => setActiveTab("chat-service.ts")}
					icon={<FileIcon color="#3178c6" />}
					label="chat-service.ts"
				/>

				{/* Spacer + new tab button */}
				<div className="flex-1" />
				<div className="shrink-0 pr-1">
					<span className="flex h-[24px] w-[24px] items-center justify-center rounded-[5px] text-text-faint">
						<svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none">
							<path
								d="M8 3v10M3 8h10"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
					</span>
				</div>
			</div>

			{/* Tab content */}
			{activeTab === "terminal" && <TerminalContent />}
			{activeTab === "ChatPanel.tsx" && <CodeEditorContent file="ChatPanel.tsx" />}
			{activeTab === "chat-service.ts" && <CodeEditorContent file="chat-service.ts" />}

			{/* Bottom workspace label */}
			<div className="flex items-center border-t border-border px-3 py-1">
				<span className="rounded bg-accent-dim px-1.5 py-0.5 text-[10px] font-medium text-accent">
					PR #34
				</span>
			</div>
		</div>
	);
}

function TabPill({
	active,
	onClick,
	icon,
	label,
}: {
	active: boolean;
	onClick: () => void;
	icon: React.ReactNode;
	label: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={[
				"relative flex h-[28px] max-w-[180px] shrink-0 items-center gap-1.5 rounded-[6px] pl-2.5 pr-1.5 text-[12px]",
				active
					? "bg-bg-overlay text-text-primary shadow-[0_1px_3px_rgba(0,0,0,0.4),inset_0_0.5px_0_rgba(255,255,255,0.04)]"
					: "text-text-faint hover:text-text-muted",
			].join(" ")}
		>
			{active && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-accent" />}
			{icon}
			<span className="min-w-0 truncate">{label}</span>
			<span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] text-text-muted">
				<svg aria-hidden="true" width="8" height="8" viewBox="0 0 9 9" fill="none">
					<path
						d="M2 2l5 5M7 2l-5 5"
						stroke="currentColor"
						strokeWidth="1.4"
						strokeLinecap="round"
					/>
				</svg>
			</span>
		</button>
	);
}

function TerminalContent() {
	return (
		<div className="flex-1 overflow-hidden p-3">
			<pre className="font-mono text-[11px] leading-[1.7] text-text-primary">
				{/* Shell prompt */}
				<span className="text-accent">~/SuperiorSwarm</span>
				<span className="text-text-muted"> on </span>
				<span className="text-purple">feature/inline-agent-chat</span>
				{"\n"}
				<span className="text-green">❯ </span>
				<span className="text-text-primary">claude</span>
				{"\n"}
				{/* Minimal Claude Code header — matches the real ── line style */}
				<span className="text-accent">{"── "}</span>
				<span className="text-accent">Claude Code</span>
				<span className="text-text-faint"> v2.1.87</span>
				<span className="text-accent">{" ──────────────────────────────────────────"}</span>
				{"\n\n"}
				{/* User prompt */}
				<span className="text-text-primary">
					{">"} implement the ChatPanel component with streaming message display
				</span>
				{"\n\n"}
				{/* Agent reading files */}
				<span className="text-text-faint">{"  ⠸ "}</span>
				<span className="text-text-muted">Analyzing codebase...</span>
				{"\n"}
				<span className="text-text-faint">{"  ⠸ "}</span>
				<span className="text-text-muted">
					Reading src/shared/chat-types.ts, src/main/chat/chat-service.ts
				</span>
				{"\n\n"}
				{/* File operations */}
				<span className="text-green">{"  ✓ "}</span>
				<span className="text-text-secondary">Created </span>
				<span className="text-text-primary">src/renderer/hooks/useAgentChat.ts</span>
				<span className="text-green"> (+89 lines)</span>
				{"\n"}
				<span className="text-green">{"  ✓ "}</span>
				<span className="text-text-secondary">Created </span>
				<span className="text-text-primary">src/renderer/components/ChatMessage.tsx</span>
				<span className="text-green"> (+67 lines)</span>
				{"\n"}
				<span className="text-green">{"  ✓ "}</span>
				<span className="text-text-secondary">Modified </span>
				<span className="text-text-primary">src/renderer/components/ChatPanel.tsx</span>
				<span className="text-green"> +156</span>
				<span className="text-red"> -23</span>
				{"\n"}
				<span className="text-green">{"  ✓ "}</span>
				<span className="text-text-secondary">Modified </span>
				<span className="text-text-primary">src/main/chat/chat-service.ts</span>
				<span className="text-green"> +34</span>
				<span className="text-red"> -8</span>
				{"\n\n"}
				{/* Test results */}
				<span className="text-text-secondary">{"  "}Running tests...</span>
				{"\n"}
				<span className="text-green">{"  ✓ "}</span>
				<span className="text-text-secondary">chat/chat-service.test.ts (6 tests)</span>
				{"\n"}
				<span className="text-green">{"  ✓ "}</span>
				<span className="text-text-secondary">hooks/useAgentChat.test.ts (4 tests)</span>
				{"\n"}
				<span className="text-green">{"  ✓ "}</span>
				<span className="text-green">10 tests passed</span>
				{"\n\n"}
				{/* Cursor */}
				<span className="text-text-primary">{">"} </span>
				<span className="animate-pulse text-text-primary">█</span>
			</pre>
		</div>
	);
}

const CHAT_PANEL_CODE = `import { useEffect, useRef, useCallback } from "react";
import { useAgentChat } from "../hooks/useAgentChat";
import { ChatMessage } from "./ChatMessage";
import type { AgentMessage } from "../../shared/chat-types";

interface ChatPanelProps {
  conversationId: string;
  agentId: string;
  onClose: () => void;
}

export function ChatPanel({ conversationId, agentId, onClose }: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { messages, streamingContent, send, status } = useAgentChat({
    conversationId,
    agentId,
  });

  // Subscribe to message stream with cleanup
  useEffect(() => {
    const unsubscribe = messages.subscribe(() => {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      });
    });
    return () => unsubscribe();
  }, [messages]);

  const handleSend = useCallback(
    (content: string) => {
      send({ role: "user", content, timestamp: Date.now() });
    },
    [send],
  );

  return (
    <div className="flex h-full flex-col bg-bg-base">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <div className="size-2 rounded-full bg-green animate-pulse" />
        <span className="text-sm font-medium">{agentId}</span>
        <span className="text-xs text-muted">{status}</span>
        <button onClick={onClose} className="ml-auto">x</button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {messages.map((msg: AgentMessage) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {streamingContent && (
          <ChatMessage
            message={{ role: "assistant", content: streamingContent }}
            streaming
          />
        )}
      </div>

      <ChatInput onSend={handleSend} disabled={status !== "connected"} />
    </div>
  );
}`;

const CHAT_SERVICE_CODE = `import { MessageQueue } from "./message-queue";
import type { ChatMessage, ChatEvent } from "../../shared/chat-types";

export class ChatService {
  private ws: WebSocket;
  private queue: MessageQueue;
  private reconnectAttempts = 0;
  private listeners = new Map<string, Set<(e: ChatEvent) => void>>();

  constructor(private url: string) {
    this.queue = new MessageQueue();
    this.connect(url);
  }

  async send(message: ChatMessage): Promise<void> {
    this.queue.enqueue(message);
    await this.queue.flush(this.ws);
  }

  on(event: string, handler: (e: ChatEvent) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  private connect(url: string): void {
    this.ws = this.createSocket(url);
    this.ws.onmessage = (e) => this.handleMessage(e);
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.queue.flush(this.ws);
    };
    this.ws.onclose = () => this.reconnectWithBackoff(url);
  }

  private reconnectWithBackoff(url: string): void {
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    setTimeout(() => {
      this.reconnectAttempts++;
      this.connect(url);
    }, delay);
  }

  private createSocket(url: string): WebSocket {
    return new WebSocket(url);
  }

  private handleMessage(event: MessageEvent): void {
    const data = JSON.parse(event.data) as ChatEvent;
    this.listeners.get(data.type)?.forEach((fn) => fn(data));
  }

  dispose(): void {
    this.ws.close();
    this.listeners.clear();
  }
}`;

const CHAT_PANEL_LINES = CHAT_PANEL_CODE.split("\n");
const CHAT_SERVICE_LINES = CHAT_SERVICE_CODE.split("\n");

function CodeEditorContent({ file }: { file: "ChatPanel.tsx" | "chat-service.ts" }) {
	const lines = file === "ChatPanel.tsx" ? CHAT_PANEL_LINES : CHAT_SERVICE_LINES;
	const filePath =
		file === "ChatPanel.tsx"
			? "src/renderer/components/ChatPanel.tsx"
			: "src/main/chat/chat-service.ts";

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			{/* File path bar */}
			<div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-bg-surface px-3">
				<span className="flex-1 truncate font-mono text-[11px] text-text-faint">{filePath}</span>
				<span className="font-mono text-[10px] text-text-faint">feature/inline-agent-chat</span>
			</div>

			{/* Code content */}
			<div className="flex-1 overflow-auto bg-bg-base">
				<table className="w-full border-collapse font-mono text-[11px] leading-[1.7]">
					<tbody>
						{lines.map((line, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: static mock data, never reorders
							<tr key={i} className="hover:bg-bg-elevated/40">
								<td className="w-[42px] select-none border-r border-border px-2 text-right text-[10px] text-text-faint/50">
									{i + 1}
								</td>
								<td className="whitespace-pre pl-3 pr-4 text-text-muted">
									<CodeLine content={line} />
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function CodeLine({ content }: { content: string }) {
	// Simple keyword-based highlighting for visual effect
	const highlighted = highlightSyntax(content);
	return <>{highlighted}</>;
}

function highlightSyntax(line: string): React.ReactNode[] {
	const result: React.ReactNode[] = [];
	let remaining = line;
	let keyIdx = 0;

	// Match patterns in order of priority
	const patterns: [RegExp, string][] = [
		[/^(\/\/.*)/, "text-text-faint"], // single-line comments
		[
			/^(import|export|from|return|const|let|new|type|interface|class|function|if|else|async|await|typeof|private|this|void)\b/,
			"text-accent",
		],
		[/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/, "text-green"],
		[/^(true|false|null|undefined|Date)\b/, "text-yellow"],
		[/^(\d+(?:_\d+)*)/, "text-yellow"],
		[/^(=>|\.\.\.|\?\.)/, "text-accent"],
	];

	while (remaining.length > 0) {
		let matched = false;

		// Skip leading whitespace
		const wsMatch = remaining.match(/^(\s+)/);
		if (wsMatch?.[1]) {
			result.push(wsMatch[1]);
			remaining = remaining.slice(wsMatch[1].length);
			if (remaining.length === 0) break;
		}

		for (const [pattern, className] of patterns) {
			const m = remaining.match(pattern);
			if (m?.[1]) {
				result.push(
					<span key={keyIdx++} className={className}>
						{m[1]}
					</span>
				);
				remaining = remaining.slice(m[1].length);
				matched = true;
				break;
			}
		}

		if (!matched) {
			// Take one character or a word
			const wordMatch = remaining.match(/^([^\s"'`]+)/);
			if (wordMatch?.[1]) {
				result.push(wordMatch[1]);
				remaining = remaining.slice(wordMatch[1].length);
			} else {
				result.push(remaining[0] ?? "");
				remaining = remaining.slice(1);
			}
		}
	}

	return result;
}
