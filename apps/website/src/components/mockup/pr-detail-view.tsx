export function PrDetailView() {
	return (
		<div className="flex flex-1 flex-col bg-bg-base">
			{/* Tab bar matching real app style */}
			<div className="flex items-center border-b border-border">
				<div className="flex items-center gap-1 border-b-2 border-accent px-3 py-1.5">
					<span className="text-[11px] font-medium text-accent">package.json</span>
					<button type="button" className="ml-1 text-[9px] text-text-faint hover:text-text-muted">
						×
					</button>
				</div>
			</div>

			{/* Code editor content - showing package.json like in the real app */}
			<div className="flex-1 overflow-hidden p-0">
				<div className="flex">
					{/* Line numbers */}
					<div className="select-none border-r border-border px-2 py-3 text-right">
						{[1, 2, 3, 4, 5, 6].map((n) => (
							<div key={n} className="font-mono text-[11px] leading-[1.65] text-text-faint">
								{n}
							</div>
						))}
					</div>
					{/* Code content */}
					<div className="flex-1 py-3 pl-4">
						<pre className="font-mono text-[11px] leading-[1.65]">
							<span className="text-text-faint">{"{"}</span>
							{"\n"}
							<span className="text-text-muted">{"  "}</span>
							<span className="text-green">{'"name"'}</span>
							<span className="text-text-faint">: </span>
							<span className="text-accent">{'"superiorswarm-test"'}</span>
							<span className="text-text-faint">,</span>
							{"\n"}
							<span className="text-text-muted">{"  "}</span>
							<span className="text-green">{'"version"'}</span>
							<span className="text-text-faint">: </span>
							<span className="text-accent">{'"1.0.0"'}</span>
							<span className="text-text-faint">,</span>
							{"\n"}
							<span className="text-text-muted">{"  "}</span>
							<span className="text-green">{'"private"'}</span>
							<span className="text-text-faint">: </span>
							<span className="text-purple">true</span>
							{"\n"}
							<span className="text-text-faint">{"}"}</span>
							{"\n"}
						</pre>
					</div>
				</div>
			</div>
		</div>
	);
}
