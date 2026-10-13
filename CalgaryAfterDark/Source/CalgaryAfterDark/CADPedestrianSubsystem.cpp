#include "CADPedestrianSubsystem.h"
#include "CADDataSubsystem.h"
#include "CADGameInstance.h"
#include "CADPedestrian.h"
#include "CADTerrain.h"
#include "CADWorldStreamer.h"
#include "CalgaryAfterDark.h"
#include "Engine/World.h"

bool UCADPedestrianSubsystem::ShouldCreateSubsystem(UObject* Outer) const
{
	const UWorld* W = Cast<UWorld>(Outer);
	return W && W->IsGameWorld();
}

int32 UCADPedestrianSubsystem::TargetCount() const
{
	int32 Level = 2;
	if (UCADGameInstance* GI = UCADGameInstance::Get(this)) Level = GI->Settings.PedestrianDensity;
	static const int32 C[4] = { 0, 20, 45, 75 };
	return C[CADMath::Clamp(Level, 0, 3)];
}

bool UCADPedestrianSubsystem::AnyPedNear(const FVector& P, float Radius) const
{
	for (const TWeakObjectPtr<ACADPedestrian>& W : ACADPedestrian::Registry)
	{
		const ACADPedestrian* Ped = W.Get();
		if (Ped && !Ped->bDead && FVector::Dist2D(Ped->GetActorLocation(), P) < Radius) return true;
	}
	return false;
}

void UCADPedestrianSubsystem::DespawnAll()
{
	for (ACADPedestrian* P : Peds) if (P) P->Destroy();
	Peds.Reset();
}

void UCADPedestrianSubsystem::TrySpawn()
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* Data = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	UCADWorldStreamer* St = GetWorld()->GetSubsystem<UCADWorldStreamer>();
	if (!Data || !St) return;
	const FCADRoadNetwork& N = Data->Network;
	TArray<int32> Near;
	N.EdgesNear(Focus, 26000.f, Near);
	for (int32 Try = 0; Try < 12 && Near.Num() > 0; ++Try)
	{
		const int32 Ei = Near[FMath::RandRange(0, Near.Num() - 1)];
		const FCADRoadEdge& E = N.Edges[Ei];
		if (E.Kind == ECADRoadKind::Highway || E.Kind == ECADRoadKind::Ramp || E.Kind == ECADRoadKind::Expressway || (E.bBridge && E.Kind != ECADRoadKind::Path)) continue;
		const float T = FMath::FRandRange(0.15f, 0.85f);
		const int32 Side = FMath::RandBool() ? 1 : -1;
		const FVector P = N.SidewalkPoint(Ei, T, Side);
		const float D = FVector::Dist2D(P, Focus);
		if (D < 3500.f || D > 26000.f) continue;
		if (!St->IsLoadedAt(P)) continue;
		const ECADDistrict Dist = CADTerrain::DistrictAt(P.X, P.Y);
		float Weight = 1.f;
		switch (Dist)
		{
		case ECADDistrict::Downtown: Weight = 1.6f; break;
		case ECADDistrict::Beltline: Weight = 1.4f; break;
		case ECADDistrict::Parkland: Weight = 1.2f; break;
		case ECADDistrict::Suburb: Weight = 0.7f * (1.f - 0.5f * Night); break;
		case ECADDistrict::Industrial: Weight = 0.4f; break;
		case ECADDistrict::Airport: Weight = 0.4f; break;
		default: Weight = 0.f; break;
		}
		if (E.Kind == ECADRoadKind::Path) Weight = CADMath::Max(Weight, 1.2f);
		if (FMath::FRand() > Weight / 1.6f) continue;

		int32 Type = 1;
		const float R = FMath::FRand();
		switch (Dist)
		{
		case ECADDistrict::Downtown: Type = R < 0.6f ? 0 : (R < 0.9f ? 1 : (R < 0.95f ? 2 : 3)); break;
		case ECADDistrict::Parkland: Type = R < 0.35f ? 2 : (R < 0.75f ? 1 : 4); break;
		case ECADDistrict::Industrial: case ECADDistrict::Airport: Type = R < 0.8f ? 3 : 1; break;
		case ECADDistrict::Suburb: Type = R < 0.5f ? 4 : (R < 0.85f ? 1 : 2); break;
		default: Type = R < 0.5f ? 1 : 4; break;
		}
		FActorSpawnParameters SP;
		SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
		ACADPedestrian* Ped = GetWorld()->SpawnActor<ACADPedestrian>(P + FVector(0, 0, 100.f), FRotator(0, FMath::FRandRange(0.f, 360.f), 0), SP);
		if (Ped)
		{
			Ped->Setup(Type, Ei, T, Side, SeedCounter++ * 7919 + 13);
			Peds.Add(Ped);
		}
		return;
	}
}

void UCADPedestrianSubsystem::Tick(float DeltaTime)
{
	if (!bEnabled) return;
	SpawnClock += DeltaTime;
	if (SpawnClock > 0.3f && Peds.Num() < TargetCount())
	{
		SpawnClock = 0.f;
		TrySpawn();
	}
	CleanClock += DeltaTime;
	if (CleanClock > 1.f)
	{
		CleanClock = 0.f;
		for (int32 i = Peds.Num() - 1; i >= 0; --i)
		{
			ACADPedestrian* P = Peds[i];
			if (!P) { Peds.RemoveAtSwap(i); continue; }
			const float D = FVector::Dist2D(P->GetActorLocation(), Focus);
			if (P->bExpired || D > 40000.f || P->GetActorLocation().Z < -2000.f)
			{
				P->Destroy();
				Peds.RemoveAtSwap(i);
				continue;
			}
			P->SetActorTickInterval(D > 16000.f ? 0.3f : (D > 8000.f ? 0.1f : 0.f));
		}
	}
}
