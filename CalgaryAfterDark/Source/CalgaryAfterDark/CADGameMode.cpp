#include "CADGameMode.h"
#include "CADAudioSubsystem.h"
#include "CADDataSubsystem.h"
#include "CADEconomySubsystem.h"
#include "CADEnvironmentSubsystem.h"
#include "CADFleetSubsystem.h"
#include "CADGameInstance.h"
#include "CADHUD.h"
#include "CADInteractionSubsystem.h"
#include "CADMissionSubsystem.h"
#include "CADPedestrianSubsystem.h"
#include "CADPlayerCharacter.h"
#include "CADPlayerController.h"
#include "CADPoliceSubsystem.h"
#include "CADTerrain.h"
#include "CADTrafficSubsystem.h"
#include "CADVehicle.h"
#include "CADWorldStreamer.h"
#include "CalgaryAfterDark.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Engine/World.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Kismet/GameplayStatics.h"
#include "Kismet/KismetSystemLibrary.h"

ACADGameMode::ACADGameMode()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bTickEvenWhenPaused = true;
	DefaultPawnClass = nullptr;
	PlayerControllerClass = ACADPlayerController::StaticClass();
	HUDClass = ACADHUD::StaticClass();
}

ACADPlayerController* ACADGameMode::GetPC() const
{
	return Cast<ACADPlayerController>(UGameplayStatics::GetPlayerController(GetWorld(), 0));
}

bool ACADGameMode::IsPausedState(ECADGameState S) const
{
	switch (S)
	{
	case ECADGameState::Paused: case ECADGameState::Map: case ECADGameState::Inventory: case ECADGameState::Garage:
	case ECADGameState::Shop: case ECADGameState::Property: case ECADGameState::Briefing: case ECADGameState::Results:
		return bInSession;
	case ECADGameState::Settings:
		return bInSession;
	default: return false;
	}
}

void ACADGameMode::BeginPlay()
{
	Super::BeginPlay();
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* D = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	if (!D || !D->bLoaded)
	{
		StartupError = TEXT("Game data failed to load. Check that Content/Data/*.csv is present (run Tools/generate_map.py and Tools/build_tables.py).");
		if (D) for (const FString& E : D->LoadErrors) StartupError += TEXT("\n") + E;
		UE_LOG(LogCAD, Error, TEXT("%s"), *StartupError);
	}
	SetSystemsEnabled(false);
	if (UCADEnvironmentSubsystem* Env = UCADEnvironmentSubsystem::Get(this))
	{
		Env->bEnabled = true;
		Env->Setup();
		Env->SetTime(19.2f);
		Env->SetWeather(ECADWeather::Clear, true);
	}
	if (D && D->bLoaded)
	{
		MenuFocus = D->LocationPos(TEXT("needle"));
		if (UCADWorldStreamer* S = GetWorld()->GetSubsystem<UCADWorldStreamer>()) { S->bEnabled = true; S->SetFocus(MenuFocus); }
	}
	SetupMenuCamera();
	if (UGameplayStatics::GetPlayerController(GetWorld(), 0)) { if (ACADPlayerController* PC = GetPC()) PC->RefreshContext(); }
}

void ACADGameMode::SetupMenuCamera()
{
	FActorSpawnParameters SP;
	SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	MenuCam = GetWorld()->SpawnActor<ACameraActor>(MenuFocus + FVector(0, 80000.f, 25000.f), FRotator::ZeroRotator, SP);
	if (MenuCam && MenuCam->GetCameraComponent()) MenuCam->GetCameraComponent()->SetFieldOfView(70.f);
	if (APlayerController* PC = UGameplayStatics::GetPlayerController(GetWorld(), 0))
	{
		PC->SetViewTarget(MenuCam);
	}
}

