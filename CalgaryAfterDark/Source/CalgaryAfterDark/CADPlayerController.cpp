#include "CADPlayerController.h"
#include "CADFleetSubsystem.h"
#include "CADGameInstance.h"
#include "CADGameMode.h"
#include "CADHUD.h"
#include "CADInteractionSubsystem.h"
#include "CADMissionSubsystem.h"
#include "CADPlayerCharacter.h"
#include "CADPoliceSubsystem.h"
#include "CADVehicle.h"
#include "CADVehicleDriver.h"
#include "CalgaryAfterDark.h"
#include "Components/CapsuleComponent.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "InputAction.h"
#include "InputMappingContext.h"
#include "InputModifiers.h"
#include "Camera/PlayerCameraManager.h"
#include "Engine/LocalPlayer.h"
#include "Engine/World.h"

ACADPlayerController::ACADPlayerController()
{
	bShowMouseCursor = true;
	bEnableClickEvents = false;
	bAutoManageActiveCameraTarget = true;
}

ACADGameMode* ACADPlayerController::GM() const { return GetWorld() ? GetWorld()->GetAuthGameMode<ACADGameMode>() : nullptr; }
ACADHUD* ACADPlayerController::Hud() const { return Cast<ACADHUD>(GetHUD()); }

const TArray<FCADBinding>& ACADPlayerController::Bindings()
{
	static TArray<FCADBinding> B;
	if (B.Num() == 0)
	{
		B = {
			{ TEXT("Forward"), TEXT("Move forward / Accelerate"), EKeys::W },
			{ TEXT("Back"), TEXT("Move back / Brake / Reverse"), EKeys::S },
			{ TEXT("Left"), TEXT("Move left / Steer left"), EKeys::A },
			{ TEXT("Right"), TEXT("Move right / Steer right"), EKeys::D },
			{ TEXT("Sprint"), TEXT("Sprint"), EKeys::LeftShift },
			{ TEXT("Jump"), TEXT("Jump / Handbrake"), EKeys::SpaceBar },
			{ TEXT("Interact"), TEXT("Interact / Enter / Exit"), EKeys::E },
			{ TEXT("Map"), TEXT("Open map"), EKeys::M },
			{ TEXT("Inventory"), TEXT("Inventory"), EKeys::Tab },
			{ TEXT("Pause"), TEXT("Pause"), EKeys::Escape },
			{ TEXT("Lights"), TEXT("Headlights"), EKeys::H },
			{ TEXT("Reset"), TEXT("Flip vehicle upright"), EKeys::R },
		};
	}
	return B;
}

FKey ACADPlayerController::KeyFor(FName Id) const
{
	if (UCADGameInstance* GI = UCADGameInstance::Get(this))
	{
		if (const FKey* K = GI->Settings.KeyBindings.Find(Id)) if (K->IsValid()) return *K;
	}
	for (const FCADBinding& B : Bindings()) if (B.Id == Id) return B.Default;
	return EKeys::Invalid;
}

UInputAction* ACADPlayerController::Act(FName Name, EInputActionValueType Type)
{
	if (TObjectPtr<UInputAction>* F = Actions.Find(Name)) return F->Get();
	UInputAction* A = NewObject<UInputAction>(this, Name);
	A->ValueType = Type;
	A->bTriggerWhenPaused = true;
	Actions.Add(Name, A);
	return A;
}

void ACADPlayerController::Map(UInputMappingContext* Ctx, FName Action, const FKey& Key, bool bNegate)
{
	if (!Key.IsValid()) return;
	UInputAction* A = Act(Action);
	FEnhancedActionKeyMapping& M = Ctx->MapKey(A, Key);
	if (bNegate) M.Modifiers.Add(NewObject<UInputModifierNegate>(Ctx));
}

