#include "CADVehicleDriver.h"
#include "CADVehicle.h"
#include "CADDataSubsystem.h"
#include "CADGameInstance.h"
#include "CalgaryAfterDark.h"
#include "Engine/World.h"

UCADVehicleDriver::UCADVehicleDriver()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.TickGroup = TG_PrePhysics;
}

ACADVehicle* UCADVehicleDriver::Veh() const { return Cast<ACADVehicle>(GetOwner()); }

const FCADRoadNetwork* UCADVehicleDriver::Net() const
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* D = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	return (D && D->Network.IsBuilt()) ? &D->Network : nullptr;
}

void UCADVehicleDriver::Stop()
{
	Mode = ECADDriverMode::Idle;
	Path.Reset();
	Route.Reset();
}

void UCADVehicleDriver::SetRoute(const TArray<FCADDirEdge>& InRoute)
{
	Route = InRoute;
	const FCADRoadNetwork* N = Net();
	ACADVehicle* V = Veh();
	if (!N || !V || Route.Num() == 0) { Path.Reset(); return; }
	N->BuildLanePath(Route, Lane, Path);
	// start at the first point that is ahead of the vehicle
	PathIdx = 0;
	const FVector Loc = V->GetActorLocation();
	const FVector Fwd = V->GetActorForwardVector();
	float Best = TNumericLimits<float>::Max();
	for (int32 i = 0; i < CADMath::Min(Path.Num(), 6); ++i)
	{
		const FVector D = Path[i].Pos - Loc;
		const float Dist = D.Size2D();
		if (FVector::DotProduct(D.GetSafeNormal2D(), Fwd) > 0.2f && Dist < Best) { Best = Dist; PathIdx = i; }
	}
	bFinished = false;
	Mode = ECADDriverMode::FollowRoute;
}

bool UCADVehicleDriver::PlanTo(const FVector& Dest)
{
	const FCADRoadNetwork* N = Net();
	ACADVehicle* V = Veh();
	if (!N || !V) return false;
	TArray<FCADDirEdge> R;
	if (!N->FindRouteBetween(V->GetActorLocation(), V->GetActorForwardVector(), Dest, R)) return false;
	LastGoal = Dest;
	SetRoute(R);
	return true;
}

bool UCADVehicleDriver::PlanVia(const TArray<FVector>& Waypoints)
{
	const FCADRoadNetwork* N = Net();
	ACADVehicle* V = Veh();
	if (!N || !V || Waypoints.Num() == 0) return false;
	TArray<FCADDirEdge> Full;
	FCADDirEdge Cur; float T;
	if (!N->ProjectToLane(V->GetActorLocation(), V->GetActorForwardVector(), Cur, T)) return false;
	Full.Add(Cur);
	for (const FVector& W : Waypoints)
	{
		const int32 Goal = N->NearestNode(W, true);
		if (Goal == INDEX_NONE) continue;
		if (N->ToNode(Cur) == Goal) continue;
		TArray<FCADDirEdge> Seg;
		if (!N->FindRoute(Cur, Goal, Seg)) continue;
		for (int32 i = 1; i < Seg.Num(); ++i) Full.Add(Seg[i]);
		Cur = Seg.Last();
	}
	LastGoal = Waypoints.Last();
	SetRoute(Full);
	return Full.Num() > 0;
}

void UCADVehicleDriver::StartPursuit(AActor* InTarget, float InSpeedFactor)
{
	Target = InTarget;
	SpeedFactor = InSpeedFactor;
	Mode = ECADDriverMode::Pursue;
	bObeySignals = false;
	ReplanClock = 99.f;
}

float UCADVehicleDriver::RouteRemainingCm() const
{
	float D = 0.f;
	for (int32 i = CADMath::Max(0, PathIdx); i + 1 < Path.Num(); ++i) D += FVector::Dist2D(Path[i].Pos, Path[i + 1].Pos);
	return D;
}

void UCADVehicleDriver::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);
	ACADVehicle* V = Veh();
	if (!V || !V->bConfigured) return;
	if (V->bPlayerDriven) return;
	if (V->bWrecked || Mode == ECADDriverMode::Idle)
	{
		V->InThrottle = 0.f; V->InSteer = 0.f; V->InBrake = 0.6f; V->InHandbrake = 0.f;
		return;
	}
	const float Dt = CADMath::Clamp(DeltaTime, 0.001f, 0.1f);
	if (Mode == ECADDriverMode::FollowRoute) DriveFollow(Dt);
	else DrivePursue(Dt);
}

void UCADVehicleDriver::ApplySpeed(float DesiredCms, float CurrentCms)
{
	ACADVehicle* V = Veh();
	const float Err = DesiredCms - CurrentCms;
	if (Err > 0.f)
	{
		V->InThrottle = CADMath::Clamp(Err / 500.f, 0.f, 1.f);
		V->InBrake = 0.f;
	}
	else
	{
		V->InThrottle = 0.f;
		V->InBrake = CADMath::Clamp(-Err / 450.f, 0.f, 1.f);
	}
	V->InHandbrake = 0.f;
}

