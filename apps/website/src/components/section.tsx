"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

export function Section({
	children,
	id,
	label,
	className = "",
}: {
	children: ReactNode;
	id?: string;
	label?: string;
	className?: string;
}) {
	const reduced = useReducedMotion();
	return (
		<motion.section
			id={id}
			aria-label={label}
			initial={reduced ? false : { opacity: 0, y: 24 }}
			whileInView={{ opacity: 1, y: 0 }}
			viewport={{ once: true, amount: 0.2 }}
			transition={{ duration: 0.5, ease: "easeOut" }}
			className={`relative mx-auto max-w-5xl px-6 py-24 md:py-32 ${className}`}
		>
			{children}
		</motion.section>
	);
}

/** Wrapper for staggered child animations within a section */
export function StaggerChild({
	children,
	index = 0,
	className = "",
}: {
	children: ReactNode;
	index?: number;
	className?: string;
}) {
	const reduced = useReducedMotion();
	return (
		<motion.div
			initial={reduced ? false : { opacity: 0, y: 20 }}
			whileInView={{ opacity: 1, y: 0 }}
			viewport={{ once: true, amount: 0.2 }}
			transition={{ duration: 0.5, ease: "easeOut", delay: index * 0.1 }}
			className={className}
		>
			{children}
		</motion.div>
	);
}
