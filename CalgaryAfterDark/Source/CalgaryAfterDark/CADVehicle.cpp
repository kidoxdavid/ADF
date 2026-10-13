#include "CADVehicle.h"
#include "CADAssets.h"
#include "CADDataSubsystem.h"
#include "CADGameInstance.h"
#include "CADHumanoid.h"
#include "CADPoliceSubsystem.h"
#include "CADTerrain.h"
#include "CADVehicleDriver.h"
#include "CADWorldStreamer.h"
#include "CalgaryAfterDark.h"
#include "Camera/CameraComponent.h"
#include "Components/BoxComponent.h"
#include "Components/SpotLightComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/World.h"
#include "GameFramework/SpringArmComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "ProceduralMeshComponent.h"
#include "UObject/ConstructorHelpers.h"
#include "Engine/StaticMesh.h"

TArray<TWeakObjectPtr<ACADVehicle>> ACADVehicle::Registry;
float ACADVehicle::GlobalGrip = 1.f;

namespace
{
	FLinearColor Lin(float R, float G, float B) { return FLinearColor(R, G, B, 1.f); }
	constexpr float ChassisHalfH = 40.f;
	constexpr float Clearance = 24.f;
	constexpr float MountZ = 10.f;
}

ACADVehicle::ACADVehicle()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickGroup = TG_PrePhysics;
	AutoPossessAI = EAutoPossessAI::Disabled;

	Chassis = CreateDefaultSubobject<UBoxComponent>(TEXT("Chassis"));
	Chassis->SetBoxExtent(FVector(210.f, 90.f, ChassisHalfH));
	Chassis->SetCollisionProfileName(TEXT("Vehicle"));
	Chassis->SetNotifyRigidBodyCollision(true);
	Chassis->SetCanEverAffectNavigation(false);
	Chassis->SetLinearDamping(0.03f);
	Chassis->SetAngularDamping(0.9f);
	SetRootComponent(Chassis);
	Chassis->OnComponentHit.AddDynamic(this, &ACADVehicle::OnChassisHit);

	static ConstructorHelpers::FObjectFinder<UStaticMesh> CubeF(TEXT("/Engine/BasicShapes/Cube.Cube"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> CylF(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	auto Part = [&](const TCHAR* Name, UStaticMesh* M) -> UStaticMeshComponent*
	{
		UStaticMeshComponent* C = CreateDefaultSubobject<UStaticMeshComponent>(Name);
		C->SetStaticMesh(M);
		C->SetupAttachment(Chassis);
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		C->SetCanEverAffectNavigation(false);
		return C;
	};
	Lower = Part(TEXT("Lower"), CubeF.Object);
	CabinMesh = Part(TEXT("Cabin"), CubeF.Object);
	RoofMesh = Part(TEXT("Roof"), CubeF.Object);
	ExtraMesh = Part(TEXT("Extra"), CubeF.Object);
	for (int32 i = 0; i < NumWheels; ++i)
	{
		Tire[i] = Part(*FString::Printf(TEXT("Tire%d"), i), CylF.Object);
		Rim[i] = Part(*FString::Printf(TEXT("Rim%d"), i), CylF.Object);
	}
	for (int32 i = 0; i < 2; ++i)
	{
		HeadBox[i] = Part(*FString::Printf(TEXT("Head%d"), i), CubeF.Object);
		TailBox[i] = Part(*FString::Printf(TEXT("Tail%d"), i), CubeF.Object);
		LightBar[i] = Part(*FString::Printf(TEXT("Bar%d"), i), CubeF.Object);
		LightBar[i]->SetVisibility(false);
		HeadSpot[i] = CreateDefaultSubobject<USpotLightComponent>(*FString::Printf(TEXT("Spot%d"), i));
		HeadSpot[i]->SetupAttachment(Chassis);
		HeadSpot[i]->SetIntensity(60000.f);
		HeadSpot[i]->SetAttenuationRadius(4500.f);
		HeadSpot[i]->SetInnerConeAngle(18.f);
		HeadSpot[i]->SetOuterConeAngle(34.f);
		HeadSpot[i]->SetCastShadows(false);
		HeadSpot[i]->SetVisibility(false);
	}

	Boom = CreateDefaultSubobject<USpringArmComponent>(TEXT("Boom"));
	Boom->SetupAttachment(Chassis);
	Boom->SetUsingAbsoluteRotation(true);
	Boom->TargetArmLength = 720.f;
	Boom->SocketOffset = FVector(0, 0, 150.f);
	Boom->bDoCollisionTest = true;
	Boom->ProbeSize = 16.f;
	Boom->bEnableCameraLag = true;
	Boom->CameraLagSpeed = 12.f;
	Cam = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Cam->SetupAttachment(Boom, USpringArmComponent::SocketName);
	Cam->FieldOfView = 90.f;
}

void ACADVehicle::BeginPlay()
{
	Super::BeginPlay();
	Registry.Add(this);
}

void ACADVehicle::EndPlay(const EEndPlayReason::Type Reason)
{
	Registry.Remove(this);
	Super::EndPlay(Reason);
}

ACADVehicle* ACADVehicle::FindNearest(const UWorld* World, const FVector& P, float MaxDist, const ACADVehicle* Ignore)
{
	ACADVehicle* Best = nullptr;
	float BestD = MaxDist;
	for (const TWeakObjectPtr<ACADVehicle>& W : Registry)
	{
		ACADVehicle* V = W.Get();
		if (!V || V == Ignore || V->GetWorld() != World) continue;
		const float D = FVector::Dist(V->GetActorLocation(), P);
		if (D < BestD) { BestD = D; Best = V; }
	}
	return Best;
}

// ------------------------------------------------------------------------------------------------
// Configuration
// ------------------------------------------------------------------------------------------------
void ACADVehicle::Configure(FName Id, const FCADOwnedVehicle* Owned)
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* Data = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	const FCADVehicleRow* Row = Data ? Data->FindVehicle(Id) : nullptr;
	if (!Row)
	{
		UE_LOG(LogCAD, Warning, TEXT("Unknown vehicle id %s"), *Id.ToString());
		return;
	}
	VehicleId = Id;
	Spec = *Row;
	if (Owned)
	{
		OwnedId = Owned->Id;
		Paint = Owned->Paint;
		EngineLvl = Owned->Engine; BrakeLvl = Owned->Brakes; HandlingLvl = Owned->Handling; WheelLvl = Owned->Wheels;
		Health = Owned->Health;
	}
	else
	{
		Paint = UCADDataSubsystem::ParseColor(Spec.Color);
		Health = 100.f;
	}
	BuildVisual();
	ApplyUpgrades();

	Chassis->SetSimulatePhysics(true);
	Chassis->SetMassOverrideInKg(NAME_None, Spec.MassKg, true);
	Chassis->SetCenterOfMass(FVector(0.f, 0.f, -22.f));
	Chassis->BodyInstance.InertiaTensorScale = FVector(1.6f, 1.8f, 1.2f);
	Chassis->BodyInstance.UpdateMassProperties();
	bConfigured = true;
	if (Health <= 0.f) SetWrecked();
}

void ACADVehicle::ApplyUpgrades()
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* D = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	const float E = D ? D->UpgradeBonus(TEXT("Engine"), EngineLvl) : 0.f;
	const float B = D ? D->UpgradeBonus(TEXT("Brakes"), BrakeLvl) : 0.f;
	const float H = D ? D->UpgradeBonus(TEXT("Handling"), HandlingLvl) : 0.f;
	const float W = D ? D->UpgradeBonus(TEXT("Wheels"), WheelLvl) : 0.f;
	AccelCm = Spec.AccelMps2 * 100.f * (1.f + E);
	TopCms = Spec.TopSpeedKph / 0.036f * (1.f + E * 0.5f);
	BrakeCm = Spec.BrakeMps2 * 100.f * (1.f + B);
	MaxSteer = Spec.MaxSteerDeg * (1.f + H * 0.25f);
	GripBase = Spec.Grip * (1.f + H + W);
	SuspHz = Spec.SuspensionHz;
	SetWheelStyle(WheelLvl);
}