float UCADVehicleDriver::ObstacleSpeed(float CurrentCms, bool bIgnoreTarget) const
{
	ACADVehicle* V = Veh();
	const FVector Fwd = V->GetActorForwardVector();
	const float HalfLen = V->Spec.LengthM * 50.f;
	const float Look = CADMath::Clamp(600.f + CurrentCms * 1.5f, 700.f, 5500.f);
	const FVector Start = V->GetActorLocation() + Fwd * HalfLen + FVector(0, 0, 20.f);
	const FVector End = Start + Fwd * Look;
	FCollisionQueryParams QP(SCENE_QUERY_STAT(CADDriverSweep), false, V);
	if (bIgnoreTarget && Target.IsValid()) QP.AddIgnoredActor(Target.Get());
	FCollisionObjectQueryParams OQP;
	OQP.AddObjectTypesToQuery(ECC_Vehicle);
	OQP.AddObjectTypesToQuery(ECC_Pawn);
	FHitResult Hit;
	const FCollisionShape Shape = FCollisionShape::MakeBox(FVector(30.f, V->Spec.WidthM * 45.f, 55.f));
	if (GetWorld()->SweepSingleByObjectType(Hit, Start, End, V->GetActorQuat(), OQP, Shape, QP))
	{
		float OtherSpeed = 0.f;
		if (ACADVehicle* OV = Cast<ACADVehicle>(Hit.GetActor()))
		{
			if (V->Role == ECADVehicleRole::Police && OV->Role == ECADVehicleRole::Police) {}
			OtherSpeed = CADMath::Max(0.f, FVector::DotProduct(OV->Velocity(), Fwd));
		}
		else if (AActor* A = Hit.GetActor())
		{
			OtherSpeed = CADMath::Max(0.f, FVector::DotProduct(A->GetVelocity(), Fwd));
		}
		const float Gap = Hit.Distance;
		if (Gap < 450.f) return 0.f;
		return OtherSpeed + FMath::Sqrt(2.f * 420.f * (Gap - 450.f));
	}
	return TNumericLimits<float>::Max();
}

void UCADVehicleDriver::HandleStuck(float Dt, float DesiredCms, float CurrentCms)
{
	ACADVehicle* V = Veh();
	if (ReverseTime > 0.f)
	{
		ReverseTime -= Dt;
		V->InThrottle = -0.8f;
		V->InBrake = 0.f;
		V->InSteer = -V->InSteer;
		return;
	}
	if (CurrentCms < 40.f && DesiredCms > 250.f) StuckTime += Dt; else StuckTime = 0.f;
	if (StuckTime > 4.5f)
	{
		StuckTime = 0.f;
		++StuckCount;
		ReverseTime = 1.6f;
		if (StuckCount >= 4) bGiveUp = true;
	}
	if (CurrentCms > 400.f) StuckCount = 0;
}

void UCADVehicleDriver::DriveFollow(float Dt)
{
	ACADVehicle* V = Veh();
	const FCADRoadNetwork* N = Net();
	if (!N || Path.Num() < 2)
	{
		V->InThrottle = 0.f; V->InBrake = 0.5f;
		return;
	}
	const FVector Loc = V->GetActorLocation();
	const FVector Fwd = V->GetActorForwardVector();
	const float Cur = CADMath::Max(0.f, V->ForwardSpeedMps() * 100.f);

	// advance along the path
	while (PathIdx < Path.Num() - 1)
	{
		const FVector D = Path[PathIdx].Pos - Loc;
		if (D.Size2D() < 650.f || (FVector::DotProduct(D.GetSafeNormal2D(), Fwd) < -0.2f && D.Size2D() < 2500.f)) ++PathIdx;
		else break;
	}
	if (PathIdx >= Path.Num() - 1 && FVector::Dist2D(Loc, Path.Last().Pos) < 900.f)
	{
		if (!bFinished)
		{
			bFinished = true;
			OnRouteFinished.Broadcast(this);
		}
		ApplySpeed(0.f, Cur);
		V->InSteer = 0.f;
		return;
	}

	// pure pursuit target
	const float Look = CADMath::Clamp(Cur * 0.75f, 900.f, 3200.f);
	int32 T = PathIdx;
	while (T < Path.Num() - 1 && FVector::Dist2D(Loc, Path[T].Pos) < Look) ++T;
	const FVector ToT = Path[T].Pos - Loc;
	const float Local_X = FVector::DotProduct(ToT, Fwd);
	const float Local_Y = FVector::DotProduct(ToT, V->GetActorRightVector());
	const float Ang = FMath::RadiansToDegrees(FMath::Atan2(Local_Y, CADMath::Max(Local_X, 1.f)));
	V->InSteer = CADMath::Clamp(Ang / CADMath::Max(18.f, V->Spec.MaxSteerDeg * 0.7f), -1.f, 1.f);

	// speed plan: posted limit, upcoming slower points (comfortable braking), signals, obstacles
	float Desired = Path[PathIdx].SpeedKph / 0.036f * SpeedFactor;
	float Dist = 0.f;
	FVector Prev = Loc;
	for (int32 i = PathIdx; i < Path.Num() && Dist < 6000.f; ++i)
	{
		Dist += FVector::Dist2D(Prev, Path[i].Pos);
		Prev = Path[i].Pos;
		const float PtSpeed = Path[i].SpeedKph / 0.036f * SpeedFactor;
		Desired = CADMath::Min(Desired, FMath::Sqrt(PtSpeed * PtSpeed + 2.f * 380.f * Dist));
		if (bObeySignals && Path[i].StopNode != INDEX_NONE)
		{
			const ECADSignalState S = N->SignalState(Path[i].StopNode, Path[i].StopEdge, GetWorld()->GetTimeSeconds());
			const float StopDist = Dist - 150.f;
			const bool bCanStopYellow = StopDist > (Cur * Cur) / (2.f * 500.f);
			if (S == ECADSignalState::Red || (S == ECADSignalState::Yellow && bCanStopYellow))
			{
				if (StopDist > -200.f) Desired = CADMath::Min(Desired, FMath::Sqrt(2.f * 380.f * CADMath::Max(0.f, StopDist)));
			}
		}
	}
	if (FMath::Abs(Ang) > 22.f) Desired = CADMath::Min(Desired, 900.f);
	Desired = CADMath::Min(Desired, ObstacleSpeed(Cur, false));

	ApplySpeed(Desired, Cur);
	HandleStuck(Dt, Desired, Cur);
}

