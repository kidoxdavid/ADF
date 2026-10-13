#include "CADAudioSubsystem.h"
#include "CADEnvironmentSubsystem.h"
#include "CADGameInstance.h"
#include "CADPlayerCharacter.h"
#include "CADTerrain.h"
#include "CADVehicle.h"
#include "CalgaryAfterDark.h"
#include "Components/AudioComponent.h"
#include "Engine/World.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Kismet/GameplayStatics.h"
#include "Engine/Engine.h"

namespace { constexpr int32 SampleRate = 22050; }

UCADAudioSubsystem* UCADAudioSubsystem::Get(const UObject* Ctx)
{
	const UWorld* W = Ctx ? Ctx->GetWorld() : nullptr;
	return W ? W->GetSubsystem<UCADAudioSubsystem>() : nullptr;
}

bool UCADAudioSubsystem::ShouldCreateSubsystem(UObject* Outer) const
{
	const UWorld* W = Cast<UWorld>(Outer);
	return W && W->IsGameWorld() && !IsRunningDedicatedServer();
}

void UCADAudioSubsystem::Deinitialize()
{
	for (UAudioComponent* C : { EngineComp.Get(), AmbientComp.Get(), SirenComp.Get(), SfxComp.Get() })
	{
		if (C) C->Stop();
	}
	if (EngineWave) EngineWave->OnSoundWaveProceduralUnderflow.Unbind();
	if (AmbientWave) AmbientWave->OnSoundWaveProceduralUnderflow.Unbind();
	if (SirenWave) SirenWave->OnSoundWaveProceduralUnderflow.Unbind();
	if (SfxWave) SfxWave->OnSoundWaveProceduralUnderflow.Unbind();
	Super::Deinitialize();
}

float UCADAudioSubsystem::Noise()
{
	NoiseSeed = NoiseSeed * 1664525u + 1013904223u;
	return (static_cast<float>(NoiseSeed >> 8) / 8388608.f) - 1.f;
}

USoundWaveProcedural* UCADAudioSubsystem::MakeWave()
{
	USoundWaveProcedural* W = NewObject<USoundWaveProcedural>(this);
	W->SetSampleRate(SampleRate);
	W->NumChannels = 1;
	W->Duration = INDEFINITELY_LOOPING_DURATION;
	W->SoundGroup = SOUNDGROUP_Default;
	W->bLooping = false;
	return W;
}

void UCADAudioSubsystem::Push(USoundWaveProcedural* W, const TArray<int16>& Buf)
{
	W->QueueAudio(reinterpret_cast<const uint8*>(Buf.GetData()), Buf.Num() * sizeof(int16));
}

void UCADAudioSubsystem::Create()
{
	bCreated = true;
	UWorld* World = GetWorld();
	if (!World || !GEngine || !GEngine->UseSound()) return;   // no audio device: stay silent
	auto Make = [&](TObjectPtr<USoundWaveProcedural>& Wave, TObjectPtr<UAudioComponent>& Comp, void (UCADAudioSubsystem::*Fn)(USoundWaveProcedural*, int32))
	{
		USoundWaveProcedural* Wv = MakeWave();
		Wv->OnSoundWaveProceduralUnderflow = FOnSoundWaveProceduralUnderflow::CreateUObject(this, Fn);
		Wave = Wv;
		Comp = UGameplayStatics::SpawnSound2D(World, Wv, 1.f, 1.f, 0.f, nullptr, false, false);
	};
	Make(EngineWave, EngineComp, &UCADAudioSubsystem::GenEngine);
	Make(AmbientWave, AmbientComp, &UCADAudioSubsystem::GenAmbient);
	Make(SirenWave, SirenComp, &UCADAudioSubsystem::GenSiren);
	Make(SfxWave, SfxComp, &UCADAudioSubsystem::GenSfx);
}