void ACADVehicle::BuildVisual()
{
	UCADAssets* A = CADAssets(this);
	if (!A) return;
	const float L = Spec.LengthM * 100.f, W = Spec.WidthM * 100.f, H = Spec.HeightM * 100.f;
	const FString Cat = Spec.Category;
	Chassis->SetBoxExtent(FVector(L * 0.5f * 0.95f, W * 0.5f * 0.95f, ChassisHalfH));

	PaintMat = A->MakeUnique(Paint, 0.f, 0.55f, 0.28f);
	UMaterialInterface* Glass = A->Color(Lin(0.02f, 0.035f, 0.05f), 0.f, 0.85f, 0.08f);
	const bool bTruck = Cat == TEXT("Truck"), bVan = Cat == TEXT("Van"), bPickup = Cat == TEXT("Pickup"), bSUV = Cat == TEXT("SUV");
	const bool bSport = Cat == TEXT("Sports");

	float LowerH = bTruck ? 70.f : 54.f;
	float LowerZ = bTruck ? 6.f : -1.f;
	Lower->SetMaterial(0, PaintMat);
	Lower->SetRelativeLocation(FVector(0, 0, LowerZ));
	Lower->SetRelativeScale3D(FVector(L * 0.98f, W, LowerH) / 100.f);

	float CabLen = 0.52f, CabX = -0.05f, CabH = 50.f;
	if (bSport) { CabLen = 0.44f; CabX = -0.04f; CabH = 38.f; }
	if (bSUV) { CabLen = 0.64f; CabX = -0.08f; CabH = 60.f; }
	if (bPickup) { CabLen = 0.32f; CabX = 0.08f; CabH = 56.f; }
	if (bVan) { CabLen = 0.82f; CabX = -0.06f; CabH = 78.f; }
	if (bTruck) { CabLen = 0.22f; CabX = 0.38f; CabH = 95.f; }
	const float CabBase = LowerZ + LowerH * 0.5f;
	CabinMesh->SetMaterial(0, Glass);
	CabinMesh->SetRelativeLocation(FVector(CabX * L, 0, CabBase + CabH * 0.5f));
	CabinMesh->SetRelativeScale3D(FVector(CabLen * L, W * 0.9f, CabH) / 100.f);
	RoofMesh->SetMaterial(0, PaintMat);
	RoofMesh->SetRelativeLocation(FVector(CabX * L, 0, CabBase + CabH + 3.f));
	RoofMesh->SetRelativeScale3D(FVector(CabLen * L * 1.02f, W * 0.92f, 7.f) / 100.f);

	ExtraMesh->SetVisibility(bPickup || bTruck);
	if (bPickup)
	{
		ExtraMesh->SetMaterial(0, PaintMat);
		ExtraMesh->SetRelativeLocation(FVector(-0.28f * L, 0, CabBase + 6.f));
		ExtraMesh->SetRelativeScale3D(FVector(0.4f * L, W * 0.98f, 14.f) / 100.f);
	}
	if (bTruck)
	{
		ExtraMesh->SetMaterial(0, A->Color(Lin(0.8f, 0.8f, 0.78f), 0.f, 0.1f, 0.6f));
		ExtraMesh->SetRelativeLocation(FVector(-0.2f * L, 0, CabBase + 70.f));
		ExtraMesh->SetRelativeScale3D(FVector(0.58f * L, W * 1.0f, 170.f) / 100.f);
	}

	WheelRadius = bTruck ? 46.f : ((bSUV || bPickup || bVan) ? 36.f : 32.f);
	const float WX0 = 0.32f * L, WX1 = (bTruck ? -0.27f : -0.31f) * L, WY = W * 0.5f - 16.f;
	WheelLocal[0] = FVector(WX0, -WY, MountZ);
	WheelLocal[1] = FVector(WX0, WY, MountZ);
	WheelLocal[2] = FVector(WX1, -WY, MountZ);
	WheelLocal[3] = FVector(WX1, WY, MountZ);
	UMaterialInterface* TireMat = A->Color(Lin(0.012f, 0.012f, 0.012f), 0.f, 0.f, 0.9f);
	for (int32 i = 0; i < NumWheels; ++i)
	{
		Tire[i]->SetMaterial(0, TireMat);
		Tire[i]->SetRelativeScale3D(FVector(WheelRadius * 2.f, WheelRadius * 2.f, 24.f) / 100.f);
		Rim[i]->SetRelativeScale3D(FVector(WheelRadius * 1.3f, WheelRadius * 1.3f, 26.f) / 100.f);
	}
	// lights
	UMaterialInterface* HeadMat = A->Color(Lin(1.f, 0.95f, 0.8f), 0.4f, 0.f, 0.2f);
	UMaterialInterface* TailMat = A->Color(Lin(0.35f, 0.02f, 0.02f), 0.5f, 0.f, 0.3f);
	for (int32 i = 0; i < 2; ++i)
	{
		const float S = i == 0 ? -1.f : 1.f;
		HeadBox[i]->SetMaterial(0, HeadMat);
		HeadBox[i]->SetRelativeLocation(FVector(L * 0.5f - 2.f, S * W * 0.34f, LowerZ + 14.f));
		HeadBox[i]->SetRelativeScale3D(FVector(6.f, 36.f, 14.f) / 100.f);
		TailBox[i]->SetMaterial(0, TailMat);
		TailBox[i]->SetRelativeLocation(FVector(-L * 0.5f + 2.f, S * W * 0.34f, LowerZ + 14.f));
		TailBox[i]->SetRelativeScale3D(FVector(6.f, 36.f, 12.f) / 100.f);
		HeadSpot[i]->SetRelativeLocation(FVector(L * 0.5f, S * W * 0.34f, LowerZ + 14.f));
		HeadSpot[i]->SetRelativeRotation(FRotator(-4.f, 0.f, 0.f));
		LightBar[i]->SetRelativeLocation(FVector(CabX * L, S * W * 0.2f, CabBase + CabH + 12.f));
		LightBar[i]->SetRelativeScale3D(FVector(18.f, 38.f, 9.f) / 100.f);
		LightBar[i]->SetVisibility(Cat == TEXT("Police"));
	}
	if (Cat == TEXT("Police"))
	{
		bSirenOn = false;
		// white body, dark blue stripe via roof/hood tint
		RoofMesh->SetMaterial(0, A->Color(Lin(0.02f, 0.05f, 0.25f), 0.f, 0.3f, 0.4f));
	}
	TraceLen = (ChassisHalfH + Clearance + MountZ) + 980.f / FMath::Square(2.f * PI * CADMath::Max(1.f, Spec.SuspensionHz));
}

