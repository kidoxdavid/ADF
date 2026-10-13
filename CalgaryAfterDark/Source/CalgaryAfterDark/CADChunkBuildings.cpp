// Second half of ACADChunk: sidewalks, street furniture, buildings, props, water and world bounds.
#include "CADChunk.h"
#include "CADAssets.h"
#include "CADDataSubsystem.h"
#include "CADRoadNetwork.h"
#include "CADTerrain.h"
#include "CalgaryAfterDark.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/BoxComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"

namespace
{
	FLinearColor Lin(float R, float G, float B) { return FLinearColor(R, G, B, 1.f); }
	float YawOf(const FVector2D& D) { return FMath::RadiansToDegrees(FMath::Atan2(D.Y, D.X)); }
}

// ------------------------------------------------------------------------------------------------
// Step 2: sidewalks, street lamps, signal heads, highway gantry signs
// ------------------------------------------------------------------------------------------------
void ACADChunk::StepSidewalksAndFurniture()
{
	UMaterialInterface* Walk = Assets->Color(Lin(0.32f, 0.31f, 0.29f), 0.f, 0.f, 0.95f);
	UMaterialInterface* Steel = Assets->Color(Lin(0.12f, 0.13f, 0.14f), 0.f, 0.6f, 0.5f);
	UMaterialInterface* Concrete = Assets->Color(Lin(0.30f, 0.30f, 0.30f), 0.f, 0.f, 0.9f);
	UMaterialInterface* SignGreen = Assets->Color(Lin(0.02f, 0.2f, 0.08f), 0.f, 0.f, 0.5f);

	TArray<int32> Near;
	Net->EdgesNear(Centre(), 38000.f, Near);
	int32 LampCount = 0;
	for (int32 ei : Near)
	{
		const FCADRoadEdge& E = Net->Edges[ei];
		const FVector A = Net->Nodes[E.A].Pos, B = Net->Nodes[E.B].Pos;
		const FVector Mid = (A + B) * 0.5f;
		if (!Contains(Mid) || E.bBridge || !E.IsVehicle()) continue;
		const ECADDistrict Dist = CADTerrain::DistrictAt(Mid.X, Mid.Y);
		const FVector Dir(E.Dir.X, E.Dir.Y, 0.f);
		const FVector Right(-E.Dir.Y, E.Dir.X, 0.f);
		const FVector D3 = B - A;
		const float Pitch = FMath::RadiansToDegrees(FMath::Atan2(D3.Z, E.Length));
		const float Yaw = YawOf(E.Dir);
		const bool bUrban = Dist != ECADDistrict::Rural;

		const bool bSidewalk = bUrban && (E.Kind == ECADRoadKind::Local || E.Kind == ECADRoadKind::Collector ||
			E.Kind == ECADRoadKind::Arterial);
		const float RA = Net->Nodes[E.A].Radius + 120.f, RB = Net->Nodes[E.B].Radius + 120.f;
		const float Run = E.Length - RA - RB;
		if (bSidewalk && Run > 300.f)
		{
			const FVector C = A + Dir * (RA + Run * 0.5f) + FVector(0, 0, CADMath::Lerp(0.f, D3.Z, (RA + Run * 0.5f) / E.Length));
			for (float Side : { -1.f, 1.f })
			{
				Box(Walk, C + Right * Side * (E.HalfWidth + 110.f) + FVector(0, 0, 22.f - 15.f), FVector(Run, 220.f, 30.f), FRotator(Pitch, Yaw, 0));
			}
		}

		const bool bLamps = bUrban && E.Kind != ECADRoadKind::Highway && E.Kind != ECADRoadKind::Ramp && E.Kind != ECADRoadKind::Service && E.Kind != ECADRoadKind::Path;
		if (bLamps && Run > 600.f && LampCount < 500)
		{
			const float Spacing = (Dist == ECADDistrict::Suburb) ? 5500.f : 4200.f;
			int32 k = 0;
			for (float S = RA + 400.f; S < E.Length - RB - 300.f; S += Spacing, ++k)
			{
				const float Side = (k % 2 == 0) ? 1.f : -1.f;
				const FVector P = A + Dir * S + Right * Side * (E.HalfWidth + 60.f) + FVector(0, 0, CADMath::Lerp(0.f, D3.Z, S / E.Length));
				Cylinder(Steel, P + FVector(0, 0, 350.f), 22.f, 700.f, false, false, 50000.f);
				const FVector Head = P + FVector(0, 0, 705.f) - Right * Side * 90.f;
				Box(Cast<UMaterialInterface>(Assets->LampGlow), Head, FVector(180.f, 45.f, 22.f), FRotator(0, Yaw + 90.f, 0), false, false, 45000.f);
				Lamps.Add(Head);
				++LampCount;
			}
		}
		// Highway gantry sign facing oncoming traffic
		if (E.Kind == ECADRoadKind::Highway && (ei % 14) == 0 && E.Length > 3000.f)
		{
			const FVector P = Mid;
			const float HW = E.HalfWidth + 150.f;
			Cylinder(Steel, P + Right * HW + FVector(0, 0, 300.f), 50.f, 600.f, true);
			Cylinder(Steel, P - Right * HW + FVector(0, 0, 300.f), 50.f, 600.f, true);
			Box(Steel, P + FVector(0, 0, 640.f), FVector(60.f, HW * 2.f + 100.f, 40.f), FRotator(0, Yaw, 0), false);
			Box(SignGreen, P + FVector(0, 0, 540.f), FVector(30.f, HW * 1.4f, 200.f), FRotator(0, Yaw, 0), false);
			const FString Label = FString::Printf(TEXT("%s\n%d km/h"), *E.Road, FMath::RoundToInt(E.SpeedKph));
			AddText(Label, P + Dir * 20.f + FVector(0, 0, 540.f), FRotator(0, Yaw + 180.f, 0), 55.f, FColor::White);
			AddText(Label, P - Dir * 20.f + FVector(0, 0, 540.f), FRotator(0, Yaw, 0), 55.f, FColor::White);
		}
	}

	// Signal heads: one per approach, on the near-right corner of the stop line
	TSet<int32> Seen;
	for (int32 ei : Near)
	{
		for (int32 n : { Net->Edges[ei].A, Net->Edges[ei].B })
		{
			if (Seen.Contains(n)) continue;
			Seen.Add(n);
			const FCADRoadNode& Node = Net->Nodes[n];
			if (!Node.bSignal || !Contains(Node.Pos)) continue;
			for (int32 e : Node.Edges)
			{
				const FCADRoadEdge& E = Net->Edges[e];
				if (!E.IsVehicle() || E.bBridge) continue;
				const FVector2D Out = (E.A == n) ? E.Dir : -E.Dir;
				const FVector OutDir(Out.X, Out.Y, 0.f);
				const FVector InDir = -OutDir;               // direction of approaching traffic
				const FVector InRight(-InDir.Y, InDir.X, 0.f);
				const FVector P = Node.Pos + OutDir * (Node.Radius + 160.f) + InRight * (E.HalfWidth + 90.f);
				Cylinder(Steel, P + FVector(0, 0, 220.f), 18.f, 440.f, false, false, 40000.f);
				const float HeadYaw = YawOf(FVector2D(InDir.X, InDir.Y)) + 180.f; // face approaching drivers
				if (UStaticMeshComponent* Lamp = MakeStaticMesh(Assets->Cube, Cast<UMaterialInterface>(Assets->SigRed), P + FVector(0, 0, 450.f), FVector(0.3f, 0.35f, 0.9f), FRotator(0, HeadYaw, 0)))
				{
					FCADSignalVisual V;
					V.Node = n; V.Edge = e; V.Lamp = Lamp;
					Signals.Add(V);
				}
			}
		}
	}
}

