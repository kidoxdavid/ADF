#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "CADTypes.h"
#include "CADTrafficSubsystem.generated.h"

class ACADVehicle;

/** Ambient traffic: spawns, routes and despawns lane-following vehicles around the player. */
UCLASS()
class CALGARYAFTERDARK_API UCADTrafficSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()
public:
	virtual bool ShouldCreateSubsystem(UObject* Outer) const override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(UCADTrafficSubsystem, STATGROUP_Tickables); }

	bool bEnabled = false;
	FVector Focus = FVector::ZeroVector;
	float Night = 0.f;
	float RainFactor = 0.f;
	/** Extra density multiplier requested by missions (e.g. highway pressure). */
	float DensityBoost = 1.f;

	/** Spawns a vehicle on a lane of an edge and gives it a driver. Returns null if the spot is blocked. */
	ACADVehicle* SpawnOnLane(FName VehicleId, int32 Edge, bool bForward, float T, int32 Lane, ECADVehicleRole Role, const FLinearColor* PaintOverride = nullptr);
	/** Spawns a bare (undriven) vehicle at a transform. */
	ACADVehicle* SpawnAt(FName VehicleId, const FVector& Loc, const FRotator& Rot, ECADVehicleRole Role, const FCADOwnedVehicle* Owned = nullptr);
	void DespawnAll();
	int32 NumTraffic() const { return Cars.Num(); }
	int32 TargetCount() const;
	/** Finds a random lane spot between MinDist and MaxDist of the focus on a loaded chunk. */
	bool PickSpawnSpot(float MinDist, float MaxDist, int32& OutEdge, bool& bOutFwd, float& OutT) const;

private:
	UPROPERTY() TArray<TObjectPtr<ACADVehicle>> Cars;
	float SpawnClock = 0.f;
	float CleanClock = 0.f;
	float LightClock = 0.f;
	int32 Plans = 0;
	FRandomStream Rng{ 4242 };

	FName PickVehicle(ECADDistrict D) const;
	void GiveNewDestination(ACADVehicle* V);
	void Cleanup();
};
