"use client";

import { supabase } from "@/lib/supabase";
import { useState } from "react";

type FormState = "idle" | "loading" | "success" | "error" | "duplicate";

export function WaitlistForm() {
	const [email, setEmail] = useState("");
	const [honeypot, setHoneypot] = useState("");
	const [state, setState] = useState<FormState>("idle");

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!email.trim()) return;

		// Honeypot: bots auto-fill hidden fields, humans don't
		if (honeypot) {
			setState("success");
			return;
		}

		setState("loading");

		const { error } = await supabase.from("waitlist").insert({ email: email.trim() });

		if (error) {
			if (error.code === "23505") {
				setState("duplicate");
			} else {
				setState("error");
			}
			return;
		}

		setState("success");
		setEmail("");
	}

	if (state === "success") {
		return (
			<div className="flex flex-col items-center gap-2">
				<p className="text-[15px] font-medium text-accent">You're on the list.</p>
				<p className="text-[13px] text-text-secondary">
					We'll let you know when SuperiorSwarm is ready.
				</p>
			</div>
		);
	}

	if (state === "duplicate") {
		return (
			<div className="flex flex-col items-center gap-2">
				<p className="text-[15px] font-medium text-accent">You're already on the list.</p>
				<p className="text-[13px] text-text-secondary">
					We'll reach out when it's time.
				</p>
			</div>
		);
	}

	return (
		<form onSubmit={handleSubmit} className="flex flex-col items-center gap-3">
			{/* Honeypot — invisible to humans, bots auto-fill it */}
			<div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
				<label htmlFor="website">Website</label>
				<input
					id="website"
					name="website"
					type="text"
					tabIndex={-1}
					autoComplete="off"
					value={honeypot}
					onChange={(e) => setHoneypot(e.target.value)}
				/>
			</div>

			<div className="flex w-full max-w-sm flex-col items-stretch gap-2 sm:flex-row sm:items-center">
				<input
					type="email"
					required
					value={email}
					onChange={(e) => {
						setEmail(e.target.value);
						if (state === "error") setState("idle");
					}}
					placeholder="you@email.com"
					className="flex-1 rounded-full border border-border bg-bg-surface px-5 py-2.5 text-[15px] text-text-primary placeholder:text-text-faint outline-none transition-colors focus:border-accent"
				/>
				<button
					type="submit"
					disabled={state === "loading"}
					className="shrink-0 rounded-full bg-accent px-6 py-2.5 text-[15px] font-medium text-bg-base transition-shadow hover:shadow-[0_0_20px_rgba(196,149,108,0.3)] disabled:opacity-50"
				>
					{state === "loading" ? "Joining..." : "Join waitlist"}
				</button>
			</div>
			{state === "error" && (
				<p className="text-[13px] text-red">Something went wrong. Try again.</p>
			)}
			<p className="text-[11px] text-text-faint">Free & open source · macOS</p>
		</form>
	);
}
