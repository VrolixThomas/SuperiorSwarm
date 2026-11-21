import { createTRPCClient } from "@trpc/client";
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueuePermissionDecision } from "../../../src/renderer/components/queue/QueuePermissionDecision";
import { ipcLink } from "../../../src/renderer/trpc/ipc-link";
import type { fixtureRouter } from "./native-main";
const client = createTRPCClient<typeof fixtureRouter>({ links: [ipcLink()] });
type Rows = Awaited<ReturnType<typeof client.permissionFixture.list.query>>;
function Surface() {
	const [rows, setRows] = useState<Rows>([]);
	const refresh = useCallback(() => client.permissionFixture.list.query().then(setRows), []);
	useEffect(() => {
		void refresh();
		const timer = setInterval(() => void refresh(), 250);
		return () => clearInterval(timer);
	}, [refresh]);
	return (
		<main className="p-8">
			<h1>Permission response verification</h1>
			<p>Native UI · provider stand-ins · actual bridge receipts</p>
			{rows.map(({ item, capability }) => (
				<div
					key={item.id}
					data-provider={item.context.provider}
					data-terminal={item.target.type === "terminal" ? item.target.terminalId : ""}
				>
					<h2>{item.context.provider}</h2>
					<QueuePermissionDecision
						item={item}
						capability={capability}
						onDecide={(input) => client.permissionFixture.decide.mutate(input)}
						onOpen={() => {}}
						onChanged={() => void refresh()}
					/>
				</div>
			))}
		</main>
	);
}
createRoot(document.getElementById("root")!).render(<Surface />);