void UCADAudioSubsystem::GenEngine(USoundWaveProcedural* W, int32 Samples)
{
	const int32 N = CADMath::Max(Samples, 2048);
	TArray<int16> Buf;
	Buf.SetNumUninitialized(N);
	const float Rpm = EngRpm, Amp = EngAmp, Load = EngLoad;
	const float F = CADMath::Max(20.f, Rpm / 30.f);   // 4-cylinder firing frequency
	const float Dphi = 2.f * PI * F / SampleRate;
	for (int32 i = 0; i < N; ++i)
	{
		EngPhase += Dphi;
		if (EngPhase > 2.f * PI) EngPhase -= 2.f * PI;
		EngNoise = EngNoise * 0.9f + Noise() * 0.1f;
		float S = 0.55f * FMath::Sin(EngPhase) + 0.28f * FMath::Sin(2.f * EngPhase + 0.4f) + 0.16f * FMath::Sin(3.f * EngPhase) * (0.4f + Load)
			+ 0.07f * FMath::Sin(5.f * EngPhase) * Load + EngNoise * (0.15f + 0.25f * Load);
		S = FMath::Tanh(S * (1.1f + Load)) * Amp * 0.5f;
		Buf[i] = static_cast<int16>(CADMath::Clamp(S, -1.f, 1.f) * 32000.f);
	}
	Push(W, Buf);
}

void UCADAudioSubsystem::GenAmbient(USoundWaveProcedural* W, int32 Samples)
{
	const int32 N = CADMath::Max(Samples, 2048);
	TArray<int16> Buf;
	Buf.SetNumUninitialized(N);
	const float Wind = WindAmp, Rain = RainAmp, City = CityAmp;
	for (int32 i = 0; i < N; ++i)
	{
		const float Nz = Noise();
		AmbLp1 += (Nz - AmbLp1) * 0.03f;           // low rumble (wind / traffic)
		AmbLp2 += (Nz - AmbLp2) * 0.35f;           // brighter hiss (rain)
		HumPhase += 2.f * PI * 55.f / SampleRate;
		if (HumPhase > 2.f * PI) HumPhase -= 2.f * PI;
		const float WindS = AmbLp1 * 4.f * Wind;
		const float RainS = (AmbLp2 - AmbLp1 * 0.5f) * Rain * 0.9f;
		const float CityS = (AmbLp1 * 3.f + 0.05f * FMath::Sin(HumPhase)) * City;
		const float S = (WindS + RainS + CityS) * 0.5f;
		Buf[i] = static_cast<int16>(CADMath::Clamp(S, -1.f, 1.f) * 30000.f);
	}
	Push(W, Buf);
}

void UCADAudioSubsystem::GenSiren(USoundWaveProcedural* W, int32 Samples)
{
	const int32 N = CADMath::Max(Samples, 2048);
	TArray<int16> Buf;
	Buf.SetNumUninitialized(N);
	const float Amp = SirenAmp;
	for (int32 i = 0; i < N; ++i)
	{
		SirenLfo += 2.f * PI * 0.35f / SampleRate;
		if (SirenLfo > 2.f * PI) SirenLfo -= 2.f * PI;
		const float Freq = 950.f + 450.f * FMath::Sin(SirenLfo);
		SirenPhase += 2.f * PI * Freq / SampleRate;
		if (SirenPhase > 2.f * PI) SirenPhase -= 2.f * PI;
		const float S = (FMath::Sin(SirenPhase) + 0.3f * FMath::Sin(SirenPhase * 2.f)) * Amp * 0.3f;
		Buf[i] = static_cast<int16>(CADMath::Clamp(S, -1.f, 1.f) * 30000.f);
	}
	Push(W, Buf);
}

void UCADAudioSubsystem::GenSfx(USoundWaveProcedural* W, int32 Samples)
{
	const int32 N = CADMath::Max(Samples, 2048);
	TArray<int16> Buf;
	Buf.SetNumZeroed(N);
	{
		FScopeLock Lock(&SfxLock);
		const int32 Take = CADMath::Min(N, SfxQueue.Num());
		for (int32 i = 0; i < Take; ++i) Buf[i] = static_cast<int16>(CADMath::Clamp(SfxQueue[i], -1.f, 1.f) * 30000.f);
		SfxQueue.RemoveAt(0, Take);
	}
	Push(W, Buf);
}

