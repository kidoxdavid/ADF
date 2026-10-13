#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "CADDataSubsystem.h"
#include "CADMissionSubsystem.generated.h"

class APawn;

class ACADVehicle;
class ACADMarker;

struct FCADMissionResult
{
	FString Title;
	bool bSuccess = false;
	TArray<FString> Lines;
	int32 Cash = 0;
};

struct FCADObjTarget
{
	FVector Pos = FVector::ZeroVector;
	FString Label;
	FLinearColor Colour = FLinearColor::White;
	bool bPrimary = true;
};

/**
 * Data-driven mission runner. Missions are rows in Missions.csv; their stages (dialogue, travel, timed
 * checkpoints, vehicle search, branching choices, evading police, ramming, racing...) are rows in
 * MissionStages.csv. Handles objectives, timers, optional objectives, checkpoints/restart, rewards (paid at most
 * once), reputation, flags and completion records.
 */
UCLASS()
class CALGARYAFTERDARK_API UCADMissionSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()
public:
	static UCADMissionSubsystem* Get(const UObject* WorldContext);
	virtual bool ShouldCreateSubsystem(UObject* Outer) const override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(UCADMissionSubsystem, STATGROUP_Tickables); }

	bool bEnabled = false;

	// ---- state ----------------------------------------------------------------------------------
	bool bActive = false;
	bool bFailed = false;
	bool bResultReady = false;
	FString FailReason;
	FCADMissionResult Result;
	FName ActiveId;
	int32 StageIdx = 0;
	float TimeLeft = -1.f;
	float MissionTime = 0.f;
	bool bInputLocked = false;   // race countdown
	FString CountdownText;
	FName BriefingId;
	FString BriefingWhy;

	// HUD callbacks set by the game mode
	TFunction<void()> OnBriefing;
	TFunction<void()> OnResultReady;

	// ---- queries ----------------------------------------------------------------------------------
	const FCADMissionDef* Def() const;
	const FCADStageDef* Stage() const;
	bool CanStart(FName Id, FString& Why) const;
	bool AvailableAt(FName GiverLocation, FName& OutMission) const;
	bool IsCompleted(FName Id) const;
	bool InDialogue() const;
	bool GetDialogueLine(FString& Speaker, FString& Text) const;
	bool InChoice() const;
	bool ChoiceAvailable(int32 I, FString* OutReason = nullptr) const;
	FString ObjectiveText() const;
	void GetTargets(TArray<FCADObjTarget>& Out) const;
	FString OptionalText() const;
	int32 NumCompleted() const;

	// ---- commands -----------------------------------------------------------------------------------
	void ShowBriefing(FName Id);
	void AcceptBriefing();
	void DeclineBriefing();
	void Start(FName Id);
	void StartCourier();
	void AdvanceDialogue();
	void ChooseOption(int32 I);
	void Retry();
	void Abandon();
	void DismissResult();
	void NotifyMapOpened();
	void NotifyBusted();
	void NotifyPlayerDead();
	void ApplyEffects(const FString& Effects, FName CashKey, TArray<FString>* Summary);
	bool CheckRequirement(const FString& Req) const;

private:
	FCADMissionDef GigDef;
	int32 CheckpointStage = 0;
	float StageTime = 0.f;
	int32 CpIdx = 0;
	int32 DialogueIdx = 0;
	int32 FindIdx = 0;
	float BonusTime = 0.f;
	float MinHealth = 100.f;
	bool bEverWanted = false;
	int32 GigCounter = 0;
	float RaceCountdown = 0.f;
	int32 RivalSpawnTries = 0;
	int32 RivalsWanted = 0;
	float DensityBackup = 1.f;
	bool bDensityBoosted = false;

	UPROPERTY() TArray<TObjectPtr<ACADMarker>> StageMarkers;
	UPROPERTY() TObjectPtr<ACADVehicle> MissionVehicle;
	UPROPERTY() TObjectPtr<ACADVehicle> TargetVehicle;
	UPROPERTY() TObjectPtr<ACADVehicle> RaceRival;
	UPROPERTY() TArray<TObjectPtr<ACADVehicle>> Rivals;

	class UCADGameInstance* GI() const;
	UCADDataSubsystem* Data() const;
	APawn* PlayerPawn() const;
	ACADVehicle* PlayerVehicle() const;
	FVector Loc(FName Id) const;
	static FString ParamVal(const FString& Param, const TCHAR* Key);

	void EnterStage(int32 Idx);
	void NextStage();
	void JumpTo(int32 Idx);
	void Fail(const FString& Reason);
	void Finish(const FCADStageDef& S);
	void ClearStageActors(bool bKeepMissionVehicle);
	void ClearAllActors();
	void SetMarkers(const TArray<FCADObjTarget>& T);
	ACADVehicle* SpawnMissionVehicle(FName VehicleId, const FVector* AtLocation, ECADVehicleRole Role);
	void EnsureMissionVehicle(const FCADStageDef& S);
	void RestoreDensity();
	void TickStage(float Dt);
	bool Reached(const FVector& P, float RadiusCm, bool bNeedVehicle, bool bNeedStop, bool bNeedMissionVehicle) const;
};
