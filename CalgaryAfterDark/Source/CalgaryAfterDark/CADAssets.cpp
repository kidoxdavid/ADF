#include "CADAssets.h"
#include "CADGameInstance.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/ConstructorHelpers.h"
#include "Engine/World.h"

UCADAssets::UCADAssets()
{
	static ConstructorHelpers::FObjectFinder<UStaticMesh> CubeF(TEXT("/Engine/BasicShapes/Cube.Cube"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> SphereF(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> CylF(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> ConeF(TEXT("/Engine/BasicShapes/Cone.Cone"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> PlaneF(TEXT("/Engine/BasicShapes/Plane.Plane"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> MatF(TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
	Cube = CubeF.Object;
	Sphere = SphereF.Object;
	Cylinder = CylF.Object;
	Cone = ConeF.Object;
	Plane = PlaneF.Object;
	FallbackMat = MatF.Object;
}

UCADAssets* CADAssets(const UObject* WorldContext)
{
	if (!WorldContext) return nullptr;
	const UWorld* W = WorldContext->GetWorld();
	if (!W) return nullptr;
	if (UCADGameInstance* GI = Cast<UCADGameInstance>(W->GetGameInstance()))
	{
		return GI->Assets;
	}
	return nullptr;
}

static uint32 HashColor(const FLinearColor& C, float E, float M, float R)
{
	auto Q = [](float V) { return static_cast<uint32>(CADMath::Clamp(FMath::RoundToInt(V * 255.f), 0, 255)); };
	uint32 H = Q(C.R) | (Q(C.G) << 8) | (Q(C.B) << 16) | (Q(C.A) << 24);
	H = HashCombine(H, GetTypeHash(FMath::RoundToInt(E * 10.f)));
	H = HashCombine(H, GetTypeHash(FMath::RoundToInt(M * 20.f)));
	H = HashCombine(H, GetTypeHash(FMath::RoundToInt(R * 20.f)));
	return H;
}

void UCADAssets::InitMaterials()
{
	LitMat = Cast<UMaterialInterface>(StaticLoadObject(UMaterialInterface::StaticClass(), nullptr,
		TEXT("/Game/Materials/M_CAD_Lit.M_CAD_Lit"), nullptr, LOAD_NoWarn | LOAD_Quiet));
	WaterMat = Cast<UMaterialInterface>(StaticLoadObject(UMaterialInterface::StaticClass(), nullptr,
		TEXT("/Game/Materials/M_CAD_Water.M_CAD_Water"), nullptr, LOAD_NoWarn | LOAD_Quiet));
	bFullMaterials = (LitMat != nullptr);
	if (!LitMat) LitMat = FallbackMat;
	if (!WaterMat) WaterMat = LitMat;

	WindowLit = MakeUnique(FLinearColor(1.f, 0.82f, 0.45f), 0.f, 0.f, 0.2f);
	WindowDark = MakeUnique(FLinearColor(0.03f, 0.05f, 0.08f), 0.f, 0.6f, 0.1f);
	LampGlow = MakeUnique(FLinearColor(1.f, 0.85f, 0.55f), 0.f, 0.f, 0.3f);
	SigRed = MakeUnique(FLinearColor(1.f, 0.05f, 0.03f), 6.f, 0.f, 0.3f);
	SigYellow = MakeUnique(FLinearColor(1.f, 0.7f, 0.05f), 6.f, 0.f, 0.3f);
	SigGreen = MakeUnique(FLinearColor(0.05f, 1.f, 0.25f), 6.f, 0.f, 0.3f);
	Water = Cast<UMaterialInstanceDynamic>(UMaterialInstanceDynamic::Create(WaterMat, this));
	if (Water)
	{
		Water->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.08f, 0.28f, 0.38f));
		Water->SetScalarParameterValue(TEXT("Roughness"), 0.05f);
		Water->SetScalarParameterValue(TEXT("Metallic"), 0.2f);
	}
	SetNight(0.f);
}

UMaterialInstanceDynamic* UCADAssets::MakeUnique(const FLinearColor& C, float Emissive, float Metallic, float Roughness)
{
	UMaterialInstanceDynamic* M = UMaterialInstanceDynamic::Create(LitMat ? LitMat.Get() : FallbackMat.Get(), this);
	if (M)
	{
		M->SetVectorParameterValue(TEXT("Color"), C);
		M->SetScalarParameterValue(TEXT("Emissive"), Emissive);
		M->SetScalarParameterValue(TEXT("Metallic"), Metallic);
		M->SetScalarParameterValue(TEXT("Roughness"), Roughness);
	}
	return M;
}

UMaterialInstanceDynamic* UCADAssets::Color(const FLinearColor& C, float Emissive, float Metallic, float Roughness)
{
	const uint32 K = HashColor(C, Emissive, Metallic, Roughness);
	if (TObjectPtr<UMaterialInstanceDynamic>* Found = Cache.Find(K))
	{
		return Found->Get();
	}
	UMaterialInstanceDynamic* M = MakeUnique(C, Emissive, Metallic, Roughness);
	Cache.Add(K, M);
	return M;
}

void UCADAssets::SetNight(float Night)
{
	Night = CADMath::Clamp(Night, 0.f, 1.f);
	if (WindowLit) WindowLit->SetScalarParameterValue(TEXT("Emissive"), CADMath::Lerp(0.05f, 3.5f, Night));
	if (LampGlow) LampGlow->SetScalarParameterValue(TEXT("Emissive"), CADMath::Lerp(0.f, 14.f, Night));
}
