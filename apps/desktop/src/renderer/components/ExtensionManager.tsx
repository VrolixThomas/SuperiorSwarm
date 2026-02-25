import { trpc } from "../trpc/client";

interface ExtensionManagerProps {
	onClose: () => void;
}

export function ExtensionManager({ onClose }: ExtensionManagerProps) {
	const utils = trpc.useUtils();
	const { data: extensions, isLoading } = trpc.diff.listExtensions.useQuery();

	const addMutation = trpc.diff.addExtension.useMutation({
		onSuccess: () => utils.diff.listExtensions.invalidate(),
	});

	const toggleMutation = trpc.diff.toggleExtension.useMutation({
		onSuccess: () => utils.diff.listExtensions.invalidate(),
	});

	async function handleAdd() {
		const path = await window.electron.dialog.openFile([
			{ name: "VS Code Extension", extensions: ["vsix"] },
		]);
		if (!path) return;
		addMutation.mutate({ path });
	}

	return (
		<div className="absolute inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
			<div
				className="w-full rounded-t-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-md)]"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
					<span className="flex-1 text-[13px] font-medium text-[var(--text)]">Extensions</span>
					<button
						type="button"
						onClick={onClose}
						className="text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
					>
						✕
					</button>
				</div>

				{/* Extension list */}
				<div className="max-h-64 overflow-y-auto px-4 py-2">
					{isLoading && (
						<div className="py-2 text-[12px] text-[var(--text-quaternary)]">Loading…</div>
					)}
					{extensions && extensions.length === 0 && (
						<div className="py-2 text-[12px] text-[var(--text-quaternary)]">
							No extensions installed. Add a .vsix file to enable language features.
						</div>
					)}
					{extensions?.map((ext) => {
						const name = ext.path.split("/").pop() ?? ext.path;
						return (
							<div
								key={ext.id}
								className="flex items-center gap-2 rounded py-1.5 text-[12px]"
							>
								<button
									type="button"
									onClick={() => toggleMutation.mutate({ id: ext.id, enabled: !ext.enabled })}
									className={`shrink-0 h-4 w-4 rounded border text-[10px] ${
										ext.enabled
											? "border-[var(--accent)] bg-[var(--accent)] text-white"
											: "border-[var(--border)] text-transparent"
									}`}
								>
									✓
								</button>
								<span
									className={`flex-1 truncate ${ext.enabled ? "text-[var(--text-secondary)]" : "text-[var(--text-quaternary)]"}`}
									title={ext.path}
								>
									{name}
								</span>
							</div>
						);
					})}
				</div>

				{/* Footer */}
				<div className="flex justify-between border-t border-[var(--border)] px-4 py-3">
					<p className="text-[11px] text-[var(--text-quaternary)]">
						Changes take effect on next diff open
					</p>
					<button
						type="button"
						onClick={handleAdd}
						disabled={addMutation.isPending}
						className="rounded-[6px] bg-[var(--accent)] px-3 py-1 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
					>
						Add .vsix
					</button>
				</div>
			</div>
		</div>
	);
}
