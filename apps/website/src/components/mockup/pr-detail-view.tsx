export function PrDetailView() {
	return (
		<div className="flex flex-1 flex-col bg-app-bg-base">
			{/* Tab bar matching real app style */}
			<div className="flex items-center border-b border-app-border-subtle">
				<div className="flex items-center gap-1 border-b-2 border-app-accent px-3 py-1.5">
					<span className="text-[11px] font-medium text-app-accent">package.json</span>
					<button type="button" className="ml-1 text-[9px] text-app-text-quaternary hover:text-app-text-tertiary">
						×
					</button>
				</div>
			</div>

			{/* Code editor content - showing package.json like in the real app */}
			<div className="flex-1 overflow-hidden p-0">
				<div className="flex">
					{/* Line numbers */}
					<div className="select-none border-r border-app-border-subtle px-2 py-3 text-right">
						{[1, 2, 3, 4, 5, 6].map((n) => (
							<div key={n} className="font-mono text-[11px] leading-[1.65] text-app-text-quaternary">
								{n}
							</div>
						))}
					</div>
					{/* Code content */}
					<div className="flex-1 py-3 pl-4">
						<pre className="font-mono text-[11px] leading-[1.65]">
							<span className="text-app-text-quaternary">{"{"}</span>
							{"\n"}
							<span className="text-app-text-tertiary">{"  "}</span>
							<span className="text-app-success">{'"name"'}</span>
							<span className="text-app-text-quaternary">: </span>
							<span className="text-app-accent">{'"superiorswarm-test"'}</span>
							<span className="text-app-text-quaternary">,</span>
							{"\n"}
							<span className="text-app-text-tertiary">{"  "}</span>
							<span className="text-app-success">{'"version"'}</span>
							<span className="text-app-text-quaternary">: </span>
							<span className="text-app-accent">{'"1.0.0"'}</span>
							<span className="text-app-text-quaternary">,</span>
							{"\n"}
							<span className="text-app-text-tertiary">{"  "}</span>
							<span className="text-app-success">{'"private"'}</span>
							<span className="text-app-text-quaternary">: </span>
							<span className="text-app-purple">true</span>
							{"\n"}
							<span className="text-app-text-quaternary">{"}"}</span>
							{"\n"}
						</pre>
					</div>
				</div>
			</div>
		</div>
	);
}
