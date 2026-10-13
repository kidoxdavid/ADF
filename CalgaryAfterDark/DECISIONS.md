# DECISIONS

Routine design decisions made without asking, with the reasoning, so they can be challenged later.

## D1. Engine: Unreal Engine 5 (mandated), written without the engine installed
The brief forbids switching engines. The sandbox has no UE; the project is therefore authored as source only and the
README/PROJECT_STATUS state clearly that it is uncompiled. APIs targeted: **UE 5.4**.

## D2. Everything is code-/data-driven; no binary assets
Without the editor I cannot author `.uasset`/`.umap` files. So:
* Boot on the engine's own `/Engine/Maps/Entry`; the GameMode builds the world at runtime.
* All visible geometry is `/Engine/BasicShapes` primitives instanced per chunk; materials are dynamic instances of
  one parameter material (`M_CAD_Lit`, optional editor commandlet `CADSetup`, falling back to `BasicShapeMaterial`).
* Input actions/contexts are created in C++ (also makes rebinding trivial). UI is canvas/HUD, no UMG.
* Audio is synthesised procedurally into `USoundWaveProcedural` streams.
This keeps the project openable and playable straight from source and "missing optional assets never crash".

## D3. Data Tables from CSV at runtime
The brief asks for Data Tables/Data Assets. Row structs (`FTableRowBase`) are real UE DataTable rows; the CSVs are
imported at startup via `UDataTable::CreateTableFromCSVString`, so designers can also import the same CSVs as normal
DataTable assets. Source of truth is Python (`Tools/*.py`) so the road graph, locations and missions can be
generated *and validated* outside the engine.

## D4. Map generated from a validated graph, not hand-placed
A Python generator builds a planarised road graph (crossings, T-junctions, bridges by river proximity, overpasses by
height difference, diamond interchange, cul-de-sacs) and validates strong connectivity, grades, and mission
references. The same data feeds road meshes, traffic, police, pedestrians, minimap, map and route overlay, which is
how "the map corresponds to the real playable world" is guaranteed by construction.

## D5. Custom runtime chunk streaming instead of World Partition
World Partition requires an authored level. A tick-budgeted cell streamer (500 m cells, nearest-first,
one generation step per frame, destroy when far) provides the same behaviour for a procedural world. Documented as a
roadmap item to convert once real levels exist.

## D6. Vehicle physics: raycast wheels on a Chaos rigid body, not Chaos Vehicle
Chaos Vehicles need skeletal meshes with wheel bones and Blueprint wheel classes - assets I cannot author here. The
chosen model is still real physics: a simulated box body (mass, inertia, centre of mass), four line-trace suspensions
(spring/damper from natural frequency), lateral grip, drive/brake forces with a friction circle, aero downforce, and real
collision/response/damage - applied as forces so the car interacts with every collidable object. It is tunable per
vehicle row (mass, accel, top speed, brake, steer, grip, suspension Hz, durability, off-road). Physics substepping
is enabled in config.

## D7. Roads, rivers, bridges, curbs
Roads are thin collidable slabs (top 6 cm above ground), intersections are padded squares, sidewalks are 16 cm curbs
trimmed back from intersections (crosswalks), bridges are thicker decks with rails and piers. The terrain is a
procedural mesh with a carved Bow River valley, so the river is real geometry, and the terrain model
(`CADTerrain`) is analytic so roads, AI and spawners agree on ground height.

## D8. Navigation: road graph + A*, not NavMesh
Vehicles route on the directed lane graph (A* over directed-edge states, <=115 degree turns, U-turns only at dead
ends); pedestrians follow sidewalk polylines with crossing checks; police use road routes then direct pursuit with
line-of-sight. Signals are a pure function of time so visuals and AI cannot disagree. NavMesh/Mass is a roadmap item.

## D9. Police knowledge model
Heat accrues only from *witnessed* crimes (a patrol car within 120 m or a pedestrian within 35 m). Units must see the
player (distance + line trace) to pursue; otherwise they search the last known position with a growing radius, and
heat drains after a delay. Arrest requires holding a stationary/on-foot player. Ambient patrol cars join pursuits.

## D10. Money safety
All transactions go through `UCADEconomySubsystem`: `Spend` fails atomically; rewards use `EarnOnce(key)` with keys
persisted in the save, so replays/retries/duplicate callbacks cannot pay twice. Garage capacity and affordability are
validated server-style before any state changes.

## D11. UE5 large-world-coordinate safety
`FVector` is double in UE5 and `FMath::Min/Max/Clamp/Lerp` need identical argument types. `CADMath::` wrappers in
`CADTypes.h` unify mixed float/double/int arguments; all gameplay code uses them. (Found by compiling the core
offline with a strict mock.)

## D12. Terrain winding
The mesh emits both triangle windings per quad so the ground is visible regardless of face-orientation mistakes;
halve the triangle count after confirming in the editor (comment in `CADChunk.cpp`).

## D13. Scope
Weapons/combat, interiors, music, skeletal characters, mesh deformation were deliberately left out in favour of a
complete, data-driven open-world loop (driving, city life, police, missions, economy, ownership, persistence).
