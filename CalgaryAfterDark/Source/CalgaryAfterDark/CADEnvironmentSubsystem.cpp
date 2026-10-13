#include "CADEnvironmentSubsystem.h"
#include "CADAssets.h"
#include "CADEconomySubsystem.h"
#include "CADGameInstance.h"
#include "CADTrafficSubsystem.h"
#include "CADPedestrianSubsystem.h"
#include "CADVehicle.h"
#include "CADWorldStreamer.h"
#include "CalgaryAfterDark.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/SkyLightComponent.h"
#include "Engine/DirectionalLight.h"
#include "Engine/ExponentialHeightFog.h"
#include "Engine/SkyLight.h"
#include "Engine/World.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/VolumetricCloudComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInstanceDynamic.h"

UCADEnvironmentSubsystem* UCADEnvironmentSubsystem::Get(const UObject* Ctx)
{
	const UWorld* W = Ctx ? Ctx->GetWorld() : nullptr;
	return W ? W->GetSubsystem<UCADEnvironmentSubsystem>() : nullptr;
}

bool UCADEnvironmentSubsystem::ShouldCreateSubsystem(UObject* Outer) const
{
	const UWorld* W = Cast<UWorld>(Outer);
	return W && W->IsGameWorld();
}

void UCADEnvironmentSubsystem::Setup()
{
	if (bSetUp) return;
	UWorld* W = GetWorld();
	if (!W) return;
	bSetUp = true;

	auto SpawnLight = [&](bool bMoon) -> ADirectionalLight*
	{
		const FTransform T(FRotator(-45.f, 30.f, 0.f));
		ADirectionalLight* L = W->SpawnActorDeferred<ADirectionalLight>(ADirectionalLight::StaticClass(), T);
		if (!L) return nullptr;
		L->GetRootComponent()->SetMobility(EComponentMobility::Movable);
		L->FinishSpawning(T);
		UDirectionalLightComponent* C = Cast<UDirectionalLightComponent>(L->GetLightComponent());
		C->SetMobility(EComponentMobility::Movable);
		C->bUsedAsAtmosphereSunLight = true;
		C->AtmosphereSunLightIndex = bMoon ? 1 : 0;
		C->SetCastShadows(true);
		C->SetIntensity(bMoon ? 0.4f : 10.f);
		if (bMoon) C->SetLightColor(FLinearColor(0.55f, 0.65f, 1.f));
		return L;
	};
	Sun = SpawnLight(false);
	Moon = SpawnLight(true);

	// Sky atmosphere + volumetric clouds + height fog + real-time-captured sky light
	{
		AActor* Atmos = W->SpawnActor<AActor>();
		USkyAtmosphereComponent* SA = NewObject<USkyAtmosphereComponent>(Atmos, TEXT("SkyAtmosphere"));
		Atmos->SetRootComponent(SA);
		SA->RegisterComponent();
		UVolumetricCloudComponent* VC = NewObject<UVolumetricCloudComponent>(Atmos, TEXT("Clouds"));
		VC->SetupAttachment(SA);
		VC->RegisterComponent();
	}
	{
		const FTransform T;
		SkyLightActor = W->SpawnActorDeferred<ASkyLight>(ASkyLight::StaticClass(), T);
		if (SkyLightActor)
		{
			SkyLightActor->GetRootComponent()->SetMobility(EComponentMobility::Movable);
			USkyLightComponent* C = SkyLightActor->GetLightComponent();
			C->bRealTimeCapture = true;
			C->SetIntensity(1.f);
			SkyLightActor->FinishSpawning(T);
		}
	}
	Fog = W->SpawnActor<AExponentialHeightFog>();
	if (Fog && Fog->GetComponent())
	{
		Fog->GetComponent()->SetVolumetricFog(true);
		Fog->GetComponent()->SetFogDensity(0.002f);
		Fog->GetComponent()->SetFogHeightFalloff(0.3f);
	}
	BuildMountains();
	BuildPrecip();
	UpdateSun();
}