void UCADVehicleDriver::DrivePursue(float Dt)
{
	ACADVehicle* V = Veh();
	AActor* Tg = Target.Get();
	const FCADRoadNetwork* N = Net();
	if (!Tg || !N) { V->InBrake = 0.5f; V->InThrottle = 0.f; return; }
	const FVector Loc = V->GetActorLocation();
	const FVector Fwd = V->GetActorForwardVector();
	const float Cur = CADMath::Max(0.f, V->ForwardSpeedMps() * 100.f);
	const FVector TLoc = Tg->GetActorLocation();
	const float Dist = FVector::Dist2D(Loc, TLoc);

	// direct pursuit when close with a clear line, otherwise follow the road route to the target
	bool bDirect = false;
	if (Dist < 4500.f)
	{
		FHitResult H;
		FCollisionQueryParams QP(SCENE_QUERY_STAT(CADPursuitLOS), false, V);
		QP.AddIgnoredActor(Tg);
		bDirect = !GetWorld()->LineTraceSingleByChannel(H, Loc + FVector(0, 0, 80.f), TLoc + FVector(0, 0, 80.f), ECC_Visibility, QP);
	}
	if (bDirect)
	{
		const FVector Lead = TLoc + Tg->GetVelocity() * 0.35f;
		const FVector ToT = Lead - Loc;
		const float LX = FVector::DotProduct(ToT, Fwd);
		const float LY = FVector::DotProduct(ToT, V->GetActorRightVector());
		const float Ang = FMath::RadiansToDegrees(FMath::Atan2(LY, LX));
		float Steer = CADMath::Clamp(Ang / CADMath::Max(18.f, V->Spec.MaxSteerDeg * 0.8f), -1.f, 1.f);
		if (LX < 0.f) Steer = LY >= 0.f ? 1.f : -1.f;   // target behind: full lock to turn around
		V->InSteer = Steer;
		float Desired = V->Spec.TopSpeedKph / 0.036f * SpeedFactor;
		const float TargetSpeed = Tg->GetVelocity().Size();
		if (Dist < 1800.f) Desired = CADMath::Min(Desired, CADMath::Max(TargetSpeed * 1.15f + 300.f, 600.f));
		if (Dist < 700.f && TargetSpeed < 300.f) Desired = 0.f;       // box in a stopped target
		if (FMath::Abs(Ang) > 50.f) Desired = CADMath::Min(Desired, 1200.f);
		Desired = CADMath::Min(Desired, ObstacleSpeed(Cur, !bAvoidTarget) );
		if (LX < 0.f) Desired = CADMath::Min(Desired, 700.f);
		ApplySpeed(Desired, Cur);
		HandleStuck(Dt, Desired, Cur);
		return;
	}

	ReplanClock += Dt;
	if (ReplanClock > 1.8f || FVector::Dist2D(LastPlannedTarget, TLoc) > 6000.f || Path.Num() < 2)
	{
		ReplanClock = 0.f;
		LastPlannedTarget = TLoc;
		TArray<FCADDirEdge> R;
		if (N->FindRouteBetween(Loc, Fwd, TLoc, R))
		{
			Route = R;
			N->BuildLanePath(Route, Lane, Path);
			PathIdx = 0;
			for (int32 i = 0; i < CADMath::Min(Path.Num(), 6); ++i)
			{
				const FVector D = Path[i].Pos - Loc;
				if (FVector::DotProduct(D.GetSafeNormal2D(), Fwd) > 0.2f) { PathIdx = i; break; }
			}
		}
	}
	const bool bWasObey = bObeySignals;
	bObeySignals = false;
	const float OldSF = SpeedFactor;
	SpeedFactor = CADMath::Max(SpeedFactor, 1.25f);
	DriveFollow(Dt);
	SpeedFactor = OldSF;
	bObeySignals = bWasObey;
	bFinished = false;
}