// ------------------------------------------------------------------------------------------------
// Step 3: buildings (lattice fill for urban cores, frontage houses for suburbs, storefronts at locations)
// ------------------------------------------------------------------------------------------------
void ACADChunk::AddWindowBands(const FVector& Base, float Yaw, float SX, float SY, float H, FRandomStream& R, float BandH, float Coverage)
{
	const FRotator Rot(0, Yaw, 0);
	const int32 NumBands = CADMath::Max(1, FMath::FloorToInt((H - 250.f) / BandH));
	for (int32 k = 0; k < NumBands; ++k)
	{
		const float Z = 220.f + k * BandH + BandH * 0.5f;
		if (Z > H - 100.f) break;
		for (int32 face = 0; face < 4; ++face)
		{
			FVector Local, Size;
			const float Sign = (face % 2 == 0) ? 1.f : -1.f;
			if (face < 2) { Local = FVector(Sign * (SX * 0.5f + 8.f), 0, Z); Size = FVector(20.f, SY * 0.86f, BandH * 0.55f); }
			else { Local = FVector(0, Sign * (SY * 0.5f + 8.f), Z); Size = FVector(SX * 0.86f, 20.f, BandH * 0.55f); }
			UMaterialInterface* M = (R.FRand() < Coverage) ? Cast<UMaterialInterface>(Assets->WindowLit) : Cast<UMaterialInterface>(Assets->WindowDark);
			Box(M, Base + Rot.RotateVector(Local), Size, Rot, false, false, 55000.f);
		}
	}
}