void ACADVehicle::SetPaint(const FLinearColor& NewPaint)
{
	Paint = NewPaint;
	if (PaintMat) PaintMat->SetVectorParameterValue(TEXT("Color"), Paint * (1.f - (1.f - Health / 100.f) * 0.55f));
}

void ACADVehicle::SetWheelStyle(int32 Level)
{
	WheelLvl = Level;
	UCADAssets* A = CADAssets(this);
	if (!A) return;
	static const FLinearColor Styles[4] = { Lin(0.18f, 0.18f, 0.19f), Lin(0.55f, 0.56f, 0.58f), Lin(0.08f, 0.08f, 0.09f), Lin(0.85f, 0.65f, 0.15f) };
	UMaterialInterface* M = A->Color(Styles[CADMath::Clamp(Level, 0, 3)], 0.f, 0.9f, 0.25f);
	for (int32 i = 0; i < NumWheels; ++i)
	{
		Rim[i]->SetMaterial(0, M);
		Rim[i]->SetRelativeScale3D(FVector(WheelRadius * (1.2f + 0.05f * Level), WheelRadius * (1.2f + 0.05f * Level), 26.f) / 100.f);
	}
}

void ACADVehicle::Repair()
{
	Health = 100.f;
	bWrecked = false;
	SetPaint(Paint);
}

