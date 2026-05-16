// V4 timeline. 60fps. ~83s total = 4980f.
// Scenes:
//   opening          0–420    7s   8 terminals appear 4×2, collapse to 1
//   s1Terminal     420–660    4s   single base terminal
//   s2SidebarBuild 660–1200   9s   tabs→repos→worktrees→+Repo+settings
//   s2bThemeSweep  1200–1380  3s   diagonal light reveal + return
//   s3StartWS      1380–1680  5s   pulsing logos top-down
//   s4AgentsDone   1680–2100  7s   random green flips
//   s5DiffPanel    2100–2640  9s   right panel + diff highlight
//   s6FileNav      2640–2880  4s   file tree navigation
//   s7PRComment    2880–3240  6s   comments + Solve-with-AI
//   s8SolveResult  3240–3720  8s   full solve result
//   s9Tickets      3720–4080  6s   tickets tab → worktree
//   s10PRsList     4080–4380  5s   PRs to review
//   s11ReviewResult 4380–4860 8s   AI PR review result
//   endHold        4860–4980  2s   final hold
export const FPS_V4 = 60;
export const TOTAL_FRAMES_V4 = 4980;

export const SCENES_V4 = {
	opening: { from: 0, duration: 420 },
	s1Terminal: { from: 420, duration: 240 },
	s2SidebarBuild: { from: 660, duration: 540 },
	s2bThemeSweep: { from: 1200, duration: 180 },
	s3StartWS: { from: 1380, duration: 300 },
	s4AgentsDone: { from: 1680, duration: 420 },
	s5DiffPanel: { from: 2100, duration: 540 },
	s6FileNav: { from: 2640, duration: 240 },
	s7PRComment: { from: 2880, duration: 360 },
	s8SolveResult: { from: 3240, duration: 480 },
	s9Tickets: { from: 3720, duration: 360 },
	s10PRsList: { from: 4080, duration: 300 },
	s11ReviewResult: { from: 4380, duration: 480 },
	endHold: { from: 4860, duration: 120 },
} as const;

export type SceneKeyV4 = keyof typeof SCENES_V4;

export const SPRING_V4 = { damping: 22, stiffness: 110, mass: 0.7 } as const;
