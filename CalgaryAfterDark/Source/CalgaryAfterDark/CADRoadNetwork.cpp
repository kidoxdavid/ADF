#include "CADRoadNetwork.h"
#include "CalgaryAfterDark.h"
#include "Algo/Reverse.h"

float FCADRoadNetwork::DefaultSpeedKph(ECADRoadKind K)
{
	switch (K)
	{
	case ECADRoadKind::Highway: return 100.f;
	case ECADRoadKind::Expressway: return 80.f;
	case ECADRoadKind::Arterial: return 60.f;
	case ECADRoadKind::Collector: return 50.f;
	case ECADRoadKind::Local: return 40.f;
	case ECADRoadKind::Ramp: return 50.f;
	case ECADRoadKind::Industrial: return 50.f;
	case ECADRoadKind::Service: return 30.f;
	default: return 0.f;
	}
}

int32 FCADRoadNetwork::DefaultLanes(ECADRoadKind K)
{
	switch (K)
	{
	case ECADRoadKind::Highway: return 3;
	case ECADRoadKind::Expressway: return 2;
	case ECADRoadKind::Arterial: return 2;
	case ECADRoadKind::Industrial: return 2;
	case ECADRoadKind::Path: return 0;
	default: return 1;
	}
}

void FCADRoadNetwork::Finalize()
{
	for (FCADRoadNode& N : Nodes)
	{
		N.Edges.Reset();
		N.Radius = 250.f;
	}
	Grid.Reset();

	for (int32 i = 0; i < Edges.Num(); ++i)
	{
		FCADRoadEdge& E = Edges[i];
		const FVector PA = Nodes[E.A].Pos, PB = Nodes[E.B].Pos;
		const FVector2D D2(PB.X - PA.X, PB.Y - PA.Y);
		E.Length = CADMath::Max(D2.Size(), 1.f);
		E.Dir = D2 / E.Length;
		E.LanesPerDir = DefaultLanes(E.Kind);
		E.SpeedKph = DefaultSpeedKph(E.Kind);
		if (E.Kind == ECADRoadKind::Path)
		{
			E.HalfWidth = 250.f;
		}
		else
		{
			E.HalfWidth = (E.bOneWay ? E.LanesPerDir * LaneWidth : E.LanesPerDir * 2.f * LaneWidth) * 0.5f;
			if (E.Kind == ECADRoadKind::Highway) E.HalfWidth += 150.f;
		}
		Nodes[E.A].Edges.Add(i);
		Nodes[E.B].Edges.Add(i);
		if (E.IsVehicle())
		{
			Nodes[E.A].Radius = CADMath::Max(Nodes[E.A].Radius, E.HalfWidth + 150.f);
			Nodes[E.B].Radius = CADMath::Max(Nodes[E.B].Radius, E.HalfWidth + 150.f);
		}

		const FIntPoint C0 = CellOf(CADMath::Min(PA.X, PB.X), CADMath::Min(PA.Y, PB.Y));
		const FIntPoint C1 = CellOf(CADMath::Max(PA.X, PB.X), CADMath::Max(PA.Y, PB.Y));
		for (int32 cx = C0.X; cx <= C1.X; ++cx)
		{
			for (int32 cy = C0.Y; cy <= C1.Y; ++cy)
			{
				Grid.FindOrAdd(FIntPoint(cx, cy)).Add(i);
			}
		}
	}
	UE_LOG(LogCAD, Log, TEXT("Road network built: %d nodes, %d edges"), Nodes.Num(), Edges.Num());
}

FVector FCADRoadNetwork::PointOnEdge(int32 Edge, float T) const
{
	const FCADRoadEdge& E = Edges[Edge];
	return CADMath::Lerp(Nodes[E.A].Pos, Nodes[E.B].Pos, T);
}