void ACADVehicle::SetWrecked()
{
	if (bWrecked) return;
	bWrecked = true;
	Health = 0.f;
	bHeadlightsOn = false;
	InThrottle = InBrake = InSteer = 0.f;
	if (PaintMat) PaintMat->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.015f, 0.015f, 0.015f));
}

// ------------------------------------------------------------------------------------------------
// State
// ------------------------------------------------------------------------------------------------
FVector ACADVehicle::Velocity() const { return Chassis->GetPhysicsLinearVelocity(); }
float ACADVehicle::SpeedKph() const { return Velocity().Size() * 0.036f; }
float ACADVehicle::ForwardSpeedMps() const { return FVector::DotProduct(Velocity(), Chassis->GetForwardVector()) / 100.f; }

FVector ACADVehicle::GetExitLocation() const
{
	const FVector Right = Chassis->GetRightVector();
	return GetActorLocation() - Right * (Spec.WidthM * 50.f + 90.f) + FVector(0, 0, 30.f);
}

void ACADVehicle::AddCameraInput(float DYaw, float DPitch)
{
	CamYawOffset += DYaw;
	CamPitchOffset = CADMath::Clamp(CamPitchOffset + DPitch, -35.f, 40.f);
	LastLookTime = GetWorld()->GetTimeSeconds();
}

