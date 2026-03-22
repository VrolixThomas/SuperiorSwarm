import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
	content: string;
	className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
	return (
		<div className={`markdown-body ${className ?? ""}`} style={{ lineHeight: 1.7, fontSize: 13 }}>
			<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
				{content}
			</ReactMarkdown>
		</div>
	);
}
