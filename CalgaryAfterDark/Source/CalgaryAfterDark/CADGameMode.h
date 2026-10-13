#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "CADTypes.h"
#include "CADGameMode.generated.h"

class ACADPlayerCharacter;
class ACADPlayerController;
class ACameraActor;
class ACADVehicle;

enum class ECADOverlayKind : uint8 { None, Wasted, Busted };

/**
 * Game bootstrap and state machine: main menu with a skyline fly-over, new game / continue, session lifecycle,
 * death and arrest handling, saving, waypoint, and glue between the world subsystems and the UI.
 */
UCLASS()
class CALGARYAFTERDARK_API ACADGameMode : public AGameModeBase
{
	GENERATED_BODY()
public:
	ACADGameMode();
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	ECADGameState State = ECADGameState::MainMenu;
	ECADGameState StateBeforeSettings = ECADGameState::MainMenu;
	bool bInSession = false;
	bool bLoadingWorld = false;
	bool bFrozen = false;
	float LoadElapsed = 0.f;
	FString StartupError;

	// overlay (WASTED / BUSTED)
	FString OverlayTitle, OverlaySub;
	float OverlayTimer = 0.f;
	float FadeAlpha = 0.f;

	// waypoint
	bool bHasWaypoint = false;
	FVector Waypoint = FVector::ZeroVector;
	void SetWaypoint(const FVector& P) { Waypoint = P; bHasWaypoint = true; }
	void ClearWaypoint() { bHasWaypoint = false; }

	// context for shop / property screens
	FName ShopId, PropertyId;
	bool bGarageInVehicle = false;

	void SetState(ECADGameState S);
	bool IsPausedState(ECADGameState S) const;
	void StartNewGame();
	void ContinueGame();
	void ReturnToMainMenu();
	void QuitGame();
	bool SaveGameNow(bool bToast = true);
	void OpenShop(FName Id);
	void OpenGarage();
	void OpenProperty(FName Id);
	void SleepUntilMorning();
	void GarageSpawnTransform(FVector& OutPos, FRotator& OutRot) const;
	ACADPlayerCharacter* GetPlayerChar() const { return PlayerChar.Get(); }
	ACADPlayerController* GetPC() const;
	FString CurrentRoadName() const;
	FString CurrentDistrictName() const;

	// debug / QA console commands
	UFUNCTION(Exec) void CADGiveCash(int32 Amount);
	UFUNCTION(Exec) void CADTeleport(FName LocationId);
	UFUNCTION(Exec) void CADWeather(int32 Type);
	UFUNCTION(Exec) void CADTime(float Hours);
	UFUNCTION(Exec) void CADWanted(int32 Level);
	UFUNCTION(Exec) void CADSpawn(FName VehicleId);
	UFUNCTION(Exec) void CADStats();

private:
	TWeakObjectPtr<ACADPlayerCharacter> PlayerChar;
	UPROPERTY() TObjectPtr<ACameraActor> MenuCam;
	FVector PendingLoc = FVector::ZeroVector;
	float PendingYaw = 0.f;
	bool bPendingFromSave = false;
	float MenuAngle = 0.f;
	float AutosaveClock = 0.f;
	float DeathTimer = 0.f;
	bool bDeathHandled = false;
	bool bBustPending = false;
	ECADOverlayKind Overlay = ECADOverlayKind::None;
	FVector MenuFocus = FVector::ZeroVector;
	bool bBound = false;

	void SetupMenuCamera();
	void TickMenuCamera(float Dt);
	void BeginSession(const FVector& Loc, float Yaw, bool bFromSave);
	void FinishSessionStart();
	void BindSessionCallbacks();
	void UpdateFoci(const FVector& Focus);
	void SetSystemsEnabled(bool bSession);
	void StartOverlay(ECADOverlayKind K);
	void ResolveOverlay();
	void RespawnAt(FName LocationId);
	void OnInteract(const struct FCADInteractPoint& P);
	void OnBusted();
};
