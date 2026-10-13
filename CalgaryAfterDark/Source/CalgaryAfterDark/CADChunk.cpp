#include "CADChunk.h"
#include "CADAssets.h"
#include "CADDataSubsystem.h"
#include "CADGameInstance.h"
#include "CADRoadNetwork.h"
#include "CADTerrain.h"
#include "CalgaryAfterDark.h"
#include "ProceduralMeshComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/TextRenderComponent.h"
#include "Components/BoxComponent.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"

namespace
{
	FLinearColor Lin(float R, float G, float B) { return FLinearColor(R, G, B, 1.f); }
	float Rad(float Deg) { return FMath::DegreesToRadians(Deg); }
}

ACADChunk::ACADChunk()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickInterval = 0.1f;
	USceneComponent* Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	Root->SetMobility(EComponentMobility::Static);
	SetRootComponent(Root);
	Terrain = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("Terrain"));
	Terrain->SetupAttachment(Root);
	Terrain->bUseAsyncCooking = true;
	Terrain->bUseComplexAsSimpleCollision = true;
	Terrain->SetCastShadow(false);
	Terrain->SetCanEverAffectNavigation(false);
}

bool ACADChunk::Contains(const FVector& P) const
{
	return P.X >= Coord.X * ChunkSize && P.X < (Coord.X + 1) * ChunkSize && P.Y >= Coord.Y * ChunkSize && P.Y < (Coord.Y + 1) * ChunkSize;
}

void ACADChunk::Init(FIntPoint InCoord)
{
	Coord = InCoord;
	Assets = CADAssets(this);
	if (UCADGameInstance* GI = UCADGameInstance::Get(this))
	{
		Data = GI->GetSubsystem<UCADDataSubsystem>();
	}
	Net = Data ? &Data->Network : nullptr;
	if (Assets)
	{
		auto C = [this](float R, float G, float B, float Metal = 0.f, float Rough = 0.8f) { return Cast<UMaterialInterface>(Assets->Color(Lin(R, G, B), 0.f, Metal, Rough)); };
		WallPalette = { C(0.50f, 0.50f, 0.48f), C(0.28f, 0.29f, 0.31f), C(0.33f, 0.11f, 0.08f), C(0.55f, 0.48f, 0.36f),
			C(0.07f, 0.15f, 0.22f, 0.7f, 0.1f), C(0.05f, 0.18f, 0.18f, 0.7f, 0.1f), C(0.46f, 0.34f, 0.22f), C(0.72f, 0.72f, 0.70f) };
		HousePalette = { C(0.55f, 0.50f, 0.40f), C(0.40f, 0.45f, 0.55f), C(0.50f, 0.36f, 0.30f), C(0.62f, 0.60f, 0.55f), C(0.35f, 0.42f, 0.32f), C(0.60f, 0.45f, 0.20f) };
	}
}

bool ACADChunk::BuildNextStep()
{
	if (!Assets || !Net || !Net->IsBuilt()) { NextStep = NumSteps; return true; }
	switch (NextStep)
	{
	case 0: StepTerrain(); break;
	case 1: StepRoads(); break;
	case 2: StepSidewalksAndFurniture(); break;
	case 3: StepBuildings(); break;
	case 4: StepProps(); break;
	case 5: StepWaterAndBounds(); break;
	default: break;
	}
	FlushPending();
	++NextStep;
	return NextStep >= NumSteps;
}

