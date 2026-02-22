import { useEffect, useState } from "react";
import { useProjectStore } from "../stores/projects";
import { AddRepositoryCloneTab } from "./AddRepositoryCloneTab";
import { AddRepositoryCreateTab } from "./AddRepositoryCreateTab";
import { AddRepositoryOpenTab } from "./AddRepositoryOpenTab";

type Tab = "clone" | "open" | "create";

const TABS: { key: Tab; label: string }[] = [
	{ key: "clone", label: "Clone" },
	{ key: "open", label: "Open" },
	{ key: "create", label: "Create" },
];

export function AddRepositoryModal() {
	const { isAddModalOpen, closeAddModal } = useProjectStore();
	const [activeTab, setActiveTab] = useState<Tab>("clone");

	useEffect(() => {
		if (!isAddModalOpen) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				closeAddModal();
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isAddModalOpen, closeAddModal]);

	if (!isAddModalOpen) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
			onClick={(e) => {
				if (e.target === e.currentTarget) closeAddModal();
			}}
			onKeyDown={() => {}}
			role="presentation"
		>
			<div className="w-[480px] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-md)]">
				{/* Header */}
				<div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
					<h2 className="text-[15px] font-semibold text-[var(--text)]">
						Add Repository
					</h2>
					<button
						type="button"
						onClick={closeAddModal}
						className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
					>
						<svg
							aria-hidden="true"
							width="14"
							height="14"
							viewBox="0 0 16 16"
							fill="none"
						>
							<path
								d="M4 4l8 8M12 4l-8 8"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
					</button>
				</div>

				{/* Tab bar */}
				<div className="flex border-b border-[var(--border)] px-4">
					{TABS.map((tab) => (
						<button
							key={tab.key}
							type="button"
							onClick={() => setActiveTab(tab.key)}
							className={`px-3 py-2 text-[13px] transition-all duration-[120ms] ${
								activeTab === tab.key
									? "border-b-2 border-[var(--accent)] text-[var(--text)]"
									: "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
							}`}
						>
							{tab.label}
						</button>
					))}
				</div>

				{/* Tab content */}
				{activeTab === "clone" && <AddRepositoryCloneTab />}
				{activeTab === "open" && <AddRepositoryOpenTab />}
				{activeTab === "create" && <AddRepositoryCreateTab />}
			</div>
		</div>
	);
}
