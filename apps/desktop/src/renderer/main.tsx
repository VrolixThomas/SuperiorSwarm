import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";
import { trpc } from "./trpc/client";
import { ipcLink } from "./trpc/ipc-link";

function Root() {
	const [queryClient] = useState(() => new QueryClient());
	const [trpcClient] = useState(() =>
		trpc.createClient({
			links: [ipcLink()],
		})
	);

	return (
		<trpc.Provider client={trpcClient} queryClient={queryClient}>
			<QueryClientProvider client={queryClient}>
				<App />
			</QueryClientProvider>
		</trpc.Provider>
	);
}

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
	<StrictMode>
		<ErrorBoundary>
			<Root />
		</ErrorBoundary>
	</StrictMode>
);
