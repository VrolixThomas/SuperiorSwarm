// V4 timeline. 60fps. ~78s total = 4680f.
// Scenes:
//   opening          0–420    7s   8 terminals appear 4×2, merge into one
//   s1Terminal     420–660    4s   single base terminal
//   s2SidebarBuild 660–1200   9s   tabs→repos→worktrees→+Repo+settings
//   s2bThemeSweep  1200–1380  3s   light/dark fade
//   s3StartWS      1380–1680  5s   pulsing logos top-down (active worktrees)
//   s4AgentsDone   1680–2100  7s   random green flips (task-complete)
//   s5DiffPanel    2100–2640  9s   right diff panel + code editor
//   s6FileNav      2640–2880  4s   file tree navigation + Files-tab right panel
//   s7PRComment    2880–3240  6s   comments tab right panel
//   s8SolveResult  3240–3720  8s   full solve result (3 panes)
//   s9Tickets      3720–4080  6s   tickets tab → Start-worktree affordance
//   s10PRsList     4080–4380  5s   PRs to review
//   outro          4380–4680  5s   pulsing logo + CTA
export const FPS_V4 = 60;
export const TOTAL_FRAMES_V4 = 4680;

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
	outro: { from: 4380, duration: 300 },
} as const;

export type SceneKeyV4 = keyof typeof SCENES_V4;

export const SPRING_V4 = { damping: 22, stiffness: 110, mass: 0.7 } as const;
