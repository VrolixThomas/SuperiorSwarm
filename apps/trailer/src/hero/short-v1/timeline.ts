// Short-v1 timeline. 60fps. 44s = 2640f. Music-only, "construct the app" arc.
//
// Each scene mounts ONCE and plays v4's natural build animation through its
// inner shifted clock — no per-beat re-mount, no double-build, no clock jumps.
//
// Scene map (12 scenes):
//   opening        0–120        2.0s   8 terminals merge → 1
//   baseTerminal 120–360        4.0s   single base terminal settles
//   sidebarBuild 360–780        7.0s   tabs → repos → worktrees → +Repo settings
//   diffPanel    780–1140       6.0s   right diff panel slides + diff body fills
//   splitFile   1140–1320       3.0s   split-pane file enters
//   comments    1320–1560       4.0s   comment cards stamp in + resolve to green
//   approve     1560–1740       3.0s   Solve Result CTA pops
//   tickets     1740–1920       3.0s   tickets tab rows cascade in
//   prs         1920–2100       3.0s   PR cards cascade in
//   agentsFlip  2100–2220       2.0s   worktree agent dots flip green 10f/agent
//   pullback    2220–2280       1.0s   scale-down + fade for outro lead-in
//   outro       2280–2640       6.0s   logo + CTA (extended so the pulse
//                                       plays a full breath cycle plus tail)
export const FPS_SHORT = 60;
export const TOTAL_FRAMES_SHORT = 2640;

export const SCENES_SHORT = {
	opening: { from: 0, duration: 120 },
	baseTerminal: { from: 120, duration: 240 },
	sidebarBuild: { from: 360, duration: 420 },
	diffPanel: { from: 780, duration: 360 },
	splitFile: { from: 1140, duration: 180 },
	comments: { from: 1320, duration: 240 },
	approve: { from: 1560, duration: 180 },
	tickets: { from: 1740, duration: 180 },
	prs: { from: 1920, duration: 180 },
	agentsFlip: { from: 2100, duration: 120 },
	pullback: { from: 2220, duration: 60 },
	outro: { from: 2280, duration: 360 },
} as const;

export type SceneKeyShort = keyof typeof SCENES_SHORT;

export const SPRING_SHORT = { damping: 14, stiffness: 180, mass: 0.55 } as const;