float FCADRoadNetwork::LaneOffset(const FCADRoadEdge& E, int32 Lane) const
{
	Lane = CADMath::Clamp(Lane, 0, CADMath::Max(0, E.LanesPerDir - 1));
	if (E.bOneWay)
	{
		return (Lane + 0.5f - E.LanesPerDir * 0.5f) * LaneWidth;
	}
	return (Lane + 0.5f) * LaneWidth;
}

// ----------------------------------------------------------------------------------------------
// Spatial queries
// ----------------------------------------------------------------------------------------------
void FCADRoadNetwork::EdgesNear(const FVector& P, float Radius, TArray<int32>& Out) const
{
	Out.Reset();
	const FIntPoint C0 = CellOf(P.X - Radius, P.Y - Radius);
	const FIntPoint C1 = CellOf(P.X + Radius, P.Y + Radius);
	TSet<int32> Seen;
	for (int32 cx = C0.X; cx <= C1.X; ++cx)
	{
		for (int32 cy = C0.Y; cy <= C1.Y; ++cy)
		{
			if (const TArray<int32>* L = Grid.Find(FIntPoint(cx, cy)))
			{
				for (int32 E : *L)
				{
					bool bAlready = false;
					Seen.Add(E, &bAlready);
					if (!bAlready) Out.Add(E);
				}
			}
		}
	}
}

int32 FCADRoadNetwork::NearestNode(const FVector& P, bool bVehicleOnly) const
{
	int32 Best = INDEX_NONE;
	float BestD = TNumericLimits<float>::Max();
	TArray<int32> Near;
	for (float R : { 20000.f, 60000.f, 200000.f, 1000000.f })
	{
		EdgesNear(P, R, Near);
		for (int32 ei : Near)
		{
			const FCADRoadEdge& E = Edges[ei];
			if (bVehicleOnly && !E.IsVehicle()) continue;
			for (int32 n : { E.A, E.B })
			{
				const float D = FVector::DistSquared(Nodes[n].Pos, P);
				if (D < BestD) { BestD = D; Best = n; }
			}
		}
		if (Best != INDEX_NONE) break;
	}
	return Best;
}

bool FCADRoadNetwork::NearestEdge(const FVector& P, bool bVehicleOnly, int32& OutEdge, float& OutT, float& OutDist) const
{
	OutEdge = INDEX_NONE;
	OutDist = TNumericLimits<float>::Max();
	TArray<int32> Near;
	for (float R : { 15000.f, 50000.f, 200000.f })
	{
		EdgesNear(P, R, Near);
		for (int32 ei : Near)
		{
			const FCADRoadEdge& E = Edges[ei];
			if (bVehicleOnly && !E.IsVehicle()) continue;
			const FVector A = Nodes[E.A].Pos, B = Nodes[E.B].Pos;
			const FVector AB = B - A;
			const float L2 = AB.SizeSquared();
			const float T = L2 > 0.f ? CADMath::Clamp(FVector::DotProduct(P - A, AB) / L2, 0.f, 1.f) : 0.f;
			const float D = FVector::Dist(P, A + AB * T);
			if (D < OutDist) { OutDist = D; OutEdge = ei; OutT = T; }
		}
		if (OutEdge != INDEX_NONE && OutDist < R * 0.8f) break;
	}
	return OutEdge != INDEX_NONE;
}

float FCADRoadNetwork::RoadClearance(const FVector2D& P, bool bIncludePaths) const
{
	float Best = TNumericLimits<float>::Max();
	TArray<int32> Near;
	EdgesNear(FVector(P.X, P.Y, 0.f), 9000.f, Near);
	for (int32 ei : Near)
	{
		const FCADRoadEdge& E = Edges[ei];
		if (!bIncludePaths && !E.IsVehicle()) continue;
		const FVector2D A(Nodes[E.A].Pos.X, Nodes[E.A].Pos.Y), B(Nodes[E.B].Pos.X, Nodes[E.B].Pos.Y);
		const FVector2D AB = B - A;
		const float L2 = AB.SizeSquared();
		const float T = L2 > 0.f ? CADMath::Clamp(FVector2D::DotProduct(P - A, AB) / L2, 0.f, 1.f) : 0.f;
		const float D = FVector2D::Distance(P, A + AB * T) - E.HalfWidth;
		Best = CADMath::Min(Best, D);
	}
	return Best;
}

