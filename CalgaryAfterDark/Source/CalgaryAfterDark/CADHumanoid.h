#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "CADHumanoid.generated.h"

class UStaticMeshComponent;
class USceneComponent;

/**
 * Primitive-built humanoid with procedural walk/run/idle animation (no skeletal mesh or animation assets
 * required). Base for the player and pedestrians.
 */
UCLASS()
class CALGARYAFTERDARK_API ACADHumanoid : public ACharacter
{
	GENERATED_BODY()
public:
	ACADHumanoid();
	virtual void Tick(float DeltaSeconds) override;
	virtual void BeginPlay() override;

	float Health = 100.f;
	bool bDead = false;
	bool bBodyHidden = false;

	/** Colours + height scale. */
	void SetLook(const FLinearColor& Shirt, const FLinearColor& Pants, const FLinearColor& Skin, const FLinearColor& Hair, float HeightScale);
	void SetBodyVisible(bool bVisible);
	/** Lay the body down (struck by a vehicle / dead). */
	virtual void Collapse();
	virtual void ApplyDamage(float Amount);

protected:
	UPROPERTY() TObjectPtr<UStaticMeshComponent> Torso;
	UPROPERTY() TObjectPtr<UStaticMeshComponent> Head;
	UPROPERTY() TObjectPtr<UStaticMeshComponent> HairCap;
	UPROPERTY() TObjectPtr<USceneComponent> LegPivot[2];
	UPROPERTY() TObjectPtr<USceneComponent> ArmPivot[2];
	UPROPERTY() TObjectPtr<UStaticMeshComponent> LegMesh[2];
	UPROPERTY() TObjectPtr<UStaticMeshComponent> ArmMesh[2];
	UPROPERTY() TObjectPtr<USceneComponent> BodyRoot;
	float AnimPhase = 0.f;
	float CollapseAlpha = 0.f;
	bool bCollapsing = false;
	float SwingScale = 1.f;
};