void ACADGameMode::TickMenuCamera(float Dt)
{
	if (!MenuCam) return;
	MenuAngle += Dt * 0.03f;
	const float R = 95000.f;
	const FVector Pos = MenuFocus + FVector(FMath::Cos(MenuAngle + 1.2f) * R, FMath::Sin(MenuAngle + 1.2f) * R, 28000.f + FMath::Sin(MenuAngle * 2.f) * 6000.f);
	MenuCam->SetActorLocation(Pos);
	const FVector Look = MenuFocus + FVector(0, 0, 9000.f) - Pos;
	MenuCam->SetActorRotation(Look.Rotation());
}

void ACADGameMode::SetSystemsEnabled(bool bSession)
{
	UWorld* W = GetWorld();
	if (UCADTrafficSubsystem* T = W->GetSubsystem<UCADTrafficSubsystem>()) T->bEnabled = true;
	if (UCADPedestrianSubsystem* P = W->GetSubsystem<UCADPedestrianSubsystem>()) P->bEnabled = true;
	if (UCADPoliceSubsystem* Po = W->GetSubsystem<UCADPoliceSubsystem>()) Po->bEnabled = bSession;
	if (UCADMissionSubsystem* M = W->GetSubsystem<UCADMissionSubsystem>()) M->bEnabled = bSession;
	if (UCADInteractionSubsystem* I = W->GetSubsystem<UCADInteractionSubsystem>()) I->bEnabled = bSession;
	if (UCADAudioSubsystem* A = W->GetSubsystem<UCADAudioSubsystem>()) A->bEnabled = true;
}

void ACADGameMode::UpdateFoci(const FVector& F)
{
	UWorld* W = GetWorld();
	if (UCADWorldStreamer* S = W->GetSubsystem<UCADWorldStreamer>()) S->SetFocus(F);
	if (UCADTrafficSubsystem* T = W->GetSubsystem<UCADTrafficSubsystem>()) T->Focus = F;
	if (UCADPedestrianSubsystem* P = W->GetSubsystem<UCADPedestrianSubsystem>()) P->Focus = F;
	if (UCADEnvironmentSubsystem* E = W->GetSubsystem<UCADEnvironmentSubsystem>()) E->Focus = F;
}

void ACADGameMode::SetState(ECADGameState S)
{
	if (S == ECADGameState::Settings && State != ECADGameState::Settings) StateBeforeSettings = State;
	State = S;
	UGameplayStatics::SetGamePaused(GetWorld(), IsPausedState(S));
	if (S == ECADGameState::Map)
	{
		if (UCADMissionSubsystem* M = UCADMissionSubsystem::Get(this)) M->NotifyMapOpened();
	}
	ACADPlayerController* PC = GetPC();
	if (PC) PC->RefreshContext();
	if (ACADHUD* H = Cast<ACADHUD>(PC ? PC->GetHUD() : nullptr)) H->OnStateChanged();
}

// ------------------------------------------------------------------------------------------------
// Session lifecycle
// ------------------------------------------------------------------------------------------------
void ACADGameMode::StartNewGame()
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* D = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	if (!D || !D->bLoaded) return;
	GI->NewProfile();
	const FVector P = D->LocationPos(TEXT("start"));
	SetWaypoint(D->LocationPos(TEXT("diner")));
	if (UCADEnvironmentSubsystem* Env = UCADEnvironmentSubsystem::Get(this)) { Env->SetTime(9.f); Env->Day = 1; Env->SetWeather(ECADWeather::Clear, true); }
	BeginSession(P, 0.f, false);
}

void ACADGameMode::ContinueGame()
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	if (!GI) return;
	if (!GI->LoadProfile())
	{
		GI->Toast(GI->LastError);
		return;
	}
	if (!GI->LastError.IsEmpty()) GI->Toast(GI->LastError);
	bHasWaypoint = false;
	BeginSession(GI->Profile.PlayerLocation, GI->Profile.PlayerYaw, true);
}

