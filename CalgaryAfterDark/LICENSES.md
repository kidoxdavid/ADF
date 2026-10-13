# LICENSES AND ASSETS

## Game content
All code, data, story, characters, dialogue, vehicle designs (stats and primitive shapes), business names, street names
and UI in this project were written for it and are original. They are fictional: "Calgary After Dark" is not
affiliated with Grand Theft Auto, Rockstar Games, the City of Calgary, or any real business, agency, vehicle maker,
or person. Real place names used for flavour (Calgary, Bow River, Rocky Mountains) are geographic references; street
names, businesses, police service ("Foothills Regional Police Service") and road names are fictionalised. No fictional
crime is attached to any identifiable real business or person. The road network is **not** derived from OpenStreetMap
or any map dataset; it is procedurally authored (`Tools/generate_map.py`).

Source code and data in this folder: no third-party code is included. Choose and add a project license before
distributing (none has been chosen).

## Art, audio, fonts
* **No imported art, audio or fonts.** Geometry uses Unreal Engine's built-in `/Engine/BasicShapes` meshes and
  `BasicShapeMaterial` (licensed to you under the Unreal Engine EULA as part of the engine).
* Audio is generated at runtime by `CADAudioSubsystem` (no samples). No music is shipped.
* HUD text uses the engine's default fonts.

## Dependencies
| Dependency | Use | License / terms |
|---|---|---|
| Unreal Engine 5.4 | runtime, build | Epic Games Unreal Engine EULA (royalty terms apply to commercial releases) |
| Engine plugins `EnhancedInput`, `ProceduralMeshComponent` | input, terrain mesh | part of the engine |
| Python 3, `matplotlib`, `numpy` | **developer tools only** (`Tools/`, map preview) | PSF / matplotlib (BSD-style) / BSD; not shipped |
| g++ | offline core test only | GPL toolchain; not shipped |

Pre-made third-party packs, marketplace content and AI-generated assets: **none**.
