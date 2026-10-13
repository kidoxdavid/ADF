# TESTING

Be clear about what the results below mean: **only section A was actually run.** Section B is the QA plan from the
brief, every item currently **NOT RUN** because Unreal Engine is not available in the authoring environment. No
frame rate, stability or gameplay result is claimed anywhere.

## A. Automated checks that were run (Linux sandbox)

Command: `python3 Tools/run_validation.py` (about 25 s). Result: **OVERALL PASS**.

### A1. Gameplay tables (`Tools/build_tables.py`)
| Check | Result |
|---|---|
| All 6 missions end in a `Complete` stage | pass |
| Every stage of every mission reachable from stage 0 (following Choice jumps), no dead ends | pass |
| All Choice jump targets in range | pass |
| Prerequisites reference real missions | pass |
| Stage counts | m1:9, m2:5, m3:10, m4:7, m5:12, m6:15 (58 total) |

### A2. Map data (`Tools/generate_map.py`)
| Check | Result |
|---|---|
| Nodes / edges / signals / locations | 6,302 / 6,771 / 430 / 61 |
| Drivable directed edges strongly connected (with the C++ turn rule + dead-end U-turn) | **100%** of 11,780 |
| Prairie Trail, Glen Trail, Chinook Trail, Stoney Ring, Macleod, Trans-Canada West, Airport Trail, Southbridge, Centre St, Riverside Dr fully inside the connected network | pass |
| Highways that end in empty terrain | none (only the two intended map-edge stubs) |
| Max road grade | 9.8% (foothill ramp); everything in the city is flat except overpass approaches |
| Nodes outside the +-4.6 km playable area | 0 |
| Every non-landmark location within 120 m of the drivable network | pass |
| Mission stages reference existing locations | pass |

### A3. Engine-independent C++ core (`Tools/cpp_tests`)
`CADRoadNetwork.cpp` and `CADTerrain.cpp` (the **real game source files**) compiled with g++ against a minimal UE
mock and run on the generated CSVs.
| Check | Result |
|---|---|
| Location-to-location routes (all ordered pairs of 50 drivable locations) | **2,450 / 2,450** found; longest 16.3 km, max 372 segments |
| 600 random node-pair routes | 458 started on a valid directed edge and were routed; **0 illegal turns (>115 deg), 0 wrong-way on one-ways, 0 discontinuities** |
| Lane path continuity | max gap between lane points 408 m (long straight highway edge), all coordinates finite |
| Traffic signals | 430 signalised nodes; 160 time samples each; **0** samples with conflicting greens |
| Terrain model | river bed below ground, downtown flat, foothills rise, district classification as designed |
| Road nodes vs terrain | 6,163 checked, **0** buried under terrain |

This validates the algorithms and the data, not the engine integration.

## B. QA plan from the brief - status

Run these in the editor (PIE) and in a packaged Windows build, then record the result here.

| # | Test | Procedure | Expected | Status |
|---|---|---|---|---|
| 1 | Game launches | Open project, Play | Main menu over a night-time skyline fly-over | NOT RUN |
| 2 | New game starts | New Game | Loading screen, then the player stands near the hostel; toast about Marcy | NOT RUN |
| 3 | Movement and camera | WASD, mouse, Shift, Space | Smooth camera-relative movement, camera avoids walls | NOT RUN |
| 4 | Enter/exit vehicles | Press E next to a parked/traffic car | Possess car; E again exits at left/right | NOT RUN |
| 5 | Driving | W/S/A/D, Space, H, R | Accelerate, brake, reverse, steer, handbrake drift, lights, flip reset | NOT RUN |
| 6 | Collisions | Hit walls, cars, a pole-less building | Sensible bounce; damage drops the health bar; wreck at 0 | NOT RUN |
| 7 | Traffic | Drive downtown | Cars keep right, stop at red, queue, recover from blockage | NOT RUN |
| 8 | Pedestrians | Walk Riverwalk/downtown | Walk sidewalks, idle, flee from fast cars, fall when hit | NOT RUN |
| 9 | District travel | Drive diner -> industrial -> airport -> foothills overlook | Continuous driving, streaming without long hitches | NOT RUN |
| 10 | Missions 1-6 | Play each from start to finish | Objective flow, dialogue, choices, rewards | NOT RUN |
| 11 | Failure/restart | Let a timer expire; wreck a mission car | Fail screen, retry from checkpoint works | NOT RUN |
| 12 | Money/purchases | Buy a car, upgrade, repair, paint, buy property | Balance changes, unaffordable purchases rejected | NOT RUN |
| 13 | Persistence of ownership/mods | Save, quit, Continue | Owned vehicles, paint, upgrades restored | NOT RUN |
| 14 | Police | Run over a pedestrian near others (`CADWanted 2` as a shortcut) | Stars, pursuit, losing them, arrest if stationary | NOT RUN |
| 15 | Save/load | Pause -> Save, Continue; also corrupt the file | Correct restore; friendly error + backup fallback | NOT RUN |
| 16 | Resume after a mission | Finish mission 1, keep playing | Result screen, free roam continues, car kept | NOT RUN |
| 17 | Map matches world | Compare minimap/map with streets | Same layout; bridges, interchange, river | NOT RUN |
| 18 | Missing optional assets | Skip `CADSetup`; run with no audio device | Boots; flat-coloured, silent if no audio | NOT RUN |
| 19 | Extended stability | 30 min free drive, weather/time cycling | No crash, no runaway memory/actor counts (`CADStats`) | NOT RUN |

## C. Suggested first manual session (15 minutes)

1. `CADSetup` once, Play, New Game.
2. `CADStats` in the console - confirm chunks load/unload as you walk.
3. Walk to the diner marker, accept mission 1, finish it (also exercises enter-vehicle, map, delivery, rewards).
4. `CADGiveCash 50000`, drive to Macleod Motor Mile, buy the Chinook GT, take it to the garage, upgrade and paint it.
5. `CADTime 21`, `CADWeather 2` - check night lighting and rain; drive Prairie Trail for the overpasses and interchange.
6. `CADWanted 3` - check pursuit, escape and arrest, then Save -> Continue.

Record failures as GitHub issues with the `LogCAD` output.
