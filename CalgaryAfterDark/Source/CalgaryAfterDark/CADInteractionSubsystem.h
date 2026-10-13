#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "CADInteractionSubsystem.generated.h"

class ACADMarker;

struct FCADInteractPoint
{
	FName Id;
	FString Kind;      // Giver, Shop, Garage, Property
	FString Label;
	FVector Pos = FVector::ZeroVector;
	float RadiusCm = 1500.f;
};

/**
 * Context-sensitive interaction points (mission givers, shops, garages, properties) with world markers,
 * nearest-point prompt, and landmark discovery rewards.
 */
UCLASS()
class CALGARYAFTERDARK_API UCADInteractionSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()
public:
	static UCADInteractionSubsystem* Get(const UObject* WorldContext);
	virtual bool ShouldCreateSubsystem(UObject* Outer) const override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(UCADInteractionSubsystem, STATGROUP_Tickables); }

	bool bEnabled = false;
	TArray<FCADInteractPoint> Points;
	int32 CurrentIdx = INDEX_NONE;
	FString Prompt;
	TFunction<void(const FCADInteractPoint&)> OnActivate;

	const FCADInteractPoint* Current() const { return Points.IsValidIndex(CurrentIdx) ? &Points[CurrentIdx] : nullptr; }
	void Activate();
	void DestroyMarkers();

private:
	UPROPERTY() TMap<FName, TObjectPtr<ACADMarker>> Markers;
	float MarkerClock = 0.f;
	float DiscoverClock = 0.f;
	bool bBuilt = false;
	void Build();
	void UpdateMarkers(const FVector& Focus);
};
