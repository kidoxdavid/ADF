#pragma once

#include "CoreMinimal.h"
#include "Engine/DataTable.h"
#include "InputCoreTypes.h"
#include <type_traits>
#include "CADTypes.generated.h"

/**
 * UE5 uses double for FVector components, and FMath::Min/Max/Clamp/Lerp require identical argument types.
 * These wrappers unify mixed float/double/int arguments so gameplay code can stay readable.
 */
namespace CADMath
{
	template<class A, class B> inline auto Min(A a, B b) { using T = std::common_type_t<A, B>; return FMath::Min<T>(static_cast<T>(a), static_cast<T>(b)); }
	template<class A, class B> inline auto Max(A a, B b) { using T = std::common_type_t<A, B>; return FMath::Max<T>(static_cast<T>(a), static_cast<T>(b)); }
	template<class A, class B, class C> inline auto Min3(A a, B b, C c) { return Min(Min(a, b), c); }
	template<class A, class B, class C> inline auto Max3(A a, B b, C c) { return Max(Max(a, b), c); }
	template<class A, class B, class C> inline auto Clamp(A x, B lo, C hi) { using T = std::common_type_t<A, B, C>; return FMath::Clamp<T>(static_cast<T>(x), static_cast<T>(lo), static_cast<T>(hi)); }
	template<class A, class B, class U> auto Lerp(const A& a, const B& b, const U& t) { using T = std::common_type_t<A, B>; const T Ta(a), Tb(b); return static_cast<T>(Ta + (Tb - Ta) * t); }
}

/** World data is authored in metres (CSV); the engine works in centimetres. */
static constexpr float CADM = 100.f;

// ------------------------------------------------------------------------------------------------
// Enums (plain; CSV columns hold strings which the data subsystem parses)
// ------------------------------------------------------------------------------------------------
UENUM(BlueprintType)
enum class ECADRoadKind : uint8
{
	Highway, Expressway, Arterial, Collector, Local, Ramp, Industrial, Service, Path
};

UENUM(BlueprintType)
enum class ECADDistrict : uint8
{
	Downtown, Beltline, Suburb, Industrial, Airport, Parkland, Rural
};

UENUM(BlueprintType)
enum class ECADGameState : uint8
{
	MainMenu, Playing, Paused, Map, Inventory, Garage, Shop, Property, Briefing, Settings, Results
};

UENUM(BlueprintType)
enum class ECADStageType : uint8
{
	Dialogue, GoTo, DriveTo, EnterVehicle, FindVehicle, Checkpoints, Choice, Evade, Ram, Race, Escape, OpenMap, Complete
};

UENUM(BlueprintType)
enum class ECADVehicleRole : uint8
{
	Parked, Player, Traffic, Police, Mission, Rival
};

UENUM(BlueprintType)
enum class ECADWeather : uint8
{
	Clear, Cloudy, Rain, Fog, Snow
};

UENUM(BlueprintType)
enum class ECADSignalState : uint8
{
	Green, Yellow, Red
};

// ------------------------------------------------------------------------------------------------
// Data table rows. Property names == CSV column names (Content/Data/*.csv).
// ------------------------------------------------------------------------------------------------
USTRUCT(BlueprintType)
struct FCADVehicleRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString DisplayName;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Category;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 Price = 0;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float MassKg = 1500.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float AccelMps2 = 5.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float TopSpeedKph = 160.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float BrakeMps2 = 9.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float MaxSteerDeg = 32.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Grip = 1.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float SuspensionHz = 1.7f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float CollisionResistance = 1.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float OffRoad = 0.3f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float LengthM = 4.4f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float WidthM = 1.85f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float HeightM = 1.45f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Color = TEXT("#B0B5BA");
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 TrafficWeight = 10;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) bool Dealer = true;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 RepairPerPoint = 40;
};

USTRUCT(BlueprintType)
struct FCADUpgradeRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString DisplayName;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Category;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 Level = 1;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 Price = 0;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Bonus = 0.f;
};

USTRUCT(BlueprintType)
struct FCADItemRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString DisplayName;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 Price = 0;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Effect;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Description;
};

USTRUCT(BlueprintType)
struct FCADShopRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString DisplayName;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Type;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Location;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Stock;
};

USTRUCT(BlueprintType)
struct FCADPropertyRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString DisplayName;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Location;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 Price = 0;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 IncomePerDay = 0;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 VehicleSlots = 1;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) bool SavePoint = true;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Description;
};

USTRUCT(BlueprintType)
struct FCADLocationRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString DisplayName;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Kind;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString District;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float X = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Y = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Radius = 15.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Description;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 DiscoverReward = 0;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Tags;
};

USTRUCT(BlueprintType)
struct FCADRoadNodeRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float X = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Y = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Z = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) bool Signal = false;
};

USTRUCT(BlueprintType)
struct FCADRoadEdgeRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString A;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString B;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Kind;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) bool OneWay = false;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) bool Bridge = false;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Road;
};

USTRUCT(BlueprintType)
struct FCADRiverRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float X = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Y = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float HalfWidth = 60.f;
};

USTRUCT(BlueprintType)
struct FCADMissionRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Title;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Giver;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Category;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Brief;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Prereq;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString MinRep;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) bool Night = false;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 RewardCash = 0;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 RewardPublic = 0;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 RewardBusiness = 0;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 RewardUnderworld = 0;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString RewardVehicle;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 TimeBonusPerSec = 0;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Optional;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) bool Repeatable = false;
};

