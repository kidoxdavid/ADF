#pragma once

#include "CoreMinimal.h"
#include "Engine/GameInstance.h"
#include "CADTypes.h"
#include "CADGameInstance.generated.h"

class UCADAssets;

DECLARE_MULTICAST_DELEGATE_OneParam(FCADOnToast, const FString&);

/** Owns persistent profile + settings, save/load, and the shared asset library. */
UCLASS()
class CALGARYAFTERDARK_API UCADGameInstance : public UGameInstance
{
	GENERATED_BODY()
public:
	virtual void Init() override;

	UPROPERTY() TObjectPtr<UCADAssets> Assets;
	FCADProfile Profile;
	FCADSettings Settings;
	FString LastError;
	FCADOnToast OnToast;
	bool bProfileLoaded = false;

	static constexpr const TCHAR* ProfileSlot = TEXT("CAD_Profile");
	static constexpr const TCHAR* BackupSlot = TEXT("CAD_Profile_Backup");
	static constexpr const TCHAR* SettingsSlot = TEXT("CAD_Settings");

	void Toast(const FString& Msg) { OnToast.Broadcast(Msg); }
	bool HasSave() const;
	void NewProfile();
	/** Writes Profile. The previous save is rotated into a backup slot first and never lost on failure. */
	bool SaveProfile();
	bool LoadProfile();
	void SaveSettings();
	void LoadSettings();

	static UCADGameInstance* Get(const UObject* WorldContext);

private:
	static bool ValidateProfile(FCADProfile& P, FString& OutError);
};
