import { Nav } from "@/components/nav";
import type { ReactNode } from "react";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
	return (
		<>
			<Nav />
			<main className="mx-auto max-w-2xl px-6 pb-24 pt-28 md:px-8">
				<p className="mb-2 text-xs text-text-muted">Last updated: {updated}</p>
				<h1 className="mb-10 text-2xl font-semibold text-text-primary">{title}</h1>
				<div className="space-y-8 text-sm leading-relaxed text-text-secondary">{children}</div>
			</main>
		</>
	);
}

export function Section({ heading, children }: { heading?: string; children: ReactNode }) {
	return (
		<section>
			{heading && <h2 className="mb-3 text-sm font-semibold text-text-primary">{heading}</h2>}
			<div className="space-y-3">{children}</div>
		</section>
	);
}

export function P({ children }: { children: ReactNode }) {
	return <p>{children}</p>;
}

export function UL({ children }: { children: ReactNode }) {
	return <ul className="list-disc space-y-1 pl-5">{children}</ul>;
}

export function Caps({ children }: { children: ReactNode }) {
	return <p className="font-medium uppercase tracking-wide text-text-secondary">{children}</p>;
}
