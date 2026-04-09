import { diffLines } from "diff";
import { useMemo } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface MarkdownRenderedDiffProps {
	original: string;
	modified: string;
}

export function MarkdownRenderedDiff({ original, modified }: MarkdownRenderedDiffProps) {
	const chunks = useMemo(
		() => diffLines(original, modified, { ignoreNewlineAtEof: true }),
		[original, modified]
	);

	return (
		<div className="flex flex-col">
			{chunks.map((chunk, i) => {
				if (chunk.added) {
					return (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: stable positional chunks
							key={i}
							className="mb-0.5 rounded border-l-2 border-[#30d158] bg-[rgba(48,209,88,0.08)] py-0.5 pl-3 pr-2"
						>
							<MarkdownRenderer content={chunk.value} />
						</div>
					);
				}
				if (chunk.removed) {
					return (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: stable positional chunks
							key={i}
							className="mb-0.5 rounded border-l-2 border-[#ff453a] bg-[rgba(255,69,58,0.08)] py-0.5 pl-3 pr-2 opacity-75"
						>
							<MarkdownRenderer content={chunk.value} />
						</div>
					);
				}
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: stable positional chunks
					<div key={i}>
						<MarkdownRenderer content={chunk.value} />
					</div>
				);
			})}
		</div>
	);
}
