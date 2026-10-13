#pragma once

#include "CoreMinimal.h"
#include "GameFramework/SaveGame.h"
#include "CADTypes.h"
#include "CADSaveGame.generated.h"

UCLASS()
class CALGARYAFTERDARK_API UCADSaveGame : public USaveGame
{
	GENERATED_BODY()
public:
	UPROPERTY(SaveGame) int32 FileVersion = CAD_SAVE_VERSION;
	UPROPERTY(SaveGame) FCADProfile Profile;
	UPROPERTY(SaveGame) FCADSettings Settings;
};
