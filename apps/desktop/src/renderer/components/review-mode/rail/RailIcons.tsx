import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };
function Icon({ size = 14, children, ...props }: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.6"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{...props}
		>
			{children}
		</svg>
	);
}
export function Check(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="m3.5 8.5 3 3 6-7" />
		</Icon>
	);
}
export function Circle(props: IconProps) {
	return (
		<Icon {...props}>
			<circle cx="8" cy="8" r="6" />
		</Icon>
	);
}
export function FlaskConical(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M6 2h4M7 2v5l-4 6h10L9 7V2M5 10h6" />
		</Icon>
	);
}
export function MessageSquare(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M2 3h12v8H6l-4 3V3Z" />
		</Icon>
	);
}
export function Sparkles(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="m8 1 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" />
		</Icon>
	);
}
export function ArrowRightToLine(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M2 8h8M7 5l3 3-3 3M13.5 3v10" />
		</Icon>
	);
}
export function ChevronDown(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="m4 6 4 4 4-4" />
		</Icon>
	);
}
export function ChevronRight(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="m6 4 4 4-4 4" />
		</Icon>
	);
}
export function Bot(props: IconProps) {
	return (
		<Icon {...props}>
			<rect x="3" y="4.5" width="10" height="8" rx="2" />
			<path d="M8 2v2.5M6 8.5h.01M10 8.5h.01" />
		</Icon>
	);
}
export function LoaderCircle(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M8 2a6 6 0 1 1-6 6" />
		</Icon>
	);
}
export function MoreHorizontal(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M3 8h.01M8 8h.01M13 8h.01" />
		</Icon>
	);
}
