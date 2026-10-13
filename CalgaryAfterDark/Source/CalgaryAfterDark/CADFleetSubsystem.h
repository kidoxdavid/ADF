#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "CADTypes.h"
#include "CADFleetSubsystem.generated.h"

class ACADVehicle;

/** Vehicle ownership: purchase, spawn, store, repair, paint, upgrades, resale. All money goes through the economy. */
UCLASS()
class CALGARYAFTERDARK_API UCADFleetSubsystem : public UWorldSubsystem
{
	GENERATED_BODY()
public:
	static UCADFleetSubsystem* Get(const UObject* WorldContext);
	virtual bool ShouldCreateSubsystem(UObject* Outer) const override;

	TWeakObjectPtr<ACADVehicle> Active;

	FCADOwnedVehicle* FindOwned(const FGuid& Id);
	int32 Capacity() const;
	int32 NumOwned() const;
	bool BuyVehicle(FName VehicleId, FString& OutMessage, FGuid* OutId = nullptr);
	bool GrantVehicle(FName VehicleId, FGuid* OutId = nullptr);
	bool SellVehicle(const FGuid& Id, FString& OutMessage);
	ACADVehicle* SpawnOwned(const FGuid& Id, const FVector& Loc, const FRotator& Rot);
	/** Writes live health/position back into the profile. */
	void SyncActive();
	void StoreActive();
	bool Retrieve(const FGuid& Id, const FVector& Loc, const FRotator& Rot, FString& OutMessage);
	int32 RepairCost(const FGuid& Id);
	bool Repair(const FGuid& Id, FString& OutMessage);
	static constexpr int32 PaintCost = 200;
	bool Paint(const FGuid& Id, const FLinearColor& Colour, FString& OutMessage);
	/** Category: Engine, Brakes, Handling, Wheels. */
	int32 UpgradeCost(const FGuid& Id, const FString& Category, FString* OutName = nullptr);
	bool Upgrade(const FGuid& Id, const FString& Category, FString& OutMessage);
	/** Re-applies stored upgrades/paint to the live vehicle (garage preview). */
	void RefreshLive(const FGuid& Id);
};
