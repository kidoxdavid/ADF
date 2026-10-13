#include "CADGameInstance.h"
#include "CADAssets.h"
#include "CADSaveGame.h"
#include "CalgaryAfterDark.h"
#include "Kismet/GameplayStatics.h"
#include "Engine/World.h"

UCADGameInstance* UCADGameInstance::Get(const UObject* WorldContext)
{
	if (!WorldContext) return nullptr;
	const UWorld* W = WorldContext->GetWorld();
	return W ? Cast<UCADGameInstance>(W->GetGameInstance()) : nullptr;
}

void UCADGameInstance::Init()
{
	Super::Init();
	Assets = NewObject<UCADAssets>(this);
	Assets->InitMaterials();
	LoadSettings();
}

bool UCADGameInstance::HasSave() const
{
	return UGameplayStatics::DoesSaveGameExist(ProfileSlot, 0) || UGameplayStatics::DoesSaveGameExist(BackupSlot, 0);
}

void UCADGameInstance::NewProfile()
{
	Profile = FCADProfile();
	Profile.Cash = 300;
	Profile.AddFlag(TEXT("new_game"));
	bProfileLoaded = true;
}

bool UCADGameInstance::ValidateProfile(FCADProfile& P, FString& Err)
{
	if (P.Version > CAD_SAVE_VERSION)
	{
		Err = FString::Printf(TEXT("Save was created by a newer game version (v%d, this build supports v%d)."), P.Version, CAD_SAVE_VERSION);
		return false;
	}
	if (P.Version < 1)
	{
		Err = TEXT("Save file header is invalid.");
		return false;
	}
	P.Cash = CADMath::Max(0, P.Cash);
	P.Bank = CADMath::Max(0, P.Bank);
	P.Health = CADMath::Clamp(P.Health, 1.f, 100.f);
	P.TimeOfDay = FMath::Fmod(CADMath::Max(0.f, P.TimeOfDay), 24.f);
	P.Day = CADMath::Max(1, P.Day);
	P.Weather = FMath::Min<uint8>(P.Weather, 4);
	for (FCADOwnedVehicle& V : P.Vehicles)
	{
		V.Health = CADMath::Clamp(V.Health, 1.f, 100.f);
		V.Engine = CADMath::Clamp(V.Engine, 0, 3);
		V.Brakes = CADMath::Clamp(V.Brakes, 0, 3);
		V.Handling = CADMath::Clamp(V.Handling, 0, 3);
		V.Wheels = CADMath::Clamp(V.Wheels, 0, 3);
		if (!V.Id.IsValid()) V.Id = FGuid::NewGuid();
	}
	if (P.History.Num() > 60) P.History.RemoveAt(0, P.History.Num() - 60);
	if (!FMath::IsFinite(P.PlayerLocation.X) || !FMath::IsFinite(P.PlayerLocation.Y) || !FMath::IsFinite(P.PlayerLocation.Z))
	{
		Err = TEXT("Saved player position is corrupt.");
		return false;
	}
	return true;
}

bool UCADGameInstance::SaveProfile()
{
	Profile.Version = CAD_SAVE_VERSION;
	Profile.SavedAt = FDateTime::Now().ToString(TEXT("%Y-%m-%d %H:%M"));

	// Rotate the existing good save into the backup slot so a failed write can never destroy progress.
	if (UGameplayStatics::DoesSaveGameExist(ProfileSlot, 0))
	{
		if (USaveGame* Old = UGameplayStatics::LoadGameFromSlot(ProfileSlot, 0))
		{
			UGameplayStatics::SaveGameToSlot(Old, BackupSlot, 0);
		}
	}
	UCADSaveGame* Save = Cast<UCADSaveGame>(UGameplayStatics::CreateSaveGameObject(UCADSaveGame::StaticClass()));
	if (!Save)
	{
		LastError = TEXT("Could not create save object.");
		return false;
	}
	Save->Profile = Profile;
	Save->Settings = Settings;
	if (!UGameplayStatics::SaveGameToSlot(Save, ProfileSlot, 0))
	{
		LastError = TEXT("Writing the save file failed (disk full or no permission). Your previous save is intact.");
		return false;
	}
	return true;
}

bool UCADGameInstance::LoadProfile()
{
	for (const TCHAR* Slot : { ProfileSlot, BackupSlot })
	{
		if (!UGameplayStatics::DoesSaveGameExist(Slot, 0)) continue;
		UCADSaveGame* Save = Cast<UCADSaveGame>(UGameplayStatics::LoadGameFromSlot(Slot, 0));
		if (!Save)
		{
			LastError = FString::Printf(TEXT("Save slot '%s' is damaged and could not be read."), Slot);
			continue;
		}
		FCADProfile P = Save->Profile;
		FString Err;
		if (!ValidateProfile(P, Err))
		{
			LastError = Err;
			continue;
		}
		Profile = P;
		bProfileLoaded = true;
		if (Slot == BackupSlot)
		{
			LastError = TEXT("Main save was unreadable; loaded the automatic backup instead.");
		}
		else
		{
			LastError.Reset();
		}
		return true;
	}
	if (LastError.IsEmpty()) LastError = TEXT("No save file found.");
	return false;
}

void UCADGameInstance::SaveSettings()
{
	UCADSaveGame* Save = Cast<UCADSaveGame>(UGameplayStatics::CreateSaveGameObject(UCADSaveGame::StaticClass()));
	if (Save)
	{
		Save->Settings = Settings;
		UGameplayStatics::SaveGameToSlot(Save, SettingsSlot, 0);
	}
}

void UCADGameInstance::LoadSettings()
{
	if (UGameplayStatics::DoesSaveGameExist(SettingsSlot, 0))
	{
		if (UCADSaveGame* Save = Cast<UCADSaveGame>(UGameplayStatics::LoadGameFromSlot(SettingsSlot, 0)))
		{
			Settings = Save->Settings;
			Settings.MouseSensitivity = CADMath::Clamp(Settings.MouseSensitivity, 0.1f, 5.f);
			Settings.FieldOfView = CADMath::Clamp(Settings.FieldOfView, 60.f, 120.f);
			Settings.MasterVolume = CADMath::Clamp(Settings.MasterVolume, 0.f, 1.f);
			Settings.TrafficDensity = CADMath::Clamp(Settings.TrafficDensity, 0, 3);
			Settings.PedestrianDensity = CADMath::Clamp(Settings.PedestrianDensity, 0, 3);
			Settings.ViewDistanceLevel = CADMath::Clamp(Settings.ViewDistanceLevel, 1, 3);
		}
	}
}
