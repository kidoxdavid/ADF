#include "CADSetupCommandlet.h"
#include "CalgaryAfterDark.h"

#if WITH_EDITOR
#include "AssetRegistry/AssetRegistryModule.h"
#include "Factories/MaterialFactoryNew.h"
#include "Materials/Material.h"
#include "Materials/MaterialExpressionMultiply.h"
#include "Materials/MaterialExpressionScalarParameter.h"
#include "Materials/MaterialExpressionVectorParameter.h"
#include "Misc/PackageName.h"
#include "UObject/Package.h"
#include "UObject/SavePackage.h"

static UMaterialExpressionScalarParameter* AddScalar(UMaterial* M, const TCHAR* Name, float Default)
{
	UMaterialExpressionScalarParameter* P = NewObject<UMaterialExpressionScalarParameter>(M);
	P->ParameterName = Name;
	P->DefaultValue = Default;
	M->GetExpressionCollection().AddExpression(P);
	return P;
}

static bool MakeMaterial(const FString& Name, bool bWater)
{
	const FString PkgName = FString::Printf(TEXT("/Game/Materials/%s"), *Name);
	UPackage* Pkg = CreatePackage(*PkgName);
	UMaterialFactoryNew* Factory = NewObject<UMaterialFactoryNew>();
	UMaterial* M = Cast<UMaterial>(Factory->FactoryCreateNew(UMaterial::StaticClass(), Pkg, *Name, RF_Public | RF_Standalone, nullptr, GWarn));
	if (!M) return false;

	UMaterialExpressionVectorParameter* Col = NewObject<UMaterialExpressionVectorParameter>(M);
	Col->ParameterName = TEXT("Color");
	Col->DefaultValue = FLinearColor(0.5f, 0.5f, 0.5f, 1.f);
	M->GetExpressionCollection().AddExpression(Col);
	UMaterialExpressionScalarParameter* Emi = AddScalar(M, TEXT("Emissive"), 0.f);
	UMaterialExpressionScalarParameter* Rough = AddScalar(M, TEXT("Roughness"), bWater ? 0.05f : 0.75f);
	UMaterialExpressionScalarParameter* Metal = AddScalar(M, TEXT("Metallic"), 0.f);
	UMaterialExpressionMultiply* Mul = NewObject<UMaterialExpressionMultiply>(M);
	Mul->A.Connect(0, Col);
	Mul->B.Connect(0, Emi);
	M->GetExpressionCollection().AddExpression(Mul);

	UMaterialEditorOnlyData* ED = M->GetEditorOnlyData();
	ED->BaseColor.Connect(0, Col);
	ED->EmissiveColor.Connect(0, Mul);
	ED->Roughness.Connect(0, Rough);
	ED->Metallic.Connect(0, Metal);
	if (bWater)
	{
		M->BlendMode = BLEND_Translucent;
		UMaterialExpressionScalarParameter* Op = AddScalar(M, TEXT("Opacity"), 0.78f);
		ED->Opacity.Connect(0, Op);
	}
	M->PostEditChange();
	M->MarkPackageDirty();
	FAssetRegistryModule::AssetCreated(M);

	const FString File = FPackageName::LongPackageNameToFilename(PkgName, FPackageName::GetAssetPackageExtension());
	FSavePackageArgs Args;
	Args.TopLevelFlags = RF_Public | RF_Standalone;
	const bool bOk = UPackage::SavePackage(Pkg, M, *File, Args);
	UE_LOG(LogCAD, Display, TEXT("CADSetup: %s %s"), *PkgName, bOk ? TEXT("saved") : TEXT("FAILED to save"));
	return bOk;
}
#endif

UCADSetupCommandlet::UCADSetupCommandlet()
{
	IsClient = false;
	IsEditor = true;
	IsServer = false;
	LogToConsole = true;
}

int32 UCADSetupCommandlet::Main(const FString& Params)
{
#if WITH_EDITOR
	const bool bA = MakeMaterial(TEXT("M_CAD_Lit"), false);
	const bool bB = MakeMaterial(TEXT("M_CAD_Water"), true);
	return (bA && bB) ? 0 : 1;
#else
	UE_LOG(LogCAD, Error, TEXT("CADSetup must run in the editor build."));
	return 1;
#endif
}
