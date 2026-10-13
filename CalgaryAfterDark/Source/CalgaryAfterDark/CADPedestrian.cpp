#include "CADPedestrian.h"
#include "CADDataSubsystem.h"
#include "CADGameInstance.h"
#include "CADVehicle.h"
#include "CalgaryAfterDark.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Components/CapsuleComponent.h"

TArray<TWeakObjectPtr<ACADPedestrian>> ACADPedestrian::Registry;

ACADPedestrian::ACADPedestrian()
{
	PrimaryActorTick.bCanEverTick = true;
	AutoPossessAI = EAutoPossessAI::Disabled;
	Health = 40.f;
}

void ACADPedestrian::BeginPlay()
{
	Super::BeginPlay();
	Registry.Add(this);
}

void ACADPedestrian::EndPlay(const EEndPlayReason::Type Reason)
{
	Registry.Remove(this);
	Super::EndPlay(Reason);
}

static const FCADRoadNetwork* PedNet(const UObject* Ctx)
{
	UCADGameInstance* GI = UCADGameInstance::Get(Ctx);
	UCADDataSubsystem* D = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	return (D && D->Network.IsBuilt()) ? &D->Network : nullptr;
}

void ACADPedestrian::Setup(int32 Type, int32 InEdge, float T, int32 InSide, int32 Seed)
{
	FRandomStream R(Seed);
	Edge = InEdge;
	Side = InSide >= 0 ? 1 : -1;
	bToB = R.FRand() < 0.5f;
	static const FLinearColor Skins[] = { FLinearColor(0.55f, 0.38f, 0.28f), FLinearColor(0.35f, 0.22f, 0.15f), FLinearColor(0.8f, 0.6f, 0.5f),
		FLinearColor(0.2f, 0.12f, 0.08f), FLinearColor(0.65f, 0.48f, 0.38f) };
	static const FLinearColor Hairs[] = { FLinearColor(0.02f, 0.015f, 0.01f), FLinearColor(0.25f, 0.15f, 0.06f), FLinearColor(0.5f, 0.4f, 0.2f),
		FLinearColor(0.35f, 0.35f, 0.35f), FLinearColor(0.1f, 0.04f, 0.02f) };
	static const FLinearColor Casual[] = { FLinearColor(0.6f, 0.15f, 0.12f), FLinearColor(0.1f, 0.3f, 0.55f), FLinearColor(0.15f, 0.45f, 0.25f),
		FLinearColor(0.75f, 0.65f, 0.2f), FLinearColor(0.5f, 0.5f, 0.55f), FLinearColor(0.35f, 0.15f, 0.45f) };
	FLinearColor Shirt, Pants;
	float HeightScale = R.FRandRange(0.92f, 1.08f);
	WalkSpeed = R.FRandRange(150.f, 190.f);
	switch (Type)
	{
	case 0: Shirt = FLinearColor(0.08f, 0.09f, 0.12f); Pants = FLinearColor(0.05f, 0.05f, 0.07f); if (R.FRand() < 0.4f) Shirt = FLinearColor(0.7f, 0.72f, 0.75f); break;
	case 2: Shirt = Casual[R.RandRange(0, 5)] * 1.4f; Pants = FLinearColor(0.04f, 0.04f, 0.05f); WalkSpeed = R.FRandRange(330.f, 400.f); break;
	case 3: Shirt = FLinearColor(0.9f, 0.4f, 0.03f); Pants = FLinearColor(0.1f, 0.12f, 0.2f); break;
	default: Shirt = Casual[R.RandRange(0, 5)]; Pants = FLinearColor(0.1f, 0.14f, 0.25f) * R.FRandRange(0.5f, 1.4f); break;
	}
	SetLook(Shirt, Pants, Skins[R.RandRange(0, 4)], Hairs[R.RandRange(0, 4)], HeightScale);
	GetCharacterMovement()->MaxWalkSpeed = WalkSpeed;
	SwingScale = Type == 2 ? 1.4f : 1.f;
	IdleFor = 0.f;
	State = ECADPedState::Walk;
}

FVector ACADPedestrian::CurrentDest() const
{
	const FCADRoadNetwork* N = PedNet(this);
	if (!N || !N->Edges.IsValidIndex(Edge)) return GetActorLocation();
	const FCADRoadEdge& E = N->Edges[Edge];
	const float Node = CADMath::Clamp(N->Nodes[bToB ? E.B : E.A].Radius / E.Length, 0.f, 0.45f);
	const float T = bToB ? 1.f - Node : Node;
	return N->SidewalkPoint(Edge, T, Side);
}

bool ACADPedestrian::UnsafeToCross(const FVector& At) const
{
	for (const TWeakObjectPtr<ACADVehicle>& W : ACADVehicle::Registry)
	{
		const ACADVehicle* V = W.Get();
		if (V && FVector::Dist2D(V->GetActorLocation(), At) < 3200.f && V->SpeedKph() > 18.f) return true;
	}
	return false;
}