void ACADVehicle::ResetUpright()
{
	FRotator R = GetActorRotation();
	R.Pitch = 0.f; R.Roll = 0.f;
	Chassis->SetPhysicsLinearVelocity(FVector::ZeroVector);
	Chassis->SetPhysicsAngularVelocityInDegrees(FVector::ZeroVector);
	SetActorLocationAndRotation(GetActorLocation() + FVector(0, 0, 120.f), R, false, nullptr, ETeleportType::TeleportPhysics);
}

// ------------------------------------------------------------------------------------------------
// Tick
// ------------------------------------------------------------------------------------------------
void ACADVehicle::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!bConfigured) return;
	const float Dt = CADMath::Clamp(DeltaSeconds, 0.001f, 0.05f);
	HitCooldown = CADMath::Max(0.f, HitCooldown - Dt);

	// Vehicles outside the loaded world would fall through: freeze them until terrain exists.
	if (UCADWorldStreamer* St = GetWorld()->GetSubsystem<UCADWorldStreamer>())
	{
		if (!St->IsLoadedAt(GetActorLocation()) && !bPlayerDriven)
		{
			Chassis->SetPhysicsLinearVelocity(FVector::ZeroVector);
			Chassis->SetEnableGravity(false);
			return;
		}
		Chassis->SetEnableGravity(true);
	}

	SimulateWheels(Dt);
	UpdateVisuals(Dt);
	if (bPlayerDriven) UpdateCamera(Dt);
	UpdateLights(Dt);

	// safety net: fell through the world (terrain collision not yet cooked) -> put the car back on the ground
	const FVector Loc = GetActorLocation();
	{
		const float Ground = CADTerrain::Height(Loc.X, Loc.Y);
		if (Loc.Z < Ground - 3000.f)
		{
			Chassis->SetPhysicsLinearVelocity(FVector::ZeroVector);
			Chassis->SetPhysicsAngularVelocityInDegrees(FVector::ZeroVector);
			SetActorLocation(FVector(Loc.X, Loc.Y, Ground + 400.f), false, nullptr, ETeleportType::TeleportPhysics);
			return;
		}
	}
	// water: vehicles drown
	if (!bWrecked && Loc.Z < CADTerrain::WaterZ - 30.f && CADTerrain::RiverDistance(Loc.X, Loc.Y) < 7000.f)
	{
		Health = CADMath::Max(0.f, Health - 22.f * Dt);
		if (Health <= 0.f) SetWrecked();
	}
	// flipped?
	if (Chassis->GetUpVector().Z < 0.25f && SpeedKph() < 8.f) UprightTimer += Dt; else UprightTimer = 0.f;
	if (UprightTimer > 4.f && Role != ECADVehicleRole::Player) { ResetUpright(); UprightTimer = 0.f; }
	if (bWrecked) WreckedTime += Dt;
}

