import { Window } from "happy-dom";

// React Query decides whether timers are available at module evaluation time.
// Install a browser global before importing the renderer test helper/components.
Object.assign(globalThis, { window: new Window() });