// ----------------------------------------------------------------------------------------------
// Routing
// ----------------------------------------------------------------------------------------------
bool FCADRoadNetwork::GetSuccessors(const FCADDirEdge& S, TArray<FCADDirEdge>& Out) const
{
	Out.Reset();
	const int32 N = ToNode(S);
	const FVector2D H = DirOf(S);
	for (int32 ei : Nodes[N].Edges)
	{
		if (ei == S.Edge) continue;
		const FCADRoadEdge& E = Edges[ei];
		if (!E.IsVehicle()) continue;
		FCADDirEdge Cand;
		Cand.Edge = ei;
		if (E.A == N) { Cand.bForward = true; }
		else if (E.B == N && !E.bOneWay) { Cand.bForward = false; }
		else continue;
		if (FVector2D::DotProduct(H, DirOf(Cand)) >= MaxTurnCos)
		{
			Out.Add(Cand);
		}
	}
	if (Out.Num() == 0 && !Edges[S.Edge].bOneWay)
	{
		FCADDirEdge U;
		U.Edge = S.Edge;
		U.bForward = !S.bForward;   // dead end: turn around
		Out.Add(U);
	}
	return Out.Num() > 0;
}

namespace
{
	struct FOpenItem { int32 State; float F; };
	struct FOpenPred { bool operator()(const FOpenItem& A, const FOpenItem& B) const { return A.F < B.F; } };
}

bool FCADRoadNetwork::FindRoute(const FCADDirEdge& Start, int32 GoalNode, TArray<FCADDirEdge>& OutRoute) const
{
	OutRoute.Reset();
	if (!Start.IsValid() || !Nodes.IsValidIndex(GoalNode)) return false;
	const FVector GoalPos = Nodes[GoalNode].Pos;
	const int32 NumStates = Edges.Num() * 2;
	TArray<float> G;
	G.Init(TNumericLimits<float>::Max(), NumStates);
	TArray<int32> Parent;
	Parent.Init(INDEX_NONE, NumStates);
	TBitArray<> Closed(false, NumStates);

	auto EdgeCost = [this](const FCADDirEdge& D)
	{
		const FCADRoadEdge& E = Edges[D.Edge];
		const float Mps = CADMath::Max(E.SpeedKph, 20.f) / 3.6f;
		float Cost = (E.Length / 100.f) / Mps;
		if (Nodes[ToNode(D)].bSignal) Cost += 5.f;
		return Cost;
	};
	const float MaxMps = 110.f / 3.6f;

	TArray<FOpenItem> Open;
	const int32 S0 = Start.StateIndex();
	G[S0] = EdgeCost(Start);
	Open.HeapPush(FOpenItem{ S0, G[S0] }, FOpenPred());

	TArray<FCADDirEdge> Succ;
	int32 GoalState = INDEX_NONE;
	int32 Iterations = 0;
	while (Open.Num() > 0 && Iterations++ < 60000)
	{
		FOpenItem Cur;
		Open.HeapPop(Cur, FOpenPred());
		if (Closed[Cur.State]) continue;
		Closed[Cur.State] = true;
		const FCADDirEdge CD = FCADDirEdge::FromState(Cur.State);
		if (ToNode(CD) == GoalNode) { GoalState = Cur.State; break; }
		GetSuccessors(CD, Succ);
		for (const FCADDirEdge& N : Succ)
		{
			const int32 NS = N.StateIndex();
			if (Closed[NS]) continue;
			const float Turn = FVector2D::DotProduct(DirOf(CD), DirOf(N)) < 0.9f ? 1.5f : 0.f;
			const float NG = G[Cur.State] + EdgeCost(N) + Turn;
			if (NG < G[NS])
			{
				G[NS] = NG;
				Parent[NS] = Cur.State;
				const float H = (FVector::Dist2D(Nodes[ToNode(N)].Pos, GoalPos) / 100.f) / MaxMps;
				Open.HeapPush(FOpenItem{ NS, NG + H }, FOpenPred());
			}
		}
	}
	if (GoalState == INDEX_NONE) return false;
	for (int32 S = GoalState; S != INDEX_NONE; S = Parent[S])
	{
		OutRoute.Add(FCADDirEdge::FromState(S));
	}
	Algo::Reverse(OutRoute);
	return true;
}