void UCADEnvironmentSubsystem::BuildMountains()
{
	UCADAssets* A = CADAssets(this);
	UWorld* W = GetWorld();
	if (!A || !W) return;
	MountainHost = W->SpawnActor<AActor>();
	USceneComponent* Root = NewObject<USceneComponent>(MountainHost, TEXT("Root"));
	MountainHost->SetRootComponent(Root);
	Root->RegisterComponent();
	auto MakeIsm = [&](UMaterialInterface* M) -> UInstancedStaticMeshComponent*
	{
		UInstancedStaticMeshComponent* C = NewObject<UInstancedStaticMeshComponent>(MountainHost);
		C->SetStaticMesh(A->Cone);
		C->SetMaterial(0, M);
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		C->SetCastShadow(false);
		C->SetCanEverAffectNavigation(false);
		C->bAffectDistanceFieldLighting = false;
		C->SetupAttachment(Root);
		C->RegisterComponent();
		return C;
	};
	UInstancedStaticMeshComponent* Rock = MakeIsm(A->Color(FLinearColor(0.07f, 0.09f, 0.12f), 0.f, 0.f, 1.f));
	UInstancedStaticMeshComponent* Snow = MakeIsm(A->Color(FLinearColor(0.75f, 0.78f, 0.82f), 0.f, 0.f, 1.f));
	FRandomStream R(77);
	for (int32 i = 0; i < 34; ++i)
	{
		const float Y = -2400000.f + i * 150000.f + R.FRandRange(-40000.f, 40000.f);
		const float X = -3000000.f - FMath::Abs(Y) * 0.12f + R.FRandRange(-250000.f, 250000.f);
		const float H = R.FRandRange(180000.f, 330000.f) * (1.f - FMath::Abs(Y) / 5000000.f);
		const float Dia = H * R.FRandRange(1.6f, 2.4f);
		Rock->AddInstance(FTransform(FRotator::ZeroRotator, FVector(X, Y, H * 0.45f), FVector(Dia / 100.f, Dia / 100.f, H / 100.f)));
		Snow->AddInstance(FTransform(FRotator::ZeroRotator, FVector(X, Y, H * 0.45f + H * 0.32f), FVector(Dia * 0.34f / 100.f, Dia * 0.34f / 100.f, H * 0.36f / 100.f)));
	}
}

void UCADEnvironmentSubsystem::BuildPrecip()
{
	UCADAssets* A = CADAssets(this);
	UWorld* W = GetWorld();
	if (!A || !W) return;
	PrecipHost = W->SpawnActor<AActor>();
	USceneComponent* Root = NewObject<USceneComponent>(PrecipHost, TEXT("Root"));
	PrecipHost->SetRootComponent(Root);
	Root->RegisterComponent();
	auto MakeIsm = [&](UMaterialInterface* M, const FVector& Scale, int32 Count) -> UInstancedStaticMeshComponent*
	{
		UInstancedStaticMeshComponent* C = NewObject<UInstancedStaticMeshComponent>(PrecipHost);
		C->SetMobility(EComponentMobility::Movable);
		C->SetStaticMesh(A->Cube);
		C->SetMaterial(0, M);
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		C->SetCastShadow(false);
		C->SetCanEverAffectNavigation(false);
		C->SetupAttachment(Root);
		C->RegisterComponent();
		for (int32 i = 0; i < Count; ++i) C->AddInstance(FTransform(FRotator::ZeroRotator, FVector::ZeroVector, Scale));
		C->SetVisibility(false);
		return C;
	};
	RainIsm = MakeIsm(A->Color(FLinearColor(0.6f, 0.7f, 0.85f), 1.2f, 0.f, 0.2f), FVector(0.012f, 0.012f, 0.55f), 700);
	SnowIsm = MakeIsm(A->Color(FLinearColor(0.9f, 0.92f, 1.f), 1.0f, 0.f, 0.8f), FVector(0.045f, 0.045f, 0.045f), 600);
	FRandomStream R(5);
	for (int32 i = 0; i < 700; ++i) PrecipOffsets.Add(FVector(R.FRandRange(-1800.f, 1800.f), R.FRandRange(-1800.f, 1800.f), R.FRandRange(0.f, 1600.f)));
}

void UCADEnvironmentSubsystem::SetTime(float Hours)
{
	TimeOfDay = FMath::Fmod(Hours + 24.f, 24.f);
	UpdateSun();
}