USTRUCT(BlueprintType)
struct FCADMissionStageRow : public FTableRowBase
{
	GENERATED_BODY()
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString MissionId;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 Index = 0;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Type;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Text;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Location;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float Radius = 15.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) float TimeLimit = 0.f;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Speaker;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Dialogue;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString Param;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString VehicleId;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString ChoiceA;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString ChoiceB;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString ChoiceC;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 JumpA = -1;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 JumpB = -1;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) int32 JumpC = -1;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString EffectA;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString EffectB;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString EffectC;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) FString OnEnter;
	UPROPERTY(EditAnywhere, BlueprintReadWrite) bool Checkpoint = true;
};

// ------------------------------------------------------------------------------------------------
// Persistent profile (saved). Keep field additions backward compatible and bump CAD_SAVE_VERSION.
// ------------------------------------------------------------------------------------------------
static constexpr int32 CAD_SAVE_VERSION = 1;

USTRUCT(BlueprintType)
struct FCADTransaction
{
	GENERATED_BODY()
	UPROPERTY(SaveGame) FString Description;
	UPROPERTY(SaveGame) int32 Amount = 0;
	UPROPERTY(SaveGame) int32 BalanceAfter = 0;
	UPROPERTY(SaveGame) FString Stamp;
};

USTRUCT(BlueprintType)
struct FCADOwnedVehicle
{
	GENERATED_BODY()
	UPROPERTY(SaveGame) FGuid Id;
	UPROPERTY(SaveGame) FName VehicleId;
	UPROPERTY(SaveGame) FLinearColor Paint = FLinearColor(0.5f, 0.5f, 0.5f, 1.f);
	UPROPERTY(SaveGame) int32 Engine = 0;
	UPROPERTY(SaveGame) int32 Brakes = 0;
	UPROPERTY(SaveGame) int32 Handling = 0;
	UPROPERTY(SaveGame) int32 Wheels = 0;
	UPROPERTY(SaveGame) float Health = 100.f;
};

USTRUCT(BlueprintType)
struct FCADProfile
{
	GENERATED_BODY()
	UPROPERTY(SaveGame) int32 Version = CAD_SAVE_VERSION;
	UPROPERTY(SaveGame) int32 Cash = 300;
	UPROPERTY(SaveGame) int32 Bank = 0;
	UPROPERTY(SaveGame) TArray<FCADTransaction> History;
	UPROPERTY(SaveGame) TArray<FCADOwnedVehicle> Vehicles;
	UPROPERTY(SaveGame) FGuid ActiveVehicle;
	UPROPERTY(SaveGame) FVector ActiveVehicleLocation = FVector::ZeroVector;
	UPROPERTY(SaveGame) FRotator ActiveVehicleRotation = FRotator::ZeroRotator;
	UPROPERTY(SaveGame) TArray<FName> CompletedMissions;
	UPROPERTY(SaveGame) TMap<FName, int32> MissionBestBonus;
	UPROPERTY(SaveGame) TArray<FName> Flags;
	UPROPERTY(SaveGame) TArray<FName> OwnedProperties;
	UPROPERTY(SaveGame) TArray<FName> Discovered;
	UPROPERTY(SaveGame) TArray<FName> RewardKeys;
	UPROPERTY(SaveGame) TMap<FName, int32> Inventory;
	UPROPERTY(SaveGame) int32 RepPublic = 0;
	UPROPERTY(SaveGame) int32 RepBusiness = 0;
	UPROPERTY(SaveGame) int32 RepUnderworld = 0;
	UPROPERTY(SaveGame) float Health = 100.f;
	UPROPERTY(SaveGame) FVector PlayerLocation = FVector::ZeroVector;
	UPROPERTY(SaveGame) float PlayerYaw = 0.f;
	UPROPERTY(SaveGame) float TimeOfDay = 9.f;
	UPROPERTY(SaveGame) int32 Day = 1;
	UPROPERTY(SaveGame) uint8 Weather = 0;
	UPROPERTY(SaveGame) float PlaySeconds = 0.f;
	UPROPERTY(SaveGame) FString SavedAt;
	UPROPERTY(SaveGame) int32 DeliveriesDone = 0;

	bool HasFlag(FName F) const { return Flags.Contains(F); }
	void AddFlag(FName F) { Flags.AddUnique(F); }
};

USTRUCT(BlueprintType)
struct FCADSettings
{
	GENERATED_BODY()
	UPROPERTY(SaveGame) float MouseSensitivity = 1.0f;
	UPROPERTY(SaveGame) bool bInvertY = false;
	UPROPERTY(SaveGame) float FieldOfView = 90.f;
	UPROPERTY(SaveGame) float MasterVolume = 0.8f;
	UPROPERTY(SaveGame) int32 TrafficDensity = 2;    // 0 off, 1 low, 2 normal, 3 high
	UPROPERTY(SaveGame) int32 PedestrianDensity = 2;
	UPROPERTY(SaveGame) int32 ViewDistanceLevel = 2; // 1 near, 2 medium, 3 far
	UPROPERTY(SaveGame) bool bMinimapRotates = true;
	UPROPERTY(SaveGame) int32 OutfitIndex = 0;
	UPROPERTY(SaveGame) TMap<FName, FKey> KeyBindings;
};
