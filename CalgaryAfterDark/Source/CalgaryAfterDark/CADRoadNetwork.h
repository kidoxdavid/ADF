#pragma once

#include "CoreMinimal.h"
#include "CADTypes.h"

struct FCADRoadNode
{
	FVector Pos = FVector::ZeroVector;
	bool bSignal = false;
	float Radius = 700.f;       // intersection pad half-size (cm)
	TArray<int32> Edges;        // incident edges (all kinds)
};

struct FCADRoadEdge
{
	int32 A = 0;
	int32 B = 0;
	ECADRoadKind Kind = ECADRoadKind::Local;
	bool bOneWay = false;
	bool bBridge = false;
	FString Road;
	float Length = 0.f;
	float HalfWidth = 350.f;
	float SpeedKph = 50.f;
	int32 LanesPerDir = 1;
	FVector2D Dir = FVector2D(1, 0);   // unit direction A->B in XY

	bool IsVehicle() const { return Kind != ECADRoadKind::Path; }
};

/** A traversal of an edge: from A to B (bForward) or from B to A. */
struct FCADDirEdge
{
	int32 Edge = INDEX_NONE;
	bool bForward = true;
	bool IsValid() const { return Edge != INDEX_NONE; }
	int32 StateIndex() const { return Edge * 2 + (bForward ? 0 : 1); }
	static FCADDirEdge FromState(int32 S) { FCADDirEdge D; D.Edge = S / 2; D.bForward = (S % 2) == 0; return D; }
};

/** One point of a lane-following path used by driver AI. */
struct FCADLanePoint
{
	FVector Pos = FVector::ZeroVector;
	float SpeedKph = 50.f;
	int32 StopNode = INDEX_NONE;   // set on the stop-line point before a signalised node
	int32 StopEdge = INDEX_NONE;
};

/**
 * Directed road graph loaded from RoadNodes.csv / RoadEdges.csv. Pure C++ (no UObject), shared by
 * traffic, police, missions, pedestrians, the HUD minimap and world generation.
 * Routing: A* over directed edge states; consecutive edges may not turn more than 115 degrees
 * (U-turns are only allowed at dead ends). Tools/generate_map.py validates the data with the same rule.
 */
class FCADRoadNetwork
{
public:
	static constexpr float LaneWidth = 350.f;

	TArray<FCADRoadNode> Nodes;
	TArray<FCADRoadEdge> Edges;

	bool IsBuilt() const { return Nodes.Num() > 0 && Edges.Num() > 0; }

	/** Call after filling Nodes (Pos, bSignal) and Edges (A, B, Kind, bOneWay, bBridge, Road). */
	void Finalize();

	static float DefaultSpeedKph(ECADRoadKind K);
	static int32 DefaultLanes(ECADRoadKind K);

	FVector NodePos(int32 N) const { return Nodes[N].Pos; }
	int32 FromNode(const FCADDirEdge& D) const { return D.bForward ? Edges[D.Edge].A : Edges[D.Edge].B; }
	int32 ToNode(const FCADDirEdge& D) const { return D.bForward ? Edges[D.Edge].B : Edges[D.Edge].A; }
	FVector2D DirOf(const FCADDirEdge& D) const { return D.bForward ? Edges[D.Edge].Dir : -Edges[D.Edge].Dir; }
	FVector PointOnEdge(int32 Edge, float T) const;
	float LaneOffset(const FCADRoadEdge& E, int32 Lane) const;

	// --- spatial queries ---------------------------------------------------------------------------
	void EdgesNear(const FVector& P, float Radius, TArray<int32>& Out) const;
	int32 NearestNode(const FVector& P, bool bVehicleOnly = true) const;
	bool NearestEdge(const FVector& P, bool bVehicleOnly, int32& OutEdge, float& OutT, float& OutDist) const;
	/** Smallest (distance to any road centre line minus its half width) in cm, 2D. Negative = on a road. */
	float RoadClearance(const FVector2D& P, bool bIncludePaths = true) const;

	// --- routing -----------------------------------------------------------------------------------
	bool GetSuccessors(const FCADDirEdge& S, TArray<FCADDirEdge>& Out) const;
	bool FindRoute(const FCADDirEdge& Start, int32 GoalNode, TArray<FCADDirEdge>& OutRoute) const;
	/** Route from an arbitrary position and heading to a goal position. */
	bool FindRouteBetween(const FVector& From, const FVector& Heading, const FVector& To, TArray<FCADDirEdge>& OutRoute) const;
	/** Picks the directed edge under P that best matches Heading (XY). */
	bool ProjectToLane(const FVector& P, const FVector& Heading, FCADDirEdge& Out, float& OutT) const;

	void BuildLanePath(const TArray<FCADDirEdge>& Route, int32 Lane, TArray<FCADLanePoint>& Out) const;
	/** Centre-line polyline of a route (map overlay). */
	void BuildCentreline(const TArray<FCADDirEdge>& Route, TArray<FVector>& Out) const;

	// --- signals -----------------------------------------------------------------------------------
	int32 SignalGroup(int32 Node, int32 Edge) const;
	ECADSignalState SignalState(int32 Node, int32 Edge, double TimeSeconds) const;

	// --- pedestrians -------------------------------------------------------------------------------
	FVector SidewalkPoint(int32 Edge, float T, int32 Side) const;

private:
	static constexpr float CellSize = 20000.f;
	TMap<FIntPoint, TArray<int32>> Grid;
	FIntPoint CellOf(float X, float Y) const { return FIntPoint(FMath::FloorToInt(X / CellSize), FMath::FloorToInt(Y / CellSize)); }
	static constexpr float MaxTurnCos = -0.4226f; // cos(115 deg)
};