void ACADPlayerController::BuildContext(UInputMappingContext* Ctx, int32 Kind)
{
	// Kind: 0 = on foot, 1 = in vehicle, 2 = UI
	Ctx->UnmapAll();
	if (Kind == 2)
	{
		Map(Ctx, TEXT("UiUp"), EKeys::Up); Map(Ctx, TEXT("UiUp"), EKeys::Gamepad_DPad_Up); Map(Ctx, TEXT("UiUp"), EKeys::W);
		Map(Ctx, TEXT("UiDown"), EKeys::Down); Map(Ctx, TEXT("UiDown"), EKeys::Gamepad_DPad_Down); Map(Ctx, TEXT("UiDown"), EKeys::S);
		Map(Ctx, TEXT("UiLeft"), EKeys::Left); Map(Ctx, TEXT("UiLeft"), EKeys::Gamepad_DPad_Left); Map(Ctx, TEXT("UiLeft"), EKeys::A);
		Map(Ctx, TEXT("UiRight"), EKeys::Right); Map(Ctx, TEXT("UiRight"), EKeys::Gamepad_DPad_Right); Map(Ctx, TEXT("UiRight"), EKeys::D);
		Map(Ctx, TEXT("UiAccept"), EKeys::Enter); Map(Ctx, TEXT("UiAccept"), EKeys::SpaceBar); Map(Ctx, TEXT("UiAccept"), EKeys::Gamepad_FaceButton_Bottom); Map(Ctx, TEXT("UiAccept"), EKeys::E);
		Map(Ctx, TEXT("UiBack"), EKeys::Escape); Map(Ctx, TEXT("UiBack"), EKeys::Gamepad_FaceButton_Right); Map(Ctx, TEXT("UiBack"), EKeys::BackSpace);
		Map(Ctx, TEXT("UiClick"), EKeys::LeftMouseButton);
		Map(Ctx, TEXT("UiRClick"), EKeys::RightMouseButton);
		Act(TEXT("UiScroll"), EInputActionValueType::Axis1D);
		Map(Ctx, TEXT("UiScroll"), EKeys::MouseWheelAxis);
		Map(Ctx, TEXT("MapKey"), KeyFor(TEXT("Map"))); Map(Ctx, TEXT("MapKey"), EKeys::Gamepad_Special_Left);
		Map(Ctx, TEXT("InvKey"), KeyFor(TEXT("Inventory")));
		Map(Ctx, TEXT("WaypointKey"), EKeys::Gamepad_FaceButton_Left);
		return;
	}

	Act(TEXT("Fwd"), EInputActionValueType::Axis1D);
	Act(TEXT("Rgt"), EInputActionValueType::Axis1D);
	Act(TEXT("MouseX"), EInputActionValueType::Axis1D);
	Act(TEXT("MouseY"), EInputActionValueType::Axis1D);
	Act(TEXT("StickX"), EInputActionValueType::Axis1D);
	Act(TEXT("StickY"), EInputActionValueType::Axis1D);
	Map(Ctx, TEXT("Fwd"), KeyFor(TEXT("Forward")));
	Map(Ctx, TEXT("Fwd"), KeyFor(TEXT("Back")), true);
	Map(Ctx, TEXT("Fwd"), EKeys::Gamepad_LeftY);
	Map(Ctx, TEXT("Rgt"), KeyFor(TEXT("Right")));
	Map(Ctx, TEXT("Rgt"), KeyFor(TEXT("Left")), true);
	Map(Ctx, TEXT("Rgt"), EKeys::Gamepad_LeftX);
	if (Kind == 1)
	{
		Map(Ctx, TEXT("Fwd"), EKeys::Gamepad_RightTriggerAxis);
		Map(Ctx, TEXT("Fwd"), EKeys::Gamepad_LeftTriggerAxis, true);
	}
	Map(Ctx, TEXT("MouseX"), EKeys::MouseX);
	Map(Ctx, TEXT("MouseY"), EKeys::MouseY);
	Map(Ctx, TEXT("StickX"), EKeys::Gamepad_RightX);
	Map(Ctx, TEXT("StickY"), EKeys::Gamepad_RightY);
	Map(Ctx, TEXT("Sprint"), KeyFor(TEXT("Sprint"))); Map(Ctx, TEXT("Sprint"), EKeys::Gamepad_LeftThumbstick);
	Map(Ctx, TEXT("Jump"), KeyFor(TEXT("Jump"))); Map(Ctx, TEXT("Jump"), Kind == 1 ? EKeys::Gamepad_RightShoulder : EKeys::Gamepad_FaceButton_Bottom);
	Map(Ctx, TEXT("Interact"), KeyFor(TEXT("Interact"))); Map(Ctx, TEXT("Interact"), EKeys::Gamepad_FaceButton_Top);
	Map(Ctx, TEXT("MapKey"), KeyFor(TEXT("Map"))); Map(Ctx, TEXT("MapKey"), EKeys::Gamepad_Special_Left);
	Map(Ctx, TEXT("InvKey"), KeyFor(TEXT("Inventory"))); Map(Ctx, TEXT("InvKey"), EKeys::Gamepad_DPad_Up);
	Map(Ctx, TEXT("PauseKey"), KeyFor(TEXT("Pause"))); Map(Ctx, TEXT("PauseKey"), EKeys::Gamepad_Special_Right);
	Map(Ctx, TEXT("LightsKey"), KeyFor(TEXT("Lights"))); Map(Ctx, TEXT("LightsKey"), EKeys::Gamepad_DPad_Left);
	Map(Ctx, TEXT("ResetKey"), KeyFor(TEXT("Reset"))); Map(Ctx, TEXT("ResetKey"), EKeys::Gamepad_DPad_Down);
}

