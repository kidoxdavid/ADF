#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "CADPoliceSubsystem.generated.h"

class AActor;

class ACADVehicle;

UENUM()
enum class ECADCrime : uint8
{
	VehicleCollision,
	PedestrianHit,
	PoliceHit,
	Carjack,
	RunRedLight
};

UENUM()
enum class ECADPoliceState : uint8
{
	Clear,
	Pursuit,   // police can see the player
	Search,    // sight lost; they converge on the last known position
	Cooldown   // long unseen; wanted level draining
};

DECLARE_MULTICAST_DELEGATE(FCADOnPoliceEvent);

/**
 * Wanted level + police AI. Heat is added by witnessed crimes; police only know where the player is while
 * one of their units can see them (range + line of sight). Otherwise they search the last known location and
 * the heat drains. Arrest happens when a unit holds the player in place.
 */
UCLASS()
class CALGARYAFTERDARK_API UCADPoliceSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()
public:
	static UCADPoliceSubsystem* Get(const UObject* WorldContext);
	virtual bool ShouldCreateSubsystem(UObject* Outer) const override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(UCADPoliceSubsystem, STATGROUP_Tickables); }

	bool bEnabled = false;
	FCADOnPoliceEvent OnBusted;
	FCADOnPoliceEvent OnEscaped;

	void ReportCrime(ECADCrime Type, const FVector& Where, bool bForceWitness = false);
	void SetWantedLevel(int32 Level);
	void ClearWanted(bool bSilent = false);
	int32 Level() const;
	float GetHeat() const { return Heat; }
	ECADPoliceState State() const { return PoliceState; }
	bool PlayerSeen() const { return bSeen; }
	FVector LastKnown() const { return LastKnownPos; }
	float BustProgress() const { return BustTimer / 2.5f; }
	/** Search area radius for the HUD (cm), 0 when not searching. */
	float SearchRadius() const;
	void DismissAll();
	int32 NumUnits() const { return Cops.Num(); }

private:
	UPROPERTY() TArray<TObjectPtr<ACADVehicle>> Cops;
	float Heat = 0.f;
	bool bSeen = false;
	ECADPoliceState PoliceState = ECADPoliceState::Clear;
	FVector LastKnownPos = FVector::ZeroVector;
	float UnseenTime = 0.f;
	float BustTimer = 0.f;
	float SpawnClock = 0.f;
	float SightClock = 0.f;
	float PatrolClock = 0.f;
	float DismissClock = 0.f;
	TArray<TWeakObjectPtr<ACADVehicle>> Dismissed;
	TArray<TWeakObjectPtr<ACADVehicle>> Adopted;

	AActor* PlayerActor() const;
	bool IsWitnessed(const FVector& Where) const;
	int32 DesiredUnits() const;
	void SpawnUnit();
	void UpdateSight(float Dt);
	void RouteSearchers();
	void Escape();
};
