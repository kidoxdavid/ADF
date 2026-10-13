#include "CADTrafficSubsystem.h"
#include "CADDataSubsystem.h"
#include "CADGameInstance.h"
#include "CADPoliceSubsystem.h"
#include "CADTerrain.h"
#include "CADVehicle.h"
#include "CADVehicleDriver.h"
#include "CADWorldStreamer.h"
#include "CalgaryAfterDark.h"
#include "Engine/World.h"

bool UCADTrafficSubsystem::ShouldCreateSubsystem(UObject* Outer) const
{
	const UWorld* W = Cast<UWorld>(Outer);
	return W && W->IsGameWorld();
}

int32 UCADTrafficSubsystem::TargetCount() const
{
	int32 Level = 2;
	if (UCADGameInstance* GI = UCADGameInstance::Get(this)) Level = GI->Settings.TrafficDensity;
	static const int32 Counts[4] = { 0, 12, 30, 48 };
	return FMath::RoundToInt(Counts[CADMath::Clamp(Level, 0, 3)] * DensityBoost);
}

FName UCADTrafficSubsystem::PickVehicle(ECADDistrict D) const
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* Data = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	if (!Data) return NAME_None;
	if (FMath::FRand() < 0.03f) return TEXT("patrol");
	float Total = 0.f;
	TArray<TPair<FName, float>> Table;
	for (const FName& Id : Data->VehicleOrder)
	{
		const FCADVehicleRow& R = Data->Vehicles[Id];
		float W = static_cast<float>(R.TrafficWeight);
		if (W <= 0.f) continue;
		if ((D == ECADDistrict::Industrial || D == ECADDistrict::Airport) && (R.Category == TEXT("Truck") || R.Category == TEXT("Van") || R.Category == TEXT("Pickup"))) W *= 3.f;
		if (D == ECADDistrict::Suburb && (R.Category == TEXT("SUV") || R.Category == TEXT("Compact"))) W *= 1.5f;
		Table.Add({ Id, W });
		Total += W;
	}
	float Pick = FMath::FRand() * Total;
	for (const auto& P : Table)
	{
		Pick -= P.Value;
		if (Pick <= 0.f) return P.Key;
	}
	return Table.Num() ? Table.Last().Key : NAME_None;
}

ACADVehicle* UCADTrafficSubsystem::SpawnAt(FName VehicleId, const FVector& Loc, const FRotator& Rot, ECADVehicleRole Role, const FCADOwnedVehicle* Owned)
{
	UWorld* W = GetWorld();
	if (!W) return nullptr;
	FActorSpawnParameters P;
	P.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	ACADVehicle* V = W->SpawnActor<ACADVehicle>(Loc, Rot, P);
	if (!V) return nullptr;
	V->Role = Role;
	V->Configure(VehicleId, Owned);
	return V;
}

ACADVehicle* UCADTrafficSubsystem::SpawnOnLane(FName VehicleId, int32 EdgeIdx, bool bFwd, float T, int32 Lane, ECADVehicleRole Role, const FLinearColor* PaintOverride)
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* Data = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	if (!Data || !Data->Network.IsBuilt() || !Data->Network.Edges.IsValidIndex(EdgeIdx)) return nullptr;
	const FCADRoadNetwork& N = Data->Network;
	const FCADRoadEdge& E = N.Edges[EdgeIdx];
	FCADDirEdge D; D.Edge = EdgeIdx; D.bForward = bFwd;
	const FVector2D Dir = N.DirOf(D);
	const FVector2D Right(-Dir.Y, Dir.X);
	const float Off = N.LaneOffset(E, Lane);
	FVector P = N.PointOnEdge(EdgeIdx, T);
	P.X += Right.X * Off; P.Y += Right.Y * Off;
	P.Z += 95.f;
	const FRotator Rot(0.f, FMath::RadiansToDegrees(FMath::Atan2(Dir.Y, Dir.X)), 0.f);

	// reject if something is already there
	FCollisionQueryParams QP(SCENE_QUERY_STAT(CADSpawnCheck), false);
	if (GetWorld()->OverlapBlockingTestByChannel(P, Rot.Quaternion(), ECC_Pawn, FCollisionShape::MakeBox(FVector(330.f, 140.f, 90.f)), QP))
	{
		return nullptr;
	}
	if (GetWorld()->OverlapBlockingTestByChannel(P, Rot.Quaternion(), ECC_Vehicle, FCollisionShape::MakeBox(FVector(330.f, 140.f, 90.f)), QP))
	{
		return nullptr;
	}
	ACADVehicle* V = SpawnAt(VehicleId, P, Rot, Role);
	if (!V) return nullptr;
	if (PaintOverride) V->SetPaint(*PaintOverride);
	UCADVehicleDriver* Drv = NewObject<UCADVehicleDriver>(V);
	Drv->RegisterComponent();
	Drv->Lane = CADMath::Clamp(Lane, 0, CADMath::Max(0, E.LanesPerDir - 1));
	V->Driver = Drv;
	return V;
}

bool UCADTrafficSubsystem::PickSpawnSpot(float MinDist, float MaxDist, int32& OutEdge, bool& bOutFwd, float& OutT) const
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* Data = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	UCADWorldStreamer* St = GetWorld()->GetSubsystem<UCADWorldStreamer>();
	if (!Data || !St) return false;
	const FCADRoadNetwork& N = Data->Network;
	TArray<int32> Near;
	N.EdgesNear(Focus, MaxDist, Near);
	for (int32 Try = 0; Try < 14 && Near.Num() > 0; ++Try)
	{
		const int32 Ei = Near[FMath::RandRange(0, Near.Num() - 1)];
		const FCADRoadEdge& E = N.Edges[Ei];
		if (!E.IsVehicle() || E.Length < 1500.f) continue;
		const float T = FMath::FRandRange(0.25f, 0.75f);
		const FVector P = N.PointOnEdge(Ei, T);
		const float D = FVector::Dist2D(P, Focus);
		if (D < MinDist || D > MaxDist) continue;
		if (!St->IsLoadedAt(P)) continue;
		OutEdge = Ei;
		OutT = T;
		bOutFwd = E.bOneWay ? true : FMath::RandBool();
		return true;
	}
	return false;
}