void UCADEnvironmentSubsystem::SetWeather(ECADWeather NewWeather, bool bInstant)
{
	Weather = NewWeather;
	if (bInstant)
	{
		switch (Weather)
		{
		case ECADWeather::Clear: FogDensity = 0.002f; CloudDim = 1.f; RainAmt = 0.f; SnowAmt = 0.f; break;
		case ECADWeather::Cloudy: FogDensity = 0.004f; CloudDim = 0.55f; RainAmt = 0.f; SnowAmt = 0.f; break;
		case ECADWeather::Rain: FogDensity = 0.01f; CloudDim = 0.35f; RainAmt = 1.f; SnowAmt = 0.f; break;
		case ECADWeather::Fog: FogDensity = 0.045f; CloudDim = 0.5f; RainAmt = 0.f; SnowAmt = 0.f; break;
		case ECADWeather::Snow: FogDensity = 0.018f; CloudDim = 0.5f; RainAmt = 0.f; SnowAmt = 1.f; break;
		}
	}
}

float UCADEnvironmentSubsystem::SunElevation() const
{
	return 50.f * FMath::Sin((TimeOfDay - 6.f) / 12.f * PI);
}

FString UCADEnvironmentSubsystem::TimeString() const
{
	const int32 H = FMath::FloorToInt(TimeOfDay);
	const int32 M = FMath::FloorToInt((TimeOfDay - H) * 60.f);
	return FString::Printf(TEXT("%02d:%02d"), H, M);
}

FString UCADEnvironmentSubsystem::WeatherName() const
{
	switch (Weather)
	{
	case ECADWeather::Clear: return TEXT("Clear");
	case ECADWeather::Cloudy: return TEXT("Cloudy");
	case ECADWeather::Rain: return TEXT("Rain");
	case ECADWeather::Fog: return TEXT("Fog");
	default: return TEXT("Snow");
	}
}

void UCADEnvironmentSubsystem::UpdateSun()
{
	if (!bSetUp) return;
	const float Elev = SunElevation();
	const float Az = 90.f + (TimeOfDay - 6.f) / 12.f * 180.f; // east at 6:00, south at noon, west at 18:00
	if (Sun)
	{
		Sun->SetActorRotation(FRotator(-Elev, Az + 180.f, 0.f));
		const float Day01 = CADMath::Clamp((Elev + 2.f) / 14.f, 0.f, 1.f);
		const bool bSunriseGlow = FMath::Abs(Elev) < 8.f;
		if (UDirectionalLightComponent* C = Cast<UDirectionalLightComponent>(Sun->GetLightComponent()))
		{
			C->SetIntensity(10.f * Day01 * CloudDim);
			C->SetLightColor(bSunriseGlow ? FLinearColor(1.f, 0.72f, 0.5f) : FLinearColor(1.f, 0.96f, 0.9f));
		}
	}
	if (Moon)
	{
		Moon->SetActorRotation(FRotator(Elev * 0.9f, Az, 0.f));
		const float N = CADMath::Clamp((-Elev + 4.f) / 12.f, 0.f, 1.f);
		if (UDirectionalLightComponent* C = Cast<UDirectionalLightComponent>(Moon->GetLightComponent()))
		{
			C->SetIntensity(0.5f * N * CloudDim);
		}
	}
	Night = CADMath::Clamp((4.f - Elev) / 12.f, 0.f, 1.f);
	if (SkyLightActor && SkyLightActor->GetLightComponent())
	{
		SkyLightActor->GetLightComponent()->SetIntensity(CADMath::Lerp(1.f, 0.5f, Night) * CADMath::Lerp(0.6f, 1.f, CloudDim));
	}
	if (UCADAssets* A = CADAssets(this)) A->SetNight(Night);
}

void UCADEnvironmentSubsystem::UpdatePrecip(float Dt)
{
	if (!RainIsm || !SnowIsm) return;
	const bool bRain = RainAmt > 0.05f, bSnow = SnowAmt > 0.05f;
	RainIsm->SetVisibility(bRain);
	SnowIsm->SetVisibility(bSnow);
	if (!bRain && !bSnow) return;
	PrecipClock += Dt;
	auto Update = [&](UInstancedStaticMeshComponent* C, float Amount, float Speed, float Drift, int32 Count, const FVector& Scale)
	{
		TArray<FTransform> T;
		T.Reserve(Count);
		const int32 Active = FMath::RoundToInt(Count * Amount);
		for (int32 i = 0; i < Count; ++i)
		{
			if (i >= Active) { T.Add(FTransform(FRotator::ZeroRotator, FVector(0, 0, -1000000.f), Scale)); continue; }
			const FVector& O = PrecipOffsets[i];
			const float Z = FMath::Fmod(O.Z - PrecipClock * Speed + 1600000.f, 1600.f);
			const FVector P = Focus + FVector(O.X + FMath::Sin(PrecipClock * 0.7f + i) * Drift, O.Y + FMath::Cos(PrecipClock * 0.6f + i * 0.5f) * Drift, Z - 300.f);
			T.Add(FTransform(FRotator(WindAmt * 8.f, 0.f, 0.f), P, Scale));
		}
		C->BatchUpdateInstancesTransforms(0, T, true, true, true);
	};
	if (bRain) Update(RainIsm, RainAmt, 1500.f, 8.f, 700, FVector(0.012f, 0.012f, 0.55f));
	if (bSnow) Update(SnowIsm, SnowAmt, 160.f, 90.f, 600, FVector(0.045f, 0.045f, 0.045f));
}

