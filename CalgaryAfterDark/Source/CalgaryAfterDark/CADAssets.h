#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "CADAssets.generated.h"

class UStaticMesh;
class UMaterialInterface;
class UMaterialInstanceDynamic;

/**
 * Engine primitives + shared dynamic materials. The game ships no binary art: everything visible is
 * built from /Engine/BasicShapes. If /Game/Materials/M_CAD_Lit exists (created once by the CADSetup
 * commandlet) it is used for full PBR + emissive; otherwise the engine BasicShapeMaterial is used
 * (colour only).
 */
UCLASS()
class CALGARYAFTERDARK_API UCADAssets : public UObject
{
	GENERATED_BODY()
public:
	UCADAssets();

	UPROPERTY() TObjectPtr<UStaticMesh> Cube;
	UPROPERTY() TObjectPtr<UStaticMesh> Sphere;
	UPROPERTY() TObjectPtr<UStaticMesh> Cylinder;
	UPROPERTY() TObjectPtr<UStaticMesh> Cone;
	UPROPERTY() TObjectPtr<UStaticMesh> Plane;
	UPROPERTY() TObjectPtr<UMaterialInterface> FallbackMat;
	UPROPERTY() TObjectPtr<UMaterialInterface> LitMat;
	UPROPERTY() TObjectPtr<UMaterialInterface> WaterMat;
	UPROPERTY() TMap<uint32, TObjectPtr<UMaterialInstanceDynamic>> Cache;

	// Shared, globally-animated materials
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> WindowLit;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> WindowDark;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> LampGlow;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> SigRed;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> SigYellow;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> SigGreen;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> Water;

	bool bFullMaterials = false;

	void InitMaterials();
	UMaterialInstanceDynamic* Color(const FLinearColor& C, float Emissive = 0.f, float Metallic = 0.f, float Roughness = 0.75f);
	UMaterialInstanceDynamic* MakeUnique(const FLinearColor& C, float Emissive = 0.f, float Metallic = 0.f, float Roughness = 0.75f);
	/** 0 = day, 1 = deep night. */
	void SetNight(float Night01);
};

/** Convenience accessor (via the game instance). */
CALGARYAFTERDARK_API UCADAssets* CADAssets(const UObject* WorldContext);