void UCADTrafficSubsystem::GiveNewDestination(ACADVehicle* V)
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* Data = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	if (!Data || !V || !V->Driver) return;
	const FCADRoadNetwork& N = Data->Network;
	TArray<int32> Near;
	N.EdgesNear(V->GetActorLocation(), 240000.f, Near);
	for (int32 Try = 0; Try < 8 && Near.Num() > 0; ++Try)
	{
		const int32 Ei = Near[FMath::RandRange(0, Near.Num() - 1)];
		const FCADRoadEdge& E = N.Edges[Ei];
		if (!E.IsVehicle()) continue;
		const FVector P = N.Nodes[E.A].Pos;
		const float D = FVector::Dist2D(P, V->GetActorLocation());
		if (D < 80000.f) continue;
		if (V->Driver->PlanTo(P)) return;
	}
}

void UCADTrafficSubsystem::DespawnAll()
{
	for (ACADVehicle* V : Cars) if (V) V->Destroy();
	Cars.Reset();
}

void UCADTrafficSubsystem::Cleanup()
{
	for (int32 i = Cars.Num() - 1; i >= 0; --i)
	{
		ACADVehicle* V = Cars[i];
		if (!V) { Cars.RemoveAtSwap(i); continue; }
		const float D = FVector::Dist2D(V->GetActorLocation(), Focus);
		const bool bAdopted = V->Role == ECADVehicleRole::Player || V->Role == ECADVehicleRole::Parked || V->bPlayerDriven;
		if (bAdopted) { Cars.RemoveAtSwap(i); continue; }
		const bool bFar = D > 105000.f;
		const bool bDeadWreck = V->bWrecked && V->WreckedTime > 25.f && D > 4000.f;
		const bool bStuck = V->Driver && V->Driver->bGiveUp && D > 5000.f;
		if (bFar || bDeadWreck || bStuck)
		{
			V->Destroy();
			Cars.RemoveAtSwap(i);
		}
	}
}

void UCADTrafficSubsystem::Tick(float DeltaTime)
{
	if (!bEnabled) return;
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* Data = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	if (!Data || !Data->bLoaded) return;
	Plans = 0;

	CleanClock += DeltaTime;
	if (CleanClock > 1.0f) { CleanClock = 0.f; Cleanup(); }

	LightClock += DeltaTime;
	if (LightClock > 2.f)
	{
		LightClock = 0.f;
		for (ACADVehicle* V : Cars) if (V && !V->bPlayerDriven) V->bHeadlightsOn = (Night > 0.3f || RainFactor > 0.5f) && !V->bWrecked;
	}

	// keep every driver supplied with a destination (limited planning budget per frame)
	for (ACADVehicle* V : Cars)
	{
		if (!V || !V->Driver || V->bWrecked) continue;
		if ((V->Driver->Mode == ECADDriverMode::Idle || V->Driver->bFinished) && Plans < 2)
		{
			V->Driver->bFinished = false;
			GiveNewDestination(V);
			++Plans;
		}
	}

	SpawnClock += DeltaTime;
	const int32 Target = TargetCount();
	if (SpawnClock > 0.35f && Cars.Num() < Target)
	{
		SpawnClock = 0.f;
		int32 Edge; bool bFwd; float T;
		const float MinD = Cars.Num() < Target / 3 ? 20000.f : 42000.f;
		if (PickSpawnSpot(MinD, 90000.f, Edge, bFwd, T))
		{
			const FCADRoadEdge& E = Data->Network.Edges[Edge];
			const FVector P = Data->Network.PointOnEdge(Edge, T);
			const ECADDistrict Dist = CADTerrain::DistrictAt(P.X, P.Y);
			const FName Id = PickVehicle(Dist);
			if (Id != NAME_None)
			{
				static const FLinearColor Colors[] = { FLinearColor(0.7f, 0.7f, 0.72f), FLinearColor(0.05f, 0.05f, 0.06f), FLinearColor(0.5f, 0.5f, 0.52f),
					FLinearColor(0.55f, 0.06f, 0.05f), FLinearColor(0.05f, 0.12f, 0.3f), FLinearColor(0.85f, 0.85f, 0.85f), FLinearColor(0.1f, 0.25f, 0.15f), FLinearColor(0.6f, 0.45f, 0.2f) };
				const FLinearColor Col = Colors[FMath::RandRange(0, UE_ARRAY_COUNT(Colors) - 1)];
				const int32 Lane = FMath::RandRange(0, CADMath::Max(0, E.LanesPerDir - 1));
				const bool bPatrol = (Id == TEXT("patrol"));
				if (ACADVehicle* V = SpawnOnLane(Id, Edge, bFwd, T, Lane, bPatrol ? ECADVehicleRole::Police : ECADVehicleRole::Traffic, bPatrol ? nullptr : &Col))
				{
					V->Driver->SpeedFactor = FMath::FRandRange(0.82f, 1.0f);
					V->Driver->bObeySignals = true;
					Cars.Add(V);
					if (bPatrol) V->bSirenOn = false;
				}
			}
		}
	}
}
