#include "CADInteractionSubsystem.h"
#include "CADDataSubsystem.h"
#include "CADEconomySubsystem.h"
#include "CADGameInstance.h"
#include "CADMarker.h"
#include "CADMissionSubsystem.h"
#include "CADVehicle.h"
#include "CalgaryAfterDark.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"

UCADInteractionSubsystem* UCADInteractionSubsystem::Get(const UObject* Ctx)
{
	const UWorld* W = Ctx ? Ctx->GetWorld() : nullptr;
	return W ? W->GetSubsystem<UCADInteractionSubsystem>() : nullptr;
}

bool UCADInteractionSubsystem::ShouldCreateSubsystem(UObject* Outer) const
{
	const UWorld* W = Cast<UWorld>(Outer);
	return W && W->IsGameWorld();
}

void UCADInteractionSubsystem::Build()
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* D = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	if (!D || !D->bLoaded) return;
	bBuilt = true;
	for (const FName& Id : D->LocationOrder)
	{
		const FCADLocationRow& L = D->Locations[Id];
		if (L.Kind != TEXT("Giver") && L.Kind != TEXT("Shop") && L.Kind != TEXT("Garage") && L.Kind != TEXT("Property")) continue;
		FCADInteractPoint P;
		P.Id = Id;
		P.Kind = L.Kind;
		P.Label = L.DisplayName;
		P.Pos = D->LocationPos(Id);
		P.RadiusCm = CADMath::Max(L.Radius * CADM, 800.f);
		Points.Add(P);
	}
}

void UCADInteractionSubsystem::DestroyMarkers()
{
	for (auto& P : Markers) if (P.Value) P.Value->Destroy();
	Markers.Reset();
}

void UCADInteractionSubsystem::UpdateMarkers(const FVector& Focus)
{
	UCADMissionSubsystem* M = GetWorld()->GetSubsystem<UCADMissionSubsystem>();
	for (const FCADInteractPoint& P : Points)
	{
		const float D = FVector::Dist2D(P.Pos, Focus);
		TObjectPtr<ACADMarker>* Existing = Markers.Find(P.Id);
		if (D > 80000.f)
		{
			if (Existing && *Existing) (*Existing)->Destroy();
			if (Existing) Markers.Remove(P.Id);
			continue;
		}
		if (D < 65000.f && !Existing)
		{
			FLinearColor C(0.9f, 0.9f, 0.9f);
			FString Text = P.Label;
			bool bBeam = true;
			if (P.Id == TEXT("courier_hub"))
			{
				C = FLinearColor(1.f, 0.78f, 0.1f);
				Text += TEXT("\n[Courier jobs - repeatable]");
			}
			else if (P.Kind == TEXT("Giver"))
			{
				FName Mission;
				const bool bAvail = M && M->AvailableAt(P.Id, Mission);
				C = bAvail ? FLinearColor(1.f, 0.78f, 0.1f) : FLinearColor(0.5f, 0.5f, 0.55f);
				bBeam = bAvail;
				Text += bAvail ? TEXT("\n[Job available]") : TEXT("\n[Nothing right now]");
			}
			else if (P.Kind == TEXT("Shop")) C = FLinearColor(0.2f, 0.55f, 1.f);
			else if (P.Kind == TEXT("Garage")) C = FLinearColor(1.f, 0.5f, 0.1f);
			else if (P.Kind == TEXT("Property")) C = FLinearColor(0.2f, 0.9f, 0.4f);
			FActorSpawnParameters SP;
			SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
			if (ACADMarker* Mk = GetWorld()->SpawnActor<ACADMarker>(P.Pos, FRotator::ZeroRotator, SP))
			{
				Mk->Setup(C, 450.f, Text, bBeam, 650.f);
				Markers.Add(P.Id, Mk);
			}
		}
	}
}

void UCADInteractionSubsystem::Activate()
{
	if (const FCADInteractPoint* P = Current())
	{
		if (OnActivate) OnActivate(*P);
	}
}

void UCADInteractionSubsystem::Tick(float DeltaTime)
{
	if (!bEnabled) return;
	if (!bBuilt) Build();
	APawn* Pawn = UGameplayStatics::GetPlayerPawn(GetWorld(), 0);
	if (!Pawn) return;
	const FVector L = Pawn->GetActorLocation();
	const bool bInVehicle = Cast<ACADVehicle>(Pawn) != nullptr;

	MarkerClock += DeltaTime;
	if (MarkerClock > 0.7f) { MarkerClock = 0.f; UpdateMarkers(L); }

	// nearest interactable
	CurrentIdx = INDEX_NONE;
	float Best = TNumericLimits<float>::Max();
	for (int32 i = 0; i < Points.Num(); ++i)
	{
		const FCADInteractPoint& P = Points[i];
		const float D = FVector::Dist2D(P.Pos, L);
		const float Reach = bInVehicle ? (P.Kind == TEXT("Garage") || P.Kind == TEXT("Shop") ? 1300.f : 0.f) : 480.f;
		if (D < Reach && D < Best) { Best = D; CurrentIdx = i; }
	}
	Prompt.Reset();
	if (const FCADInteractPoint* P = Current())
	{
		if (P->Kind == TEXT("Giver")) Prompt = FString::Printf(TEXT("Talk to %s"), *P->Label);
		else if (P->Kind == TEXT("Shop")) Prompt = FString::Printf(TEXT("Browse %s"), *P->Label);
		else if (P->Kind == TEXT("Garage")) Prompt = FString::Printf(TEXT("Enter %s"), *P->Label);
		else Prompt = FString::Printf(TEXT("%s"), *P->Label);
	}

	// landmark discovery rewards
	DiscoverClock += DeltaTime;
	if (DiscoverClock > 0.5f)
	{
		DiscoverClock = 0.f;
		UCADGameInstance* GI = UCADGameInstance::Get(this);
		UCADDataSubsystem* D = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
		UCADEconomySubsystem* E = GI ? GI->GetSubsystem<UCADEconomySubsystem>() : nullptr;
		if (D && E)
		{
			for (const FName& Id : D->LocationOrder)
			{
				const FCADLocationRow& Loc = D->Locations[Id];
				if (Loc.Kind != TEXT("Landmark") && Loc.Kind != TEXT("Overlook")) continue;
				if (GI->Profile.Discovered.Contains(Id)) continue;
				const FVector P = FVector(Loc.X * CADM, Loc.Y * CADM, 0.f);
				if (FVector::Dist2D(P, L) < CADMath::Max(Loc.Radius * CADM, 2500.f))
				{
					GI->Profile.Discovered.Add(Id);
					E->EarnOnce(FName(*FString::Printf(TEXT("disc_%s"), *Id.ToString())), Loc.DiscoverReward, FString::Printf(TEXT("Discovered %s"), *Loc.DisplayName));
					GI->Toast(FString::Printf(TEXT("Discovered: %s  (+%s)"), *Loc.DisplayName, *UCADEconomySubsystem::Money(Loc.DiscoverReward)));
				}
			}
		}
	}
}