void ACADGameMode::BeginSession(const FVector& Loc, float Yaw, bool bFromSave)
{
	// clean any previous session
	UWorld* W = GetWorld();
	if (UCADTrafficSubsystem* T = W->GetSubsystem<UCADTrafficSubsystem>()) T->DespawnAll();
	if (UCADPedestrianSubsystem* P = W->GetSubsystem<UCADPedestrianSubsystem>()) P->DespawnAll();
	if (UCADMissionSubsystem* M = W->GetSubsystem<UCADMissionSubsystem>()) M->Abandon();
	if (UCADPoliceSubsystem* Po = W->GetSubsystem<UCADPoliceSubsystem>()) Po->ClearWanted(true);
	PendingLoc = Loc; PendingYaw = Yaw; bPendingFromSave = bFromSave;
	bLoadingWorld = true;
	LoadElapsed = 0.f;
	UpdateFoci(Loc);
	if (UCADWorldStreamer* S = W->GetSubsystem<UCADWorldStreamer>()) S->SetFocus(Loc);
	SetState(ECADGameState::Playing);
	UGameplayStatics::SetGamePaused(W, false);
	bFrozen = true;
}

void ACADGameMode::BindSessionCallbacks()
{
	if (bBound) return;
	bBound = true;
	UWorld* W = GetWorld();
	if (UCADInteractionSubsystem* I = W->GetSubsystem<UCADInteractionSubsystem>())
		I->OnActivate = [this](const FCADInteractPoint& P) { OnInteract(P); };
	if (UCADMissionSubsystem* M = W->GetSubsystem<UCADMissionSubsystem>())
	{
		M->OnBriefing = [this]() { SetState(ECADGameState::Briefing); };
		M->OnResultReady = [this]()
		{
			if (UCADMissionSubsystem* Ms = UCADMissionSubsystem::Get(this))
			{
				if (Ms->Result.bSuccess) SaveGameNow(false);
			}
			SetState(ECADGameState::Results);
		};
	}
	if (UCADPoliceSubsystem* Po = W->GetSubsystem<UCADPoliceSubsystem>())
		Po->OnBusted.AddUObject(this, &ACADGameMode::OnBusted);
}

void ACADGameMode::FinishSessionStart()
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UWorld* W = GetWorld();
	ACADPlayerController* PC = GetPC();
	if (!GI || !PC) return;

	FVector Loc = PendingLoc;
	Loc.Z = CADMath::Max(CADTerrain::Height(Loc.X, Loc.Y), bPendingFromSave ? Loc.Z - 100.f : -10000.f) + 130.f;
	// land on whatever surface is below (roads, bridges, overpasses)
	FHitResult Hit;
	FCollisionObjectQueryParams OQP(ECC_WorldStatic);
	if (W->LineTraceSingleByObjectType(Hit, Loc + FVector(0, 0, 3000.f), Loc - FVector(0, 0, 3000.f), OQP))
	{
		Loc.Z = Hit.ImpactPoint.Z + 100.f;
	}

	FActorSpawnParameters SP;
	SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
	ACADPlayerCharacter* C = W->SpawnActor<ACADPlayerCharacter>(Loc, FRotator(0.f, PendingYaw, 0.f), SP);
	if (!C) { StartupError = TEXT("Could not spawn the player character."); bLoadingWorld = false; bFrozen = false; return; }
	PlayerChar = C;
	PC->SetCharacter(C);
	C->ApplyOutfit(GI->Settings.OutfitIndex);
	C->Health = GI->Profile.Health;
	PC->Possess(C);
	PC->SetControlRotation(FRotator(-8.f, PendingYaw, 0.f));
	PC->SetViewTargetWithBlend(C, 0.f);

	if (bPendingFromSave)
	{
		UCADEnvironmentSubsystem* Env = UCADEnvironmentSubsystem::Get(this);
		if (Env) { Env->SetTime(GI->Profile.TimeOfDay); Env->Day = GI->Profile.Day; Env->SetWeather(static_cast<ECADWeather>(GI->Profile.Weather), true); }
		if (GI->Profile.ActiveVehicle.IsValid())
		{
			if (UCADFleetSubsystem* F = UCADFleetSubsystem::Get(this))
			{
				const FVector VL = GI->Profile.ActiveVehicleLocation;
				if (!VL.IsZero()) F->SpawnOwned(GI->Profile.ActiveVehicle, VL + FVector(0, 0, 80.f), GI->Profile.ActiveVehicleRotation);
			}
		}
	}
	SetSystemsEnabled(true);
	BindSessionCallbacks();
	bInSession = true;
	bLoadingWorld = false;
	bFrozen = false;
	bDeathHandled = false;
	AutosaveClock = 0.f;
	if (UCADEnvironmentSubsystem* Env = UCADEnvironmentSubsystem::Get(this)) Env->bClockRunning = true;
	if (!bPendingFromSave) GI->Toast(TEXT("Welcome to Calgary. Find Marcy at the Last Spike Diner (marked on your map)."));
	SetState(ECADGameState::Playing);
}

