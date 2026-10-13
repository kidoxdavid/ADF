#include "CADTerrain.h"

namespace CADTerrain
{
	static TArray<FVector> GRiver;
	static const float GridAngle = FMath::DegreesToRadians(6.f);

	void SetRiver(const TArray<FVector>& XYHalfWidth) { GRiver = XYHalfWidth; }
	const TArray<FVector>& GetRiver() { return GRiver; }

	float RiverDistance(float X, float Y, float* OutHalfWidth, int32* OutSegment)
	{
		float Best = TNumericLimits<float>::Max();
		float BestW = 6000.f;
		int32 BestSeg = INDEX_NONE;
		for (int32 i = 0; i + 1 < GRiver.Num(); ++i)
		{
			const FVector& A = GRiver[i];
			const FVector& B = GRiver[i + 1];
			const float DX = B.X - A.X, DY = B.Y - A.Y;
			const float L2 = DX * DX + DY * DY;
			const float T = L2 > 0.f ? CADMath::Clamp(((X - A.X) * DX + (Y - A.Y) * DY) / L2, 0.f, 1.f) : 0.f;
			const float CX = A.X + DX * T, CY = A.Y + DY * T;
			const float D = FMath::Sqrt(FMath::Square(X - CX) + FMath::Square(Y - CY));
			if (D < Best)
			{
				Best = D;
				BestW = A.Z + (B.Z - A.Z) * T;
				BestSeg = i;
			}
		}
		if (OutHalfWidth) *OutHalfWidth = BestW;
		if (OutSegment) *OutSegment = BestSeg;
		return Best;
	}

	float Height(float X, float Y)
	{
		float W = 6000.f;
		const float D = RiverDistance(X, Y, &W);
		const float T = CADMath::Clamp((D - W) / 6000.f, 0.f, 1.f);
		const float S = T * T * (3.f - 2.f * T);
		float H = -ValleyDepth * (1.f - S);
		if (X < RampStartX)
		{
			H += (RampStartX - X) * RampSlope;
		}
		return H;
	}

	FVector Normal(float X, float Y)
	{
		const float E = 300.f;
		const float HX = Height(X + E, Y) - Height(X - E, Y);
		const float HY = Height(X, Y + E) - Height(X, Y - E);
		return FVector(-HX, -HY, 2.f * E).GetSafeNormal();
	}

	FVector2D ToGridUV(float X, float Y)
	{
		const float C = FMath::Cos(GridAngle), S = FMath::Sin(GridAngle);
		return FVector2D(X * C + Y * S, -X * S + Y * C);
	}

	ECADDistrict DistrictAt(float X, float Y)
	{
		const float Xm = X / CADM, Ym = Y / CADM;
		if (CADMath::Max(FMath::Abs(Xm), FMath::Abs(Ym)) > 3650.f)
		{
			return ECADDistrict::Rural;
		}
		const FVector2D UV = ToGridUV(Xm, Ym);
		if (UV.X > -760.f && UV.X < 880.f && UV.Y > -1000.f && UV.Y < 330.f) return ECADDistrict::Downtown;
		if (UV.X > -760.f && UV.X < 900.f && UV.Y >= 330.f && UV.Y < 1450.f) return ECADDistrict::Beltline;
		if (Xm > 1850.f && Xm < 3650.f && Ym > 150.f && Ym < 2150.f) return ECADDistrict::Industrial;
		if (Xm > 1700.f && Xm < 3650.f && Ym < -1850.f) return ECADDistrict::Airport;
		if (Ym > -2100.f && Ym < -1350.f && Xm > -1950.f && Xm < 900.f) return ECADDistrict::Beltline; // north-bank mixed use
		const float RiverD = RiverDistance(X, Y);
		if (RiverD < 33000.f && FMath::Abs(Xm) < 2600.f) return ECADDistrict::Parkland;
		return ECADDistrict::Suburb;
	}

	FString DistrictName(ECADDistrict D)
	{
		switch (D)
		{
		case ECADDistrict::Downtown: return TEXT("Downtown");
		case ECADDistrict::Beltline: return TEXT("Beltline");
		case ECADDistrict::Suburb: return TEXT("Suburbs");
		case ECADDistrict::Industrial: return TEXT("Industrial");
		case ECADDistrict::Airport: return TEXT("Airport District");
		case ECADDistrict::Parkland: return TEXT("Bow Riverwalk");
		default: return TEXT("City Edge");
		}
	}
}
