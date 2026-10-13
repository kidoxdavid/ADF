#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "CADTypes.h"
#include "CADRoadNetwork.h"
#include "CADDataSubsystem.generated.h"

/** Parsed mission stage (from MissionStages.csv). */
struct FCADStageDef
{
	ECADStageType Type = ECADStageType::Dialogue;
	FString Text;
	TArray<FName> Locations;
	float Radius = 15.f;
	float TimeLimit = 0.f;
	TArray<FString> Lines;        // dialogue lines, 'Speaker::text'
	FString Param;
	FName VehicleId;
	FString ChoiceLabel[3];
	FString ChoiceReq[3];
	int32 Jump[3] = { -1, -1, -1 };
	FString Effect[3];
	FString OnEnter;
	bool bCheckpoint = true;
	bool HasParam(const TCHAR* Key) const { return Param.Contains(Key); }
};

struct FCADMissionDef
{
	FName Id;
	FString Title, Brief, Category;
	FName Giver;
	TArray<FName> Prereq;
	FString MinRep;
	bool bNight = false;
	int32 RewardCash = 0, RewardPublic = 0, RewardBusiness = 0, RewardUnderworld = 0;
	FName RewardVehicle;
	int32 TimeBonusPerSec = 0;
	FString Optional;
	bool bRepeatable = false;
	TArray<FCADStageDef> Stages;
};

/**
 * Loads every Content/Data/*.csv into UDataTables at startup (so designers can also swap them for
 * editor-imported tables) and exposes typed, parsed lookups plus the road graph.
 */
UCLASS()
class CALGARYAFTERDARK_API UCADDataSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()
public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;

	bool bLoaded = false;
	TArray<FString> LoadErrors;

	TMap<FName, FCADVehicleRow> Vehicles;
	TArray<FName> VehicleOrder;
	TMap<FName, FCADUpgradeRow> Upgrades;
	TMap<FName, FCADItemRow> Items;
	TArray<FName> ItemOrder;
	TMap<FName, FCADShopRow> Shops;
	TMap<FName, FCADPropertyRow> Properties;
	TArray<FName> PropertyOrder;
	TMap<FName, FCADLocationRow> Locations;
	TArray<FName> LocationOrder;
	TMap<FName, FCADMissionDef> Missions;
	TArray<FName> MissionOrder;
	FCADRoadNetwork Network;

	const FCADVehicleRow* FindVehicle(FName Id) const { return Vehicles.Find(Id); }
	const FCADLocationRow* FindLocation(FName Id) const { return Locations.Find(Id); }
	/** World position (cm) of a named location, grounded on the terrain. */
	FVector LocationPos(FName Id) const;
	const FCADUpgradeRow* FindUpgrade(const FString& Category, int32 Level) const;
	float UpgradeBonus(const FString& Category, int32 Level) const;
	static FLinearColor ParseColor(const FString& Hex);
	FString LocationName(FName Id) const;

private:
	template<typename RowT> UDataTable* LoadTable(const TCHAR* File);
	void ParseAll();
	void BuildNetwork(UDataTable* Nodes, UDataTable* Edges, UDataTable* River);
};