void ACADGameMode::ReturnToMainMenu()
{
	UWorld* W = GetWorld();
	if (UCADMissionSubsystem* M = W->GetSubsystem<UCADMissionSubsystem>()) M->Abandon();
	if (UCADPoliceSubsystem* Po = W->GetSubsystem<UCADPoliceSubsystem>()) Po->ClearWanted(true);
	if (UCADInteractionSubsystem* I = W->GetSubsystem<UCADInteractionSubsystem>()) I->DestroyMarkers();
	if (UCADFleetSubsystem* F = UCADFleetSubsystem::Get(this)) { if (F->Active.IsValid()) F->Active->Destroy(); F->Active.Reset(); }
	if (ACADPlayerController* PC = GetPC())
	{
		if (ACADVehicle* V = Cast<ACADVehicle>(PC->GetPawn())) { PC->UnPossess(); V->Destroy(); }
		PC->UnPossess();
		if (PlayerChar.IsValid()) PlayerChar->Destroy();
		PC->SetViewTarget(MenuCam);
	}
	PlayerChar.Reset();
	bInSession = false;
	bFrozen = false;
	SetSystemsEnabled(false);
	if (UCADEnvironmentSubsystem* Env = UCADEnvironmentSubsystem::Get(this)) Env->SetTime(19.2f);
	SetState(ECADGameState::MainMenu);
}

void ACADGameMode::QuitGame()
{
	UKismetSystemLibrary::QuitGame(this, GetPC(), EQuitPreference::Quit, false);
}

bool ACADGameMode::SaveGameNow(bool bToast)
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	if (!GI || !bInSession) return false;
	APawn* P = GetPC() ? GetPC()->GetPawn() : nullptr;
	if (!P) return false;
	FCADProfile& Pr = GI->Profile;
	if (UCADFleetSubsystem* F = UCADFleetSubsystem::Get(this)) F->SyncActive();
	if (const ACADVehicle* V = Cast<ACADVehicle>(P))
	{
		Pr.PlayerLocation = V->GetExitLocation();
		Pr.PlayerYaw = V->GetActorRotation().Yaw;
	}
	else
	{
		Pr.PlayerLocation = P->GetActorLocation();
		Pr.PlayerYaw = P->GetActorRotation().Yaw;
	}
	if (const ACADPlayerCharacter* C = PlayerChar.Get()) Pr.Health = CADMath::Max(10.f, C->Health);
	if (UCADEnvironmentSubsystem* Env = UCADEnvironmentSubsystem::Get(this)) { Pr.TimeOfDay = Env->TimeOfDay; Pr.Day = Env->Day; Pr.Weather = static_cast<uint8>(Env->Weather); }
	const bool bOk = GI->SaveProfile();
	if (bToast) GI->Toast(bOk ? TEXT("Game saved.") : (TEXT("Save failed: ") + GI->LastError));
	return bOk;
}

void ACADGameMode::SleepUntilMorning()
{
	if (UCADEnvironmentSubsystem* Env = UCADEnvironmentSubsystem::Get(this))
	{
		if (Env->TimeOfDay >= 6.f) ++Env->Day;
		Env->SetTime(7.f);
		if (UCADEconomySubsystem* E = UCADGameInstance::Get(this)->GetSubsystem<UCADEconomySubsystem>()) E->PayPropertyIncome();
	}
	if (PlayerChar.IsValid()) PlayerChar->Health = 100.f;
	SaveGameNow(false);
	if (UCADGameInstance* GI = UCADGameInstance::Get(this)) GI->Toast(TEXT("You slept until morning. Game saved."));
}

