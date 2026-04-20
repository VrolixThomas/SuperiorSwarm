import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
	content: string;
	className?: string;
}

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

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
	return (
		<div className={`markdown-body ${className ?? ""}`} style={{ lineHeight: 1.7, fontSize: 13 }}>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[rehypeHighlight]}
				components={MARKDOWN_COMPONENTS}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}