// ------------------------------------------------------------------------------------------------
// Primitive helpers
// ------------------------------------------------------------------------------------------------
UInstancedStaticMeshComponent* ACADChunk::GetIsm(UStaticMesh* Mesh, UMaterialInterface* Mat, bool bCollision, bool bShadow, float CullEnd)
{
	uint64 Key = HashCombine(GetTypeHash(Mesh), GetTypeHash(Mat));
	Key = HashCombine(static_cast<uint32>(Key), (bCollision ? 1u : 0u) | (bShadow ? 2u : 0u) | (static_cast<uint32>(CullEnd / 1000.f) << 4));
	if (UInstancedStaticMeshComponent** F = IsmMap.Find(Key))
	{
		return *F;
	}
	UInstancedStaticMeshComponent* C = NewObject<UInstancedStaticMeshComponent>(this);
	C->SetMobility(EComponentMobility::Static);
	C->SetStaticMesh(Mesh);
	C->SetMaterial(0, Mat);
	C->SetCanEverAffectNavigation(false);
	C->SetCastShadow(bShadow);
	C->bAffectDistanceFieldLighting = false;
	if (bCollision) { C->SetCollisionProfileName(TEXT("BlockAll")); }
	else { C->SetCollisionEnabled(ECollisionEnabled::NoCollision); }
	if (CullEnd > 0.f) { C->SetCullDistances(0, static_cast<int32>(CullEnd)); }
	C->SetupAttachment(GetRootComponent());
	C->RegisterComponent();
	IsmMap.Add(Key, C);
	AllIsms.Add(C);
	return C;
}

void ACADChunk::Box(UMaterialInterface* Mat, const FVector& Centre, const FVector& SizeCm, const FRotator& Rot, bool bCollision, bool bShadow, float CullEnd)
{
	UInstancedStaticMeshComponent* C = GetIsm(Assets->Cube, Mat, bCollision, bShadow, CullEnd);
	Pending.FindOrAdd(C).Add(FTransform(Rot, Centre, SizeCm / 100.f));
}

void ACADChunk::Cylinder(UMaterialInterface* Mat, const FVector& Centre, float DiaCm, float HeightCm, bool bCollision, bool bShadow, float CullEnd)
{
	UInstancedStaticMeshComponent* C = GetIsm(Assets->Cylinder, Mat, bCollision, bShadow, CullEnd);
	Pending.FindOrAdd(C).Add(FTransform(FRotator::ZeroRotator, Centre, FVector(DiaCm / 100.f, DiaCm / 100.f, HeightCm / 100.f)));
}

void ACADChunk::Ball(UMaterialInterface* Mat, const FVector& Centre, const FVector& SizeCm, bool bCollision)
{
	UInstancedStaticMeshComponent* C = GetIsm(Assets->Sphere, Mat, bCollision, true, 90000.f);
	Pending.FindOrAdd(C).Add(FTransform(FRotator::ZeroRotator, Centre, SizeCm / 100.f));
}

UStaticMeshComponent* ACADChunk::MakeStaticMesh(UStaticMesh* Mesh, UMaterialInterface* Mat, const FVector& Loc, const FVector& Scale, const FRotator& Rot)
{
	UStaticMeshComponent* C = NewObject<UStaticMeshComponent>(this);
	C->SetMobility(EComponentMobility::Movable);
	C->SetStaticMesh(Mesh);
	C->SetMaterial(0, Mat);
	C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	C->SetCastShadow(false);
	C->SetCanEverAffectNavigation(false);
	C->SetupAttachment(GetRootComponent());
	C->RegisterComponent();
	C->SetWorldTransform(FTransform(Rot, Loc, Scale));
	return C;
}

void ACADChunk::AddText(const FString& Text, const FVector& Loc, const FRotator& Rot, float WorldSize, const FColor& Col)
{
	UTextRenderComponent* T = NewObject<UTextRenderComponent>(this);
	T->SetMobility(EComponentMobility::Movable);
	T->SetText(FText::FromString(Text));
	T->SetWorldSize(WorldSize);
	T->SetTextRenderColor(Col);
	T->SetHorizontalAlignment(EHTA_Center);
	T->SetVerticalAlignment(EVRTA_TextCenter);
	T->SetupAttachment(GetRootComponent());
	T->RegisterComponent();
	T->SetWorldLocationAndRotation(Loc, Rot);
	T->SetCullDistance(0.f);
}

void ACADChunk::FlushPending()
{
	for (auto& P : Pending)
	{
		if (P.Key && P.Value.Num() > 0)
		{
			P.Key->AddInstances(P.Value, false, true);
		}
	}
	Pending.Reset();
}

bool ACADChunk::PlaceCheck(const FVector& P, float Radius) const
{
	for (const FVector4& Q : Placed)
	{
		if (FVector2D::Distance(FVector2D(P.X, P.Y), FVector2D(Q.X, Q.Y)) < Radius + Q.W) return false;
	}
	return true;
}