void ACADChunk::AddBuilding(const FVector& Base, float Yaw, float SX, float SY, float H, int32 PaletteIdx, FRandomStream& R, bool bGlass)
{
	UMaterialInterface* Wall = WallPalette[(bGlass ? 4 + (PaletteIdx % 2) : PaletteIdx) % WallPalette.Num()];
	const FRotator Rot(0, Yaw, 0);
	auto Tier = [&](float W, float D, float H0, float H1)
	{
		Box(Wall, Base + FVector(0, 0, (H0 + H1) * 0.5f), FVector(W, D, H1 - H0), Rot);
		AddWindowBands(Base + FVector(0, 0, H0), Yaw, W, D, H1 - H0, R, H > 4000.f ? 800.f : 650.f, 0.7f);
	};
	if (H > 6000.f)
	{
		Tier(SX, SY, 0.f, H * 0.55f);
		Tier(SX * 0.8f, SY * 0.8f, H * 0.55f, H * 0.85f);
		Tier(SX * 0.55f, SY * 0.55f, H * 0.85f, H);
		if (H > 12000.f)
		{
			UMaterialInterface* Steel = Assets->Color(Lin(0.5f, 0.5f, 0.52f), 0.f, 0.8f, 0.3f);
			Cylinder(Steel, Base + FVector(0, 0, H + H * 0.06f), 60.f, H * 0.12f, false);
		}
	}
	else
	{
		Tier(SX, SY, 0.f, H);
		if (H > 1800.f)
		{
			UMaterialInterface* Unit = Assets->Color(Lin(0.35f, 0.36f, 0.38f), 0.f, 0.3f, 0.6f);
			for (int32 i = 0; i < 2 + R.RandRange(0, 2); ++i)
			{
				const FVector L(R.FRandRange(-SX * 0.3f, SX * 0.3f), R.FRandRange(-SY * 0.3f, SY * 0.3f), H + 90.f);
				Box(Unit, Base + Rot.RotateVector(L), FVector(250.f, 200.f, 180.f), Rot, false, true, 40000.f);
			}
		}
	}
	Placed.Add(FVector4(Base.X, Base.Y, Base.Z, FMath::Sqrt(SX * SX + SY * SY) * 0.5f));
}

void ACADChunk::AddHouse(const FVector& Base, float Yaw, FRandomStream& R)
{
	UMaterialInterface* Wall = HousePalette[R.RandRange(0, HousePalette.Num() - 1)];
	UMaterialInterface* Roof = Assets->Color(Lin(0.09f, 0.075f, 0.065f), 0.f, 0.f, 0.9f);
	const float SX = 1100.f + R.FRandRange(-100.f, 150.f), SY = 950.f, H = 520.f;
	const FRotator Rot(0, Yaw, 0);
	Box(Wall, Base + FVector(0, 0, H * 0.5f), FVector(SX, SY, H), Rot);
	const float Pitch = 24.f;
	const float PanelW = (SY * 0.5f) / FMath::Cos(FMath::DegreesToRadians(Pitch)) + 40.f;
	for (float Side : { -1.f, 1.f })
	{
		const FQuat Q = FQuat(FRotator(0, Yaw, 0)) * FQuat(FVector(1, 0, 0), FMath::DegreesToRadians(Side * Pitch));
		const FVector Local(0, Side * SY * 0.25f, H + SY * 0.25f * FMath::Tan(FMath::DegreesToRadians(Pitch)) * 0.5f + 25.f);
		Box(Roof, Base + Rot.RotateVector(Local), FVector(SX + 60.f, PanelW, 30.f), FRotator(Q), false);
	}
	// attached garage and windows
	Box(Wall, Base + Rot.RotateVector(FVector(SX * 0.5f + 150.f, 0, 140.f)), FVector(300.f, 520.f, 280.f), Rot);
	for (float Side : { -1.f, 1.f })
	{
		UMaterialInterface* M = (R.FRand() < 0.6f) ? Cast<UMaterialInterface>(Assets->WindowLit) : Cast<UMaterialInterface>(Assets->WindowDark);
		for (float X : { -SX * 0.25f, SX * 0.25f })
		{
			Box(M, Base + Rot.RotateVector(FVector(X, Side * (SY * 0.5f + 6.f), 280.f)), FVector(160.f, 14.f, 130.f), Rot, false, false, 25000.f);
		}
	}
	Placed.Add(FVector4(Base.X, Base.Y, Base.Z, 750.f));
}