void ACADPlayerController::RebuildMappings()
{
	if (!FootCtx) { FootCtx = NewObject<UInputMappingContext>(this, TEXT("FootCtx")); VehicleCtx = NewObject<UInputMappingContext>(this, TEXT("VehicleCtx")); UiCtx = NewObject<UInputMappingContext>(this, TEXT("UiCtx")); }
	BuildContext(FootCtx, 0);
	BuildContext(VehicleCtx, 1);
	BuildContext(UiCtx, 2);
	RefreshContext();
}

void ACADPlayerController::ResetBindings()
{
	if (UCADGameInstance* GI = UCADGameInstance::Get(this)) { GI->Settings.KeyBindings.Reset(); GI->SaveSettings(); }
	RebuildMappings();
}

void ACADPlayerController::RefreshContext()
{
	ULocalPlayer* LP = GetLocalPlayer();
	UEnhancedInputLocalPlayerSubsystem* Sub = LP ? LP->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>() : nullptr;
	if (!Sub || !FootCtx) return;
	Sub->ClearAllMappings();
	ACADGameMode* G = GM();
	const ECADGameState S = G ? G->State : ECADGameState::MainMenu;
	if (S == ECADGameState::Playing)
	{
		Sub->AddMappingContext(Cast<ACADVehicle>(GetPawn()) ? VehicleCtx.Get() : FootCtx.Get(), 0);
		SetInputMode(FInputModeGameOnly());
		bShowMouseCursor = false;
	}
	else
	{
		Sub->AddMappingContext(UiCtx, 0);
		FInputModeGameAndUI M;
		M.SetHideCursorDuringCapture(false);
		SetInputMode(M);
		bShowMouseCursor = true;
	}
	AxisFwd = AxisRight = 0.f; bHandbrake = false; bSprint = false; LookX = LookY = 0.f;
}