void UCADEnvironmentSubsystem::Tick(float DeltaTime)
{
	if (!bEnabled) return;
	if (!bSetUp) Setup();
	const float Dt = CADMath::Min(DeltaTime, 0.1f);

	if (bClockRunning)
	{
		TimeOfDay += Dt * 24.f / DayLengthSeconds;
		if (TimeOfDay >= 24.f)
		{
			TimeOfDay -= 24.f;
			++Day;
		}
		const int32 Hour = FMath::FloorToInt(TimeOfDay);
		if (Hour != LastIntHour)
		{
			if (Hour == 6 && LastIntHour != -1)
			{
				if (UCADGameInstance* GI = UCADGameInstance::Get(this))
					if (UCADEconomySubsystem* E = GI->GetSubsystem<UCADEconomySubsystem>()) E->PayPropertyIncome();
			}
			LastIntHour = Hour;
		}
	}

	if (bAutoWeather)
	{
		WeatherTimer -= Dt;
		if (WeatherTimer <= 0.f)
		{
			WeatherTimer = FMath::FRandRange(420.f, 900.f);
			const float R = FMath::FRand();
			SetWeather(R < 0.40f ? ECADWeather::Clear : R < 0.70f ? ECADWeather::Cloudy : R < 0.82f ? ECADWeather::Rain : R < 0.88f ? ECADWeather::Fog : ECADWeather::Snow);
		}
	}

	// ease visuals toward the target weather
	float TFog = 0.002f, TCloud = 1.f, TRain = 0.f, TSnow = 0.f, TWind = 0.15f, TGrip = 1.f;
	switch (Weather)
	{
	case ECADWeather::Cloudy: TFog = 0.004f; TCloud = 0.55f; TWind = 0.35f; break;
	case ECADWeather::Rain: TFog = 0.01f; TCloud = 0.35f; TRain = 1.f; TWind = 0.5f; TGrip = 0.8f; break;
	case ECADWeather::Fog: TFog = 0.045f; TCloud = 0.5f; TWind = 0.05f; break;
	case ECADWeather::Snow: TFog = 0.018f; TCloud = 0.5f; TSnow = 1.f; TWind = 0.3f; TGrip = 0.68f; break;
	default: break;
	}
	const float K = CADMath::Min(1.f, Dt * 0.25f);
	FogDensity = CADMath::Lerp(FogDensity, TFog, K);
	CloudDim = CADMath::Lerp(CloudDim, TCloud, K);
	RainAmt = CADMath::Lerp(RainAmt, TRain, K * 1.5f);
	SnowAmt = CADMath::Lerp(SnowAmt, TSnow, K * 1.5f);
	WindAmt = CADMath::Lerp(WindAmt, TWind, K);
	ACADVehicle::GlobalGrip = CADMath::Lerp(ACADVehicle::GlobalGrip, TGrip, K * 2.f);
	if (Fog && Fog->GetComponent()) Fog->GetComponent()->SetFogDensity(FogDensity);

	UpdateSun();
	UpdatePrecip(Dt);

	// broadcast night to the other systems
	if (UCADWorldStreamer* S = GetWorld()->GetSubsystem<UCADWorldStreamer>()) S->Night = Night;
	if (UCADTrafficSubsystem* T = GetWorld()->GetSubsystem<UCADTrafficSubsystem>()) { T->Night = Night; T->RainFactor = RainAmt; }
	if (UCADPedestrianSubsystem* P = GetWorld()->GetSubsystem<UCADPedestrianSubsystem>()) P->Night = Night;
}
