# Queue layout correction

The user screenshot exposed gaps in the previous rendered fixture: it bypassed App's resizable panels and did not measure navigation alignment.

`MainLayout` now gives Queue a full-height standalone content area. The workspace resizable group is only mounted on other destinations, so saved repository panel sizes cannot leave an empty right-hand strip or be overwritten by Queue. The detail panel scrolls independently. Rail tooltip wrappers fill each rail slot, keeping all icons and labels centered on the same axis.

Validation: 112 focused tests pass; expanded native Electron regression passes with the production outer layout at 800x600, 1440x900, 2304x1296 and 1200x500. Checks include saved workspace layout, navigation round-trip, rail geometry, full viewport fill, detail scrolling and action reachability, plus existing Open/Done/Undo/Later/conflict and content states. Desktop build and changed-file Biome pass. Renderer type errors unchanged at 81. Graphify rebuild unavailable (missing Python module).

Screenshots contain synthetic fixture data. The actual production workspace/sidebar contents and authenticated providers are outside this layout fixture.

Hover follow-up: rail tooltips now open to the right, and inactive hover uses a quieter background than the selected destination. Real pointer movement verifies every rail tooltip at all four sizes, with production shortcut registrations. Build, 29 focused tests and native regression pass. `rail-hover-projects.png` shows the reported Projects/Tickets hover combination.

Sidebar scrolling follow-up: `react-resizable-panels` sets Group's inline height to 100%, overriding the h-screen class. Beneath the auto-height app wrapper, expanded sidebar content grew to 2681.5px in a 900px viewport, leaving each list without local scroll overflow. MainLayout now explicitly sets the Group style height to 100vh. Sidebar measures 900px and repository body has 229px client height / 1889px scroll height in the same fixture.

The native fixture now mounts the actual Sidebar, FolderList, RepositoryList, ProjectItem and band stack with eight expanded folders, 23 repositories and 30 extra workspace rows. Native Chromium wheel input reaches the final item and returns to the start in both folders and repositories at 900px and 600px heights; headers remain stationary. Collapse/reopen and Queue/workspace round trips pass. Build, Biome, 49 focused tests and the native regression pass. Type checking still reports baseline errors; importing the real Sidebar into the fixture additionally surfaces an existing unused catch variable in untouched WorkspaceItem.tsx. Screenshots are synthetic isolated fixture data.