void ACADPlayerController::SetupInputComponent()
{
	Super::SetupInputComponent();
	UEnhancedInputComponent* EIC = Cast<UEnhancedInputComponent>(InputComponent);
	if (!EIC) { UE_LOG(LogCAD, Error, TEXT("Enhanced Input component missing")); return; }
	RebuildMappings();
	auto T = [&](const TCHAR* N, ETriggerEvent E, void (ACADPlayerController::*F)(const FInputActionValue&)) { EIC->BindAction(Act(FName(N)), E, this, F); };
	T(TEXT("Fwd"), ETriggerEvent::Triggered, &ACADPlayerController::OnFwd);
	T(TEXT("Fwd"), ETriggerEvent::Completed, &ACADPlayerController::OnFwdEnd);
	T(TEXT("Rgt"), ETriggerEvent::Triggered, &ACADPlayerController::OnRight);
	T(TEXT("Rgt"), ETriggerEvent::Completed, &ACADPlayerController::OnRightEnd);
	T(TEXT("MouseX"), ETriggerEvent::Triggered, &ACADPlayerController::OnMouseX);
	T(TEXT("MouseY"), ETriggerEvent::Triggered, &ACADPlayerController::OnMouseY);
	T(TEXT("StickX"), ETriggerEvent::Triggered, &ACADPlayerController::OnStickX);
	T(TEXT("StickX"), ETriggerEvent::Completed, &ACADPlayerController::OnStickX);
	T(TEXT("StickY"), ETriggerEvent::Triggered, &ACADPlayerController::OnStickY);
	T(TEXT("StickY"), ETriggerEvent::Completed, &ACADPlayerController::OnStickY);
	T(TEXT("Sprint"), ETriggerEvent::Started, &ACADPlayerController::OnSprintStart);
	T(TEXT("Sprint"), ETriggerEvent::Completed, &ACADPlayerController::OnSprintEnd);
	T(TEXT("Jump"), ETriggerEvent::Started, &ACADPlayerController::OnJump);
	T(TEXT("Jump"), ETriggerEvent::Completed, &ACADPlayerController::OnJumpEnd);
	T(TEXT("Interact"), ETriggerEvent::Started, &ACADPlayerController::OnInteract);
	T(TEXT("MapKey"), ETriggerEvent::Started, &ACADPlayerController::OnMap);
	T(TEXT("InvKey"), ETriggerEvent::Started, &ACADPlayerController::OnInventory);
	T(TEXT("PauseKey"), ETriggerEvent::Started, &ACADPlayerController::OnPause);
	T(TEXT("LightsKey"), ETriggerEvent::Started, &ACADPlayerController::OnLights);
	T(TEXT("ResetKey"), ETriggerEvent::Started, &ACADPlayerController::OnReset);
	T(TEXT("UiUp"), ETriggerEvent::Started, &ACADPlayerController::OnUiUp);
	T(TEXT("UiDown"), ETriggerEvent::Started, &ACADPlayerController::OnUiDown);
	T(TEXT("UiLeft"), ETriggerEvent::Started, &ACADPlayerController::OnUiLeft);
	T(TEXT("UiRight"), ETriggerEvent::Started, &ACADPlayerController::OnUiRight);
	T(TEXT("UiAccept"), ETriggerEvent::Started, &ACADPlayerController::OnUiAccept);
	T(TEXT("UiBack"), ETriggerEvent::Started, &ACADPlayerController::OnUiBack);
	T(TEXT("UiClick"), ETriggerEvent::Started, &ACADPlayerController::OnUiClick);
	T(TEXT("UiRClick"), ETriggerEvent::Started, &ACADPlayerController::OnUiRClick);
	T(TEXT("UiScroll"), ETriggerEvent::Triggered, &ACADPlayerController::OnUiScroll);
	T(TEXT("WaypointKey"), ETriggerEvent::Started, &ACADPlayerController::OnWaypointKey);
}

void ACADPlayerController::OnPossess(APawn* InPawn)
{
	Super::OnPossess(InPawn);
	RefreshContext();
}

// ------------------------------------------------------------------------------------------------
// Axis & button handlers
// ------------------------------------------------------------------------------------------------
void ACADPlayerController::OnFwd(const FInputActionValue& V) { AxisFwd = V.Get<float>(); }
void ACADPlayerController::OnFwdEnd(const FInputActionValue&) { AxisFwd = 0.f; }
void ACADPlayerController::OnRight(const FInputActionValue& V) { AxisRight = V.Get<float>(); }
void ACADPlayerController::OnRightEnd(const FInputActionValue&) { AxisRight = 0.f; }
void ACADPlayerController::OnMouseX(const FInputActionValue& V) { LookX += V.Get<float>(); }
void ACADPlayerController::OnMouseY(const FInputActionValue& V) { LookY += V.Get<float>(); }
void ACADPlayerController::OnStickX(const FInputActionValue& V) { StickX = V.Get<float>(); }
void ACADPlayerController::OnStickY(const FInputActionValue& V) { StickY = V.Get<float>(); }
void ACADPlayerController::OnSprintStart(const FInputActionValue&) { bSprint = true; }
void ACADPlayerController::OnSprintEnd(const FInputActionValue&) { bSprint = false; }