void UCADAudioSubsystem::PlayThud(float Strength)
{
	FScopeLock Lock(&SfxLock);
	if (SfxQueue.Num() > SampleRate) return;
	const int32 Len = static_cast<int32>(SampleRate * (0.12f + 0.25f * Strength));
	float Lp = 0.f;
	for (int32 i = 0; i < Len; ++i)
	{
		const float T = static_cast<float>(i) / Len;
		Lp += (Noise() - Lp) * 0.12f;
		SfxQueue.Add((Lp * 2.5f + 0.5f * FMath::Sin(i * 0.05f)) * (1.f - T) * (1.f - T) * Strength);
	}
}

void UCADAudioSubsystem::PlayTick()
{
	FScopeLock Lock(&SfxLock);
	if (SfxQueue.Num() > SampleRate) return;
	for (int32 i = 0; i < 700; ++i) SfxQueue.Add(FMath::Sin(i * 0.5f) * (1.f - i / 700.f) * 0.18f);
}

void UCADAudioSubsystem::Tick(float DeltaTime)
{
	if (!bEnabled) return;
	if (!bCreated) Create();
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	const float Master = GI ? GI->Settings.MasterVolume : 0.8f;
	APawn* P = UGameplayStatics::GetPlayerPawn(GetWorld(), 0);

	// engine
	if (ACADVehicle* V = Cast<ACADVehicle>(P))
	{
		const float Load = CADMath::Clamp(V->InThrottle, 0.f, 1.f);
		EngRpm = V->bWrecked ? 0.f : V->EngineRpm();
		EngLoad = Load;
		EngAmp = V->bWrecked ? 0.f : (0.35f + 0.5f * Load) * Master;
	}
	else
	{
		EngAmp = FMath::FInterpTo(EngAmp, 0.f, DeltaTime, 8.f);
	}

	// ambience from weather and location
	float Rain = 0.f, Wind = 0.15f;
	if (UCADEnvironmentSubsystem* Env = UCADEnvironmentSubsystem::Get(this))
	{
		Rain = Env->RainIntensity();
		Wind = Env->WindAmount();
	}
	const FVector L = P ? P->GetActorLocation() : FVector::ZeroVector;
	const ECADDistrict D = CADTerrain::DistrictAt(L.X, L.Y);
	float City = 0.25f;
	if (D == ECADDistrict::Downtown) City = 0.55f;
	else if (D == ECADDistrict::Rural) { City = 0.05f; Wind += 0.3f; }
	else if (D == ECADDistrict::Suburb) City = 0.12f;
	else if (D == ECADDistrict::Industrial) City = 0.3f;
	if (L.X < -380000.f) Wind += 0.35f;      // foothills: more wind
	WindAmp = CADMath::Clamp(Wind, 0.f, 1.f) * 0.5f * Master;
	RainAmp = Rain * 0.5f * Master;
	CityAmp = City * 0.4f * Master;

	// nearest siren
	float Siren = 0.f;
	for (const TWeakObjectPtr<ACADVehicle>& W : ACADVehicle::Registry)
	{
		const ACADVehicle* V = W.Get();
		if (V && V->bSirenOn && !V->bWrecked)
		{
			const float Dst = FVector::Dist(V->GetActorLocation(), L);
			Siren = CADMath::Max(Siren, CADMath::Clamp(1.f - Dst / 9000.f, 0.f, 1.f));
		}
	}
	SirenAmp = Siren * Master;

	// footsteps for the on-foot player
	if (const ACADPlayerCharacter* C = Cast<ACADPlayerCharacter>(P))
	{
		const float Speed = C->GetVelocity().Size2D();
		if (Speed > 60.f && C->GetCharacterMovement() && C->GetCharacterMovement()->IsMovingOnGround())
		{
			FootClock += DeltaTime;
			const float Interval = Speed > 500.f ? 0.28f : 0.45f;
			if (FootClock > Interval) { FootClock = 0.f; PlayThud(0.12f * Master); }
		}
	}
}
