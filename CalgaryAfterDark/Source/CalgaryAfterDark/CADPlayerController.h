#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "InputActionValue.h"
#include "CADPlayerController.generated.h"

class UInputAction;
class UInputMappingContext;
class ACADVehicle;
class ACADPlayerCharacter;

/** One rebindable logical control (keyboard/mouse). Gamepad defaults are fixed. */
struct FCADBinding
{
	FName Id;
	FString Name;
	FKey Default;
};

/**
 * Player input and control routing. Enhanced Input actions and mapping contexts are created in code so
 * they can be rebound at runtime and saved with the settings (no .uasset input assets are needed).
 */
UCLASS()
class CALGARYAFTERDARK_API ACADPlayerController : public APlayerController
{
	GENERATED_BODY()
public:
	ACADPlayerController();
	virtual void SetupInputComponent() override;
	virtual void PlayerTick(float DeltaTime) override;
	virtual void OnPossess(APawn* InPawn) override;

	static const TArray<FCADBinding>& Bindings();
	FKey KeyFor(FName Id) const;
	void BeginRebind(FName Id) { bCapturing = true; CaptureId = Id; }
	bool IsRebinding() const { return bCapturing; }
	FName RebindingId() const { return CaptureId; }
	void RebuildMappings();
	void ResetBindings();
	/** Applies the correct mapping context for the current game state. */
	void RefreshContext();

	bool TryEnterVehicle(ACADVehicle* V);
	void ExitVehicle();
	ACADPlayerCharacter* GetCharacter() const { return CharacterRef.Get(); }
	void SetCharacter(ACADPlayerCharacter* C) { CharacterRef = C; }

	// raw axis state (also read by the HUD for map panning)
	float AxisFwd = 0.f, AxisRight = 0.f;
	bool bHandbrake = false;
	bool bSprint = false;

private:
	UPROPERTY() TObjectPtr<UInputMappingContext> FootCtx;
	UPROPERTY() TObjectPtr<UInputMappingContext> VehicleCtx;
	UPROPERTY() TObjectPtr<UInputMappingContext> UiCtx;
	UPROPERTY() TMap<FName, TObjectPtr<UInputAction>> Actions;
	TWeakObjectPtr<ACADPlayerCharacter> CharacterRef;
	bool bCapturing = false;
	FName CaptureId;
	float LookX = 0.f, LookY = 0.f, StickX = 0.f, StickY = 0.f;
	double LastClickTime = 0.0;

	UInputAction* Act(FName Name, EInputActionValueType Type = EInputActionValueType::Boolean);
	void BuildContext(UInputMappingContext* Ctx, int32 Kind);
	void Map(UInputMappingContext* Ctx, FName Action, const FKey& Key, bool bNegate = false);

	// handlers
	void OnFwd(const FInputActionValue& V);
	void OnFwdEnd(const FInputActionValue& V);
	void OnRight(const FInputActionValue& V);
	void OnRightEnd(const FInputActionValue& V);
	void OnMouseX(const FInputActionValue& V);
	void OnMouseY(const FInputActionValue& V);
	void OnStickX(const FInputActionValue& V);
	void OnStickY(const FInputActionValue& V);
	void OnSprintStart(const FInputActionValue& V);
	void OnSprintEnd(const FInputActionValue& V);
	void OnJump(const FInputActionValue& V);
	void OnJumpEnd(const FInputActionValue& V);
	void OnInteract(const FInputActionValue& V);
	void OnMap(const FInputActionValue& V);
	void OnInventory(const FInputActionValue& V);
	void OnPause(const FInputActionValue& V);
	void OnLights(const FInputActionValue& V);
	void OnReset(const FInputActionValue& V);
	void OnUiUp(const FInputActionValue& V);
	void OnUiDown(const FInputActionValue& V);
	void OnUiLeft(const FInputActionValue& V);
	void OnUiRight(const FInputActionValue& V);
	void OnUiAccept(const FInputActionValue& V);
	void OnUiBack(const FInputActionValue& V);
	void OnUiClick(const FInputActionValue& V);
	void OnUiRClick(const FInputActionValue& V);
	void OnUiScroll(const FInputActionValue& V);
	void OnWaypointKey(const FInputActionValue& V);

	class ACADGameMode* GM() const;
	class ACADHUD* Hud() const;
	void PollRebind();
};