void ACADPlayerController::OnJump(const FInputActionValue&)
{
	bHandbrake = true;
	if (ACADPlayerCharacter* C = Cast<ACADPlayerCharacter>(GetPawn())) C->Jump();
}
void ACADPlayerController::OnJumpEnd(const FInputActionValue&)
{
	bHandbrake = false;
	if (ACADPlayerCharacter* C = Cast<ACADPlayerCharacter>(GetPawn())) C->StopJumping();
}

void ACADPlayerController::OnLights(const FInputActionValue&)
{
	if (ACADVehicle* V = Cast<ACADVehicle>(GetPawn())) V->bHeadlightsOn = !V->bHeadlightsOn;
}

void ACADPlayerController::OnReset(const FInputActionValue&)
{
	if (ACADVehicle* V = Cast<ACADVehicle>(GetPawn())) V->ResetUpright();
}

void ACADPlayerController::OnInteract(const FInputActionValue&)
{
	ACADGameMode* G = GM();
	if (!G || G->State != ECADGameState::Playing || G->bFrozen) return;
	if (UCADMissionSubsystem* M = UCADMissionSubsystem::Get(this))
	{
		if (M->InDialogue()) { M->AdvanceDialogue(); return; }
	}
	UCADInteractionSubsystem* I = UCADInteractionSubsystem::Get(this);
	if (I && I->Current()) { I->Activate(); return; }
	if (ACADVehicle* V = Cast<ACADVehicle>(GetPawn())) { ExitVehicle(); (void)V; return; }
	if (ACADPlayerCharacter* C = Cast<ACADPlayerCharacter>(GetPawn()))
	{
		if (ACADVehicle* N = ACADVehicle::FindNearest(GetWorld(), C->GetActorLocation(), 420.f)) TryEnterVehicle(N);
	}
}

void ACADPlayerController::OnMap(const FInputActionValue&)
{
	ACADGameMode* G = GM();
	if (!G || !G->bInSession) return;
	if (G->State == ECADGameState::Playing) G->SetState(ECADGameState::Map);
	else if (G->State == ECADGameState::Map) G->SetState(ECADGameState::Playing);
}

void ACADPlayerController::OnInventory(const FInputActionValue&)
{
	ACADGameMode* G = GM();
	if (!G || !G->bInSession) return;
	if (G->State == ECADGameState::Playing) G->SetState(ECADGameState::Inventory);
	else if (G->State == ECADGameState::Inventory) G->SetState(ECADGameState::Playing);
}

void ACADPlayerController::OnPause(const FInputActionValue&)
{
	ACADGameMode* G = GM();
	if (G && G->bInSession && G->State == ECADGameState::Playing) G->SetState(ECADGameState::Paused);
}

void ACADPlayerController::OnUiUp(const FInputActionValue&) { if (ACADHUD* H = Hud()) H->Nav(-1); }
void ACADPlayerController::OnUiDown(const FInputActionValue&) { if (ACADHUD* H = Hud()) H->Nav(1); }
void ACADPlayerController::OnUiLeft(const FInputActionValue&) { if (ACADHUD* H = Hud()) H->Step(-1); }
void ACADPlayerController::OnUiRight(const FInputActionValue&) { if (ACADHUD* H = Hud()) H->Step(1); }
void ACADPlayerController::OnUiAccept(const FInputActionValue&) { if (ACADHUD* H = Hud()) H->Accept(); }
void ACADPlayerController::OnUiBack(const FInputActionValue&) { if (ACADHUD* H = Hud()) H->Back(); }
void ACADPlayerController::OnUiClick(const FInputActionValue&)
{
	float X, Y;
	if (GetMousePosition(X, Y)) if (ACADHUD* H = Hud()) H->Click(X, Y);
}
void ACADPlayerController::OnUiRClick(const FInputActionValue&)
{
	float X, Y;
	if (GetMousePosition(X, Y)) if (ACADHUD* H = Hud()) H->RightClick(X, Y);
}
void ACADPlayerController::OnUiScroll(const FInputActionValue& V) { if (ACADHUD* H = Hud()) H->Scroll(V.Get<float>()); }
void ACADPlayerController::OnWaypointKey(const FInputActionValue&) { if (ACADHUD* H = Hud()) H->GamepadWaypoint(); }