void ACADPedestrian::ChooseNext(int32 Node)
{
	const FCADRoadNetwork* N = PedNet(this);
	if (!N) return;
	const FCADRoadNode& Nd = N->Nodes[Node];
	TArray<int32> Options;
	const bool bOnPath = N->Edges[Edge].Kind == ECADRoadKind::Path;
	for (int32 e : Nd.Edges)
	{
		if (e == Edge && Nd.Edges.Num() > 1) continue;
		const FCADRoadEdge& E = N->Edges[e];
		if (E.Kind == ECADRoadKind::Highway || E.Kind == ECADRoadKind::Ramp || E.Kind == ECADRoadKind::Expressway) continue;
		if (E.bBridge && !bOnPath && E.Kind != ECADRoadKind::Path) continue;
		Options.Add(e);
		if (bOnPath == (E.Kind == ECADRoadKind::Path)) { Options.Add(e); Options.Add(e); }
	}
	if (Options.Num() == 0) Options.Add(Edge);
	const int32 Next = Options[FMath::RandRange(0, Options.Num() - 1)];
	const bool bFlip = FMath::FRand() < 0.4f;
	const bool bCrosses = (Next != Edge) || bFlip;
	if (bCrosses && UnsafeToCross(Nd.Pos))
	{
		State = ECADPedState::Idle;
		IdleFor = FMath::FRandRange(0.8f, 2.0f);
		StateTime = 0.f;
		bRetryNext = true;
		return;
	}
	Edge = Next;
	bToB = N->Edges[Next].A == Node;
	if (bFlip) Side = -Side;
}

void ACADPedestrian::ScanThreats()
{
	const FVector L = GetActorLocation();
	for (const TWeakObjectPtr<ACADVehicle>& W : ACADVehicle::Registry)
	{
		const ACADVehicle* V = W.Get();
		if (!V) continue;
		const float Kph = V->SpeedKph();
		if (Kph < 22.f) continue;
		const FVector VL = V->GetActorLocation();
		const float D = FVector::Dist2D(VL, L);
		if (D > 1800.f) continue;
		const FVector VDir = V->Velocity().GetSafeNormal2D();
		const FVector ToPed = (L - VL).GetSafeNormal2D();
		if (FVector::DotProduct(VDir, ToPed) > 0.75f)
		{
			// run sideways, away from the car's path
			const FVector Side2(-VDir.Y, VDir.X, 0.f);
			const float S = FVector::DotProduct(ToPed, Side2) >= 0.f ? 1.f : -1.f;
			FleeDir = (Side2 * S + ToPed * 0.3f).GetSafeNormal();
			State = ECADPedState::Flee;
			StateTime = 0.f;
			GetCharacterMovement()->MaxWalkSpeed = 640.f;
			return;
		}
	}
}

void ACADPedestrian::Collapse()
{
	Super::Collapse();
	State = ECADPedState::Down;
	StateTime = 0.f;
	GetCapsuleComponent()->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
	GetCapsuleComponent()->SetCollisionResponseToChannel(ECC_Pawn, ECR_Ignore);
	GetCapsuleComponent()->SetCollisionResponseToChannel(ECC_Vehicle, ECR_Ignore);
}

void ACADPedestrian::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const float Dt = CADMath::Min(DeltaSeconds, 0.25f);
	StateTime += Dt;

	if (State == ECADPedState::Down)
	{
		if (StateTime > 12.f) bExpired = true;
		return;
	}
	if (bDead) { Collapse(); return; }

	ThreatClock += Dt;
	if (ThreatClock > 0.3f && State != ECADPedState::Flee)
	{
		ThreatClock = 0.f;
		ScanThreats();
	}

	const FCADRoadNetwork* N = PedNet(this);
	switch (State)
	{
	case ECADPedState::Flee:
		AddMovementInput(FleeDir, 1.f);
		if (StateTime > 4.5f)
		{
			// calm down: rejoin the nearest sidewalk
			GetCharacterMovement()->MaxWalkSpeed = WalkSpeed;
			if (N)
			{
				int32 E; float T, D;
				if (N->NearestEdge(GetActorLocation(), false, E, T, D)) { Edge = E; bToB = FMath::RandBool(); }
			}
			State = ECADPedState::Walk;
			StateTime = 0.f;
		}
		break;

	case ECADPedState::Idle:
		if (StateTime > IdleFor)
		{
			State = ECADPedState::Walk;
			StateTime = 0.f;
			if (bRetryNext && N && N->Edges.IsValidIndex(Edge))
			{
				bRetryNext = false;
				const FCADRoadEdge& E = N->Edges[Edge];
				ChooseNext(bToB ? E.B : E.A);
			}
		}
		break;

	case ECADPedState::Walk:
	default:
	{
		if (!N || !N->Edges.IsValidIndex(Edge)) { bExpired = true; return; }
		const FVector Dest = CurrentDest();
		const FVector To = Dest - GetActorLocation();
		if (To.Size2D() < 160.f)
		{
			const FCADRoadEdge& E = N->Edges[Edge];
			ChooseNext(bToB ? E.B : E.A);
			break;
		}
		AddMovementInput(To.GetSafeNormal2D(), 1.f);
		WanderClock += Dt;
		if (WanderClock > 1.f)
		{
			WanderClock = 0.f;
			if (FMath::FRand() < 0.05f)
			{
				State = ECADPedState::Idle;
				IdleFor = FMath::FRandRange(3.f, 9.f);
				StateTime = 0.f;
			}
		}
		break;
	}
	}
}
