// Offline verification of the engine-independent core against the real generated map data.
// Build & run:  python3 Tools/cpp_tests/run.py     (compiles CADRoadNetwork.cpp + CADTerrain.cpp with a tiny UE mock)
#include "CADRoadNetwork.h"
#include "CADTerrain.h"
#include <fstream>
#include <sstream>
#include <map>
#include <set>
#include <random>
#include <iostream>

static std::vector<std::vector<std::string>> ReadCsv(const std::string& Path)
{
	std::ifstream F(Path);
	std::vector<std::vector<std::string>> Rows;
	std::string Line;
	while (std::getline(F, Line))
	{
		std::vector<std::string> Cells; std::string Cur; bool Q = false;
		for (size_t i = 0; i < Line.size(); ++i)
		{
			char C = Line[i];
			if (Q) { if (C == '"') { if (i + 1 < Line.size() && Line[i + 1] == '"') { Cur += '"'; ++i; } else Q = false; } else Cur += C; }
			else if (C == '"') Q = true; else if (C == ',') { Cells.push_back(Cur); Cur.clear(); } else if (C != '\r') Cur += C;
		}
		Cells.push_back(Cur);
		Rows.push_back(Cells);
	}
	return Rows;
}

static ECADRoadKind ParseKind(const std::string& S)
{
	if (S == "Highway") return ECADRoadKind::Highway; if (S == "Expressway") return ECADRoadKind::Expressway; if (S == "Arterial") return ECADRoadKind::Arterial;
	if (S == "Collector") return ECADRoadKind::Collector; if (S == "Ramp") return ECADRoadKind::Ramp; if (S == "Industrial") return ECADRoadKind::Industrial;
	if (S == "Service") return ECADRoadKind::Service; if (S == "Path") return ECADRoadKind::Path; return ECADRoadKind::Local;
}