// ------------------------------------------------------------------------------------------------
// Per-frame control
// ------------------------------------------------------------------------------------------------
void ACADPlayerController::PollRebind()
{
	TArray<FKey> Keys;
	EKeys::GetAllKeys(Keys);
	for (const FKey& K : Keys)
	{
		if (K.IsGamepadKey() || K.IsMouseButton() || K.IsAxis1D() || K.IsAxis2D() || K.IsAxis3D()) continue;
		if (WasInputKeyJustPressed(K))
		{
			if (K == EKeys::Escape) { bCapturing = false; return; }
			if (UCADGameInstance* GI = UCADGameInstance::Get(this))
			{
				// unbind the key from any other action to avoid conflicts
				for (auto& P : GI->Settings.KeyBindings) if (P.Value == K && P.Key != CaptureId) P.Value = EKeys::Invalid;
				for (const FCADBinding& B : Bindings())
					if (B.Default == K && B.Id != CaptureId && !GI->Settings.KeyBindings.Contains(B.Id)) GI->Settings.KeyBindings.Add(B.Id, EKeys::Invalid);
				GI->Settings.KeyBindings.Add(CaptureId, K);
				GI->SaveSettings();
			}
			bCapturing = false;
			RebuildMappings();
			return;
		}
	}
}

void ACADPlayerController::PlayerTick(float DeltaTime)
{
	Super::PlayerTick(DeltaTime);
	if (bCapturing) { PollRebind(); return; }
	ACADGameMode* G = GM();
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	if (!G || !GI || G->State != ECADGameState::Playing) return;
	const float Sens = GI->Settings.MouseSensitivity;
	const float InvY = GI->Settings.bInvertY ? -1.f : 1.f;
	const float Locked = G->bFrozen ? 0.f : 1.f;

	if (ACADVehicle* V = Cast<ACADVehicle>(GetPawn()))
	{
		UCADMissionSubsystem* M = UCADMissionSubsystem::Get(this);
		const bool bLock = !Locked || (M && M->bInputLocked);
		V->InThrottle = bLock ? 0.f : CADMath::Clamp(AxisFwd, -1.f, 1.f);
		V->InSteer = bLock ? 0.f : CADMath::Clamp(AxisRight, -1.f, 1.f);
		V->InHandbrake = (bLock || bHandbrake) ? 1.f : 0.f;
		V->InBrake = 0.f;
		V->AddCameraInput(LookX * 0.175f * Sens + StickX * 120.f * DeltaTime, (-LookY * InvY * 0.175f * Sens) + StickY * 80.f * DeltaTime);
	}
	else if (ACADPlayerCharacter* C = Cast<ACADPlayerCharacter>(GetPawn()))
	{
		AddYawInput(LookX * Sens * 0.07f + StickX * 140.f * DeltaTime / 2.5f);
		AddPitchInput(-LookY * InvY * Sens * 0.07f - StickY * InvY * 100.f * DeltaTime / 2.5f);
		C->bWantsSprint = bSprint;
		if (Locked > 0.f) C->MoveInput(AxisFwd, AxisRight);
		C->SetFov(GI->Settings.FieldOfView);
	}
	LookX = LookY = 0.f;
}

