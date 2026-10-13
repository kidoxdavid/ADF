#include "CADPoliceSubsystem.h"
#include "CADDataSubsystem.h"
#include "CADGameInstance.h"
#include "CADPedestrianSubsystem.h"
#include "CADTrafficSubsystem.h"
#include "CADVehicle.h"
#include "CADVehicleDriver.h"
#include "CADWorldStreamer.h"
#include "CalgaryAfterDark.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"

UCADPoliceSubsystem* UCADPoliceSubsystem::Get(const UObject* WorldContext)
{
	const UWorld* W = WorldContext ? WorldContext->GetWorld() : nullptr;
	return W ? W->GetSubsystem<UCADPoliceSubsystem>() : nullptr;
}

bool UCADPoliceSubsystem::ShouldCreateSubsystem(UObject* Outer) const
{
	const UWorld* W = Cast<UWorld>(Outer);
	return W && W->IsGameWorld();
}

AActor* UCADPoliceSubsystem::PlayerActor() const
{
	return UGameplayStatics::GetPlayerPawn(GetWorld(), 0);
}

int32 UCADPoliceSubsystem::Level() const
{
	if (Heat >= 15.f) return 5;
	if (Heat >= 10.f) return 4;
	if (Heat >= 6.f) return 3;
	if (Heat >= 3.f) return 2;
	if (Heat >= 1.f) return 1;
	return 0;
}

int32 UCADPoliceSubsystem::DesiredUnits() const
{
	static const int32 N[6] = { 0, 1, 2, 3, 4, 6 };
	return N[Level()];
}

float UCADPoliceSubsystem::SearchRadius() const
{
	if (PoliceState == ECADPoliceState::Search) return CADMath::Min(30000.f, 6000.f + UnseenTime * 1800.f);
	if (PoliceState == ECADPoliceState::Cooldown) return 30000.f;
	return 0.f;
}

bool UCADPoliceSubsystem::IsWitnessed(const FVector& Where) const
{
	for (const TWeakObjectPtr<ACADVehicle>& W : ACADVehicle::Registry)
	{
		const ACADVehicle* V = W.Get();
		if (V && V->Role == ECADVehicleRole::Police && !V->bWrecked && FVector::Dist2D(V->GetActorLocation(), Where) < 12000.f) return true;
	}
	if (UCADPedestrianSubsystem* P = GetWorld()->GetSubsystem<UCADPedestrianSubsystem>())
	{
		return P->AnyPedNear(Where, 3500.f);
	}
	return false;
}

void UCADPoliceSubsystem::ReportCrime(ECADCrime Type, const FVector& Where, bool bForceWitness)
{
	if (!bEnabled) return;
	static TMap<ECADCrime, double> Last;
	const double Now = GetWorld()->GetTimeSeconds();
	double& L = Last.FindOrAdd(Type);
	if (Now - L < 0.8) return;
	if (!bForceWitness && !IsWitnessed(Where)) return;
	L = Now;
	float Add = 0.6f;
	switch (Type)
	{
	case ECADCrime::PedestrianHit: Add = 2.2f; break;
	case ECADCrime::PoliceHit: Add = 3.0f; break;
	case ECADCrime::Carjack: Add = 2.0f; break;
	case ECADCrime::RunRedLight: Add = 0.5f; break;
	default: break;
	}
	const int32 Before = Level();
	Heat = CADMath::Min(20.f, Heat + Add);
	LastKnownPos = Where;
	if (Before == 0 && Level() > 0)
	{
		PoliceState = ECADPoliceState::Search;
		UnseenTime = 0.f;
		if (UCADGameInstance* GI = UCADGameInstance::Get(this)) GI->Toast(TEXT("WANTED - police have been alerted"));
	}
}

void UCADPoliceSubsystem::SetWantedLevel(int32 L)
{
	static const float Thr[6] = { 0.f, 1.f, 3.f, 6.f, 10.f, 15.f };
	L = CADMath::Clamp(L, 0, 5);
	Heat = Thr[L];
	if (APawn* P = Cast<APawn>(PlayerActor())) LastKnownPos = P->GetActorLocation();
	PoliceState = L > 0 ? ECADPoliceState::Search : ECADPoliceState::Clear;
	UnseenTime = 0.f;
}

void UCADPoliceSubsystem::ClearWanted(bool bSilent)
{
	Heat = 0.f;
	bSeen = false;
	PoliceState = ECADPoliceState::Clear;
	BustTimer = 0.f;
	UnseenTime = 0.f;
	DismissAll();
	(void)bSilent;
}

