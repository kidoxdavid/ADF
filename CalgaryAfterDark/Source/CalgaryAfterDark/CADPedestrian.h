#pragma once

#include "CoreMinimal.h"
#include "CADHumanoid.h"
#include "CADPedestrian.generated.h"

UENUM()
enum class ECADPedState : uint8 { Walk, Idle, Flee, Down };

/** Sidewalk-following pedestrian with a small state machine: walk, loiter, flee from danger, go down when hit. */
UCLASS()
class CALGARYAFTERDARK_API ACADPedestrian : public ACADHumanoid
{
	GENERATED_BODY()
public:
	ACADPedestrian();
	virtual void Tick(float DeltaSeconds) override;
	virtual void Collapse() override;
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;

	static TArray<TWeakObjectPtr<ACADPedestrian>> Registry;

	ECADPedState State = ECADPedState::Walk;
	bool bExpired = false;

	/** Type: 0 office, 1 casual, 2 jogger, 3 worker, 4 resident. */
	void Setup(int32 Type, int32 InEdge, float T, int32 InSide, int32 Seed);

private:
	int32 Edge = INDEX_NONE;
	bool bToB = true;
	int32 Side = 1;
	float StateTime = 0.f;
	float IdleFor = 0.f;
	float WalkSpeed = 170.f;
	float ThreatClock = 0.f;
	float WanderClock = 0.f;
	bool bRetryNext = false;
	FVector FleeDir = FVector::ZeroVector;

	void ChooseNext(int32 Node);
	FVector CurrentDest() const;
	bool UnsafeToCross(const FVector& At) const;
	void ScanThreats();
};
