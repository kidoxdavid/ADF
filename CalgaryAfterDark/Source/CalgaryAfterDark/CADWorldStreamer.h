#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "CADWorldStreamer.generated.h"

class AActor;

class ACADChunk;
class UPointLightComponent;

/**
 * Distance-based cell streaming of the procedural city (our runtime stand-in for World Partition).
 * Chunks are spawned nearest-first, built a step at a time, and destroyed when far away.
 */
UCLASS()
class CALGARYAFTERDARK_API UCADWorldStreamer : public UTickableWorldSubsystem
{
	GENERATED_BODY()
public:
	virtual bool ShouldCreateSubsystem(UObject* Outer) const override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(UCADWorldStreamer, STATGROUP_Tickables); }

	bool bEnabled = false;
	FVector Focus = FVector::ZeroVector;
	float Night = 0.f;   // 0..1, driven by the environment subsystem

	void SetFocus(const FVector& F) { Focus = F; }
	/** True once every chunk touching the circle has its terrain collision generated. */
	bool IsAreaReady(const FVector& P, float Radius) const;
	bool IsLoadedAt(const FVector& P) const;
	int32 NumLoaded() const { return Chunks.Num(); }
	int32 NumBuilding() const;
	float LoadRadius() const;

private:
	UPROPERTY() TMap<FIntPoint, TObjectPtr<ACADChunk>> Chunks;
	UPROPERTY() TObjectPtr<AActor> LightHost;
	UPROPERTY() TArray<TObjectPtr<UPointLightComponent>> LampLights;
	float LightClock = 0.f;

	void UpdateLampLights();
	static float DistToChunk(const FVector& P, FIntPoint C);
};
