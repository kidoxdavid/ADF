#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "CADMarker.generated.h"

class UStaticMeshComponent;
class UTextRenderComponent;

/** World-space marker: ground ring + light beam + billboarded label. Used for interactions and objectives. */
UCLASS()
class CALGARYAFTERDARK_API ACADMarker : public AActor
{
	GENERATED_BODY()
public:
	ACADMarker();
	virtual void Tick(float DeltaSeconds) override;
	void Setup(const FLinearColor& Colour, float RadiusCm, const FString& Label, bool bShowBeam, float LabelHeightCm = 520.f);

	FName Key;

private:
	UPROPERTY() TObjectPtr<UStaticMeshComponent> Pad;
	UPROPERTY() TObjectPtr<UStaticMeshComponent> Beam;
	UPROPERTY() TObjectPtr<UTextRenderComponent> Label;
	float Clock = 0.f;
};