void UCADPoliceSubsystem::DismissAll()
{
	for (ACADVehicle* V : Cops)
	{
		if (!V) continue;
		V->bSirenOn = false;
		if (V->Driver)
		{
			V->Driver->Stop();
			V->Driver->bObeySignals = true;
			V->Driver->SpeedFactor = 0.85f;
		}
		Dismissed.Add(V);
	}
	Cops.Reset();
	// ambient patrol cars simply go back to normal traffic duty
	for (const TWeakObjectPtr<ACADVehicle>& W : Adopted)
	{
		if (ACADVehicle* V = W.Get())
		{
			V->bSirenOn = false;
			if (V->Driver) { V->Driver->Stop(); V->Driver->bObeySignals = true; V->Driver->SpeedFactor = 0.9f; }
		}
	}
	Adopted.Reset();
}

void UCADPoliceSubsystem::Escape()
{
	Heat = 0.f;
	PoliceState = ECADPoliceState::Clear;
	DismissAll();
	if (UCADGameInstance* GI = UCADGameInstance::Get(this)) GI->Toast(TEXT("Wanted level lost - you got away"));
	OnEscaped.Broadcast();
}

void UCADPoliceSubsystem::SpawnUnit()
{
	UCADTrafficSubsystem* Traffic = GetWorld()->GetSubsystem<UCADTrafficSubsystem>();
	AActor* P = PlayerActor();
	if (!Traffic || !P) return;
	int32 Edge; bool bFwd; float T;
	Traffic->Focus = P->GetActorLocation();
	if (!Traffic->PickSpawnSpot(38000.f, 62000.f, Edge, bFwd, T)) return;
	ACADVehicle* V = Traffic->SpawnOnLane(TEXT("patrol"), Edge, bFwd, T, 0, ECADVehicleRole::Police);
	if (!V) return;
	V->bSirenOn = true;
	V->bHeadlightsOn = true;
	Cops.Add(V);
	if (bSeen) V->Driver->StartPursuit(P, 0.95f + 0.06f * Level());
	else V->Driver->PlanTo(LastKnownPos);
}

void UCADPoliceSubsystem::UpdateSight(float Dt)
{
	AActor* P = PlayerActor();
	if (!P) return;
	const FVector PL = P->GetActorLocation();
	bool bAny = false;
	TArray<ACADVehicle*> All;
	for (ACADVehicle* V : Cops) All.Add(V);
	for (const TWeakObjectPtr<ACADVehicle>& W : Adopted) if (W.IsValid()) All.Add(W.Get());
	for (ACADVehicle* V : All)
	{
		if (!V || V->bWrecked) continue;
		const float D = FVector::Dist(V->GetActorLocation(), PL);
		if (D > 9000.f) continue;
		FHitResult H;
		FCollisionQueryParams QP(SCENE_QUERY_STAT(CADPoliceSight), false, V);
		QP.AddIgnoredActor(P);
		const bool bBlocked = GetWorld()->LineTraceSingleByChannel(H, V->GetActorLocation() + FVector(0, 0, 120.f), PL + FVector(0, 0, 80.f), ECC_Visibility, QP);
		if (!bBlocked) { bAny = true; break; }
	}
	bSeen = bAny;
	if (bSeen) LastKnownPos = PL;
}

void UCADPoliceSubsystem::RouteSearchers()
{
	AActor* P = PlayerActor();
	if (!P) return;
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* Data = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	TArray<ACADVehicle*> All;
	for (ACADVehicle* V : Cops) All.Add(V);
	for (const TWeakObjectPtr<ACADVehicle>& W : Adopted) if (W.IsValid()) All.Add(W.Get());
	for (ACADVehicle* V : All)
	{
		if (!V || !V->Driver || V->bWrecked) continue;
		if (bSeen || UnseenTime < 2.5f)
		{
			if (V->Driver->Mode != ECADDriverMode::Pursue || V->Driver->Target.Get() != P) V->Driver->StartPursuit(P, 0.95f + 0.06f * Level());
		}
		else
		{
			if (V->Driver->Mode == ECADDriverMode::Pursue)
			{
				V->Driver->Mode = ECADDriverMode::Idle;
				V->Driver->bObeySignals = false;
				V->Driver->SpeedFactor = 0.9f;
			}
			if (V->Driver->Mode == ECADDriverMode::Idle || V->Driver->bFinished)
			{
				V->Driver->bFinished = false;
				FVector Goal = LastKnownPos;
				if (V->Driver->bFinished || FVector::Dist2D(V->GetActorLocation(), LastKnownPos) < 3000.f)
				{
					// patrol the search area
					const float R = SearchRadius();
					Goal = LastKnownPos + FVector(FMath::FRandRange(-R, R), FMath::FRandRange(-R, R), 0.f);
				}
				V->Driver->PlanTo(Goal);
			}
		}
	}
	(void)Data;
}