bool FCADRoadNetwork::ProjectToLane(const FVector& P, const FVector& Heading, FCADDirEdge& Out, float& OutT) const
{
	int32 Edge; float T, Dist;
	if (!NearestEdge(P, true, Edge, T, Dist)) return false;
	const FCADRoadEdge& E = Edges[Edge];
	const FVector2D H = FVector2D(Heading.X, Heading.Y).GetSafeNormal();
	bool bFwd = FVector2D::DotProduct(H, E.Dir) >= 0.f;
	if (E.bOneWay) bFwd = true;
	Out.Edge = Edge;
	Out.bForward = bFwd;
	OutT = T;
	return true;
}

bool FCADRoadNetwork::FindRouteBetween(const FVector& From, const FVector& Heading, const FVector& To, TArray<FCADDirEdge>& OutRoute) const
{
	FCADDirEdge Start; float T;
	if (!ProjectToLane(From, Heading, Start, T)) return false;
	const int32 Goal = NearestNode(To, true);
	if (Goal == INDEX_NONE) return false;
	if (ToNode(Start) == Goal)
	{
		OutRoute = { Start };
		return true;
	}
	return FindRoute(Start, Goal, OutRoute);
}

void FCADRoadNetwork::BuildLanePath(const TArray<FCADDirEdge>& Route, int32 Lane, TArray<FCADLanePoint>& Out) const
{
	Out.Reset();
	if (Route.Num() == 0) return;

	auto Right2 = [](const FVector2D& D) { return FVector2D(-D.Y, D.X); };
	auto LanePos = [&](const FCADDirEdge& D, bool bAtEnd) -> FVector
	{
		const FCADRoadEdge& E = Edges[D.Edge];
		const FVector Base = Nodes[bAtEnd ? ToNode(D) : FromNode(D)].Pos;
		const FVector2D R = Right2(DirOf(D)) * LaneOffset(E, Lane);
		return FVector(Base.X + R.X, Base.Y + R.Y, Base.Z);
	};

	{
		FCADLanePoint P;
		P.Pos = LanePos(Route[0], false);
		P.SpeedKph = Edges[Route[0].Edge].SpeedKph;
		Out.Add(P);
	}
	for (int32 i = 0; i < Route.Num(); ++i)
	{
		const FCADDirEdge& D = Route[i];
		const FCADRoadEdge& E = Edges[D.Edge];
		if (i + 1 >= Route.Num())
		{
			FCADLanePoint P;
			P.Pos = LanePos(D, true);
			P.SpeedKph = E.SpeedKph;
			Out.Add(P);
			break;
		}
		const FCADDirEdge& Nx = Route[i + 1];
		const FCADRoadEdge& NE = Edges[Nx.Edge];
		const int32 N = ToNode(D);
		const FVector2D D1 = DirOf(D), D2 = DirOf(Nx);
		const float Setback = CADMath::Min3(Nodes[N].Radius * 0.9f, E.Length * 0.35f, NE.Length * 0.35f);

		const FVector End = LanePos(D, true);
		const FVector Start2 = LanePos(Nx, false);
		const FVector Pb = End - FVector(D1.X, D1.Y, 0.f) * Setback;
		const FVector Pa = Start2 + FVector(D2.X, D2.Y, 0.f) * Setback;

		FCADLanePoint StopLine;
		StopLine.Pos = Pb;
		StopLine.SpeedKph = E.SpeedKph;
		if (Nodes[N].bSignal)
		{
			StopLine.StopNode = N;
			StopLine.StopEdge = D.Edge;
		}
		Out.Add(StopLine);

		const float Cross = D1.X * D2.Y - D1.Y * D2.X;
		const float Dot = FVector2D::DotProduct(D1, D2);
		const float TurnDeg = FMath::RadiansToDegrees(FMath::Acos(CADMath::Clamp(Dot, -1.f, 1.f)));
		float TurnSpeed = CADMath::Min(E.SpeedKph, NE.SpeedKph);
		if (TurnDeg > 60.f) TurnSpeed = CADMath::Min(TurnSpeed, 22.f);
		else if (TurnDeg > 25.f) TurnSpeed = CADMath::Min(TurnSpeed, 32.f);

		FVector Control = (Pb + Pa) * 0.5f;
		if (FMath::Abs(Cross) > 0.05f)
		{
			// intersection of Pb + t*D1 and Pa - u*D2
			const FVector2D Diff(Pa.X - Pb.X, Pa.Y - Pb.Y);
			const float T = (Diff.X * D2.Y - Diff.Y * D2.X) / Cross;
			Control = Pb + FVector(D1.X, D1.Y, 0.f) * CADMath::Clamp(T, 0.f, Setback * 4.f);
		}
		for (float S : { 0.25f, 0.5f, 0.75f })
		{
			const float Om = 1.f - S;
			FCADLanePoint P;
			P.Pos = Pb * (Om * Om) + Control * (2.f * Om * S) + Pa * (S * S);
			P.SpeedKph = TurnSpeed;
			Out.Add(P);
		}
		FCADLanePoint P;
		P.Pos = Pa;
		P.SpeedKph = CADMath::Min(TurnSpeed + 10.f, NE.SpeedKph);
		Out.Add(P);
	}
}

