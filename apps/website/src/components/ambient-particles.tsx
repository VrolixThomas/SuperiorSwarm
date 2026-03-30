"use client";

import { useReducedMotion } from "motion/react";
import { useMemo } from "react";

const PARTICLE_COUNT = 24;

function generateParticles() {
	return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
		id: i,
		left: `${Math.random() * 100}%`,
		size: 2 + Math.random() * 2,
		opacity: 0.04 + Math.random() * 0.06,
		duration: 20 + Math.random() * 30,
		delay: Math.random() * -40,
		color: Math.random() > 0.5 ? "var(--color-accent)" : "var(--color-brand)",
	}));
}

export function AmbientParticles() {
	const reduced = useReducedMotion();
	const particles = useMemo(() => generateParticles(), []);

	return (
		<div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
			{particles.map((p) => (
				<div
					key={p.id}
					className="absolute rounded-full"
					style={{
						left: p.left,
						bottom: "-10px",
						width: p.size,
						height: p.size,
						backgroundColor: p.color,
						opacity: reduced ? p.opacity : 0,
						animation: reduced
							? "none"
							: `particle-drift ${p.duration}s linear ${p.delay}s infinite`,
					}}
				/>
			))}
		</div>
	);
}
