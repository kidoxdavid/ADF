#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "CADTypes.h"
#include "CADVehicle.generated.h"

class UBoxComponent;
class UStaticMeshComponent;
class USpringArmComponent;
class UCameraComponent;
class USpotLightComponent;
class UMaterialInstanceDynamic;
class UCADVehicleDriver;
class ACADHumanoid;

/**
 * Arcade-realistic vehicle simulated by the engine's rigid-body physics (Chaos). Four raycast wheels apply
 * spring/damper, lateral-grip, drive and brake forces at their contact points, so the car genuinely
 * collides with, and is pushed by, the world (see DECISIONS.md for why this instead of Chaos Vehicle assets).
 */
UCLASS()
class CALGARYAFTERDARK_API ACADVehicle : public APawn
{
	GENERATED_BODY()
public:
	ACADVehicle();

	virtual void Tick(float DeltaSeconds) override;
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;

	// ---- configuration ----------------------------------------------------------------------------
	UPROPERTY() TObjectPtr<UBoxComponent> Chassis;
	UPROPERTY() TObjectPtr<USpringArmComponent> Boom;
	UPROPERTY() TObjectPtr<UCameraComponent> Cam;
	UPROPERTY() TObjectPtr<UCADVehicleDriver> Driver;

	FName VehicleId;
	FCADVehicleRow Spec;
	FGuid OwnedId;
	FLinearColor Paint = FLinearColor(0.5f, 0.5f, 0.5f);
	int32 EngineLvl = 0, BrakeLvl = 0, HandlingLvl = 0, WheelLvl = 0;
	ECADVehicleRole Role = ECADVehicleRole::Parked;
	float Health = 100.f;
	bool bWrecked = false;
	bool bPlayerDriven = false;
	bool bHeadlightsOn = false;
	bool bSirenOn = false;
	bool bConfigured = false;
	float WreckedTime = 0.f;
	FString MissionTag;      // non-empty for mission vehicles

	/** Applies a data-table row + optional ownership record (paint/upgrades/health). */
	void Configure(FName Id, const FCADOwnedVehicle* Owned);
	void ApplyUpgrades();
	void SetPaint(const FLinearColor& NewPaint);
	void SetWheelStyle(int32 Level);
	void Repair();
	void SetWrecked();

	// ---- control ----------------------------------------------------------------------------------
	float InThrottle = 0.f;   // -1..1
	float InSteer = 0.f;      // -1..1
	float InHandbrake = 0.f;  // 0..1
	float InBrake = 0.f;      // 0..1 explicit brake (AI)
	void AddCameraInput(float DYaw, float DPitch);
	void ResetUpright();
	FVector GetExitLocation() const;
	void SetEngineActive(bool bOn) { bEngineOn = bOn; }

	// ---- state ------------------------------------------------------------------------------------
	float SpeedKph() const;
	float ForwardSpeedMps() const;
	FVector Velocity() const;
	float EngineRpm() const { return Rpm; }
	FString DisplayName() const { return Spec.DisplayName; }
	bool IsOnGround() const { return GroundedWheels > 0; }
	static float GlobalGrip;      // set by the weather system (1 = dry)

	static TArray<TWeakObjectPtr<ACADVehicle>> Registry;
	static ACADVehicle* FindNearest(const UWorld* World, const FVector& P, float MaxDist, const ACADVehicle* Ignore = nullptr);

	UFUNCTION()
	void OnChassisHit(UPrimitiveComponent* HitComp, AActor* Other, UPrimitiveComponent* OtherComp, FVector NormalImpulse, const FHitResult& Hit);

private:
	static constexpr int32 NumWheels = 4;
	FVector WheelLocal[NumWheels];
	float WheelSpin[NumWheels] = { 0, 0, 0, 0 };
	float WheelExt[NumWheels] = { 0, 0, 0, 0 };
	bool bWheelGround[NumWheels] = { false, false, false, false };
	float WheelRadius = 32.f;
	float TraceLen = 90.f;
	float SteerAngle = 0.f;
	float Rpm = 900.f;
	bool bEngineOn = true;
	int32 GroundedWheels = 0;
	float UprightTimer = 0.f;
	float HitCooldown = 0.f;
	float LightClock = 0.f;
	float SirenClock = 0.f;
	float CamYawOffset = 0.f, CamPitchOffset = 0.f, LastLookTime = -10.f, CamYaw = 0.f;

	// stats after upgrades
	float AccelCm = 600.f, TopCms = 4400.f, BrakeCm = 900.f, MaxSteer = 32.f, GripBase = 1.f, SuspHz = 1.7f;

	UPROPERTY() TObjectPtr<UStaticMeshComponent> Lower;
	UPROPERTY() TObjectPtr<UStaticMeshComponent> CabinMesh;
	UPROPERTY() TObjectPtr<UStaticMeshComponent> RoofMesh;
	UPROPERTY() TObjectPtr<UStaticMeshComponent> ExtraMesh;   // pickup bed / truck cargo
	UPROPERTY() TObjectPtr<UStaticMeshComponent> Tire[4];
	UPROPERTY() TObjectPtr<UStaticMeshComponent> Rim[4];
	UPROPERTY() TObjectPtr<UStaticMeshComponent> HeadBox[2];
	UPROPERTY() TObjectPtr<UStaticMeshComponent> TailBox[2];
	UPROPERTY() TObjectPtr<UStaticMeshComponent> LightBar[2];
	UPROPERTY() TObjectPtr<USpotLightComponent> HeadSpot[2];
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> PaintMat;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> RimMat;

	void BuildVisual();
	void SimulateWheels(float Dt);
	void UpdateVisuals(float Dt);
	void UpdateCamera(float Dt);
	void UpdateLights(float Dt);
};