// ------------------------------------------------------------------------------------------------
// Entering and leaving vehicles
// ------------------------------------------------------------------------------------------------
bool ACADPlayerController::TryEnterVehicle(ACADVehicle* V)
{
	ACADPlayerCharacter* C = Cast<ACADPlayerCharacter>(GetPawn());
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	if (!C || !V || !GI) return false;
	if (V->bWrecked) { GI->Toast(TEXT("That vehicle is wrecked.")); return false; }
	if (V->Role == ECADVehicleRole::Police) { GI->Toast(TEXT("You can't take a police vehicle.")); return false; }
	if (V->Role == ECADVehicleRole::Rival) { GI->Toast(TEXT("It's not yours to take.")); return false; }
	if (V->Role == ECADVehicleRole::Traffic)
	{
		// carjacking: a fictional crime that is only noticed when witnessed
		if (UCADPoliceSubsystem* P = UCADPoliceSubsystem::Get(this)) P->ReportCrime(ECADCrime::Carjack, V->GetActorLocation());
		V->Role = ECADVehicleRole::Parked;
		if (V->Driver) V->Driver->Stop();
	}
	CharacterRef = C;
	C->GetCharacterMovement()->DisableMovement();
	C->GetCapsuleComponent()->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	C->SetBodyVisible(false);
	C->AttachToComponent(V->Chassis, FAttachmentTransformRules::SnapToTargetNotIncludingScale);
	C->SetActorRelativeLocation(FVector::ZeroVector);
	Possess(V);
	V->bPlayerDriven = true;
	V->InHandbrake = 0.f; V->InBrake = 0.f;
	if (V->Role == ECADVehicleRole::Parked && V->OwnedId.IsValid()) V->Role = ECADVehicleRole::Player;
	if (UCADFleetSubsystem* F = UCADFleetSubsystem::Get(this)) if (V->OwnedId.IsValid()) { F->Active = V; GI->Profile.ActiveVehicle = V->OwnedId; }
	SetControlRotation(V->GetActorRotation());
	RefreshContext();
	return true;
}

void ACADPlayerController::ExitVehicle()
{
	ACADVehicle* V = Cast<ACADVehicle>(GetPawn());
	ACADPlayerCharacter* C = CharacterRef.Get();
	if (!V || !C) return;
	if (V->SpeedKph() > 28.f)
	{
		if (UCADGameInstance* GI = UCADGameInstance::Get(this)) GI->Toast(TEXT("Slow down before getting out."));
		return;
	}
	const FVector Right = V->GetActorRightVector();
	const FVector Offsets[3] = { -Right * (V->Spec.WidthM * 50.f + 90.f), Right * (V->Spec.WidthM * 50.f + 90.f), FVector(0, 0, V->Spec.HeightM * 100.f + 120.f) };
	FVector Exit = V->GetActorLocation() + Offsets[2];
	FCollisionQueryParams QP(SCENE_QUERY_STAT(CADExit), false, V);
	QP.AddIgnoredActor(C);
	for (const FVector& O : Offsets)
	{
		const FVector P = V->GetActorLocation() + O + FVector(0, 0, 40.f);
		if (!GetWorld()->OverlapBlockingTestByChannel(P, FQuat::Identity, ECC_Pawn, FCollisionShape::MakeCapsule(34.f, 88.f), QP)) { Exit = P; break; }
	}
	C->DetachFromActor(FDetachmentTransformRules::KeepWorldTransform);
	C->SetActorLocationAndRotation(Exit, FRotator(0.f, V->GetActorRotation().Yaw, 0.f), false, nullptr, ETeleportType::TeleportPhysics);
	C->GetCapsuleComponent()->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
	C->GetCharacterMovement()->SetMovementMode(MOVE_Falling);
	C->SetBodyVisible(true);
	V->bPlayerDriven = false;
	V->InThrottle = 0.f; V->InSteer = 0.f; V->InBrake = 1.f; V->InHandbrake = 1.f;
	UnPossess();
	Possess(C);
	SetControlRotation(FRotator(-10.f, V->GetActorRotation().Yaw, 0.f));
	RefreshContext();
}
