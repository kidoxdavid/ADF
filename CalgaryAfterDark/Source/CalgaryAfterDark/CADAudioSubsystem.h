#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "Sound/SoundWaveProcedural.h"
#include "CADAudioSubsystem.generated.h"

class UAudioComponent;

/**
 * Fully procedural audio (no sound assets required): engine tone driven by the player's vehicle RPM, wind /
 * rain / city-hum ambience, police siren and one-shot impacts. The game launches and plays with no audio
 * content at all; if no audio device exists the streams are simply not created.
 */
UCLASS()
class CALGARYAFTERDARK_API UCADAudioSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()
public:
	static UCADAudioSubsystem* Get(const UObject* WorldContext);
	virtual bool ShouldCreateSubsystem(UObject* Outer) const override;
	virtual void Tick(float DeltaTime) override;
	virtual void Deinitialize() override;
	virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(UCADAudioSubsystem, STATGROUP_Tickables); }

	bool bEnabled = false;
	void PlayThud(float Strength01);
	void PlayTick();

private:
	UPROPERTY() TObjectPtr<UAudioComponent> EngineComp;
	UPROPERTY() TObjectPtr<UAudioComponent> AmbientComp;
	UPROPERTY() TObjectPtr<UAudioComponent> SirenComp;
	UPROPERTY() TObjectPtr<UAudioComponent> SfxComp;
	UPROPERTY() TObjectPtr<USoundWaveProcedural> EngineWave;
	UPROPERTY() TObjectPtr<USoundWaveProcedural> AmbientWave;
	UPROPERTY() TObjectPtr<USoundWaveProcedural> SirenWave;
	UPROPERTY() TObjectPtr<USoundWaveProcedural> SfxWave;
	bool bCreated = false;
	float FootClock = 0.f;

	// parameters written by the game thread, read by the audio thread (single-float, benign races)
	volatile float EngRpm = 0.f, EngAmp = 0.f, EngLoad = 0.f;
	volatile float WindAmp = 0.f, RainAmp = 0.f, CityAmp = 0.f;
	volatile float SirenAmp = 0.f;
	FCriticalSection SfxLock;
	TArray<float> SfxQueue;

	float EngPhase = 0.f, EngNoise = 0.f;
	float AmbLp1 = 0.f, AmbLp2 = 0.f, HumPhase = 0.f;
	float SirenPhase = 0.f, SirenLfo = 0.f;
	uint32 NoiseSeed = 12345u;

	void Create();
	USoundWaveProcedural* MakeWave();
	void GenEngine(USoundWaveProcedural* W, int32 Samples);
	void GenAmbient(USoundWaveProcedural* W, int32 Samples);
	void GenSiren(USoundWaveProcedural* W, int32 Samples);
	void GenSfx(USoundWaveProcedural* W, int32 Samples);
	float Noise();
	static void Push(USoundWaveProcedural* W, const TArray<int16>& Buf);
};
