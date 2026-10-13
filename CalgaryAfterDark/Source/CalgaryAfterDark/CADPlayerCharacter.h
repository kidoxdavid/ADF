#pragma once

#include "CoreMinimal.h"
#include "CADHumanoid.h"
#include "CADPlayerCharacter.generated.h"

class USpringArmComponent;
class UCameraComponent;

UCLASS()
class CALGARYAFTERDARK_API ACADPlayerCharacter : public ACADHumanoid
{
	GENERATED_BODY()
public:
	ACADPlayerCharacter();
	virtual void Tick(float DeltaSeconds) override;
	virtual void Landed(const FHitResult& Hit) override;
	virtual void ApplyDamage(float Amount) override;

	UPROPERTY() TObjectPtr<USpringArmComponent> Boom;
	UPROPERTY() TObjectPtr<UCameraComponent> Cam;

	float Stamina = 100.f;
	bool bWantsSprint = false;
	bool bInWater = false;
	float InvulnerableTime = 0.f;
	float FallSpeedAtLand = 0.f;

	void MoveInput(float Forward, float Right);
	void SetFov(float Fov);
	static constexpr int32 NumOutfits = 6;
	/** Simple character customization: six jacket/trouser/hair combinations. */
	void ApplyOutfit(int32 Index);

private:
	float LastZVelocity = 0.f;
};
