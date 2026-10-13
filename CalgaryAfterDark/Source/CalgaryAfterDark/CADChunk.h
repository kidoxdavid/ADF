#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "CADTypes.h"
#include "CADChunk.generated.h"

class UInstancedStaticMeshComponent;
class UProceduralMeshComponent;
class UStaticMeshComponent;
class UStaticMesh;
class UMaterialInterface;
class UCADAssets;
class UCADDataSubsystem;
class FCADRoadNetwork;

struct FCADSignalVisual
{
	int32 Node = INDEX_NONE;
	int32 Edge = INDEX_NONE;
	TWeakObjectPtr<UStaticMeshComponent> Lamp;
	int8 LastState = -1;
};

/**
 * One 500 m x 500 m streamed cell of Calgary. Everything inside is generated procedurally from the road graph
 * and the terrain model, one build step per call so streaming never hitches. Created and destroyed by
 * UCADWorldStreamer as the player moves (our runtime equivalent of World Partition cells).
 */
UCLASS()
class CALGARYAFTERDARK_API ACADChunk : public AActor
{
	GENERATED_BODY()
public:
	ACADChunk();

	static constexpr float ChunkSize = 50000.f; // 500 m
	static constexpr int32 NumSteps = 6;

	FIntPoint Coord = FIntPoint::ZeroValue;
	int32 NextStep = 0;
	bool bTerrainReady = false;
	TArray<FVector> Lamps;

	void Init(FIntPoint InCoord);
	bool IsFullyBuilt() const { return NextStep >= NumSteps; }
	/** Executes one generation step. Returns true when all steps are done. */
	bool BuildNextStep();
	FVector Centre() const { return FVector((Coord.X + 0.5f) * ChunkSize, (Coord.Y + 0.5f) * ChunkSize, 0.f); }
	bool Contains(const FVector& P) const;

	virtual void Tick(float DeltaSeconds) override;

private:
	UPROPERTY() TObjectPtr<UProceduralMeshComponent> Terrain;
	UPROPERTY() TArray<TObjectPtr<UInstancedStaticMeshComponent>> AllIsms;
	UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> FoamIsm;

	TMap<uint64, UInstancedStaticMeshComponent*> IsmMap;
	TMap<UInstancedStaticMeshComponent*, TArray<FTransform>> Pending;
	TArray<FCADSignalVisual> Signals;
	TArray<FVector4> Placed;   // x,y,z,radius of buildings/props placed in this chunk
	struct FFoam { FVector Origin; FVector2D Dir; float Length; float Phase; int32 Index; };
	TArray<FFoam> Foam;
	float FoamClock = 0.f;
	float SignalClock = 0.f;

	UCADAssets* Assets = nullptr;
	UCADDataSubsystem* Data = nullptr;
	const FCADRoadNetwork* Net = nullptr;
	TArray<UMaterialInterface*> WallPalette;
	TArray<UMaterialInterface*> HousePalette;

	// primitive helpers
	UInstancedStaticMeshComponent* GetIsm(UStaticMesh* Mesh, UMaterialInterface* Mat, bool bCollision, bool bShadow, float CullEnd);
	void Box(UMaterialInterface* Mat, const FVector& Centre, const FVector& SizeCm, const FRotator& Rot, bool bCollision = true, bool bShadow = true, float CullEnd = 0.f);
	void Cylinder(UMaterialInterface* Mat, const FVector& Centre, float DiaCm, float HeightCm, bool bCollision = true, bool bShadow = true, float CullEnd = 0.f);
	void Ball(UMaterialInterface* Mat, const FVector& Centre, const FVector& SizeCm, bool bCollision = false);
	UStaticMeshComponent* MakeStaticMesh(UStaticMesh* Mesh, UMaterialInterface* Mat, const FVector& Loc, const FVector& Scale, const FRotator& Rot);
	void AddText(const FString& Text, const FVector& Loc, const FRotator& Rot, float WorldSize, const FColor& Col);
	void FlushPending();
	bool PlaceCheck(const FVector& P, float Radius) const;

	// generation steps
	void StepTerrain();
	void StepRoads();
	void StepSidewalksAndFurniture();
	void StepBuildings();
	void StepProps();
	void StepWaterAndBounds();

	void AddBuilding(const FVector& Base, float Yaw, float SX, float SY, float H, int32 PaletteIdx, FRandomStream& R, bool bGlass);
	void AddHouse(const FVector& Base, float Yaw, FRandomStream& R);
	void AddWindowBands(const FVector& Base, float Yaw, float SX, float SY, float H, FRandomStream& R, float BandH, float Coverage);
	void AddStorefronts();
};
