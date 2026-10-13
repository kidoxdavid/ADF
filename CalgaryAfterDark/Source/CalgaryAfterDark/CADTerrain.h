#pragma once

#include "CoreMinimal.h"
#include "CADTypes.h"

/**
 * Analytic terrain model shared by chunk generation, road placement, vehicle/AI spawn logic and the
 * map. All inputs/outputs are Unreal units (cm). Mirrors Tools/generate_map.py (metres) exactly.
 */
namespace CADTerrain
{
	static constexpr float WaterZ = -300.f;       // -3 m
	static constexpr float ValleyDepth = 600.f;   // 6 m
	static constexpr float RampStartX = -375000.f;
	static constexpr float RampSlope = 0.10f;
	static constexpr float WorldHalfExtent = 470000.f; // playable boundary
	static constexpr float RingHalfExtent = 360000.f;

	/** River polyline points: X,Y in cm, Z = half-width in cm. */
	void SetRiver(const TArray<FVector>& XYHalfWidth);
	const TArray<FVector>& GetRiver();

	/** Distance in cm to the river centre line; OutHalfWidth receives the local half width. */
	float RiverDistance(float X, float Y, float* OutHalfWidth = nullptr, int32* OutSegment = nullptr);

	/** Ground height in cm. */
	float Height(float X, float Y);

	/** Normal of the ground surface (finite differences). */
	FVector Normal(float X, float Y);

	ECADDistrict DistrictAt(float X, float Y);
	FString DistrictName(ECADDistrict D);

	/** Downtown/Beltline grid frame (rotated 6 degrees). */
	FVector2D ToGridUV(float X, float Y);
}
