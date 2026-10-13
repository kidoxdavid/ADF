#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "CADPedestrianSubsystem.generated.h"

class ACADPedestrian;

/** Spawns, simulates (distance-throttled) and despawns pedestrians around the player. */
UCLASS()
class CALGARYAFTERDARK_API UCADPedestrianSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()
public:
	virtual bool ShouldCreateSubsystem(UObject* Outer) const override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(UCADPedestrianSubsystem, STATGROUP_Tickables); }

	bool bEnabled = false;
	FVector Focus = FVector::ZeroVector;
	float Night = 0.f;

	bool AnyPedNear(const FVector& P, float Radius) const;
	void DespawnAll();
	int32 NumPeds() const { return Peds.Num(); }
	int32 TargetCount() const;

private:
	UPROPERTY() TArray<TObjectPtr<ACADPedestrian>> Peds;
	float SpawnClock = 0.f;
	float CleanClock = 0.f;
	int32 SeedCounter = 1;
	void TrySpawn();
};
