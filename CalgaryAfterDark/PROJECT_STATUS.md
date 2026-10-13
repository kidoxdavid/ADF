# PROJECT STATUS

Last updated with the initial implementation pass. **Legend**

* **Written** - source exists and was reviewed by reading it.
* **Verified offline** - actually executed here against real data (see TESTING.md).
* **Untested in engine** - never compiled or run in Unreal (there is no Unreal Engine in the authoring environment).

> Nothing below is marked "Complete" or "Working in game" because the game has not been built or launched.

## Environment facts (inspected before any decision)

| Item | Result |
|---|---|
| OS | Linux 6.18 (x86_64), 4 CPUs, 15 GB RAM, no GPU, no display |
| Unreal Engine 5 (`UnrealEditor`, `RunUAT`, `UnrealBuildTool`, any `.uproject`) | **Not installed** |
| Visual Studio / MSVC / Windows SDK | **Not available** (Linux) |
| Other engines | Not used (rule: no silent engine switch) |
| Available | g++/clang, Python 3.13, cmake - used only for generators and the offline core test |

## Deliverable state

| Deliverable | State |
|---|---|
| UE 5.4 project (`.uproject`, Target.cs x2, module Build.cs, Config/*.ini) | Written; untested in engine |
| ~11,200 lines of C++ gameplay code in ~60 source files | Written; untested in engine |
| Engine-independent core (graph, A*, lane paths, signals, terrain) | Written; **verified offline** |
| Map data (6,302 nodes / 6,771 edges / river / 61 locations) | Generated; **verified offline** |
| Gameplay data (9 vehicles, 12 upgrades, 3 items, 4 shops, 2 properties, 6 missions / 58 stages) | Generated; **verified offline** (mission graph reachability) |
| Documentation | README, this file, DECISIONS, TESTING, LICENSES |

## Feature checklist (against the brief)

| # | Feature | Written | Verified offline | Untested in engine | Notes |
|---|---|:-:|:-:|:-:|---|
| 1 | Unreal Engine 5 C++ project | yes | - | yes | Targets 5.4 APIs |
| 2 | Enhanced Input (kbd/mouse/gamepad), rebinding UI | yes | - | yes | Actions/contexts built in code |
| 3 | Third-person character, sprint, jump, collision camera | yes | - | yes | Spring-arm camera |
| 4 | Procedural humanoid animation (no skeletal assets) | yes | - | yes | Limb swing/idle/jump/collapse |
| 5 | Vehicle physics (raycast wheels on Chaos rigid body) | yes | - | yes | Not Chaos Vehicle assets |
| 6 | 9 vehicles, configurable stats, upgrades, paint, wheels | yes | data only | yes | Table-driven |
| 7 | Vehicle damage, headlights, brake lights, siren | yes | - | yes | Health + paint darkening |
| 8 | Traffic AI (lane following, signals, avoidance, stuck recovery, density) | yes | routing+signals | yes | |
| 9 | Pedestrians (sidewalks, idle, flee, hit reaction, types) | yes | - | yes | |
| 10 | Wanted level, police pursuit, sight/search/cooldown, arrest | yes | - | yes | Police do not know your position without sight |
| 11 | Procedural Calgary: 8 district types, river, bridges, highway, interchange, ring road | yes | layout+graph | yes | Streamed 500 m chunks |
| 12 | Minimap + full map + waypoint + route overlay | yes | route algorithm | yes | Canvas-drawn from the real road graph |
| 13 | Day/night, weather (cloud/rain/fog/snow), weather grip, streetlights | yes | - | yes | Needs `CADSetup` for glow |
| 14 | Procedural audio (engine, wind, rain, city, siren, impacts) | yes | - | yes | Optional; silent if no audio device |
| 15 | Mission framework + 6 playable missions + courier gigs | yes | stage graph | yes | |
| 16 | Reputation (3 tracks) + law-enforcement attention + choices/endings | yes | - | yes | |
| 17 | Economy in CAD, transactions, history, no-duplicate rewards | yes | - | yes | `EarnOnce` guards |
| 18 | Garage (store/retrieve/repair/paint/upgrade/sell), dealership, stores | yes | - | yes | |
| 19 | Properties (loft, depot) with save point, storage, daily income | yes | - | yes | |
| 20 | Full UI: main menu, pause, settings, briefing, objectives, wanted, speedo, prompts, inventory, map, garage, results | yes | - | yes | UMG-free canvas |
| 21 | Versioned saves, validation, backup rotation, corrupt-save messages | yes | - | yes | `USaveGame` |
| 22 | World Partition | **no** | - | - | Custom chunk streamer instead (DECISIONS.md) |
| 23 | Chaos Vehicles assets | **no** | - | - | Custom arcade model instead |
| 24 | NavMesh pedestrians/police | **no** | - | - | Custom road + sidewalk graph |
| 25 | Interiors, weapons, music, skeletal characters | **no** | - | - | Roadmap |

## What was actually executed here

* `python3 Tools/run_validation.py` -> **PASS** (tables, map, offline C++ core). Details in TESTING.md.
* Outputs: 100% of 11,780 drivable directed edges are mutually reachable (strongly connected, with the C++ turn rule
  and dead-end U-turns); max road grade 9.8% (the foothill ramp); every one of 2,450 location-to-location driving
  routes resolves in the compiled C++ router (longest 16.3 km); zero illegal turns or wrong-way moves over 458
  random routes; zero conflicting signal greens at 430 signalised nodes; no road node buried under terrain.

## Biggest risks (what I expect to need attention first)

1. **Compile errors.** ~11k lines of UE C++ were written without compiling the engine-dependent parts. UE5 LWC
   (double `FVector`) pitfalls were found by the offline compile and handled with `CADMath::` wrappers; other API
   drift is possible.
2. **Visual correctness.** Terrain emits both triangle windings (safe against face-orientation mistakes). Ground
   materials use `BasicShapeMaterial`'s `Color` parameter if `CADSetup` was not run; if that parameter is absent the
   world renders grey until `CADSetup` creates `M_CAD_Lit`.
3. **Vehicle tuning.** The wheel model is physically reasoned (units, spring frequency, friction circle) but
   untested; grip, damping and steering numbers will need driving time.
4. **Performance.** Chunk build steps run one per frame (budgeted), but instance counts, physics bodies for
   instanced collision and canvas map drawing are unprofiled. No FPS number is claimed.
5. **Packaged builds** rely on runtime CSV loading from `Content/Data` (staged as non-UFS); first Windows package
   should confirm the folder is deployed.

## Next steps (in order)

1. Build in the editor, fix compile errors, run `CADSetup`, press Play.
2. Walk the QA list in TESTING.md and record real results.
3. Tune driving feel, traffic density, chunk budget; profile with `stat unit`/Insights.
4. Replace primitives with authored art; add skeletal characters.
5. Convert to World Partition; NavMesh crowds; more content (see README roadmap).