void ACADChunk::StepBuildings()
{
	const float X0 = Coord.X * ChunkSize, Y0 = Coord.Y * ChunkSize;

	struct FLattice { ECADDistrict D; float Cell; };
	const FLattice Lattices[] = { { ECADDistrict::Downtown, 6400.f }, { ECADDistrict::Beltline, 5000.f },
		{ ECADDistrict::Industrial, 11000.f }, { ECADDistrict::Airport, 13000.f } };

	// locations that must stay clear of generic buildings
	TArray<FVector4> Keep;
	for (const FName& Id : Data->LocationOrder)
	{
		const FCADLocationRow& L = Data->Locations[Id];
		if (L.Kind == TEXT("Waypoint")) continue;
		Keep.Add(FVector4(L.X * CADM, L.Y * CADM, 0.f, (L.Kind == TEXT("Landmark") ? L.Radius * CADM + 800.f : 3200.f)));
	}

	for (const FLattice& Lt : Lattices)
	{
		const int32 CX0 = FMath::FloorToInt(X0 / Lt.Cell), CX1 = FMath::FloorToInt((X0 + ChunkSize) / Lt.Cell);
		const int32 CY0 = FMath::FloorToInt(Y0 / Lt.Cell), CY1 = FMath::FloorToInt((Y0 + ChunkSize) / Lt.Cell);
		for (int32 cx = CX0; cx <= CX1; ++cx)
		{
			for (int32 cy = CY0; cy <= CY1; ++cy)
			{
				FRandomStream R(HashCombine(HashCombine(static_cast<uint32>(cx + 5000), static_cast<uint32>(cy + 5000)), static_cast<uint32>(Lt.Cell)));
				FVector P((cx + 0.5f) * Lt.Cell, (cy + 0.5f) * Lt.Cell, 0.f);
				float SX, SY, H;
				float Yaw = 0.f;
				bool bGlass = false;
				switch (Lt.D)
				{
				case ECADDistrict::Downtown:
				{
					SX = R.FRandRange(2800.f, 4200.f); SY = R.FRandRange(2800.f, 4200.f);
					const FVector2D Core(10000.f, -25000.f);
					const float Dcore = FVector2D::Distance(FVector2D(P.X, P.Y), Core);
					H = 2500.f + 19000.f * FMath::Exp(-FMath::Square(Dcore / 38000.f)) * R.FRandRange(0.45f, 1.f) + R.FRandRange(0.f, 1800.f);
					if (Dcore > 70000.f) H = CADMath::Min(H, 4500.f);
					bGlass = H > 6000.f && R.FRand() < 0.7f;
					break;
				}
				case ECADDistrict::Beltline:
					SX = R.FRandRange(2200.f, 3300.f); SY = R.FRandRange(2200.f, 3000.f);
					H = R.FRand() < 0.2f ? R.FRandRange(800.f, 1100.f) : R.FRandRange(1500.f, 3800.f);
					break;
				case ECADDistrict::Industrial:
					SX = R.FRandRange(4500.f, 7000.f); SY = R.FRandRange(3000.f, 5200.f); H = R.FRandRange(900.f, 1400.f);
					break;
				default:
					SX = R.FRandRange(5000.f, 8000.f); SY = R.FRandRange(4000.f, 6000.f); H = R.FRandRange(800.f, 1600.f);
					break;
				}
				const float Margin = Lt.Cell * 0.5f - FMath::Sqrt(SX * SX + SY * SY) * 0.5f;
				if (Margin > 0.f) { P.X += R.FRandRange(-Margin, Margin); P.Y += R.FRandRange(-Margin, Margin); }
				if (!Contains(P)) continue;
				if (CADTerrain::DistrictAt(P.X, P.Y) != Lt.D) continue;
				if (R.FRand() < 0.12f) continue; // empty lot / plaza
				const float Radius = FMath::Sqrt(SX * SX + SY * SY) * 0.5f;
				if (Net->RoadClearance(FVector2D(P.X, P.Y)) < Radius + 500.f) continue;
				float W; CADTerrain::RiverDistance(P.X, P.Y, &W);
				if (CADTerrain::RiverDistance(P.X, P.Y) < W + 4500.f + Radius) continue;
				bool bBlocked = false;
				for (const FVector4& K : Keep)
				{
					if (FVector2D::Distance(FVector2D(P.X, P.Y), FVector2D(K.X, K.Y)) < K.W + Radius) { bBlocked = true; break; }
				}
				if (bBlocked) continue;
				int32 Edge; float T, Dist;
				if (Net->NearestEdge(P, true, Edge, T, Dist)) Yaw = YawOf(Net->Edges[Edge].Dir);
				P.Z = CADTerrain::Height(P.X, P.Y);
				AddBuilding(P, Yaw, SX, SY, H, R.RandRange(0, 3), R, bGlass);
				// industrial yards: fence + containers
				if (Lt.D == ECADDistrict::Industrial && R.FRand() < 0.6f)
				{
					UMaterialInterface* Fence = Assets->Color(Lin(0.25f, 0.26f, 0.27f), 0.f, 0.4f, 0.6f);
					const FRotator Rot(0, Yaw, 0);
					const float FX = SX + 1600.f, FY = SY + 1600.f;
					for (int32 side = 0; side < 4; ++side)
					{
						const float Sg = (side % 2 == 0) ? 1.f : -1.f;
						const FVector L = side < 2 ? FVector(Sg * FX * 0.5f, 0, 110.f) : FVector(0, Sg * FY * 0.5f, 110.f);
						const FVector S = side < 2 ? FVector(20.f, FY, 220.f) : FVector(FX, 20.f, 220.f);
						Box(Fence, P + Rot.RotateVector(L), S, Rot, true, false, 50000.f);
					}
					static const FLinearColor Cont[] = { Lin(0.5f, 0.1f, 0.08f), Lin(0.1f, 0.25f, 0.5f), Lin(0.45f, 0.4f, 0.05f), Lin(0.1f, 0.35f, 0.2f) };
					for (int32 i = 0; i < 3; ++i)
					{
						const FVector L(R.FRandRange(-FX * 0.35f, FX * 0.35f), SY * 0.5f + 600.f, 130.f + (i % 2) * 260.f);
						Box(Assets->Color(Cont[R.RandRange(0, 3)], 0.f, 0.3f, 0.6f), P + Rot.RotateVector(L), FVector(1200.f, 240.f, 260.f), Rot, true, true, 50000.f);
					}
				}
			}
		}
	}

	// Frontage houses along suburban local streets
	TArray<int32> Near;
	Net->EdgesNear(Centre(), 38000.f, Near);
	for (int32 ei : Near)
	{
		const FCADRoadEdge& E = Net->Edges[ei];
		if (E.Kind != ECADRoadKind::Local && E.Kind != ECADRoadKind::Collector) continue;
		const FVector A = Net->Nodes[E.A].Pos, B = Net->Nodes[E.B].Pos;
		const FVector Mid = (A + B) * 0.5f;
		if (!Contains(Mid) || E.bBridge) continue;
		if (CADTerrain::DistrictAt(Mid.X, Mid.Y) != ECADDistrict::Suburb) continue;
		FRandomStream R(ei * 7919 + 13);
		const FVector Dir(E.Dir.X, E.Dir.Y, 0.f);
		const FVector Right(-E.Dir.Y, E.Dir.X, 0.f);
		const float Yaw = YawOf(E.Dir);
		const float R0 = Net->Nodes[E.A].Radius + 700.f;
		for (float S = R0; S < E.Length - Net->Nodes[E.B].Radius - 700.f; S += 2500.f)
		{
			for (float Side : { -1.f, 1.f })
			{
				if (R.FRand() < 0.1f) continue;
				FVector P = A + Dir * (S + R.FRandRange(-150.f, 150.f)) + Right * Side * (E.HalfWidth + 1450.f);
				if (!Contains(P)) continue;
				if (Net->RoadClearance(FVector2D(P.X, P.Y)) < 700.f) continue;
				if (!PlaceCheck(P, 750.f)) continue;
				float W; CADTerrain::RiverDistance(P.X, P.Y, &W);
				if (CADTerrain::RiverDistance(P.X, P.Y) < W + 5000.f) continue;
				P.Z = CADTerrain::Height(P.X, P.Y);
				AddHouse(P, Yaw, R);
			}
		}
	}
	AddStorefronts();
}