// ------------------------------------------------------------------------------------------------
// Interaction hand-off
// ------------------------------------------------------------------------------------------------
void ACADGameMode::OpenShop(FName Id) { ShopId = Id; SetState(ECADGameState::Shop); }
void ACADGameMode::OpenGarage()
{
	bGarageInVehicle = Cast<ACADVehicle>(GetPC() ? GetPC()->GetPawn() : nullptr) != nullptr;
	SetState(ECADGameState::Garage);
}
void ACADGameMode::OpenProperty(FName Id) { PropertyId = Id; SetState(ECADGameState::Property); }

void ACADGameMode::GarageSpawnTransform(FVector& OutPos, FRotator& OutRot) const
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* D = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	OutPos = FVector::ZeroVector; OutRot = FRotator::ZeroRotator;
	if (!D) return;
	const FVector G = D->LocationPos(TEXT("garage"));
	int32 E; float T, Dist;
	FVector Dir(1, 0, 0);
	if (D->Network.NearestEdge(G, true, E, T, Dist))
	{
		Dir = FVector(D->Network.Edges[E].Dir.X, D->Network.Edges[E].Dir.Y, 0.f);
		const FVector OnRoad = D->Network.PointOnEdge(E, T);
		OutPos = OnRoad + FVector(0, 0, 120.f);   // pull out onto the street in front of the garage
	}
	else OutPos = G + FVector(0, 0, 120.f);
	OutRot = FRotator(0.f, Dir.Rotation().Yaw, 0.f);
}

void ACADGameMode::OnInteract(const FCADInteractPoint& P)
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADMissionSubsystem* M = UCADMissionSubsystem::Get(this);
	if (P.Kind == TEXT("Giver"))
	{
		if (P.Id == TEXT("courier_hub")) { if (M) M->StartCourier(); return; }
		FName Mission;
		if (M && M->AvailableAt(P.Id, Mission)) M->ShowBriefing(Mission);
		else if (GI) GI->Toast(P.Id == TEXT("diner") ? TEXT("Marcy: Nothing for you right now. Finish what's on your plate and come back.") : TEXT("Owen: I've got nothing urgent for you right now. Thanks for asking."));
	}
	else if (P.Kind == TEXT("Shop")) OpenShop(P.Id);
	else if (P.Kind == TEXT("Garage")) OpenGarage();
	else if (P.Kind == TEXT("Property")) OpenProperty(P.Id);
}

// ------------------------------------------------------------------------------------------------
// Death / arrest
// ------------------------------------------------------------------------------------------------
void ACADGameMode::OnBusted()
{
	if (Overlay != ECADOverlayKind::None || !bInSession) return;
	StartOverlay(ECADOverlayKind::Busted);
}

void ACADGameMode::StartOverlay(ECADOverlayKind K)
{
	Overlay = K;
	OverlayTimer = 0.f;
	bFrozen = true;
	OverlayTitle = K == ECADOverlayKind::Wasted ? TEXT("WASTED") : TEXT("BUSTED");
	OverlaySub = K == ECADOverlayKind::Wasted ? TEXT("You were taken to Bow Valley General.") : TEXT("The Foothills Regional Police Service has you.");
}

void ACADGameMode::RespawnAt(FName LocationId)
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* D = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	ACADPlayerController* PC = GetPC();
	if (!D || !PC) return;
	if (ACADVehicle* V = Cast<ACADVehicle>(PC->GetPawn())) { V->InThrottle = 0; PC->ExitVehicle(); }
	ACADPlayerCharacter* C = PlayerChar.Get();
	if (!C) return;
	FVector P = D->LocationPos(LocationId);
	int32 E; float T, Dist;
	if (D->Network.NearestEdge(P, true, E, T, Dist)) P = D->Network.PointOnEdge(E, T) + FVector(0, 0, 0.f);
	P.Z += 130.f;
	C->DetachFromActor(FDetachmentTransformRules::KeepWorldTransform);
	C->SetActorLocation(P, false, nullptr, ETeleportType::TeleportPhysics);
	C->Health = 100.f;
	C->bDead = false;
	C->GetCharacterMovement()->SetMovementMode(MOVE_Walking);
	C->SetBodyVisible(true);
	UpdateFoci(P);
}

