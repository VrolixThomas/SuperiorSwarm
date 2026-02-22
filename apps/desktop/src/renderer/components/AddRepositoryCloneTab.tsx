import { useState } from "react";
import { useProjectStore } from "../stores/projects";
import { trpc } from "../trpc/client";

export function AddRepositoryCloneTab() {
	const [url, setUrl] = useState("");
	const [directory, setDirectory] = useState("~/BranchFlux/projects/");
	const utils = trpc.useUtils();
	const { closeAddModal } = useProjectStore();

	const cloneMutation = trpc.projects.clone.useMutation({
		onSuccess: () => {
			utils.projects.list.invalidate();
			closeAddModal();
		},
	});

	const handleBrowse = async () => {
		const paths = await window.electron.dialog.openDirectory();
		const selected = paths?.[0];
		if (selected) {
			setDirectory(selected);
		}
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		cloneMutation.mutate({ url, targetDir: directory });
	};

	return (
		<form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4">
			<div className="flex flex-col gap-1.5">
				<label
					htmlFor="clone-url"
					className="text-[13px] font-medium text-[var(--text-secondary)]"
				>
					Repository URL
				</label>
				<input
					id="clone-url"
					type="text"
					value={url}
					onChange={(e) => setUrl(e.target.value)}
					placeholder="https://github.com/owner/repo.git"
					className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<label
					htmlFor="clone-dir"
					className="text-[13px] font-medium text-[var(--text-secondary)]"
				>
					Directory
				</label>
				<div className="flex gap-2">
					<input
						id="clone-dir"
						type="text"
						value={directory}
						onChange={(e) => setDirectory(e.target.value)}
						className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[13px] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
					/>
					<button
						type="button"
						onClick={handleBrowse}
						className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[13px] text-[var(--text-secondary)] transition-all duration-[120ms] hover:bg-[var(--bg-overlay)]"
					>
						Browse
					</button>
				</div>
			</div>

			<button
				type="submit"
				disabled={!url.trim() || cloneMutation.isPending}
				className="w-full rounded-[var(--radius-md)] bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-white transition-all duration-[120ms] hover:bg-[var(--accent-hover)] disabled:opacity-50"
			>
				{cloneMutation.isPending ? "Cloning..." : "Clone Repository"}
			</button>

			{cloneMutation.isError && (
				<p className="text-[13px] text-[var(--term-red)]">
					{cloneMutation.error.message}
				</p>
			)}
		</form>
	);
}