void ACADChunk::AddStorefronts()
{
	UMaterialInterface* Steel = Assets->Color(Lin(0.12f, 0.13f, 0.14f), 0.f, 0.6f, 0.5f);
	for (const FName& Id : Data->LocationOrder)
	{
		const FCADLocationRow& L = Data->Locations[Id];
		FLinearColor Col;
		FString Sign = L.DisplayName;
		bool bBuilding = true;
		if (L.Kind == TEXT("Shop")) Col = Lin(0.10f, 0.25f, 0.55f);
		else if (L.Kind == TEXT("Garage")) Col = Lin(0.65f, 0.28f, 0.04f);
		else if (L.Kind == TEXT("Property")) Col = Lin(0.12f, 0.45f, 0.20f);
		else if (L.Kind == TEXT("Giver")) Col = Lin(0.55f, 0.10f, 0.10f);
		else if (L.Kind == TEXT("Police")) Col = Lin(0.04f, 0.08f, 0.30f);
		else if (L.Kind == TEXT("Hospital")) Col = Lin(0.65f, 0.65f, 0.68f);
		else bBuilding = false;
		const FVector Pos = Data->LocationPos(Id);
		if (!Contains(Pos)) continue;

		if (bBuilding)
		{
			int32 Edge; float T, Dist;
			float Yaw = 0.f;
			FVector Away = FVector(0, 1, 0);
			if (Net->NearestEdge(Pos, true, Edge, T, Dist))
			{
				const FCADRoadEdge& E = Net->Edges[Edge];
				Yaw = YawOf(E.Dir);
				const FVector OnRoad = Net->PointOnEdge(Edge, T);
				Away = (FVector(Pos.X - OnRoad.X, Pos.Y - OnRoad.Y, 0.f)).GetSafeNormal();
			}
			const float Depth = 1500.f, Wide = 2200.f, H = L.Kind == TEXT("Hospital") ? 2400.f : (L.Kind == TEXT("Police") ? 1500.f : 900.f);
			const FVector C = FVector(Pos.X, Pos.Y, Pos.Z) + Away * (L.Radius * CADM * 0.5f + Depth * 0.5f + 600.f);
			const FRotator Rot(0, Yaw, 0);
			Box(Cast<UMaterialInterface>(Assets->Color(Col, 0.f, 0.f, 0.7f)), C + FVector(0, 0, H * 0.5f), FVector(Wide, Depth, H), Rot);
			Box(Steel, C + FVector(0, 0, H + 25.f), FVector(Wide + 100.f, Depth + 100.f, 50.f), Rot);
			Box(Cast<UMaterialInterface>(Assets->WindowLit), C - Away * (Depth * 0.5f + 6.f) + FVector(0, 0, 250.f), FVector(Wide * 0.8f, 12.f, 220.f), Rot, false, false, 40000.f);
			const float SignYaw = FMath::RadiansToDegrees(FMath::Atan2(-Away.Y, -Away.X));
			AddText(Sign, C - Away * (Depth * 0.5f + 20.f) + FVector(0, 0, H - 120.f), FRotator(0, SignYaw, 0), 70.f, FColor(255, 214, 120));
			Placed.Add(FVector4(C.X, C.Y, C.Z, 1400.f));
			// forecourt paint pad so the interaction spot reads from a distance
			Box(Cast<UMaterialInterface>(Assets->Color(Col * 0.6f, 0.f, 0.f, 0.8f)), Pos + FVector(0, 0, 4.f), FVector(1600.f, 1600.f, 6.f), FRotator(0, Yaw, 0), false, false, 50000.f);
		}
		else if (L.Kind == TEXT("Landmark") && Id == TEXT("needle"))
		{
			UMaterialInterface* Con = Assets->Color(Lin(0.55f, 0.55f, 0.55f), 0.f, 0.1f, 0.5f);
			UMaterialInterface* Glass = Assets->Color(Lin(0.08f, 0.14f, 0.2f), 0.f, 0.8f, 0.1f);
			Cylinder(Con, Pos + FVector(0, 0, 2000.f), 2200.f, 4000.f, true);
			Cylinder(Con, Pos + FVector(0, 0, 9500.f), 700.f, 11000.f, true, true, 0.f);
			Cylinder(Glass, Pos + FVector(0, 0, 15200.f), 2800.f, 700.f, false);
			Cylinder(Con, Pos + FVector(0, 0, 15900.f), 1400.f, 700.f, false);
			Cylinder(Con, Pos + FVector(0, 0, 17800.f), 120.f, 3000.f, false);
			Cylinder(Cast<UMaterialInterface>(Assets->WindowLit), Pos + FVector(0, 0, 15250.f), 2850.f, 260.f, false, false);
			Placed.Add(FVector4(Pos.X, Pos.Y, Pos.Z, 1500.f));
		}
		else if (L.Kind == TEXT("Landmark") && Id == TEXT("dome"))
		{
			UMaterialInterface* Con = Assets->Color(Lin(0.45f, 0.1f, 0.08f), 0.f, 0.1f, 0.6f);
			Cylinder(Con, Pos + FVector(0, 0, 1500.f), 15000.f, 3000.f, true);
			Ball(Con, Pos + FVector(0, 0, 3000.f), FVector(15000.f, 15000.f, 2400.f), true);
			Placed.Add(FVector4(Pos.X, Pos.Y, Pos.Z, 7600.f));
		}
	}
}