void ACADVehicle::SimulateWheels(float Dt)
{
	const FTransform T = Chassis->GetComponentTransform();
	const FVector Up = T.GetUnitAxis(EAxis::Z);
	const FVector Fwd0 = T.GetUnitAxis(EAxis::X);
	const FVector Right0 = T.GetUnitAxis(EAxis::Y);
	const float Mass = Spec.MassKg;
	const float WheelMass = Mass * 0.25f;
	const float Omega = 2.f * PI * SuspHz;
	const float K = WheelMass * Omega * Omega;
	const float C = 2.f * 0.55f * WheelMass * Omega;

	const FVector Vel = Velocity();
	const float VF = FVector::DotProduct(Vel, Fwd0);
	const float Power = bWrecked || !bEngineOn ? 0.f : (0.45f + 0.55f * Health / 100.f);

	// translate pedal inputs into drive/brake intent
	float Drive = 0.f, Brake = InBrake;
	if (InThrottle > 0.f)
	{
		if (VF < -150.f) Brake = CADMath::Max(Brake, InThrottle); else Drive = InThrottle;
	}
	else if (InThrottle < 0.f)
	{
		if (VF > 150.f) Brake = CADMath::Max(Brake, -InThrottle); else Drive = InThrottle * 0.45f;
	}
	const float TopFwd = TopCms, TopRev = 3000.f;
	const float Limit = Drive >= 0.f ? TopFwd : TopRev;
	const float SpeedFrac = CADMath::Clamp(FMath::Abs(VF) / Limit, 0.f, 1.2f);
	const float DriveFactor = ((Drive >= 0.f) == (VF >= -50.f) || FMath::Abs(VF) < 100.f) ? CADMath::Clamp(1.f - SpeedFrac * SpeedFrac * SpeedFrac, 0.f, 1.f) : 1.f;

	// steering with speed-sensitive lock + smoothing
	const float SpeedKphNow = FMath::Abs(VF) * 0.036f;
	const float Lock = CADMath::Lerp(1.f, 0.28f, CADMath::Clamp(SpeedKphNow / (Spec.TopSpeedKph * 0.65f), 0.f, 1.f));
	const float TargetSteer = InSteer * MaxSteer * Lock;
	SteerAngle = FMath::FInterpTo(SteerAngle, TargetSteer, Dt, FMath::Abs(TargetSteer) > FMath::Abs(SteerAngle) ? 7.f : 11.f);

	FCollisionQueryParams QP(SCENE_QUERY_STAT(CADWheel), false, this);
	FCollisionObjectQueryParams OQP(ECC_WorldStatic);
	GroundedWheels = 0;

	for (int32 i = 0; i < NumWheels; ++i)
	{
		const FVector Mount = T.TransformPosition(WheelLocal[i]);
		FHitResult Hit;
		const bool bHit = GetWorld()->LineTraceSingleByObjectType(Hit, Mount, Mount - Up * TraceLen, OQP, QP);
		bWheelGround[i] = bHit;
		if (!bHit) { WheelExt[i] = TraceLen - WheelRadius; continue; }
		++GroundedWheels;

		const float Comp = CADMath::Max(0.f, TraceLen - Hit.Distance);
		WheelExt[i] = Hit.Distance - WheelRadius;
		const FVector Vp = Chassis->GetPhysicsLinearVelocityAtPoint(Hit.ImpactPoint);
		const float VUp = FVector::DotProduct(Vp, Up);
		const float Fs = CADMath::Max(0.f, K * Comp - C * VUp);
		const FVector SpringDir = (Up * 0.7f + Hit.ImpactNormal * 0.3f).GetSafeNormal();
		Chassis->AddForceAtLocation(SpringDir * Fs, Hit.ImpactPoint);

		// wheel axes (front wheels steer)
		const bool bFront = i < 2;
		const FQuat SteerQ = FQuat(Up, FMath::DegreesToRadians(bFront ? SteerAngle : 0.f));
		FVector Fwd = SteerQ.RotateVector(Fwd0);
		FVector Right = SteerQ.RotateVector(Right0);
		Fwd = (Fwd - Hit.ImpactNormal * FVector::DotProduct(Fwd, Hit.ImpactNormal)).GetSafeNormal();
		Right = (Right - Hit.ImpactNormal * FVector::DotProduct(Right, Hit.ImpactNormal)).GetSafeNormal();

		const float VFw = FVector::DotProduct(Vp, Fwd);
		const float VR = FVector::DotProduct(Vp, Right);

		float Mu = GripBase * GlobalGrip;
		if (Cast<UProceduralMeshComponent>(Hit.GetComponent()))
		{
			Mu *= CADMath::Lerp(0.62f, 0.95f, CADMath::Clamp(Spec.OffRoad, 0.f, 1.f));
		}
		float LatMu = Mu;
		if (!bFront && InHandbrake > 0.5f) LatMu *= 0.32f;
		const float Fn = CADMath::Max(Fs, WheelMass * 980.f * 0.15f);

		float FLat = -VR * WheelMass / Dt;
		FLat = CADMath::Clamp(FLat, -LatMu * Fn, LatMu * Fn);

		float FLong = 0.f;
		FLong += Drive * AccelCm * (Mass * 0.25f) * DriveFactor * Power;
		if (Brake > 0.f)
		{
			const float Want = -FMath::Sign(VFw) * CADMath::Min(FMath::Abs(VFw) * WheelMass / Dt, BrakeCm * WheelMass * Brake);
			FLong += Want;
		}
		if (InHandbrake > 0.5f && !bFront)
		{
			FLong += -FMath::Sign(VFw) * CADMath::Min(FMath::Abs(VFw) * WheelMass / Dt, BrakeCm * WheelMass * 0.8f);
		}
		if (FMath::IsNearlyZero(Drive) && Brake <= 0.f)
		{
			FLong += -FMath::Sign(VFw) * CADMath::Min(FMath::Abs(VFw) * WheelMass / Dt, 70.f * WheelMass); // engine braking
		}
		FLong = CADMath::Clamp(FLong, -Mu * Fn, Mu * Fn);
		const float Mag = FMath::Sqrt(FLat * FLat + FLong * FLong);
		if (Mag > Mu * Fn && Mag > 0.f)
		{
			const float S = (Mu * Fn) / Mag;
			FLat *= S; FLong *= S;
		}
		Chassis->AddForceAtLocation(Fwd * FLong + Right * FLat, Hit.ImpactPoint);
		WheelSpin[i] += (VFw / WheelRadius) * Dt * 57.2958f;
	}

	// aerodynamic downforce + drag keeps fast cars planted
	const float VMps = Vel.Size() / 100.f;
	Chassis->AddForce(-Up * Mass * 0.08f * VMps * VMps);
	Chassis->AddForce(-Vel.GetSafeNormal() * Mass * 0.0016f * VMps * VMps);

	// light yaw damping so the car doesn't spin out from tiny inputs
	if (GroundedWheels >= 2)
	{
		const FVector AngVel = Chassis->GetPhysicsAngularVelocityInRadians();
		const float YawRate = FVector::DotProduct(AngVel, Up);
		Chassis->AddTorqueInRadians(-Up * YawRate * Mass * 120.f * (InHandbrake > 0.5f ? 0.2f : 1.f));
	}

	Rpm = 900.f + CADMath::Clamp(SpeedFrac, 0.f, 1.f) * 5200.f * (1.f + 0.05f * FMath::Sin(SpeedFrac * 40.f)) + FMath::Abs(Drive) * 600.f;
}