// ------------------------------------------------------------------------------------------------
// Step 0: terrain mesh (river valley, foothill ramp, district ground colours)
// ------------------------------------------------------------------------------------------------
void ACADChunk::StepTerrain()
{
	constexpr int32 N = 40;
	const float Cell = ChunkSize / N;
	const float X0 = Coord.X * ChunkSize, Y0 = Coord.Y * ChunkSize;

	TArray<float> H;
	TArray<FVector> Nrm;
	H.SetNumUninitialized((N + 1) * (N + 1));
	Nrm.SetNumUninitialized((N + 1) * (N + 1));
	for (int32 j = 0; j <= N; ++j)
	{
		for (int32 i = 0; i <= N; ++i)
		{
			const float X = X0 + i * Cell, Y = Y0 + j * Cell;
			H[j * (N + 1) + i] = CADTerrain::Height(X, Y);
			Nrm[j * (N + 1) + i] = CADTerrain::Normal(X, Y);
		}
	}

	struct FSec { TArray<FVector> V, Nm; TArray<FVector2D> UV; TArray<int32> I; };
	FSec Sec[6];
	static const FLinearColor GroundCol[6] = { Lin(0.05f, 0.16f, 0.04f), Lin(0.20f, 0.18f, 0.07f), Lin(0.22f, 0.22f, 0.21f),
		Lin(0.13f, 0.115f, 0.09f), Lin(0.28f, 0.23f, 0.14f), Lin(0.17f, 0.16f, 0.15f) };

	for (int32 j = 0; j < N; ++j)
	{
		for (int32 i = 0; i < N; ++i)
		{
			const float X = X0 + (i + 0.5f) * Cell, Y = Y0 + (j + 0.5f) * Cell;
			const float AvgH = (H[j * (N + 1) + i] + H[j * (N + 1) + i + 1] + H[(j + 1) * (N + 1) + i] + H[(j + 1) * (N + 1) + i + 1]) * 0.25f;
			int32 S = 0;
			if (AvgH < -120.f) S = 4;
			else if (X < -380000.f) S = 5;
			else
			{
				switch (CADTerrain::DistrictAt(X, Y))
				{
				case ECADDistrict::Downtown: case ECADDistrict::Beltline: case ECADDistrict::Airport: S = 2; break;
				case ECADDistrict::Industrial: S = 3; break;
				case ECADDistrict::Rural: S = 1; break;
				default: S = 0; break;
				}
			}
			FSec& Sc = Sec[S];
			const int32 Base = Sc.V.Num();
			const int32 Idx[4][2] = { {i, j}, {i + 1, j}, {i + 1, j + 1}, {i, j + 1} };
			for (const auto& P : Idx)
			{
				Sc.V.Add(FVector(X0 + P[0] * Cell, Y0 + P[1] * Cell, H[P[1] * (N + 1) + P[0]]));
				Sc.Nm.Add(Nrm[P[1] * (N + 1) + P[0]]);
				Sc.UV.Add(FVector2D((X0 + P[0] * Cell) / 800.f, (Y0 + P[1] * Cell) / 800.f));
			}
			// Both windings are emitted so the ground is visible from above regardless of engine face convention.
			// (Remove the second pair once verified in-editor to halve terrain triangle count.)
			const int32 Tri[12] = { 0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2 };
			for (int32 t : Tri) Sc.I.Add(Base + t);
		}
	}
	for (int32 s = 0; s < 6; ++s)
	{
		if (Sec[s].V.Num() == 0) continue;
		Terrain->CreateMeshSection_LinearColor(s, Sec[s].V, Sec[s].I, Sec[s].Nm, Sec[s].UV, TArray<FLinearColor>(), TArray<FProcMeshTangent>(), true);
		Terrain->SetMaterial(s, Assets->Color(GroundCol[s], 0.f, 0.f, 0.95f));
	}
	bTerrainReady = true;
}

