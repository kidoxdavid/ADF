#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "CADTypes.h"
#include "CADEnvironmentSubsystem.generated.h"

class AActor;

class ADirectionalLight;
class ASkyLight;
class AExponentialHeightFog;
class UInstancedStaticMeshComponent;

/**
 * Day/night cycle, Alberta weather (clear, cloudy, rain, fog, snow), sky/fog/lighting actors, rain & snow
 * particles (instanced meshes following the camera), distant Rockies silhouette, and weather grip.
 */
UCLASS()
class CALGARYAFTERDARK_API UCADEnvironmentSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()
public:
	static UCADEnvironmentSubsystem* Get(const UObject* WorldContext);
	virtual bool ShouldCreateSubsystem(UObject* Outer) const override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(UCADEnvironmentSubsystem, STATGROUP_Tickables); }

	bool bEnabled = false;
	bool bAutoWeather = true;
	bool bClockRunning = true;
	float TimeOfDay = 9.f;          // hours 0..24
	int32 Day = 1;
	ECADWeather Weather = ECADWeather::Clear;
	float DayLengthSeconds = 1440.f; // 24 real minutes per in-game day
	FVector Focus = FVector::ZeroVector;
	float Night = 0.f;

	void Setup();                    // spawns the sky actors once
	void SetTime(float Hours);
	void SetWeather(ECADWeather W, bool bInstant = false);
	FString TimeString() const;
	FString WeatherName() const;
	float SunElevation() const;
	float RainIntensity() const { return RainAmt; }
	float WindAmount() const { return WindAmt; }

private:
	UPROPERTY() TObjectPtr<ADirectionalLight> Sun;
	UPROPERTY() TObjectPtr<ADirectionalLight> Moon;
	UPROPERTY() TObjectPtr<ASkyLight> SkyLightActor;
	UPROPERTY() TObjectPtr<AExponentialHeightFog> Fog;
	UPROPERTY() TObjectPtr<AActor> MountainHost;
	UPROPERTY() TObjectPtr<AActor> PrecipHost;
	UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> RainIsm;
	UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> SnowIsm;
	bool bSetUp = false;
	float WeatherBlend = 1.f;       // current visual values lerp toward target
	float FogDensity = 0.002f;
	float CloudDim = 1.f;
	float RainAmt = 0.f, SnowAmt = 0.f, WindAmt = 0.2f;
	float WeatherTimer = 600.f;
	float PrecipClock = 0.f;
	TArray<FVector> PrecipOffsets;
	int32 LastIntHour = -1;

	void UpdateSun();
	void UpdatePrecip(float Dt);
	void BuildMountains();
	void BuildPrecip();
};