void ACADVehicle::UpdateVisuals(float Dt)
{
	const float Steer = SteerAngle;
	for (int32 i = 0; i < NumWheels; ++i)
	{
		const float Z = WheelLocal[i].Z - (bWheelGround[i] ? WheelExt[i] : (TraceLen - WheelRadius));
		const FVector Loc(WheelLocal[i].X, WheelLocal[i].Y + (WheelLocal[i].Y > 0 ? 6.f : -6.f), Z);
		const FRotator R(WheelSpin[i], i < 2 ? Steer : 0.f, 90.f);
		Tire[i]->SetRelativeLocationAndRotation(Loc, R);
		Rim[i]->SetRelativeLocationAndRotation(Loc + FVector(0, WheelLocal[i].Y > 0 ? 3.f : -3.f, 0), R);
	}
}

void ACADVehicle::UpdateCamera(float Dt)
{
	const float Now = GetWorld()->GetTimeSeconds();
	if (Now - LastLookTime > 1.6f)
	{
		CamYawOffset = FMath::FInterpTo(CamYawOffset, 0.f, Dt, 2.5f);
		CamPitchOffset = FMath::FInterpTo(CamPitchOffset, 0.f, Dt, 2.5f);
	}
	const FVector V = Velocity();
	float TargetYaw = GetActorRotation().Yaw;
	if (V.Size2D() > 600.f && ForwardSpeedMps() > 0.f)
	{
		TargetYaw = FMath::RadiansToDegrees(FMath::Atan2(V.Y, V.X));
	}
	if (FMath::IsNearlyZero(CamYaw)) CamYaw = TargetYaw;
	CamYaw = FMath::RadiansToDegrees(FMath::Atan2(
		CADMath::Lerp(FMath::Sin(FMath::DegreesToRadians(CamYaw)), FMath::Sin(FMath::DegreesToRadians(TargetYaw)), CADMath::Min(1.f, Dt * 3.5f)),
		CADMath::Lerp(FMath::Cos(FMath::DegreesToRadians(CamYaw)), FMath::Cos(FMath::DegreesToRadians(TargetYaw)), CADMath::Min(1.f, Dt * 3.5f))));
	Boom->SetWorldRotation(FRotator(-11.f + CamPitchOffset, CamYaw + CamYawOffset, 0.f));
	Boom->TargetArmLength = FMath::FInterpTo(Boom->TargetArmLength, 640.f + Spec.LengthM * 25.f + SpeedKph() * 1.2f, Dt, 3.f);
	Cam->SetFieldOfView(FMath::FInterpTo(Cam->FieldOfView, 84.f + CADMath::Min(SpeedKph() * 0.12f, 22.f), Dt, 3.f));
}