void ACADGameMode::ResolveOverlay()
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADEconomySubsystem* Eco = GI ? GI->GetSubsystem<UCADEconomySubsystem>() : nullptr;
	UCADMissionSubsystem* M = UCADMissionSubsystem::Get(this);
	UCADPoliceSubsystem* Po = UCADPoliceSubsystem::Get(this);
	if (Overlay == ECADOverlayKind::Wasted)
	{
		const int32 Fee = Eco ? CADMath::Min(Eco->Cash(), 150) : 0;
		if (Eco && Fee > 0) Eco->Spend(Fee, TEXT("Hospital fees"));
		RespawnAt(TEXT("hospital"));
		if (M) M->NotifyPlayerDead();
	}
	else if (Overlay == ECADOverlayKind::Busted)
	{
		const int32 Fine = Eco ? CADMath::Min(FMath::RoundToInt(Eco->Cash() * 0.1f), 500) : 0;
		if (Eco && Fine > 0) Eco->Spend(Fine, TEXT("Police fine"));
		if (Po) Po->ClearWanted(true);
		RespawnAt(TEXT("police_hq"));
		if (M) M->NotifyBusted();
		if (GI) GI->Toast(FString::Printf(TEXT("You were released. Fine: %s"), *UCADEconomySubsystem::Money(Fine)));
	}
	Overlay = ECADOverlayKind::None;
	bFrozen = false;
	bDeathHandled = false;
}

// ------------------------------------------------------------------------------------------------
// Tick
// ------------------------------------------------------------------------------------------------
void ACADGameMode::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	ACADPlayerController* PC = GetPC();
	if (!PC) return;

	if (!bInSession && !bLoadingWorld)
	{
		TickMenuCamera(DeltaSeconds);
		UpdateFoci(MenuFocus);
		return;
	}
	if (bLoadingWorld)
	{
		LoadElapsed += DeltaSeconds;
		UWorld* W = GetWorld();
		UCADWorldStreamer* S = W->GetSubsystem<UCADWorldStreamer>();
		TickMenuCamera(DeltaSeconds);
		if (S) S->SetFocus(PendingLoc);
		if ((S && S->IsAreaReady(PendingLoc, 60000.f)) || LoadElapsed > 25.f) FinishSessionStart();
		return;
	}

	APawn* P = PC->GetPawn();
	if (P) UpdateFoci(P->GetActorLocation());

	// overlay timeline: fade out, resolve, fade in
	if (Overlay != ECADOverlayKind::None)
	{
		OverlayTimer += DeltaSeconds;
		if (OverlayTimer < 1.2f) FadeAlpha = CADMath::Min(1.f, OverlayTimer / 1.0f) * 0.85f;
		else if (OverlayTimer < 3.2f) FadeAlpha = 0.85f;
		else
		{
			if (OverlayTimer >= 3.2f && OverlayTimer - DeltaSeconds < 3.2f) ResolveOverlay();
			FadeAlpha = CADMath::Max(0.f, FadeAlpha - DeltaSeconds * 1.2f);
			if (Overlay == ECADOverlayKind::None && FadeAlpha <= 0.f) {}
		}
	}
	else FadeAlpha = CADMath::Max(0.f, FadeAlpha - DeltaSeconds * 1.5f);

	if (State == ECADGameState::Playing && Overlay == ECADOverlayKind::None)
	{
		if (const UCADMissionSubsystem* Ms = UCADMissionSubsystem::Get(this)) { if (Ms->InChoice()) SetState(ECADGameState::Briefing); }
		if (PlayerChar.IsValid() && PlayerChar->Health <= 0.f && !bDeathHandled)
		{
			bDeathHandled = true;
			StartOverlay(ECADOverlayKind::Wasted);
		}
		if (UCADGameInstance* GI = UCADGameInstance::Get(this)) GI->Profile.PlaySeconds += DeltaSeconds;
		AutosaveClock += DeltaSeconds;
		if (AutosaveClock > 300.f)
		{
			AutosaveClock = 0.f;
			const UCADMissionSubsystem* M = UCADMissionSubsystem::Get(this);
			const UCADPoliceSubsystem* Po = UCADPoliceSubsystem::Get(this);
			if ((!M || !M->bActive) && (!Po || Po->Level() == 0)) SaveGameNow(false);
		}
	}
}

