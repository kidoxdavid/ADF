#include "CADPlayerCharacter.h"
#include "CADTerrain.h"
#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/SpringArmComponent.h"

ACADPlayerCharacter::ACADPlayerCharacter()
{
	Boom = CreateDefaultSubobject<USpringArmComponent>(TEXT("Boom"));
	Boom->SetupAttachment(GetCapsuleComponent());
	Boom->TargetArmLength = 380.f;
	Boom->SocketOffset = FVector(0.f, 55.f, 55.f);
	Boom->bUsePawnControlRotation = true;
	Boom->bDoCollisionTest = true;
	Boom->ProbeSize = 14.f;
	Boom->bEnableCameraLag = true;
	Boom->CameraLagSpeed = 18.f;

	Cam = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Cam->SetupAttachment(Boom, USpringArmComponent::SocketName);
	Cam->bUsePawnControlRotation = false;
	Cam->FieldOfView = 90.f;

	GetCharacterMovement()->MaxWalkSpeed = 380.f;
	GetCharacterMovement()->MaxAcceleration = 2000.f;
	GetCharacterMovement()->BrakingDecelerationWalking = 2200.f;
	GetCharacterMovement()->AirControl = 0.3f;
}

void ACADPlayerCharacter::SetFov(float Fov)
{
	if (Cam) Cam->FieldOfView = Fov;
}

void ACADPlayerCharacter::ApplyOutfit(int32 Index)
{
	static const FLinearColor Jackets[NumOutfits] = { FLinearColor(0.06f, 0.12f, 0.22f), FLinearColor(0.45f, 0.08f, 0.06f), FLinearColor(0.1f, 0.3f, 0.15f),
		FLinearColor(0.7f, 0.55f, 0.1f), FLinearColor(0.15f, 0.15f, 0.17f), FLinearColor(0.5f, 0.5f, 0.55f) };
	static const FLinearColor Trousers[NumOutfits] = { FLinearColor(0.05f, 0.05f, 0.06f), FLinearColor(0.08f, 0.08f, 0.1f), FLinearColor(0.1f, 0.1f, 0.14f),
		FLinearColor(0.12f, 0.1f, 0.07f), FLinearColor(0.03f, 0.03f, 0.04f), FLinearColor(0.07f, 0.1f, 0.2f) };
	static const FLinearColor Hair[NumOutfits] = { FLinearColor(0.03f, 0.02f, 0.02f), FLinearColor(0.3f, 0.15f, 0.05f), FLinearColor(0.02f, 0.02f, 0.02f),
		FLinearColor(0.5f, 0.4f, 0.2f), FLinearColor(0.35f, 0.35f, 0.35f), FLinearColor(0.1f, 0.04f, 0.02f) };
	const int32 I = ((Index % NumOutfits) + NumOutfits) % NumOutfits;
	SetLook(Jackets[I], Trousers[I], FLinearColor(0.55f, 0.4f, 0.3f), Hair[I], 1.f);
}

void ACADPlayerCharacter::MoveInput(float Forward, float Right)
{
	const FVector2D In(Right, Forward);
	const float Mag = CADMath::Min(1.f, In.Size());
	if (Mag < 0.05f || bDead) return;
	const FRotator Yaw(0.f, GetControlRotation().Yaw, 0.f);
	const FVector Dir = FRotationMatrix(Yaw).GetUnitAxis(EAxis::X) * Forward + FRotationMatrix(Yaw).GetUnitAxis(EAxis::Y) * Right;
	AddMovementInput(Dir.GetSafeNormal(), Mag);
}

void ACADPlayerCharacter::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	InvulnerableTime = CADMath::Max(0.f, InvulnerableTime - DeltaSeconds);

	// safety net: if collision was not ready yet and we fell out of the world, put us back on the terrain
	{
		const FVector L = GetActorLocation();
		const float Ground = CADTerrain::Height(L.X, L.Y);
		if (L.Z < Ground - 3000.f)
		{
			SetActorLocation(FVector(L.X, L.Y, Ground + 400.f), false, nullptr, ETeleportType::TeleportPhysics);
			GetCharacterMovement()->Velocity = FVector::ZeroVector;
		}
	}
	LastZVelocity = GetVelocity().Z;

	bInWater = GetActorLocation().Z < CADTerrain::WaterZ + 20.f && CADTerrain::RiverDistance(GetActorLocation().X, GetActorLocation().Y) < 7000.f;
	UCharacterMovementComponent* M = GetCharacterMovement();

	const bool bMoving = GetVelocity().Size2D() > 40.f;
	const bool bCanSprint = bWantsSprint && bMoving && Stamina > 5.f && !bInWater && M->IsMovingOnGround();
	M->MaxWalkSpeed = bInWater ? 180.f : (bCanSprint ? 720.f : 380.f);
	M->GravityScale = bInWater ? 0.35f : 1.f;
	if (bCanSprint) Stamina = CADMath::Max(0.f, Stamina - DeltaSeconds * 18.f);
	else Stamina = CADMath::Min(100.f, Stamina + DeltaSeconds * 12.f);
	if (!bDead && Health < 100.f) Health = CADMath::Min(100.f, Health + DeltaSeconds * 0.8f);
	SwingScale = 1.f;
}

void ACADPlayerCharacter::Landed(const FHitResult& Hit)
{
	Super::Landed(Hit);
	FallSpeedAtLand = FMath::Abs(LastZVelocity);
	if (!bInWater && FallSpeedAtLand > 1100.f)
	{
		ApplyDamage((FallSpeedAtLand - 1100.f) * 0.04f);
	}
}

void ACADPlayerCharacter::ApplyDamage(float Amount)
{
	if (InvulnerableTime > 0.f) return;
	Super::ApplyDamage(Amount);
}
