#include "CADWorldStreamer.h"
#include "CADChunk.h"
#include "CADGameInstance.h"
#include "CalgaryAfterDark.h"
#include "Components/PointLightComponent.h"
#include "Engine/World.h"

bool UCADWorldStreamer::ShouldCreateSubsystem(UObject* Outer) const
{
	const UWorld* W = Cast<UWorld>(Outer);
	return W && W->IsGameWorld();
}

float UCADWorldStreamer::LoadRadius() const
{
	int32 Level = 2;
	if (UCADGameInstance* GI = UCADGameInstance::Get(this)) Level = GI->Settings.ViewDistanceLevel;
	switch (Level)
	{
	case 1: return 95000.f;
	case 3: return 190000.f;
	default: return 140000.f;
	}
}

float UCADWorldStreamer::DistToChunk(const FVector& P, FIntPoint C)
{
	const float MinX = C.X * ACADChunk::ChunkSize, MaxX = MinX + ACADChunk::ChunkSize;
	const float MinY = C.Y * ACADChunk::ChunkSize, MaxY = MinY + ACADChunk::ChunkSize;
	const float DX = CADMath::Max3(MinX - P.X, 0.f, P.X - MaxX);
	const float DY = CADMath::Max3(MinY - P.Y, 0.f, P.Y - MaxY);
	return FMath::Sqrt(DX * DX + DY * DY);
}

bool UCADWorldStreamer::IsLoadedAt(const FVector& P) const
{
	const FIntPoint C(FMath::FloorToInt(P.X / ACADChunk::ChunkSize), FMath::FloorToInt(P.Y / ACADChunk::ChunkSize));
	if (const TObjectPtr<ACADChunk>* F = Chunks.Find(C))
	{
		return (*F)->bTerrainReady;
	}
	return false;
}

bool UCADWorldStreamer::IsAreaReady(const FVector& P, float Radius) const
{
	const int32 X0 = FMath::FloorToInt((P.X - Radius) / ACADChunk::ChunkSize), X1 = FMath::FloorToInt((P.X + Radius) / ACADChunk::ChunkSize);
	const int32 Y0 = FMath::FloorToInt((P.Y - Radius) / ACADChunk::ChunkSize), Y1 = FMath::FloorToInt((P.Y + Radius) / ACADChunk::ChunkSize);
	for (int32 x = X0; x <= X1; ++x)
	{
		for (int32 y = Y0; y <= Y1; ++y)
		{
			if (x < -10 || x > 9 || y < -10 || y > 9) continue;
			const TObjectPtr<ACADChunk>* F = Chunks.Find(FIntPoint(x, y));
			if (!F || !(*F)->IsFullyBuilt()) return false;
		}
	}
	return true;
}

int32 UCADWorldStreamer::NumBuilding() const
{
	int32 N = 0;
	for (const auto& P : Chunks) if (P.Value && !P.Value->IsFullyBuilt()) ++N;
	return N;
}

void UCADWorldStreamer::Tick(float DeltaTime)
{
	if (!bEnabled) return;
	UWorld* W = GetWorld();
	if (!W) return;
	const float R = LoadRadius();

	// 1) spawn the nearest missing chunk
	FIntPoint Best(0, 0);
	float BestD = TNumericLimits<float>::Max();
	const int32 X0 = CADMath::Max(-10, FMath::FloorToInt((Focus.X - R) / ACADChunk::ChunkSize));
	const int32 X1 = CADMath::Min(9, FMath::FloorToInt((Focus.X + R) / ACADChunk::ChunkSize));
	const int32 Y0 = CADMath::Max(-10, FMath::FloorToInt((Focus.Y - R) / ACADChunk::ChunkSize));
	const int32 Y1 = CADMath::Min(9, FMath::FloorToInt((Focus.Y + R) / ACADChunk::ChunkSize));
	for (int32 x = X0; x <= X1; ++x)
	{
		for (int32 y = Y0; y <= Y1; ++y)
		{
			const FIntPoint C(x, y);
			if (Chunks.Contains(C)) continue;
			const float D = DistToChunk(Focus, C);
			if (D < R && D < BestD) { BestD = D; Best = C; }
		}
	}
	if (BestD < TNumericLimits<float>::Max() && NumBuilding() < 3)
	{
		FActorSpawnParameters P;
		P.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		if (ACADChunk* Chunk = W->SpawnActor<ACADChunk>(FVector::ZeroVector, FRotator::ZeroRotator, P))
		{
			Chunk->Init(Best);
			Chunks.Add(Best, Chunk);
		}
	}

	// 2) advance builds, nearest first (2 steps per frame, 4 while the focus cell is not ready)
	TArray<ACADChunk*> Building;
	for (auto& P : Chunks) if (P.Value && !P.Value->IsFullyBuilt()) Building.Add(P.Value);
	Building.Sort([this](const ACADChunk* A, const ACADChunk* B) { return DistToChunk(Focus, A->Coord) < DistToChunk(Focus, B->Coord); });
	int32 Budget = IsLoadedAt(Focus) ? 2 : 4;
	for (ACADChunk* C : Building)
	{
		while (Budget-- > 0 && !C->IsFullyBuilt()) { C->BuildNextStep(); }
		if (Budget <= 0) break;
	}

	// 3) unload one far chunk
	for (auto It = Chunks.CreateIterator(); It; ++It)
	{
		if (!It.Value() || DistToChunk(Focus, It.Key()) > R + 60000.f)
		{
			if (It.Value()) It.Value()->Destroy();
			It.RemoveCurrent();
			break;
		}
	}

	LightClock += DeltaTime;
	if (LightClock > 0.4f) { LightClock = 0.f; UpdateLampLights(); }
}

void UCADWorldStreamer::UpdateLampLights()
{
	UWorld* W = GetWorld();
	if (!W) return;
	if (!LightHost)
	{
		LightHost = W->SpawnActor<AActor>();
		USceneComponent* Root = NewObject<USceneComponent>(LightHost, TEXT("Root"));
		LightHost->SetRootComponent(Root);
		Root->RegisterComponent();
		for (int32 i = 0; i < 14; ++i)
		{
			UPointLightComponent* L = NewObject<UPointLightComponent>(LightHost);
			L->SetupAttachment(Root);
			L->SetCastShadows(false);
			L->SetIntensity(9000.f);
			L->SetAttenuationRadius(2600.f);
			L->SetLightColor(FLinearColor(1.f, 0.8f, 0.5f));
			L->SetMobility(EComponentMobility::Movable);
			L->RegisterComponent();
			LampLights.Add(L);
		}
	}
	const bool bOn = Night > 0.25f;
	TArray<FVector> Cand;
	if (bOn)
	{
		for (auto& P : Chunks)
		{
			if (!P.Value) continue;
			for (const FVector& L : P.Value->Lamps)
			{
				if (FVector::DistSquared2D(L, Focus) < FMath::Square(7000.f)) Cand.Add(L);
			}
		}
		Cand.Sort([this](const FVector& A, const FVector& B) { return FVector::DistSquared2D(A, Focus) < FVector::DistSquared2D(B, Focus); });
	}
	for (int32 i = 0; i < LampLights.Num(); ++i)
	{
		UPointLightComponent* L = LampLights[i];
		if (!L) continue;
		if (bOn && Cand.IsValidIndex(i))
		{
			L->SetWorldLocation(Cand[i] - FVector(0, 0, 40.f));
			L->SetVisibility(true);
		}
		else
		{
			L->SetVisibility(false);
		}
	}
}