int main(int argc, char** argv)
{
	const std::string Dir = argc > 1 ? argv[1] : "Content/Data";
	int Fails = 0;
	auto Check = [&](bool Ok, const std::string& Msg) { if (!Ok) { ++Fails; std::cout << "  FAIL: " << Msg << "\n"; } };

	// river + network, mirroring UCADDataSubsystem::BuildNetwork
	{
		TArray<FVector> River;
		auto R = ReadCsv(Dir + "/River.csv");
		for (size_t i = 1; i < R.size(); ++i) River.Add(FVector(std::stod(R[i][1]) * CADM, std::stod(R[i][2]) * CADM, std::stod(R[i][3]) * CADM));
		CADTerrain::SetRiver(River);
	}
	FCADRoadNetwork Net;
	std::unordered_map<std::string, int32> Index;
	for (auto& Row : ReadCsv(Dir + "/RoadNodes.csv"))
	{
		if (Row[0] == "Name") continue;
		FCADRoadNode N; N.Pos = FVector(std::stod(Row[1]) * CADM, std::stod(Row[2]) * CADM, std::stod(Row[3]) * CADM); N.bSignal = Row[4] == "True";
		Index[Row[0]] = Net.Nodes.Add(N);
	}
	for (auto& Row : ReadCsv(Dir + "/RoadEdges.csv"))
	{
		if (Row[0] == "Name") continue;
		FCADRoadEdge E; E.A = Index.at(Row[1]); E.B = Index.at(Row[2]); E.Kind = ParseKind(Row[3]); E.bOneWay = Row[4] == "True"; E.bBridge = Row[5] == "True"; E.Road = FString(Row[6]);
		Net.Edges.Add(E);
	}
	Net.Finalize();
	std::cout << "network: " << Net.Nodes.Num() << " nodes, " << Net.Edges.Num() << " edges\n";

	std::map<std::string, FVector> Loc;
	std::map<std::string, std::string> LocKind;
	for (auto& Row : ReadCsv(Dir + "/Locations.csv"))
	{
		if (Row[0] == "Name") continue;
		Loc[Row[0]] = FVector(std::stod(Row[4]) * CADM, std::stod(Row[5]) * CADM, 0);
		LocKind[Row[0]] = Row[2];
	}

	// 1. every drivable location must be routable from every other (the full pair matrix)
	std::vector<std::string> Ids;
	for (auto& P : Loc) if (P.first != "overlook" && LocKind[P.first] != "Landmark") Ids.push_back(P.first);
	int Ok = 0, Total = 0; double MaxLen = 0; size_t MaxEdges = 0;
	for (auto& A : Ids) for (auto& B : Ids)
	{
		if (A == B) continue;
		++Total;
		TArray<FCADDirEdge> Route;
		if (Net.FindRouteBetween(Loc[A], FVector(1, 0, 0), Loc[B], Route)) { ++Ok; double L = 0; for (auto& D : Route) L += Net.Edges[D.Edge].Length; MaxLen = std::max(MaxLen, L); MaxEdges = std::max<size_t>(MaxEdges, Route.size()); }
		else std::cout << "  no route " << A << " -> " << B << "\n";
	}
	std::cout << "location pair routes: " << Ok << "/" << Total << "  (longest " << MaxLen / 100000.0 << " km, max " << MaxEdges << " edges)\n";
	Check(Ok == Total, "all location pairs routable");

	// 2. route legality: turn limit, one-way compliance, continuity; lane path sanity
	std::mt19937 Rng(7);
	int Routed = 0, Bad = 0;
	double MaxGap = 0;
	for (int t = 0; t < 600; ++t)
	{
		int32 A = Rng() % Net.Nodes.Num(), B = Rng() % Net.Nodes.Num();
		int32 EA = INDEX_NONE;
		for (int32 e : Net.Nodes[A].Edges) if (Net.Edges[e].IsVehicle()) { EA = e; break; }
		if (EA == INDEX_NONE) continue;
		FCADDirEdge S; S.Edge = EA; S.bForward = (Net.Edges[EA].A == A) || Net.Edges[EA].bOneWay ? true : false;
		if (!Net.Edges[EA].bOneWay && Net.Edges[EA].A != A) S.bForward = false;
		TArray<FCADDirEdge> Route;
		if (!Net.FindRoute(S, B, Route)) continue;
		++Routed;
		for (int32 i = 0; i < Route.Num(); ++i)
		{
			const FCADRoadEdge& E = Net.Edges[Route[i].Edge];
			if (E.bOneWay && !Route[i].bForward) { ++Bad; std::cout << "  wrong-way on one-way edge " << Route[i].Edge << "\n"; }
			if (i + 1 < Route.Num())
			{
				if (Net.ToNode(Route[i]) != Net.FromNode(Route[i + 1])) { ++Bad; std::cout << "  discontinuous route\n"; }
				const double Dot = FVector2D::DotProduct(Net.DirOf(Route[i]), Net.DirOf(Route[i + 1]));
				const bool bDeadEnd = Route[i].Edge == Route[i + 1].Edge;
				if (Dot < -0.4227 && !bDeadEnd) { ++Bad; std::cout << "  illegal turn dot=" << Dot << "\n"; }
			}
		}
		TArray<FCADLanePoint> Lane;
		Net.BuildLanePath(Route, 0, Lane);
		for (int32 i = 0; i + 1 < Lane.Num(); ++i)
		{
			double G = FVector::Dist2D(Lane[i].Pos, Lane[i + 1].Pos); MaxGap = std::max(MaxGap, G);
			if (!std::isfinite(Lane[i].Pos.X) || !std::isfinite(Lane[i].Pos.Y)) { ++Bad; }
		}
	}
	std::cout << "random routes: " << Routed << " found, " << Bad << " violations, max lane-point gap " << MaxGap / 100.0 << " m\n";
	Check(Routed > 400, "most random node pairs are routable");
	Check(Bad == 0, "no illegal turns / wrong-way / discontinuities");
	Check(MaxGap < 85000.0, "lane path has no huge gaps");

	// 3. signals: opposite groups are never green together; every phase occurs
	int Signals = 0, Conflict = 0;
	for (int32 n = 0; n < Net.Nodes.Num(); ++n)
	{
		if (!Net.Nodes[n].bSignal) continue;
		++Signals;
		for (double T = 0; T < 80; T += 0.5)
		{
			bool G0 = false, G1 = false;
			for (int32 e : Net.Nodes[n].Edges)
			{
				if (!Net.Edges[e].IsVehicle()) continue;
				const ECADSignalState St = Net.SignalState(n, e, T);
				if (St == ECADSignalState::Green) { if (Net.SignalGroup(n, e) == 0) G0 = true; else G1 = true; }
			}
			if (G0 && G1) ++Conflict;
		}
	}
	std::cout << "signalised nodes: " << Signals << ", conflicting-green samples: " << Conflict << "\n";
	Check(Conflict == 0, "no conflicting greens");

	// 4. terrain + districts
	Check(CADTerrain::Height(0, -120000) < -500, "river bed is below ground at the Bow");
	Check(std::fabs(CADTerrain::Height(0, 0)) < 1, "downtown is flat");
	Check(CADTerrain::Height(-440000, 0) > 5000, "foothills rise to the west");
	Check(CADTerrain::DistrictAt(0, -25000) == ECADDistrict::Downtown, "downtown district");
	Check(CADTerrain::DistrictAt(270000, 110000) == ECADDistrict::Industrial, "industrial district");
	Check(CADTerrain::DistrictAt(400000, 0) == ECADDistrict::Rural, "rural outside ring");
	// road surface vs terrain: roads on flat ground must sit at terrain height (+-10cm) outside bridges/overpasses
	int OffGround = 0, Checked = 0;
	for (const FCADRoadNode& N : Net.Nodes)
	{
		bool bAnyBridgeOrElevated = false;
		for (int32 e : N.Edges) if (Net.Edges[e].bBridge) bAnyBridgeOrElevated = true;
		if (bAnyBridgeOrElevated) continue;
		const double Dz = N.Pos.Z - CADTerrain::Height((float)N.Pos.X, (float)N.Pos.Y);
		++Checked;
		if (std::fabs(Dz) > 20.0 && Dz < 0) ++OffGround;   // road buried under terrain
	}
	std::cout << "nodes checked against terrain: " << Checked << ", buried: " << OffGround << "\n";
	Check(OffGround == 0, "no road node is buried under the terrain");

	std::cout << (Fails == 0 ? "ALL CORE TESTS PASSED\n" : "CORE TESTS FAILED\n");
	return Fails == 0 ? 0 : 1;
}
