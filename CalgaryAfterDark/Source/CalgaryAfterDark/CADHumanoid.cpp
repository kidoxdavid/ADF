#include "CADHumanoid.h"
#include "CADAssets.h"
#include "Components/CapsuleComponent.h"
#include "Components/StaticMeshComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/ConstructorHelpers.h"
#include "Engine/World.h"
#include "Engine/StaticMesh.h"

ACADHumanoid::ACADHumanoid()
{
	PrimaryActorTick.bCanEverTick = true;
	GetCapsuleComponent()->InitCapsuleSize(34.f, 90.f);
	GetMesh()->SetVisibility(false);
	GetMesh()->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	GetCharacterMovement()->bRunPhysicsWithNoController = true;
	GetCharacterMovement()->bOrientRotationToMovement = true;
	GetCharacterMovement()->RotationRate = FRotator(0.f, 540.f, 0.f);
	GetCharacterMovement()->MaxWalkSpeed = 220.f;
	GetCharacterMovement()->JumpZVelocity = 520.f;
	bUseControllerRotationYaw = false;

	static ConstructorHelpers::FObjectFinder<UStaticMesh> CubeF(TEXT("/Engine/BasicShapes/Cube.Cube"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> SphereF(TEXT("/Engine/BasicShapes/Sphere.Sphere"));

	BodyRoot = CreateDefaultSubobject<USceneComponent>(TEXT("BodyRoot"));
	BodyRoot->SetupAttachment(GetCapsuleComponent());

	auto MakePart = [&](const TCHAR* Name, UStaticMesh* Mesh, USceneComponent* Parent, const FVector& Loc, const FVector& SizeCm) -> UStaticMeshComponent*
	{
		UStaticMeshComponent* C = CreateDefaultSubobject<UStaticMeshComponent>(Name);
		C->SetStaticMesh(Mesh);
		C->SetupAttachment(Parent);
		C->SetRelativeLocation(Loc);
		C->SetRelativeScale3D(SizeCm / 100.f);
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		C->SetCastShadow(true);
		C->SetCanEverAffectNavigation(false);
		return C;
	};
	auto MakePivot = [&](const TCHAR* Name, const FVector& Loc) -> USceneComponent*
	{
		USceneComponent* P = CreateDefaultSubobject<USceneComponent>(Name);
		P->SetupAttachment(BodyRoot);
		P->SetRelativeLocation(Loc);
		return P;
	};
	UStaticMesh* Cube = CubeF.Object;
	UStaticMesh* Sphere = SphereF.Object;

	Torso = MakePart(TEXT("Torso"), Cube, BodyRoot, FVector(0, 0, 22.f), FVector(24.f, 44.f, 62.f));
	Head = MakePart(TEXT("Head"), Sphere, BodyRoot, FVector(0, 0, 70.f), FVector(22.f, 20.f, 24.f));
	HairCap = MakePart(TEXT("Hair"), Sphere, BodyRoot, FVector(-1.5f, 0, 75.f), FVector(23.f, 21.f, 14.f));
	LegPivot[0] = MakePivot(TEXT("LegPivotL"), FVector(0, -11.f, -9.f));
	LegPivot[1] = MakePivot(TEXT("LegPivotR"), FVector(0, 11.f, -9.f));
	ArmPivot[0] = MakePivot(TEXT("ArmPivotL"), FVector(0, -27.f, 48.f));
	ArmPivot[1] = MakePivot(TEXT("ArmPivotR"), FVector(0, 27.f, 48.f));
	LegMesh[0] = MakePart(TEXT("LegL"), Cube, LegPivot[0], FVector(0, 0, -39.f), FVector(17.f, 17.f, 78.f));
	LegMesh[1] = MakePart(TEXT("LegR"), Cube, LegPivot[1], FVector(0, 0, -39.f), FVector(17.f, 17.f, 78.f));
	ArmMesh[0] = MakePart(TEXT("ArmL"), Cube, ArmPivot[0], FVector(0, 0, -26.f), FVector(12.f, 12.f, 56.f));
	ArmMesh[1] = MakePart(TEXT("ArmR"), Cube, ArmPivot[1], FVector(0, 0, -26.f), FVector(12.f, 12.f, 56.f));
}

void ACADHumanoid::BeginPlay()
{
	Super::BeginPlay();
}

void ACADHumanoid::SetLook(const FLinearColor& Shirt, const FLinearColor& Pants, const FLinearColor& Skin, const FLinearColor& Hair, float HeightScale)
{
	UCADAssets* A = CADAssets(this);
	if (!A) return;
	auto Q = [](const FLinearColor& C)
	{
		return FLinearColor(FMath::RoundToFloat(C.R * 8.f) / 8.f, FMath::RoundToFloat(C.G * 8.f) / 8.f, FMath::RoundToFloat(C.B * 8.f) / 8.f, 1.f);
	};
	Torso->SetMaterial(0, A->Color(Q(Shirt), 0.f, 0.f, 0.9f));
	ArmMesh[0]->SetMaterial(0, A->Color(Q(Shirt), 0.f, 0.f, 0.9f));
	ArmMesh[1]->SetMaterial(0, A->Color(Q(Shirt), 0.f, 0.f, 0.9f));
	LegMesh[0]->SetMaterial(0, A->Color(Q(Pants), 0.f, 0.f, 0.9f));
	LegMesh[1]->SetMaterial(0, A->Color(Q(Pants), 0.f, 0.f, 0.9f));
	Head->SetMaterial(0, A->Color(Q(Skin), 0.f, 0.f, 0.8f));
	HairCap->SetMaterial(0, A->Color(Q(Hair), 0.f, 0.f, 0.9f));
	BodyRoot->SetRelativeScale3D(FVector(1.f, 1.f, HeightScale));
}

void ACADHumanoid::SetBodyVisible(bool bVisible)
{
	bBodyHidden = !bVisible;
	SetActorHiddenInGame(!bVisible);
}

void ACADHumanoid::ApplyDamage(float Amount)
{
	if (bDead || Amount <= 0.f) return;
	Health = CADMath::Max(0.f, Health - Amount);
	if (Health <= 0.f) Collapse();
}

void ACADHumanoid::Collapse()
{
	if (bCollapsing) return;
	bCollapsing = true;
	bDead = true;
	GetCharacterMovement()->DisableMovement();
}

void ACADHumanoid::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (bBodyHidden) return;

	if (bCollapsing)
	{
		CollapseAlpha = CADMath::Min(1.f, CollapseAlpha + DeltaSeconds * 3.f);
		BodyRoot->SetRelativeRotation(FRotator(-85.f * CollapseAlpha, 0.f, 0.f));
		BodyRoot->SetRelativeLocation(FVector(0, 0, -62.f * CollapseAlpha));
		return;
	}

	const float Speed = GetVelocity().Size2D();
	const bool bAir = GetCharacterMovement()->IsFalling();
	AnimPhase += DeltaSeconds * (3.f + Speed * 0.012f) * (Speed > 5.f ? 1.f : 0.f);
	const float Amp = CADMath::Clamp(Speed / 350.f, 0.f, 1.f) * (Speed > 450.f ? 70.f : 42.f) * SwingScale;
	const float S = FMath::Sin(AnimPhase * 2.f);
	if (bAir)
	{
		LegPivot[0]->SetRelativeRotation(FRotator(-25.f, 0, 0));
		LegPivot[1]->SetRelativeRotation(FRotator(15.f, 0, 0));
		ArmPivot[0]->SetRelativeRotation(FRotator(-60.f, 0, 0));
		ArmPivot[1]->SetRelativeRotation(FRotator(-60.f, 0, 0));
	}
	else
	{
		const float Breath = FMath::Sin(GetWorld()->GetTimeSeconds() * 1.6f) * 2.f;
		LegPivot[0]->SetRelativeRotation(FRotator(S * Amp, 0, 0));
		LegPivot[1]->SetRelativeRotation(FRotator(-S * Amp, 0, 0));
		ArmPivot[0]->SetRelativeRotation(FRotator(-S * Amp * 0.9f + Breath, 0, 0));
		ArmPivot[1]->SetRelativeRotation(FRotator(S * Amp * 0.9f - Breath, 0, 0));
	}
	const float Bob = FMath::Abs(S) * Amp * 0.04f;
	BodyRoot->SetRelativeLocation(FVector(0, 0, Bob));
}