// ------------------------------------------------------------------------------------------------
// Step 4: trees, hill conifers, rocks
// ------------------------------------------------------------------------------------------------
void ACADChunk::StepProps()
{
	UMaterialInterface* Bark = Assets->Color(Lin(0.10f, 0.065f, 0.04f), 0.f, 0.f, 0.95f);
	UMaterialInterface* Leaf[3] = { Assets->Color(Lin(0.03f, 0.13f, 0.03f), 0.f, 0.f, 0.9f), Assets->Color(Lin(0.05f, 0.17f, 0.04f), 0.f, 0.f, 0.9f),
		Assets->Color(Lin(0.12f, 0.16f, 0.03f), 0.f, 0.f, 0.9f) };
	UMaterialInterface* Pine = Assets->Color(Lin(0.015f, 0.07f, 0.03f), 0.f, 0.f, 0.9f);
	UMaterialInterface* Rock = Assets->Color(Lin(0.17f, 0.16f, 0.15f), 0.f, 0.f, 0.95f);

	TArray<FVector4> Keep;
	for (const FName& Id : Data->LocationOrder)
	{
		const FCADLocationRow& L = Data->Locations[Id];
		if (L.Kind == TEXT("Waypoint")) continue;
		Keep.Add(FVector4(L.X * CADM, L.Y * CADM, 0.f, L.Radius * CADM + 1500.f));
	}
	const float X0 = Coord.X * ChunkSize, Y0 = Coord.Y * ChunkSize;
	constexpr float Cell = 1900.f;
	int32 Count = 0;
	for (float X = X0; X < X0 + ChunkSize && Count < 420; X += Cell)
	{
		for (float Y = Y0; Y < Y0 + ChunkSize && Count < 420; Y += Cell)
		{
			FRandomStream R(HashCombine(static_cast<uint32>(X / Cell + 9000), static_cast<uint32>(Y / Cell + 9000)));
			FVector P(X + R.FRandRange(0.f, Cell), Y + R.FRandRange(0.f, Cell), 0.f);
			if (!Contains(P)) continue;
			const ECADDistrict D = CADTerrain::DistrictAt(P.X, P.Y);
			float Prob = 0.f;
			switch (D)
			{
			case ECADDistrict::Parkland: Prob = 0.75f; break;
			case ECADDistrict::Suburb: Prob = 0.28f; break;
			case ECADDistrict::Rural: Prob = 0.05f; break;
			case ECADDistrict::Beltline: Prob = 0.03f; break;
			default: break;
			}
			const bool bHill = P.X < -380000.f;
			if (bHill) Prob = 0.35f;
			if (R.FRand() > Prob) continue;
			P.Z = CADTerrain::Height(P.X, P.Y);
			if (P.Z < -80.f) continue;
			if (Net->RoadClearance(FVector2D(P.X, P.Y)) < 600.f) continue;
			if (!PlaceCheck(P, 500.f)) continue;
			bool bBlocked = false;
			for (const FVector4& K : Keep)
			{
				if (FVector2D::Distance(FVector2D(P.X, P.Y), FVector2D(K.X, K.Y)) < K.W) { bBlocked = true; break; }
			}
			if (bBlocked) continue;
			++Count;
			if (bHill)
			{
				const float Hh = R.FRandRange(900.f, 1700.f);
				UInstancedStaticMeshComponent* C = GetIsm(Assets->Cone, Pine, false, true, 90000.f);
				Pending.FindOrAdd(C).Add(FTransform(FRotator::ZeroRotator, P + FVector(0, 0, Hh * 0.5f), FVector(Hh * 0.35f / 100.f, Hh * 0.35f / 100.f, Hh / 100.f)));
				Cylinder(Bark, P + FVector(0, 0, 100.f), 40.f, 200.f, true, false, 40000.f);
				if (R.FRand() < 0.15f) Ball(Rock, P + FVector(300, 0, 80.f), FVector(R.FRandRange(150.f, 400.f), R.FRandRange(150.f, 400.f), 160.f), true);
			}
			else
			{
				const float Hh = R.FRandRange(450.f, 800.f);
				Cylinder(Bark, P + FVector(0, 0, Hh * 0.3f), 45.f, Hh * 0.6f, true, true, 60000.f);
				Ball(Leaf[R.RandRange(0, 2)], P + FVector(0, 0, Hh * 0.8f), FVector(R.FRandRange(380.f, 650.f), R.FRandRange(380.f, 650.f), Hh * 0.8f), false);
			}
			Placed.Add(FVector4(P.X, P.Y, P.Z, 220.f));
		}
	}
}