void ACADVehicle::UpdateLights(float Dt)
{
	UCADAssets* A = CADAssets(this);
	if (!A) return;
	LightClock += Dt;
	const bool bBraking = (InBrake > 0.05f) || (InThrottle < -0.05f && ForwardSpeedMps() > 1.5f) || InHandbrake > 0.5f;
	if (LightClock > 0.1f)
	{
		LightClock = 0.f;
		UMaterialInterface* Tail = bBraking ? Cast<UMaterialInterface>(A->Color(Lin(1.f, 0.03f, 0.02f), 7.f, 0.f, 0.3f))
			: Cast<UMaterialInterface>(A->Color(bHeadlightsOn ? Lin(0.7f, 0.02f, 0.02f) : Lin(0.3f, 0.02f, 0.02f), bHeadlightsOn ? 1.5f : 0.4f, 0.f, 0.3f));
		UMaterialInterface* Head = A->Color(Lin(1.f, 0.95f, 0.8f), bHeadlightsOn ? 8.f : 0.3f, 0.f, 0.2f);
		for (int32 i = 0; i < 2; ++i)
		{
			TailBox[i]->SetMaterial(0, Tail);
			HeadBox[i]->SetMaterial(0, Head);
		}
		bool bSpots = false;
		if (bHeadlightsOn && !bWrecked)
		{
			if (bPlayerDriven) bSpots = true;
			else if (UCADWorldStreamer* St = GetWorld()->GetSubsystem<UCADWorldStreamer>())
			{
				bSpots = FVector::DistSquared2D(GetActorLocation(), St->Focus) < FMath::Square(7000.f);
			}
		}
		for (int32 i = 0; i < 2; ++i) HeadSpot[i]->SetVisibility(bSpots);
	}
	if (Role == ECADVehicleRole::Police && bSirenOn && !bWrecked)
	{
		SirenClock += Dt;
		const bool bPhase = FMath::Fmod(SirenClock, 0.4f) < 0.2f;
		LightBar[0]->SetMaterial(0, A->Color(bPhase ? Lin(1.f, 0.f, 0.f) : Lin(0.1f, 0.f, 0.f), bPhase ? 12.f : 0.5f, 0.f, 0.3f));
		LightBar[1]->SetMaterial(0, A->Color(!bPhase ? Lin(0.f, 0.2f, 1.f) : Lin(0.f, 0.f, 0.1f), !bPhase ? 12.f : 0.5f, 0.f, 0.3f));
	}
}

// ------------------------------------------------------------------------------------------------
// Collision response: damage, pedestrians, crimes
// ------------------------------------------------------------------------------------------------
void ACADVehicle::OnChassisHit(UPrimitiveComponent* HitComp, AActor* Other, UPrimitiveComponent* OtherComp, FVector NormalImpulse, const FHitResult& Hit)
{
	if (HitCooldown > 0.f || !bConfigured) return;
	const float DV = NormalImpulse.Size() / CADMath::Max(1.f, Spec.MassKg * 100.f); // m/s change
	if (DV < 2.0f) return;
	HitCooldown = 0.2f;

	if (ACADHumanoid* Person = Cast<ACADHumanoid>(Other))
	{
		const float Kph = SpeedKph();
		if (Kph > 8.f)
		{
			const FVector Dir = Velocity().GetSafeNormal();
			Person->ApplyDamage(Kph * 0.9f);
			Person->LaunchCharacter(Dir * Kph * 8.f + FVector(0, 0, 300.f), true, true);
			if (bPlayerDriven)
			{
				if (UCADPoliceSubsystem* P = UCADPoliceSubsystem::Get(this)) P->ReportCrime(ECADCrime::PedestrianHit, Person->GetActorLocation());
			}
		}
		return;
	}

	if (DV > 3.f && !bWrecked)
	{
		Health = CADMath::Max(0.f, Health - (DV - 3.f) * 2.4f / CADMath::Max(0.3f, Spec.CollisionResistance));
		SetPaint(Paint);
		if (Health <= 0.f) SetWrecked();
	}
	if (bPlayerDriven && DV > 5.f)
	{
		if (ACADVehicle* OV = Cast<ACADVehicle>(Other))
		{
			if (UCADPoliceSubsystem* P = UCADPoliceSubsystem::Get(this))
			{
				P->ReportCrime(OV->Role == ECADVehicleRole::Police ? ECADCrime::PoliceHit : ECADCrime::VehicleCollision, GetActorLocation());
			}
		}
	}
}
