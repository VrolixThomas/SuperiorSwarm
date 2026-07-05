export type ResultItem =
	| { type: "file"; path: string }
	| {
			type: "symbol";
			name: string;
			kind: number;
			path: string;
			line: number;
			column: number;
			container?: string;
	  }
	| { type: "text"; path: string; line: number; text: string };

export function resultKey(item: ResultItem): string {
	switch (item.type) {
		case "file":
			return JSON.stringify(["file", item.path]);
		case "symbol":
			return JSON.stringify([
				"symbol",
				item.name,
				item.path,
				item.line,
				item.column,
				item.kind,
				item.container ?? "",
			]);
		case "text":
			return JSON.stringify(["text", item.path, item.line, item.text]);
	}
}