void FCADRoadNetwork::BuildCentreline(const TArray<FCADDirEdge>& Route, TArray<FVector>& Out) const
{
	Out.Reset();
	for (int32 i = 0; i < Route.Num(); ++i)
	{
		if (i == 0) Out.Add(Nodes[FromNode(Route[i])].Pos);
		Out.Add(Nodes[ToNode(Route[i])].Pos);
	}
}

// ----------------------------------------------------------------------------------------------
// Signals: pure function of time, so visuals and AI always agree and nothing needs ticking.
// ----------------------------------------------------------------------------------------------
int32 FCADRoadNetwork::SignalGroup(int32 Node, int32 Edge) const
{
	const FCADRoadEdge& E = Edges[Edge];
	const FVector2D Out = (E.A == Node) ? E.Dir : -E.Dir;
	return FMath::Abs(Out.X) > FMath::Abs(Out.Y) ? 0 : 1;
}

ECADSignalState FCADRoadNetwork::SignalState(int32 Node, int32 Edge, double TimeSeconds) const
{
	static constexpr float Cycle = 38.f;
	const float T = FMath::Fmod(static_cast<float>(TimeSeconds) + static_cast<float>((Node * 37) % 38), Cycle);
	if (SignalGroup(Node, Edge) == 0)
	{
		if (T < 14.f) return ECADSignalState::Green;
		if (T < 17.f) return ECADSignalState::Yellow;
		return ECADSignalState::Red;
	}
	if (T >= 19.f && T < 33.f) return ECADSignalState::Green;
	if (T >= 33.f && T < 36.f) return ECADSignalState::Yellow;
	return ECADSignalState::Red;
}

FVector FCADRoadNetwork::SidewalkPoint(int32 Edge, float T, int32 Side) const
{
	const FCADRoadEdge& E = Edges[Edge];
	const FVector P = PointOnEdge(Edge, T);
	if (E.Kind == ECADRoadKind::Path) return P;
	const FVector2D R(-E.Dir.Y, E.Dir.X);
	const float Off = (E.HalfWidth + 110.f) * (Side >= 0 ? 1.f : -1.f);
	return FVector(P.X + R.X * Off, P.Y + R.Y * Off, P.Z + 22.f);
}
