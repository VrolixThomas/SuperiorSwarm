import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
	content: string;
	className?: string;
	components?: Components;
	skipHtml?: boolean;
	syntaxHighlighting?: boolean;
	variant?: "default" | "unstyled";
}

export type MarkdownComponents = Components;

const MARKDOWN_COMPONENTS: Components = {
	a: ({ href, children, ...props }) => (
		<a
			{...props}
			href={href}
			onClick={(e) => {
				e.preventDefault();
				if (href) window.electron.shell.openExternal(href);
			}}
		>
			{children}
		</a>
	),
};

export const MarkdownRenderer = memo(function MarkdownRenderer({
	content,
	className,
	components,
	skipHtml = false,
	syntaxHighlighting = true,
	variant = "default",
}: MarkdownRendererProps) {
	const defaultVariant = variant === "default";
	return (
		<div
			className={defaultVariant ? `markdown-body ${className ?? ""}` : className}
			style={defaultVariant ? { lineHeight: 1.7, fontSize: 13 } : undefined}
		>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={syntaxHighlighting ? [rehypeHighlight] : []}
				components={{ ...MARKDOWN_COMPONENTS, ...components }}
				skipHtml={skipHtml}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
});
