# Queue layout correction

The user screenshot exposed gaps in the previous rendered fixture: it bypassed App's resizable panels and did not measure navigation alignment.

`MainLayout` now gives Queue a full-height standalone content area. The workspace resizable group is only mounted on other destinations, so saved repository panel sizes cannot leave an empty right-hand strip or be overwritten by Queue. The detail panel scrolls independently. Rail tooltip wrappers fill each rail slot, keeping all icons and labels centered on the same axis.

Validation: 112 focused tests pass; expanded native Electron regression passes with the production outer layout at 800x600, 1440x900, 2304x1296 and 1200x500. Checks include saved workspace layout, navigation round-trip, rail geometry, full viewport fill, detail scrolling and action reachability, plus existing Open/Done/Undo/Later/conflict and content states. Desktop build and changed-file Biome pass. Renderer type errors unchanged at 81. Graphify rebuild unavailable (missing Python module).

Screenshots contain synthetic fixture data. The actual production workspace/sidebar contents and authenticated providers are outside this layout fixture.

Hover follow-up: rail tooltips now open to the right, and inactive hover uses a quieter background than the selected destination. Real pointer movement verifies every rail tooltip at all four sizes, with production shortcut registrations. Build, 29 focused tests and native regression pass. `rail-hover-projects.png` shows the reported Projects/Tickets hover combination.
