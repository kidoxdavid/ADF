#pragma once

#include "CoreMinimal.h"
#include "Commandlets/Commandlet.h"
#include "CADSetupCommandlet.generated.h"

/**
 * One-time editor setup (optional but recommended): creates /Game/Materials/M_CAD_Lit and M_CAD_Water, the PBR +
 * emissive parameter materials the game uses for night lighting (windows, lamps, signals, brake lights) and water.
 *
 *   UnrealEditor-Cmd.exe CalgaryAfterDark.uproject -run=CADSetup
 *
 * Without them the game still runs using the engine's BasicShapeMaterial (colour only, no glow).
 */
UCLASS()
class UCADSetupCommandlet : public UCommandlet
{
	GENERATED_BODY()
public:
	UCADSetupCommandlet();
	virtual int32 Main(const FString& Params) override;
};