void UCADPoliceSubsystem::Tick(float DeltaTime)
{
	if (!bEnabled) return;
	AActor* P = PlayerActor();
	if (!P) return;
	const float Dt = CADMath::Min(DeltaTime, 0.1f);

	// tidy dismissed units
	DismissClock += Dt;
	if (DismissClock > 1.f)
	{
		DismissClock = 0.f;
		for (int32 i = Dismissed.Num() - 1; i >= 0; --i)
		{
			ACADVehicle* V = Dismissed[i].Get();
			if (!V) { Dismissed.RemoveAtSwap(i); continue; }
			if (V->Driver && (V->Driver->Mode == ECADDriverMode::Idle || V->Driver->bFinished))
			{
				V->Driver->bFinished = false;
				if (UCADTrafficSubsystem* T = GetWorld()->GetSubsystem<UCADTrafficSubsystem>())
				{
					int32 Edge; bool Fwd; float Tt;
					T->Focus = P->GetActorLocation();
					if (T->PickSpawnSpot(60000.f, 100000.f, Edge, Fwd, Tt)) V->Driver->PlanTo(V->Driver->LastGoal.IsZero() ? P->GetActorLocation() : V->Driver->LastGoal);
				}
			}
			if (FVector::Dist2D(V->GetActorLocation(), P->GetActorLocation()) > 55000.f) { V->Destroy(); Dismissed.RemoveAtSwap(i); }
		}
	}

	const int32 Lvl = Level();
	if (Lvl == 0)
	{
		PoliceState = ECADPoliceState::Clear;
		BustTimer = 0.f;
		bSeen = false;
		// patrol cars still witness crimes
		return;
	}

	// adopt nearby ambient patrol cars
	PatrolClock += Dt;
	if (PatrolClock > 1.f)
	{
		PatrolClock = 0.f;
		for (const TWeakObjectPtr<ACADVehicle>& W : ACADVehicle::Registry)
		{
			ACADVehicle* V = W.Get();
			if (!V || V->Role != ECADVehicleRole::Police || V->bWrecked || Cops.Contains(V)) continue;
			if (FVector::Dist2D(V->GetActorLocation(), P->GetActorLocation()) < 60000.f && !Adopted.Contains(V))
			{
				V->bSirenOn = true;
				Adopted.Add(V);
			}
		}
	}

	// reinforcements
	SpawnClock += Dt;
	if (SpawnClock > 2.5f && Cops.Num() + Adopted.Num() < DesiredUnits())
	{
		SpawnClock = 0.f;
		SpawnUnit();
	}
	// remove lost/destroyed/too-far units so they can be replaced
	for (int32 i = Cops.Num() - 1; i >= 0; --i)
	{
		ACADVehicle* V = Cops[i];
		if (!V) { Cops.RemoveAtSwap(i); continue; }
		const float D = FVector::Dist2D(V->GetActorLocation(), P->GetActorLocation());
		if (D > 110000.f || (V->bWrecked && V->WreckedTime > 15.f && D > 4000.f) || (V->Driver && V->Driver->bGiveUp && D > 5000.f))
		{
			V->Destroy();
			Cops.RemoveAtSwap(i);
		}
	}

	// sight / dispatch awareness
	SightClock += Dt;
	if (SightClock > 0.25f)
	{
		SightClock = 0.f;
		UpdateSight(0.25f);
		RouteSearchers();
	}
	if (bSeen)
	{
		PoliceState = ECADPoliceState::Pursuit;
		UnseenTime = 0.f;
	}
	else
	{
		UnseenTime += Dt;
		PoliceState = UnseenTime < 12.f ? ECADPoliceState::Search : ECADPoliceState::Cooldown;
		if (UnseenTime > 8.f) Heat = CADMath::Max(0.f, Heat - Dt * 0.16f);
		if (Heat <= 0.f) { Escape(); return; }
	}

	// arrest: a unit stays beside a stationary / on-foot player while they are seen
	bool bHeld = false;
	if (bSeen)
	{
		float PlayerKph = 0.f;
		bool bOnFoot = true;
		if (const ACADVehicle* PV = Cast<ACADVehicle>(P)) { PlayerKph = PV->SpeedKph(); bOnFoot = false; }
		if (bOnFoot || PlayerKph < 15.f)
		{
			TArray<ACADVehicle*> All;
			for (ACADVehicle* V : Cops) All.Add(V);
			for (const TWeakObjectPtr<ACADVehicle>& W : Adopted) if (W.IsValid()) All.Add(W.Get());
			for (ACADVehicle* V : All)
			{
				if (V && !V->bWrecked && FVector::Dist(V->GetActorLocation(), P->GetActorLocation()) < 1100.f) { bHeld = true; break; }
			}
		}
	}
	BustTimer = bHeld ? BustTimer + Dt : CADMath::Max(0.f, BustTimer - Dt * 2.f);
	if (BustTimer > 2.5f)
	{
		BustTimer = 0.f;
		OnBusted.Broadcast();
	}
}