// ------------------------------------------------------------------------------------------------
// Step 5: river water + animated foam streaks, invisible world boundary walls
// ------------------------------------------------------------------------------------------------
void ACADChunk::StepWaterAndBounds()
{
	const TArray<FVector>& River = CADTerrain::GetRiver();
	const float X0 = Coord.X * ChunkSize, Y0 = Coord.Y * ChunkSize;
	for (int32 i = 0; i + 1 < River.Num(); ++i)
	{
		const FVector A = River[i], B = River[i + 1];
		const FVector Mid = (A + B) * 0.5f;
		const float W = (A.Z + B.Z) * 0.5f;
		const float Len = FVector::Dist2D(A, B);
		if (Mid.X < X0 - 5000.f || Mid.X >= X0 + ChunkSize + 5000.f || Mid.Y < Y0 - 5000.f || Mid.Y >= Y0 + ChunkSize + 5000.f) continue;
		const float Yaw = FMath::RadiansToDegrees(FMath::Atan2(B.Y - A.Y, B.X - A.X));
		if (!Contains(FVector(Mid.X, Mid.Y, 0.f))) continue;
		Box(Cast<UMaterialInterface>(Assets->Water), FVector(Mid.X, Mid.Y, CADTerrain::WaterZ - 50.f), FVector(Len + 1500.f, W * 2.2f, 100.f), FRotator(0, Yaw, 0), false, false, 0.f);

		if (!FoamIsm)
		{
			FoamIsm = NewObject<UInstancedStaticMeshComponent>(this);
			FoamIsm->SetMobility(EComponentMobility::Movable);
			FoamIsm->SetStaticMesh(Assets->Cube);
			FoamIsm->SetMaterial(0, Assets->Color(Lin(0.55f, 0.65f, 0.7f), 0.2f, 0.f, 0.3f));
			FoamIsm->SetCollisionEnabled(ECollisionEnabled::NoCollision);
			FoamIsm->SetCastShadow(false);
			FoamIsm->SetCanEverAffectNavigation(false);
			FoamIsm->SetCullDistances(0, 60000);
			FoamIsm->SetupAttachment(GetRootComponent());
			FoamIsm->RegisterComponent();
		}
		FRandomStream R(i * 31 + 5);
		const FVector2D Dir = FVector2D(B.X - A.X, B.Y - A.Y).GetSafeNormal();
		for (int32 k = 0; k < 7; ++k)
		{
			FFoam F;
			const float Lat = R.FRandRange(-W * 0.8f, W * 0.8f);
			F.Origin = FVector(A.X - Dir.Y * Lat, A.Y + Dir.X * Lat, CADTerrain::WaterZ + 4.f);
			F.Dir = Dir; F.Length = Len; F.Phase = R.FRand();
			F.Index = FoamIsm->AddInstance(FTransform(FRotator(0, Yaw, 0), F.Origin, FVector(9.f, 0.35f, 0.04f)), true);
			Foam.Add(F);
		}
	}

	// Invisible boundary walls at +-4700 m
	const float Lim = CADTerrain::WorldHalfExtent;
	auto Wall = [this](const FVector& C, const FVector& Ext)
	{
		UBoxComponent* B = NewObject<UBoxComponent>(this);
		B->SetBoxExtent(Ext);
		B->SetCollisionProfileName(TEXT("BlockAll"));
		B->SetCanEverAffectNavigation(false);
		B->SetHiddenInGame(true);
		B->SetupAttachment(GetRootComponent());
		B->RegisterComponent();
		B->SetWorldLocation(C);
	};
	const float CX0 = X0, CX1 = X0 + ChunkSize, CY0 = Y0, CY1 = Y0 + ChunkSize;
	if (CX0 <= Lim && Lim < CX1) Wall(FVector(Lim, (CY0 + CY1) * 0.5f, 0.f), FVector(100.f, ChunkSize * 0.5f, 20000.f));
	if (CX0 <= -Lim && -Lim < CX1) Wall(FVector(-Lim, (CY0 + CY1) * 0.5f, 0.f), FVector(100.f, ChunkSize * 0.5f, 20000.f));
	if (CY0 <= Lim && Lim < CY1) Wall(FVector((CX0 + CX1) * 0.5f, Lim, 0.f), FVector(ChunkSize * 0.5f, 100.f, 20000.f));
	if (CY0 <= -Lim && -Lim < CY1) Wall(FVector((CX0 + CX1) * 0.5f, -Lim, 0.f), FVector(ChunkSize * 0.5f, 100.f, 20000.f));
}