// ------------------------------------------------------------------------------------------------
// Step 1: roads, intersection pads, bridges, lane markings, crosswalks
// ------------------------------------------------------------------------------------------------
void ACADChunk::StepRoads()
{
	UMaterialInterface* Asphalt = Assets->Color(Lin(0.035f, 0.035f, 0.04f), 0.f, 0.f, 0.9f);
	UMaterialInterface* AsphaltHwy = Assets->Color(Lin(0.028f, 0.028f, 0.032f), 0.f, 0.f, 0.9f);
	UMaterialInterface* AsphaltPad = Assets->Color(Lin(0.037f, 0.037f, 0.042f), 0.f, 0.f, 0.9f);
	UMaterialInterface* AsphaltInd = Assets->Color(Lin(0.07f, 0.065f, 0.06f), 0.f, 0.f, 0.95f);
	UMaterialInterface* PathMat = Assets->Color(Lin(0.40f, 0.37f, 0.31f), 0.f, 0.f, 0.95f);
	UMaterialInterface* Concrete = Assets->Color(Lin(0.30f, 0.30f, 0.30f), 0.f, 0.f, 0.9f);
	UMaterialInterface* Yellow = Assets->Color(Lin(0.75f, 0.55f, 0.04f), 0.f, 0.f, 0.6f);
	UMaterialInterface* White = Assets->Color(Lin(0.75f, 0.75f, 0.75f), 0.f, 0.f, 0.6f);

	TArray<int32> Near;
	Net->EdgesNear(Centre(), 38000.f, Near);
	for (int32 ei : Near)
	{
		const FCADRoadEdge& E = Net->Edges[ei];
		const FVector A = Net->Nodes[E.A].Pos, B = Net->Nodes[E.B].Pos;
		const FVector Mid = (A + B) * 0.5f;
		if (!Contains(Mid)) continue;
		const FVector D3 = B - A;
		const float Len = D3.Size();
		const float Yaw = FMath::RadiansToDegrees(FMath::Atan2(D3.Y, D3.X));
		const float Pitch = FMath::RadiansToDegrees(FMath::Atan2(D3.Z, FMath::Sqrt(D3.X * D3.X + D3.Y * D3.Y)));
		const FRotator Rot(Pitch, Yaw, 0.f);
		const float Width = E.HalfWidth * 2.f;

		UMaterialInterface* Mat = Asphalt;
		switch (E.Kind)
		{
		case ECADRoadKind::Highway: case ECADRoadKind::Expressway: case ECADRoadKind::Ramp: Mat = AsphaltHwy; break;
		case ECADRoadKind::Industrial: case ECADRoadKind::Service: Mat = AsphaltInd; break;
		case ECADRoadKind::Path: Mat = PathMat; break;
		default: break;
		}
		const float Thick = E.bBridge ? 100.f : 40.f;
		const float TopOffset = (E.Kind == ECADRoadKind::Path) ? 4.f : 6.f;
		Box(E.bBridge ? Concrete : Mat, Mid + FVector(0, 0, TopOffset - Thick * 0.5f), FVector(Len + 60.f, Width, Thick), Rot);

		const FVector Dir(E.Dir.X, E.Dir.Y, 0.f);
		const FVector Right(-E.Dir.Y, E.Dir.X, 0.f);

		if (E.bBridge)
		{
			// railings + piers
			for (float Side : { -1.f, 1.f })
			{
				Box(Concrete, Mid + Right * Side * (E.HalfWidth + 20.f) + FVector(0, 0, TopOffset + 55.f), FVector(Len + 60.f, 28.f, 110.f), Rot);
			}
			const float Ground = CADTerrain::Height(Mid.X, Mid.Y);
			if (Ground < -100.f && (ei % 3) == 0)
			{
				const float Top = Mid.Z - 90.f;
				const float Bottom = Ground - 100.f;
				Cylinder(Concrete, FVector(Mid.X, Mid.Y, (Top + Bottom) * 0.5f), 260.f, Top - Bottom);
			}
			continue; // no markings on bridges beyond the deck
		}
		if (E.Kind == ECADRoadKind::Path || E.Kind == ECADRoadKind::Service) continue;

		const float RA = Net->Nodes[E.A].Radius, RB = Net->Nodes[E.B].Radius;
		const float Run = Len - RA - RB;
		if (Run < 400.f) continue;
		const FVector Centre2 = A + Dir * (RA + Run * 0.5f) + FVector(0, 0, CADMath::Lerp(0.f, D3.Z, (RA + Run * 0.5f) / Len));
		const float MZ = 8.f;
		auto Line = [&](UMaterialInterface* M, float Off, float W)
		{
			Box(M, Centre2 + Right * Off + FVector(0, 0, MZ), FVector(Run, W, 2.f), Rot, false, false, 60000.f);
		};
		auto Dashes = [&](UMaterialInterface* M, float Off, float W)
		{
			for (float S = RA + 300.f; S < Len - RB - 300.f; S += 1000.f)
			{
				const FVector P = A + Dir * (S + 150.f) + Right * Off + FVector(0, 0, CADMath::Lerp(0.f, D3.Z, S / Len) + MZ);
				Box(M, P, FVector(300.f, W, 2.f), Rot, false, false, 40000.f);
			}
		};
		const bool bMajor = E.Kind == ECADRoadKind::Arterial || E.Kind == ECADRoadKind::Expressway || E.Kind == ECADRoadKind::Highway || E.Kind == ECADRoadKind::Industrial;
		if (!E.bOneWay)
		{
			if (bMajor) { Line(Yellow, -18.f, 12.f); Line(Yellow, 18.f, 12.f); }
			else { Dashes(Yellow, 0.f, 12.f); }
			for (int32 k = 1; k < E.LanesPerDir; ++k)
			{
				Dashes(White, k * FCADRoadNetwork::LaneWidth, 12.f);
				Dashes(White, -k * FCADRoadNetwork::LaneWidth, 12.f);
			}
		}
		else
		{
			for (int32 k = 1; k < E.LanesPerDir; ++k) Dashes(White, (k - E.LanesPerDir * 0.5f) * FCADRoadNetwork::LaneWidth, 12.f);
		}
		if (bMajor || E.bOneWay)
		{
			Line(White, E.HalfWidth - 40.f, 12.f);
			Line(White, -(E.HalfWidth - 40.f), 12.f);
		}
	}

	// Intersection pads and zebra crossings at signalised nodes
	TSet<int32> SeenNodes;
	for (int32 ei : Near)
	{
		const FCADRoadEdge& E0 = Net->Edges[ei];
		for (int32 n : { E0.A, E0.B })
		{
			if (SeenNodes.Contains(n)) continue;
			SeenNodes.Add(n);
			const FCADRoadNode& Node = Net->Nodes[n];
			if (!Contains(Node.Pos)) continue;
			bool bAnyVehicle = false, bAllBridge = true;
			float Yaw = 0.f;
			for (int32 e : Node.Edges)
			{
				const FCADRoadEdge& E = Net->Edges[e];
				if (!E.IsVehicle()) continue;
				if (!bAnyVehicle) Yaw = FMath::RadiansToDegrees(FMath::Atan2(E.Dir.Y, E.Dir.X));
				bAnyVehicle = true;
				if (!E.bBridge) bAllBridge = false;
			}
			if (!bAnyVehicle || bAllBridge) continue;
			const float Half = Node.Radius - 80.f;
			Box(AsphaltPad, Node.Pos + FVector(0, 0, 7.f - 20.f), FVector(Half * 2.f, Half * 2.f, 40.f), FRotator(0, Yaw, 0));
			if (Node.bSignal)
			{
				for (int32 e : Node.Edges)
				{
					const FCADRoadEdge& E = Net->Edges[e];
					if (!E.IsVehicle() || E.bBridge || E.Kind == ECADRoadKind::Highway) continue;
					const FVector2D Out = (E.A == n) ? E.Dir : -E.Dir;
					const FVector OutDir(Out.X, Out.Y, 0.f);
					const FVector Rt(-Out.Y, Out.X, 0.f);
					const float EY = FMath::RadiansToDegrees(FMath::Atan2(Out.Y, Out.X));
					for (float Off = -(E.HalfWidth - 60.f); Off <= E.HalfWidth - 60.f; Off += 110.f)
					{
						Box(White, Node.Pos + OutDir * (Node.Radius + 40.f) + Rt * Off + FVector(0, 0, 9.f), FVector(320.f, 45.f, 2.f), FRotator(0, EY, 0), false, false, 30000.f);
					}
				}
			}
		}
	}
}