// ------------------------------------------------------------------------------------------------
// Debug / QA commands
// ------------------------------------------------------------------------------------------------
FString ACADGameMode::CurrentDistrictName() const
{
	const APawn* P = GetPC() ? GetPC()->GetPawn() : nullptr;
	if (!P) return FString();
	return CADTerrain::DistrictName(CADTerrain::DistrictAt(P->GetActorLocation().X, P->GetActorLocation().Y));
}

FString ACADGameMode::CurrentRoadName() const
{
	const APawn* P = GetPC() ? GetPC()->GetPawn() : nullptr;
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* D = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	if (!P || !D) return FString();
	int32 E; float T, Dist;
	if (D->Network.NearestEdge(P->GetActorLocation(), false, E, T, Dist) && Dist < 2500.f) return D->Network.Edges[E].Road;
	return FString();
}

void ACADGameMode::CADGiveCash(int32 Amount)
{
	if (UCADGameInstance* GI = UCADGameInstance::Get(this)) if (UCADEconomySubsystem* E = GI->GetSubsystem<UCADEconomySubsystem>()) E->Earn(Amount, TEXT("Debug"));
}

void ACADGameMode::CADTeleport(FName LocationId)
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* D = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	if (!D || !GetPC() || !GetPC()->GetPawn()) return;
	const FVector P = D->LocationPos(LocationId) + FVector(0, 0, 200.f);
	GetPC()->GetPawn()->SetActorLocation(P, false, nullptr, ETeleportType::TeleportPhysics);
}

void ACADGameMode::CADWeather(int32 Type) { if (UCADEnvironmentSubsystem* E = UCADEnvironmentSubsystem::Get(this)) { E->bAutoWeather = false; E->SetWeather(static_cast<ECADWeather>(CADMath::Clamp(Type, 0, 4))); } }
void ACADGameMode::CADTime(float Hours) { if (UCADEnvironmentSubsystem* E = UCADEnvironmentSubsystem::Get(this)) E->SetTime(Hours); }
void ACADGameMode::CADWanted(int32 Level) { if (UCADPoliceSubsystem* P = UCADPoliceSubsystem::Get(this)) P->SetWantedLevel(Level); }

void ACADGameMode::CADSpawn(FName VehicleId)
{
	if (APawn* P = GetPC() ? GetPC()->GetPawn() : nullptr)
		if (UCADTrafficSubsystem* T = GetWorld()->GetSubsystem<UCADTrafficSubsystem>())
			T->SpawnAt(VehicleId, P->GetActorLocation() + P->GetActorForwardVector() * 600.f + FVector(0, 0, 120.f), P->GetActorRotation(), ECADVehicleRole::Parked);
}

void ACADGameMode::CADStats()
{
	UWorld* W = GetWorld();
	const UCADWorldStreamer* S = W->GetSubsystem<UCADWorldStreamer>();
	const UCADTrafficSubsystem* T = W->GetSubsystem<UCADTrafficSubsystem>();
	const UCADPedestrianSubsystem* Pd = W->GetSubsystem<UCADPedestrianSubsystem>();
	UE_LOG(LogCAD, Display, TEXT("Chunks loaded %d (building %d) | traffic %d | peds %d | vehicles registered %d"),
		S ? S->NumLoaded() : 0, S ? S->NumBuilding() : 0, T ? T->NumTraffic() : 0, Pd ? Pd->NumPeds() : 0, ACADVehicle::Registry.Num());
}