void ACADChunk::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!Net || !Assets) return;
	const double Now = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.0;

	SignalClock += DeltaSeconds;
	if (SignalClock > 0.2f)
	{
		SignalClock = 0.f;
		for (FCADSignalVisual& S : Signals)
		{
			UStaticMeshComponent* L = S.Lamp.Get();
			if (!L) continue;
			const int8 St = static_cast<int8>(Net->SignalState(S.Node, S.Edge, Now));
			if (St == S.LastState) continue;
			S.LastState = St;
			UMaterialInterface* M = St == 0 ? Cast<UMaterialInterface>(Assets->SigGreen) : (St == 1 ? Cast<UMaterialInterface>(Assets->SigYellow) : Cast<UMaterialInterface>(Assets->SigRed));
			L->SetMaterial(0, M);
		}
	}

	if (FoamIsm && Foam.Num() > 0)
	{
		FoamClock += DeltaSeconds;
		for (const FFoam& F : Foam)
		{
			const float S = FMath::Fmod(F.Phase * F.Length + FoamClock * 170.f, F.Length);
			const FVector P = F.Origin + FVector(F.Dir.X, F.Dir.Y, 0.f) * S;
			FTransform T;
			FoamIsm->GetInstanceTransform(F.Index, T, true);
			T.SetLocation(P);
			FoamIsm->UpdateInstanceTransform(F.Index, T, true, false, true);
		}
		FoamIsm->MarkRenderStateDirty();
	}
}
