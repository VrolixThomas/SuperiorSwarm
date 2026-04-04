declare module "node-diff3" {
	export interface OkSection {
		ok: string[];
	}
	export interface ConflictSection {
		conflict: {
			a: string[];
			aIndex: number;
			o: string[];
			oIndex: number;
			b: string[];
			bIndex: number;
		};
	}
	export type MergeSection = OkSection | ConflictSection;
	export function diff3Merge(a: string[], o: string[], b: string[]): MergeSection[];
}
