#include "CADMarker.h"
#include "CADAssets.h"
#include "Camera/PlayerCameraManager.h"
#include "Components/StaticMeshComponent.h"
#include "Components/TextRenderComponent.h"
#include "Kismet/GameplayStatics.h"
#include "UObject/ConstructorHelpers.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Engine/StaticMesh.h"

ACADMarker::ACADMarker()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickInterval = 0.03f;
	USceneComponent* Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(Root);
	static ConstructorHelpers::FObjectFinder<UStaticMesh> CylF(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	Pad = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Pad"));
	Pad->SetStaticMesh(CylF.Object);
	Pad->SetupAttachment(Root);
	Pad->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Pad->SetCastShadow(false);
	Beam = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Beam"));
	Beam->SetStaticMesh(CylF.Object);
	Beam->SetupAttachment(Root);
	Beam->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Beam->SetCastShadow(false);
	Label = CreateDefaultSubobject<UTextRenderComponent>(TEXT("Label"));
	Label->SetupAttachment(Root);
	Label->SetHorizontalAlignment(EHTA_Center);
	Label->SetVerticalAlignment(EVRTA_TextCenter);
	Label->SetWorldSize(46.f);
}

void ACADMarker::Setup(const FLinearColor& Colour, float RadiusCm, const FString& Text, bool bShowBeam, float LabelHeightCm)
{
	UCADAssets* A = CADAssets(this);
	const float R = CADMath::Clamp(RadiusCm, 150.f, 2500.f);
	if (A)
	{
		Pad->SetMaterial(0, A->Color(Colour * 0.7f, 2.5f, 0.f, 0.5f));
		Beam->SetMaterial(0, A->Color(Colour, 6.f, 0.f, 0.4f));
	}
	Pad->SetRelativeLocation(FVector(0, 0, 14.f));
	Pad->SetRelativeScale3D(FVector(R * 2.f / 100.f, R * 2.f / 100.f, 0.03f));
	Beam->SetVisibility(bShowBeam);
	Beam->SetRelativeLocation(FVector(0, 0, 1700.f));
	Beam->SetRelativeScale3D(FVector(0.5f, 0.5f, 34.f));
	Label->SetText(FText::FromString(Text));
	Label->SetTextRenderColor(Colour.ToFColor(true));
	Label->SetRelativeLocation(FVector(0, 0, LabelHeightCm));
}

void ACADMarker::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	Clock += DeltaSeconds;
	if (APlayerCameraManager* Cam = UGameplayStatics::GetPlayerCameraManager(this, 0))
	{
		const FVector To = Cam->GetCameraLocation() - Label->GetComponentLocation();
		Label->SetWorldRotation(FRotator(0.f, FMath::RadiansToDegrees(FMath::Atan2(To.Y, To.X)), 0.f));
		const float D = To.Size();
		Label->SetWorldSize(CADMath::Clamp(D * 0.035f, 40.f, 400.f));
	}
}
