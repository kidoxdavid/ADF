#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "CADRoadNetwork.h"
#include "CADVehicleDriver.generated.h"

class ACADVehicle;

UENUM()
enum class ECADDriverMode : uint8
{
	Idle,
	FollowRoute,   // lane-following along an A* route (traffic, convoys, race rivals)
	Pursue         // police / rival pursuit of an actor
};

/**
 * Drives an ACADVehicle by writing throttle/steer/brake inputs: pure-pursuit lane following on the road
 * graph, speed limits, corner/obstacle/signal-aware speed planning, stuck recovery, and pursuit steering.
 */
UCLASS()
class CALGARYAFTERDARK_API UCADVehicleDriver : public UActorComponent
{
	GENERATED_BODY()
public:
	UCADVehicleDriver();
	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

	ECADDriverMode Mode = ECADDriverMode::Idle;
	float SpeedFactor = 1.f;          // fraction of the posted limit
	bool bObeySignals = true;
	bool bAvoidTarget = false;        // brake for the pursuit target too
	bool bFinished = false;           // route complete
	bool bGiveUp = false;             // hopelessly stuck: owner may despawn
	int32 Lane = 0;
	TWeakObjectPtr<AActor> Target;
	DECLARE_MULTICAST_DELEGATE_OneParam(FOnRouteFinished, UCADVehicleDriver*);
	FOnRouteFinished OnRouteFinished;

	/** Plans a lane path from the vehicle's current position and heading to Dest. */
	bool PlanTo(const FVector& Dest);
	/** Plans a path through several waypoints in order. */
	bool PlanVia(const TArray<FVector>& Waypoints);
	void SetRoute(const TArray<FCADDirEdge>& InRoute);
	void StartPursuit(AActor* InTarget, float InSpeedFactor);
	void Stop();
	float RouteRemainingCm() const;
	FVector LastGoal = FVector::ZeroVector;
	const TArray<FCADDirEdge>& GetRoute() const { return Route; }

private:
	TArray<FCADDirEdge> Route;
	TArray<FCADLanePoint> Path;
	int32 PathIdx = 0;
	float StuckTime = 0.f;
	float ReverseTime = 0.f;
	int32 StuckCount = 0;
	float ReplanClock = 0.f;
	FVector LastPlannedTarget = FVector::ZeroVector;

	ACADVehicle* Veh() const;
	const FCADRoadNetwork* Net() const;
	void DriveFollow(float Dt);
	void DrivePursue(float Dt);
	/** Writes throttle/brake to hit DesiredCms; returns nothing. */
	void ApplySpeed(float DesiredCms, float CurrentCms);
	float ObstacleSpeed(float CurrentCms, bool bIgnoreTarget) const;
	void HandleStuck(float Dt, float DesiredCms, float CurrentCms);
};
