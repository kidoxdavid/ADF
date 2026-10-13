#include "CADMissionSubsystem.h"
#include "CADEconomySubsystem.h"
#include "CADEnvironmentSubsystem.h"
#include "CADFleetSubsystem.h"
#include "CADGameInstance.h"
#include "CADMarker.h"
#include "CADPoliceSubsystem.h"
#include "CADTerrain.h"
#include "CADTrafficSubsystem.h"
#include "CADVehicle.h"
#include "CADVehicleDriver.h"
#include "CalgaryAfterDark.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"

UCADMissionSubsystem* UCADMissionSubsystem::Get(const UObject* Ctx)
{
	const UWorld* W = Ctx ? Ctx->GetWorld() : nullptr;
	return W ? W->GetSubsystem<UCADMissionSubsystem>() : nullptr;
}

bool UCADMissionSubsystem::ShouldCreateSubsystem(UObject* Outer) const
{
	const UWorld* W = Cast<UWorld>(Outer);
	return W && W->IsGameWorld();
}

UCADGameInstance* UCADMissionSubsystem::GI() const { return UCADGameInstance::Get(this); }
UCADDataSubsystem* UCADMissionSubsystem::Data() const { return GI() ? GI()->GetSubsystem<UCADDataSubsystem>() : nullptr; }
APawn* UCADMissionSubsystem::PlayerPawn() const { return UGameplayStatics::GetPlayerPawn(GetWorld(), 0); }
ACADVehicle* UCADMissionSubsystem::PlayerVehicle() const { return Cast<ACADVehicle>(PlayerPawn()); }
FVector UCADMissionSubsystem::Loc(FName Id) const { return Data() ? Data()->LocationPos(Id) : FVector::ZeroVector; }

FString UCADMissionSubsystem::ParamVal(const FString& Param, const TCHAR* Key)
{
	TArray<FString> Parts;
	Param.ParseIntoArray(Parts, TEXT(";"), true);
	const FString Prefix = FString(Key) + TEXT(":");
	for (const FString& P : Parts)
	{
		if (P.StartsWith(Prefix)) return P.Mid(Prefix.Len());
	}
	return FString();
}

// ------------------------------------------------------------------------------------------------
// Queries
// ------------------------------------------------------------------------------------------------
const FCADMissionDef* UCADMissionSubsystem::Def() const
{
	if (!bActive && !bFailed && !bResultReady) return nullptr;
	if (ActiveId == TEXT("gig")) return &GigDef;
	return Data() ? Data()->Missions.Find(ActiveId) : nullptr;
}

const FCADStageDef* UCADMissionSubsystem::Stage() const
{
	const FCADMissionDef* D = Def();
	return (D && D->Stages.IsValidIndex(StageIdx)) ? &D->Stages[StageIdx] : nullptr;
}

bool UCADMissionSubsystem::IsCompleted(FName Id) const { return GI() && GI()->Profile.CompletedMissions.Contains(Id); }

int32 UCADMissionSubsystem::NumCompleted() const { return GI() ? GI()->Profile.CompletedMissions.Num() : 0; }

bool UCADMissionSubsystem::CheckRequirement(const FString& Req) const
{
	if (Req.IsEmpty()) return true;
	UCADGameInstance* G = GI();
	if (!G) return false;
	if (Req.StartsWith(TEXT("flag:"))) return G->Profile.HasFlag(FName(*Req.Mid(5)));
	FString Lhs, Rhs;
	if (!Req.Split(TEXT(">="), &Lhs, &Rhs)) return true;
	const int32 N = FCString::Atoi(*Rhs);
	Lhs = Lhs.ToLower();
	if (Lhs == TEXT("cash")) return G->Profile.Cash >= N;
	if (Lhs == TEXT("rep_public") || Lhs == TEXT("public")) return G->Profile.RepPublic >= N;
	if (Lhs == TEXT("rep_business") || Lhs == TEXT("business")) return G->Profile.RepBusiness >= N;
	if (Lhs == TEXT("rep_underworld") || Lhs == TEXT("underworld")) return G->Profile.RepUnderworld >= N;
	return true;
}

bool UCADMissionSubsystem::CanStart(FName Id, FString& Why) const
{
	UCADDataSubsystem* D = Data();
	const FCADMissionDef* M = D ? D->Missions.Find(Id) : nullptr;
	if (!M) { Why = TEXT("Unknown mission."); return false; }
	if (bActive) { Why = TEXT("Finish or abandon your current job first."); return false; }
	if (IsCompleted(Id) && !M->bRepeatable) { Why = TEXT("Already completed."); return false; }
	for (const FName& P : M->Prereq)
	{
		if (!IsCompleted(P))
		{
			const FCADMissionDef* PM = D->Missions.Find(P);
			Why = FString::Printf(TEXT("Requires: %s"), PM ? *PM->Title : *P.ToString());
			return false;
		}
	}
	TArray<FString> Reqs;
	M->MinRep.ParseIntoArray(Reqs, TEXT(";"), true);
	for (const FString& R : Reqs)
	{
		if (!CheckRequirement(R)) { Why = FString::Printf(TEXT("Requires reputation: %s"), *R); return false; }
	}
	return true;
}

bool UCADMissionSubsystem::AvailableAt(FName GiverLocation, FName& OutMission) const
{
	UCADDataSubsystem* D = Data();
	if (!D) return false;
	for (const FName& Id : D->MissionOrder)
	{
		const FCADMissionDef& M = D->Missions[Id];
		FString Why;
		if (M.Giver == GiverLocation && CanStart(Id, Why)) { OutMission = Id; return true; }
	}
	return false;
}

bool UCADMissionSubsystem::InDialogue() const
{
	const FCADStageDef* S = Stage();
	return bActive && !bFailed && S && S->Type == ECADStageType::Dialogue;
}

bool UCADMissionSubsystem::GetDialogueLine(FString& Speaker, FString& Text) const
{
	const FCADStageDef* S = Stage();
	if (!S || !S->Lines.IsValidIndex(DialogueIdx)) return false;
	const FString& L = S->Lines[DialogueIdx];
	if (!L.Split(TEXT("::"), &Speaker, &Text)) { Speaker = TEXT(""); Text = L; }
	return true;
}

bool UCADMissionSubsystem::InChoice() const
{
	const FCADStageDef* S = Stage();
	return bActive && !bFailed && S && S->Type == ECADStageType::Choice;
}

bool UCADMissionSubsystem::ChoiceAvailable(int32 I, FString* Why) const
{
	const FCADStageDef* S = Stage();
	if (!S || I < 0 || I > 2 || S->ChoiceLabel[I].IsEmpty()) return false;
	if (!S->ChoiceReq[I].IsEmpty() && !CheckRequirement(S->ChoiceReq[I]))
	{
		if (Why) *Why = FString::Printf(TEXT("Requires %s"), *S->ChoiceReq[I]);
		return false;
	}
	return true;
}

FString UCADMissionSubsystem::ObjectiveText() const
{
	const FCADStageDef* S = Stage();
	if (!S || !bActive) return FString();
	FString T = S->Text;
	const bool bMv = S->Param.Contains(TEXT("mv"));
	switch (S->Type)
	{
	case ECADStageType::DriveTo:
		if (bMv && MissionVehicle && PlayerVehicle() != MissionVehicle) return FString::Printf(TEXT("Get back in the %s"), *MissionVehicle->DisplayName());
		if (!PlayerVehicle()) return TEXT("Get in a vehicle");
		break;
	case ECADStageType::Checkpoints:
	case ECADStageType::Race:
		if (!PlayerVehicle()) return TEXT("Get back in your vehicle");
		T += FString::Printf(TEXT("  (%d/%d)"), CpIdx, S->Locations.Num());
		break;
	case ECADStageType::Dialogue: return TEXT("Listen");
	default: break;
	}
	if (!CountdownText.IsEmpty()) T = CountdownText;
	return T;
}

FString UCADMissionSubsystem::OptionalText() const
{
	const FCADMissionDef* D = Def();
	if (!D || D->Optional.IsEmpty()) return FString();
	TArray<FString> Parts;
	D->Optional.ParseIntoArray(Parts, TEXT(";"), true);
	FString Out;
	for (const FString& P : Parts)
	{
		FString K, V;
		P.Split(TEXT(":"), &K, &V);
		const FString Label = K == TEXT("NoDamage") ? TEXT("Keep the vehicle in good shape") : (K == TEXT("NoWanted") ? TEXT("Stay off the police radar") : K);
		if (!Out.IsEmpty()) Out += TEXT("   ");
		Out += FString::Printf(TEXT("[Optional] %s (+$%s)"), *Label, *V);
	}
	return Out;
}

void UCADMissionSubsystem::GetTargets(TArray<FCADObjTarget>& Out) const
{
	Out.Reset();
	const FCADStageDef* S = Stage();
	if (!S || !bActive || bFailed) return;
	auto Add = [&](const FVector& P, const FString& Label, const FLinearColor& C, bool bPrimary = true)
	{
		FCADObjTarget T; T.Pos = P; T.Label = Label; T.Colour = C; T.bPrimary = bPrimary;
		Out.Add(T);
	};
	const FLinearColor Gold(1.f, 0.8f, 0.1f), Red(1.f, 0.25f, 0.2f), Green(0.2f, 1.f, 0.4f);
	UCADDataSubsystem* D = Data();
	switch (S->Type)
	{
	case ECADStageType::GoTo:
	case ECADStageType::DriveTo:
	case ECADStageType::Escape:
		if (S->Locations.Num() > 0) Add(Loc(S->Locations[0]), D ? D->LocationName(S->Locations[0]) : FString(), Gold);
		if (S->Type == ECADStageType::DriveTo && S->Param.Contains(TEXT("mv")) && MissionVehicle && PlayerVehicle() != MissionVehicle)
		{
			Out.Reset();
			Add(MissionVehicle->GetActorLocation(), MissionVehicle->DisplayName(), Green);
		}
		break;
	case ECADStageType::EnterVehicle:
		if (MissionVehicle) Add(MissionVehicle->GetActorLocation(), MissionVehicle->DisplayName(), Green);
		break;
	case ECADStageType::FindVehicle:
		for (const FName& L : S->Locations) Add(Loc(L), TEXT("Search here"), Gold, false);
		break;
	case ECADStageType::Checkpoints:
	case ECADStageType::Race:
		if (S->Locations.IsValidIndex(CpIdx)) Add(Loc(S->Locations[CpIdx]), FString::Printf(TEXT("%d/%d"), CpIdx + 1, S->Locations.Num()), Gold);
		if (S->Locations.IsValidIndex(CpIdx + 1)) Add(Loc(S->Locations[CpIdx + 1]), TEXT(""), Gold, false);
		if (S->Type == ECADStageType::Race && RaceRival) Add(RaceRival->GetActorLocation(), TEXT("Rival"), Red, false);
		break;
	case ECADStageType::Ram:
		if (TargetVehicle) Add(TargetVehicle->GetActorLocation(), TEXT("Target"), Red);
		break;
	default: break;
	}
}

// ------------------------------------------------------------------------------------------------
// Effects
// ------------------------------------------------------------------------------------------------
void UCADMissionSubsystem::ApplyEffects(const FString& Effects, FName CashKey, TArray<FString>* Summary)
{
	if (Effects.IsEmpty()) return;
	UCADGameInstance* G = GI();
	UCADEconomySubsystem* E = G ? G->GetSubsystem<UCADEconomySubsystem>() : nullptr;
	if (!G || !E) return;
	TArray<FString> Tokens;
	Effects.ParseIntoArray(Tokens, TEXT(";"), true);
	int32 Index = 0;
	for (FString Tok : Tokens)
	{
		Tok.TrimStartAndEndInline();
		++Index;
		auto Rep = [&](const TCHAR* Prefix, int32& Field, const TCHAR* Name) -> bool
		{
			if (!Tok.StartsWith(Prefix)) return false;
			const int32 V = FCString::Atoi(*Tok.Mid(FCString::Strlen(Prefix)));
			Field = CADMath::Clamp(Field + V, -100, 100);
			if (Summary) Summary->Add(FString::Printf(TEXT("%s reputation %+d"), Name, V));
			return true;
		};
		if (Tok.StartsWith(TEXT("cash")))
		{
			const int32 V = FCString::Atoi(*Tok.Mid(4));
			if (V > 0)
			{
				const bool bPaid = CashKey != NAME_None ? E->EarnOnce(FName(*FString::Printf(TEXT("%s_fx%d"), *CashKey.ToString(), Index)), V, TEXT("Mission reward")) : (E->Earn(V, TEXT("Reward")), true);
				if (bPaid && Summary) Summary->Add(FString::Printf(TEXT("Cash %s"), *(FString(TEXT("+")) + UCADEconomySubsystem::Money(V))));
			}
			else if (V < 0)
			{
				if (E->Spend(-V, TEXT("Mission expense")) && Summary) Summary->Add(FString::Printf(TEXT("Paid %s"), *UCADEconomySubsystem::Money(-V)));
			}
		}
		else if (Rep(TEXT("rep_public"), G->Profile.RepPublic, TEXT("Public"))) {}
		else if (Rep(TEXT("rep_business"), G->Profile.RepBusiness, TEXT("Business"))) {}
		else if (Rep(TEXT("rep_underworld"), G->Profile.RepUnderworld, TEXT("Underworld"))) {}
		else if (Tok.StartsWith(TEXT("heat+")))
		{
			if (UCADPoliceSubsystem* P = UCADPoliceSubsystem::Get(this))
			{
				P->SetWantedLevel(CADMath::Max(P->Level(), FCString::Atoi(*Tok.Mid(5))));
				if (Summary) Summary->Add(TEXT("Police attention increased"));
			}
		}
		else if (Tok.StartsWith(TEXT("wanted=")))
		{
			if (UCADPoliceSubsystem* P = UCADPoliceSubsystem::Get(this)) P->SetWantedLevel(FCString::Atoi(*Tok.Mid(7)));
		}
		else if (Tok.StartsWith(TEXT("flag:"))) G->Profile.AddFlag(FName(*Tok.Mid(5)));
		else if (Tok.StartsWith(TEXT("grant:")))
		{
			if (UCADFleetSubsystem* F = UCADFleetSubsystem::Get(this)) F->GrantVehicle(FName(*Tok.Mid(6)));
		}
		else if (Tok.StartsWith(TEXT("time=")))
		{
			if (UCADEnvironmentSubsystem* Env = UCADEnvironmentSubsystem::Get(this)) Env->SetTime(FCString::Atof(*Tok.Mid(5)));
		}
	}
}

// ------------------------------------------------------------------------------------------------
// Commands
// ------------------------------------------------------------------------------------------------
void UCADMissionSubsystem::ShowBriefing(FName Id)
{
	FString Why;
	BriefingId = Id;
	BriefingWhy = CanStart(Id, Why) ? FString() : Why;
	if (OnBriefing) OnBriefing();
}

void UCADMissionSubsystem::AcceptBriefing()
{
	if (BriefingId != NAME_None && BriefingWhy.IsEmpty()) Start(BriefingId);
	BriefingId = NAME_None;
}

void UCADMissionSubsystem::DeclineBriefing() { BriefingId = NAME_None; }

void UCADMissionSubsystem::Start(FName Id)
{
	FString Why;
	if (!CanStart(Id, Why)) { if (GI()) GI()->Toast(Why); return; }
	ClearAllActors();
	bActive = true; bFailed = false; bResultReady = false;
	ActiveId = Id;
	MissionTime = 0.f; MinHealth = 100.f; bEverWanted = false; BonusTime = 0.f;
	MissionVehicle = nullptr;
	CheckpointStage = 0;
	if (GI()) GI()->Toast(FString::Printf(TEXT("Mission started: %s"), *Def()->Title));
	EnterStage(0);
}

void UCADMissionSubsystem::StartCourier()
{
	UCADDataSubsystem* D = Data();
	if (!D || bActive) { if (GI()) GI()->Toast(TEXT("Finish your current job first.")); return; }
	TArray<FName> Gigs;
	for (const FName& Id : D->LocationOrder)
	{
		const FCADLocationRow& L = D->Locations[Id];
		if (L.Kind == TEXT("Waypoint") && L.Tags.Contains(TEXT("gig"))) Gigs.Add(Id);
	}
	if (Gigs.Num() < 2) return;
	const APawn* P = PlayerPawn();
	const FVector PL = P ? P->GetActorLocation() : FVector::ZeroVector;
	FName A, B;
	for (int32 Try = 0; Try < 40; ++Try)
	{
		A = Gigs[FMath::RandRange(0, Gigs.Num() - 1)];
		B = Gigs[FMath::RandRange(0, Gigs.Num() - 1)];
		if (A == B) continue;
		const float Leg1 = FVector::Dist2D(Loc(A), PL), Leg2 = FVector::Dist2D(Loc(A), Loc(B));
		if (Leg2 > 90000.f && Leg1 < 350000.f) break;
	}
	const float Dist = FVector::Dist2D(Loc(A), Loc(B));
	const int32 Limit = FMath::RoundToInt(45.f + Dist / 800.f);
	const int32 Reward = 140 + FMath::RoundToInt(Dist / 100.f * 0.2f);
	GigDef = FCADMissionDef();
	GigDef.Id = TEXT("gig");
	GigDef.Title = TEXT("Courier Run");
	GigDef.Brief = TEXT("Collect a parcel and deliver it before the clock runs out.");
	GigDef.bRepeatable = true;
	GigDef.Optional = TEXT("NoWanted:50");
	FCADStageDef S1; S1.Type = ECADStageType::DriveTo; S1.Locations = { A }; S1.Radius = 12.f; S1.Param = TEXT("stop");
	S1.Text = FString::Printf(TEXT("Pick up the parcel at %s"), *D->LocationName(A));
	FCADStageDef S2; S2.Type = ECADStageType::DriveTo; S2.Locations = { B }; S2.Radius = 12.f; S2.Param = TEXT("stop"); S2.TimeLimit = static_cast<float>(Limit);
	S2.Text = FString::Printf(TEXT("Deliver the parcel to %s"), *D->LocationName(B));
	FCADStageDef S3; S3.Type = ECADStageType::Complete; S3.Effect[0] = FString::Printf(TEXT("cash+%d"), Reward);
	GigDef.Stages = { S1, S2, S3 };
	++GigCounter;

	ClearAllActors();
	bActive = true; bFailed = false; bResultReady = false;
	ActiveId = TEXT("gig");
	MissionTime = 0.f; MinHealth = 100.f; bEverWanted = false; BonusTime = 0.f;
	MissionVehicle = nullptr;
	CheckpointStage = 0;
	if (GI()) GI()->Toast(FString::Printf(TEXT("Courier job: %s -> %s  (reward %s)"), *D->LocationName(A), *D->LocationName(B), *UCADEconomySubsystem::Money(Reward)));
	EnterStage(0);
}

void UCADMissionSubsystem::AdvanceDialogue()
{
	const FCADStageDef* S = Stage();
	if (!S || S->Type != ECADStageType::Dialogue) return;
	++DialogueIdx;
	if (DialogueIdx >= S->Lines.Num()) NextStage();
}

void UCADMissionSubsystem::ChooseOption(int32 I)
{
	const FCADStageDef* S = Stage();
	if (!S || S->Type != ECADStageType::Choice || !ChoiceAvailable(I)) return;
	const FString Effect = S->Effect[I];
	const int32 Jump = S->Jump[I];
	ApplyEffects(Effect, NAME_None, nullptr);
	if (Jump >= 0) JumpTo(Jump); else NextStage();
}

void UCADMissionSubsystem::NotifyMapOpened()
{
	const FCADStageDef* S = Stage();
	if (bActive && S && S->Type == ECADStageType::OpenMap) NextStage();
}

void UCADMissionSubsystem::NotifyBusted() { if (bActive && !bFailed) Fail(TEXT("Busted by the police.")); }
void UCADMissionSubsystem::NotifyPlayerDead() { if (bActive && !bFailed) Fail(TEXT("You didn't make it.")); }

void UCADMissionSubsystem::Fail(const FString& Reason)
{
	if (!bActive || bFailed) return;
	bFailed = true;
	FailReason = Reason;
	bInputLocked = false;
	CountdownText.Reset();
	RestoreDensity();
	if (const FCADMissionDef* D = Def())
	{
		if (D->Id == TEXT("m5_rival") && Reason.Contains(TEXT("race")) && GI()) GI()->Profile.AddFlag(TEXT("rival_won"));
	}
	Result = FCADMissionResult();
	Result.bSuccess = false;
	Result.Title = Def() ? Def()->Title : FString();
	Result.Lines = { Reason };
	if (OnResultReady) OnResultReady();
}

void UCADMissionSubsystem::Retry()
{
	if (!bActive || !bFailed) return;
	bFailed = false;
	bResultReady = false;
	if (UCADPoliceSubsystem* P = UCADPoliceSubsystem::Get(this)) P->ClearWanted(true);
	const FCADStageDef* S = Def() && Def()->Stages.IsValidIndex(CheckpointStage) ? &Def()->Stages[CheckpointStage] : nullptr;
	if (S) EnsureMissionVehicle(*S);
	EnterStage(CheckpointStage);
}

void UCADMissionSubsystem::Abandon()
{
	if (!bActive && !bFailed) return;
	RestoreDensity();
	ClearAllActors();
	bActive = false; bFailed = false; bResultReady = false;
	bInputLocked = false;
	CountdownText.Reset();
	ActiveId = NAME_None;
}

void UCADMissionSubsystem::DismissResult()
{
	bResultReady = false;
	if (bFailed) Abandon();
}

// ------------------------------------------------------------------------------------------------
// Stage flow
// ------------------------------------------------------------------------------------------------
void UCADMissionSubsystem::SetMarkers(const TArray<FCADObjTarget>& T)
{
	for (ACADMarker* M : StageMarkers) if (M) M->Destroy();
	StageMarkers.Reset();
	for (const FCADObjTarget& O : T)
	{
		FActorSpawnParameters SP;
		SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		if (ACADMarker* M = GetWorld()->SpawnActor<ACADMarker>(O.Pos, FRotator::ZeroRotator, SP))
		{
			M->Setup(O.Colour, O.bPrimary ? 900.f : 500.f, O.Label, O.bPrimary, 650.f);
			StageMarkers.Add(M);
		}
	}
}

void UCADMissionSubsystem::ClearStageActors(bool bKeepMissionVehicle)
{
	for (ACADMarker* M : StageMarkers) if (M) M->Destroy();
	StageMarkers.Reset();
	for (ACADVehicle* V : Rivals) if (V) V->Destroy();
	Rivals.Reset();
	if (RaceRival) { RaceRival->Destroy(); RaceRival = nullptr; }
	if (TargetVehicle && TargetVehicle != MissionVehicle) { TargetVehicle->Destroy(); }
	TargetVehicle = nullptr;
	(void)bKeepMissionVehicle;
}

void UCADMissionSubsystem::ClearAllActors()
{
	ClearStageActors(false);
	if (MissionVehicle)
	{
		if (PlayerVehicle() == MissionVehicle) { MissionVehicle->Role = ECADVehicleRole::Parked; MissionVehicle->MissionTag.Reset(); }
		else MissionVehicle->Destroy();
	}
	MissionVehicle = nullptr;
}

ACADVehicle* UCADMissionSubsystem::SpawnMissionVehicle(FName VehicleId, const FVector* At, ECADVehicleRole Role)
{
	UCADTrafficSubsystem* T = GetWorld()->GetSubsystem<UCADTrafficSubsystem>();
	UCADDataSubsystem* D = Data();
	APawn* P = PlayerPawn();
	if (!T || !D) return nullptr;
	FVector Pos; FRotator Rot;
	if (At)
	{
		Pos = *At + FVector(0, 0, 120.f);
		Rot = FRotator::ZeroRotator;
		int32 E; float Tt, Dist;
		if (D->Network.NearestEdge(*At, true, E, Tt, Dist) && Dist < 3000.f)
		{
			const FVector2D Dir = D->Network.Edges[E].Dir;
			Rot.Yaw = FMath::RadiansToDegrees(FMath::Atan2(Dir.Y, Dir.X));
		}
	}
	else
	{
		const FVector F = P ? P->GetActorForwardVector() : FVector::ForwardVector;
		const FVector R = P ? P->GetActorRightVector() : FVector::RightVector;
		Pos = (P ? P->GetActorLocation() : FVector::ZeroVector) + F * 300.f + R * 450.f + FVector(0, 0, 100.f);
		Rot = P ? FRotator(0.f, P->GetActorRotation().Yaw, 0.f) : FRotator::ZeroRotator;
	}
	ACADVehicle* V = T->SpawnAt(VehicleId, Pos, Rot, Role);
	if (V) V->MissionTag = ActiveId.ToString();
	return V;
}

void UCADMissionSubsystem::EnsureMissionVehicle(const FCADStageDef& S)
{
	if (!S.Param.Contains(TEXT("mv"))) return;
	if (MissionVehicle && !MissionVehicle->bWrecked) return;
	if (MissionVehicle) MissionVehicle->Destroy();
	FName Veh = MissionVehicle ? MissionVehicle->VehicleId : FName(TEXT("kestrel"));
	if (const FCADMissionDef* D = Def())
		for (const FCADStageDef& St : D->Stages) if (St.Type == ECADStageType::EnterVehicle && !St.VehicleId.IsNone()) { Veh = St.VehicleId; break; }
	MissionVehicle = SpawnMissionVehicle(Veh, nullptr, ECADVehicleRole::Mission);
}

void UCADMissionSubsystem::RestoreDensity()
{
	if (bDensityBoosted)
	{
		if (UCADTrafficSubsystem* T = GetWorld()->GetSubsystem<UCADTrafficSubsystem>()) T->DensityBoost = DensityBackup;
		bDensityBoosted = false;
	}
}

void UCADMissionSubsystem::NextStage() { EnterStage(StageIdx + 1); }
void UCADMissionSubsystem::JumpTo(int32 Idx) { EnterStage(Idx); }

void UCADMissionSubsystem::EnterStage(int32 Idx)
{
	const FCADMissionDef* D = Def();
	if (!D) return;
	if (!D->Stages.IsValidIndex(Idx))
	{
		UE_LOG(LogCAD, Warning, TEXT("Mission %s ran off the end of its stages"), *ActiveId.ToString());
		Abandon();
		return;
	}
	RestoreDensity();
	ClearStageActors(true);
	StageIdx = Idx;
	const FCADStageDef& S = D->Stages[Idx];
	StageTime = 0.f; CpIdx = 0; DialogueIdx = 0; bInputLocked = false; CountdownText.Reset(); RaceCountdown = 0.f;
	TimeLeft = S.TimeLimit > 0.f ? S.TimeLimit : -1.f;
	if (S.bCheckpoint) CheckpointStage = Idx;
	ApplyEffects(S.OnEnter, NAME_None, nullptr);

	UCADTrafficSubsystem* Traffic = GetWorld()->GetSubsystem<UCADTrafficSubsystem>();
	UCADDataSubsystem* Dt = Data();
	APawn* P = PlayerPawn();

	switch (S.Type)
	{
	case ECADStageType::EnterVehicle:
	{
		if (MissionVehicle) MissionVehicle->Destroy();
		const FVector At = S.Locations.Num() ? Loc(S.Locations[0]) : FVector::ZeroVector;
		MissionVehicle = SpawnMissionVehicle(S.VehicleId, S.Locations.Num() ? &At : nullptr, ECADVehicleRole::Mission);
		break;
	}
	case ECADStageType::FindVehicle:
	{
		FindIdx = S.Locations.Num() ? FMath::RandRange(0, S.Locations.Num() - 1) : 0;
		if (S.Locations.IsValidIndex(FindIdx))
		{
			const FVector At = Loc(S.Locations[FindIdx]);
			TargetVehicle = SpawnMissionVehicle(S.VehicleId, &At, ECADVehicleRole::Parked);
			if (TargetVehicle) TargetVehicle->MissionTag = ActiveId.ToString();
		}
		break;
	}
	case ECADStageType::Checkpoints:
		if (S.Param.Contains(TEXT("traffic+")) && Traffic)
		{
			DensityBackup = Traffic->DensityBoost;
			Traffic->DensityBoost = 1.6f;
			bDensityBoosted = true;
		}
		break;
	case ECADStageType::Race:
	{
		RaceCountdown = 3.5f;
		bInputLocked = true;
		if (!PlayerVehicle()) { RaceCountdown = 0.f; bInputLocked = false; }
		const FString SpeedStr = ParamVal(S.Param, TEXT("speed"));
		const float Speed = SpeedStr.IsEmpty() ? 0.9f : FCString::Atof(*SpeedStr);
		ACADVehicle* PV = PlayerVehicle();
		if (Traffic && Dt && PV)
		{
			// rival starts on the road beside the player
			int32 E; float T, Dist;
			if (Dt->Network.NearestEdge(PV->GetActorLocation(), true, E, T, Dist))
			{
				const FCADRoadEdge& Ed = Dt->Network.Edges[E];
				const FVector2D Dir = PV->GetActorForwardVector().X * Ed.Dir.X + PV->GetActorForwardVector().Y * Ed.Dir.Y >= 0.f ? Ed.Dir : -Ed.Dir;
				const FVector2D R(-Dir.Y, Dir.X);
				const FVector Pos = PV->GetActorLocation() + FVector(R.X, R.Y, 0.f) * 420.f + FVector(Dir.X, Dir.Y, 0.f) * 200.f + FVector(0, 0, 60.f);
				RaceRival = Traffic->SpawnAt(S.VehicleId, Pos, FRotator(0.f, FMath::RadiansToDegrees(FMath::Atan2(Dir.Y, Dir.X)), 0.f), ECADVehicleRole::Rival);
				if (RaceRival)
				{
					UCADVehicleDriver* Drv = NewObject<UCADVehicleDriver>(RaceRival);
					Drv->RegisterComponent();
					Drv->SpeedFactor = Speed;
					Drv->bObeySignals = false;
					RaceRival->Driver = Drv;
					TArray<FVector> Way;
					for (const FName& L : S.Locations) Way.Add(Loc(L));
					Drv->PlanVia(Way);
					Drv->Mode = ECADDriverMode::Idle;   // released after the countdown
				}
			}
		}
		break;
	}
	case ECADStageType::Evade:
		if (UCADPoliceSubsystem* Pol = UCADPoliceSubsystem::Get(this)) Pol->SetWantedLevel(FCString::Atoi(*S.Param));
		break;
	case ECADStageType::Escape:
	{
		const FString N = ParamVal(S.Param, TEXT("n"));
		RivalsWanted = N.IsEmpty() ? 2 : FCString::Atoi(*N);
		RivalSpawnTries = 0;
		break;
	}
	case ECADStageType::Ram:
	{
		if (S.Locations.Num() >= 2)
		{
			const FVector At = Loc(S.Locations[0]);
			TargetVehicle = SpawnMissionVehicle(S.VehicleId, &At, ECADVehicleRole::Rival);
			if (TargetVehicle)
			{
				UCADVehicleDriver* Drv = NewObject<UCADVehicleDriver>(TargetVehicle);
				Drv->RegisterComponent();
				Drv->SpeedFactor = 0.72f;
				Drv->bObeySignals = false;
				TargetVehicle->Driver = Drv;
				Drv->PlanTo(Loc(S.Locations[1]));
			}
		}
		break;
	}
	case ECADStageType::Complete:
		Finish(S);
		return;
	default: break;
	}
	(void)P;

	TArray<FCADObjTarget> T;
	GetTargets(T);
	SetMarkers(T);
}

bool UCADMissionSubsystem::Reached(const FVector& Pos, float RadiusCm, bool bNeedVehicle, bool bNeedStop, bool bNeedMv) const
{
	const APawn* P = PlayerPawn();
	if (!P) return false;
	const FVector L = P->GetActorLocation();
	if (FVector::Dist2D(L, Pos) > RadiusCm || FMath::Abs(L.Z - Pos.Z) > 1500.f) return false;
	const ACADVehicle* V = PlayerVehicle();
	if (bNeedVehicle && !V) return false;
	if (bNeedMv && MissionVehicle && V != MissionVehicle) return false;
	if (bNeedStop && V && V->SpeedKph() > 6.f) return false;
	return true;
}

void UCADMissionSubsystem::Tick(float DeltaTime)
{
	if (!bEnabled || !bActive || bFailed) return;
	const float Dt = CADMath::Min(DeltaTime, 0.1f);
	MissionTime += Dt;
	StageTime += Dt;
	if (const ACADVehicle* V = PlayerVehicle()) MinHealth = CADMath::Min(MinHealth, V->Health);
	if (UCADPoliceSubsystem* P = UCADPoliceSubsystem::Get(this)) if (P->Level() > 0) bEverWanted = true;

	if (TimeLeft >= 0.f)
	{
		TimeLeft -= Dt;
		if (TimeLeft <= 0.f) { Fail(TEXT("Time ran out.")); return; }
	}
	const FCADStageDef* S = Stage();
	if (!S) return;
	if (S->Param.Contains(TEXT("mv")) && MissionVehicle && MissionVehicle->bWrecked) { Fail(TEXT("The vehicle was wrecked.")); return; }
	TickStage(Dt);

	// keep markers on moving targets
	if (StageMarkers.Num() > 0)
	{
		TArray<FCADObjTarget> T;
		GetTargets(T);
		if (T.Num() == StageMarkers.Num())
		{
			for (int32 i = 0; i < T.Num(); ++i) if (StageMarkers[i]) StageMarkers[i]->SetActorLocation(T[i].Pos);
		}
		else SetMarkers(T);
	}
}

void UCADMissionSubsystem::TickStage(float Dt)
{
	const FCADStageDef* S = Stage();
	UCADDataSubsystem* D = Data();
	if (!S || !D) return;
	switch (S->Type)
	{
	case ECADStageType::GoTo:
		if (S->Locations.Num() && Reached(Loc(S->Locations[0]), S->Radius * CADM, false, false, false)) NextStage();
		break;
	case ECADStageType::DriveTo:
		if (S->Locations.Num() && Reached(Loc(S->Locations[0]), S->Radius * CADM, true, S->Param.Contains(TEXT("stop")), S->Param.Contains(TEXT("mv"))))
		{
			BonusTime = TimeLeft > 0.f ? TimeLeft : BonusTime;
			NextStage();
		}
		break;
	case ECADStageType::EnterVehicle:
		if (MissionVehicle && PlayerVehicle() == MissionVehicle) NextStage();
		break;
	case ECADStageType::FindVehicle:
		if (TargetVehicle && PlayerVehicle() == TargetVehicle)
		{
			MissionVehicle = TargetVehicle;
			TargetVehicle->Role = ECADVehicleRole::Mission;
			TargetVehicle = nullptr;
			NextStage();
		}
		break;
	case ECADStageType::Checkpoints:
	case ECADStageType::Race:
	{
		if (S->Type == ECADStageType::Race && RaceCountdown > 0.f)
		{
			RaceCountdown -= Dt;
			CountdownText = RaceCountdown > 0.5f ? FString::Printf(TEXT("Get ready...  %d"), FMath::CeilToInt(RaceCountdown - 0.5f)) : TEXT("GO!");
			if (RaceCountdown <= 0.f)
			{
				bInputLocked = false;
				CountdownText.Reset();
				if (RaceRival && RaceRival->Driver) { RaceRival->Driver->Mode = ECADDriverMode::FollowRoute; }
			}
			break;
		}
		if (S->Type == ECADStageType::Race && RaceRival && RaceRival->Driver && RaceRival->Driver->bFinished)
		{
			Fail(TEXT("You lost the race."));
			return;
		}
		if (!S->Locations.IsValidIndex(CpIdx)) { NextStage(); break; }
		if (Reached(Loc(S->Locations[CpIdx]), S->Radius * CADM, true, false, false))
		{
			++CpIdx;
			if (CpIdx >= S->Locations.Num())
			{
				BonusTime = TimeLeft > 0.f ? TimeLeft : 0.f;
				NextStage();
			}
			else if (GI())
			{
				GI()->Toast(FString::Printf(TEXT("Checkpoint %d/%d"), CpIdx, S->Locations.Num()));
				TArray<FCADObjTarget> T; GetTargets(T); SetMarkers(T);
			}
		}
		break;
	}
	case ECADStageType::Evade:
		if (StageTime > 1.5f)
		{
			if (UCADPoliceSubsystem* P = UCADPoliceSubsystem::Get(this)) if (P->Level() == 0) NextStage();
		}
		break;
	case ECADStageType::Escape:
	{
		// spawn pursuers one at a time, a block or two away
		if (Rivals.Num() < RivalsWanted && RivalSpawnTries < 60 && FMath::Fmod(StageTime, 0.8f) < Dt)
		{
			++RivalSpawnTries;
			UCADTrafficSubsystem* T = GetWorld()->GetSubsystem<UCADTrafficSubsystem>();
			APawn* P = PlayerPawn();
			if (T && P)
			{
				T->Focus = P->GetActorLocation();
				int32 Edge; bool bFwd; float Tt;
				if (T->PickSpawnSpot(24000.f, 42000.f, Edge, bFwd, Tt))
				{
					FString VehStr = ParamVal(S->Param, TEXT("veh"));
					if (VehStr.IsEmpty()) VehStr = TEXT("stampede");
					if (ACADVehicle* V = T->SpawnOnLane(FName(*VehStr), Edge, bFwd, Tt, 0, ECADVehicleRole::Rival))
					{
						V->Driver->StartPursuit(P, 0.98f);
						V->Driver->bAvoidTarget = false;
						Rivals.Add(V);
					}
				}
			}
		}
		if (S->Locations.Num() && Reached(Loc(S->Locations[0]), S->Radius * CADM, true, false, false)) NextStage();
		break;
	}
	case ECADStageType::Ram:
		if (!TargetVehicle) { NextStage(); break; }
		if (TargetVehicle->bWrecked || TargetVehicle->Health <= 18.f) { NextStage(); break; }
		if (TargetVehicle->Driver && TargetVehicle->Driver->bFinished) Fail(TEXT("The truck reached its drop-off."));
		break;
	case ECADStageType::Complete:
		Finish(*S);
		break;
	default: break;
	}
}

void UCADMissionSubsystem::Finish(const FCADStageDef& S)
{
	const FCADMissionDef* D = Def();
	UCADGameInstance* G = GI();
	UCADEconomySubsystem* E = G ? G->GetSubsystem<UCADEconomySubsystem>() : nullptr;
	if (!D || !G || !E || !bActive) return;
	const bool bGig = ActiveId == TEXT("gig");
	const FName Key = bGig ? FName(*FString::Printf(TEXT("gig_%d"), GigCounter)) : ActiveId;
	const bool bFirst = !IsCompleted(ActiveId);

	Result = FCADMissionResult();
	Result.Title = D->Title;
	Result.bSuccess = true;
	const int32 CashBefore = G->Profile.Cash;

	if (bFirst || D->bRepeatable)
	{
		if (D->RewardCash > 0 && E->EarnOnce(FName(*FString::Printf(TEXT("%s_base"), *Key.ToString())), D->RewardCash, FString::Printf(TEXT("%s"), *D->Title)))
			Result.Lines.Add(FString::Printf(TEXT("Mission reward +%s"), *UCADEconomySubsystem::Money(D->RewardCash)));
		G->Profile.RepPublic = CADMath::Clamp(G->Profile.RepPublic + D->RewardPublic, -100, 100);
		G->Profile.RepBusiness = CADMath::Clamp(G->Profile.RepBusiness + D->RewardBusiness, -100, 100);
		G->Profile.RepUnderworld = CADMath::Clamp(G->Profile.RepUnderworld + D->RewardUnderworld, -100, 100);
		if (D->RewardPublic) Result.Lines.Add(FString::Printf(TEXT("Public reputation %+d"), D->RewardPublic));
		if (D->RewardBusiness) Result.Lines.Add(FString::Printf(TEXT("Business reputation %+d"), D->RewardBusiness));
		if (D->RewardUnderworld) Result.Lines.Add(FString::Printf(TEXT("Underworld reputation %+d"), D->RewardUnderworld));
		ApplyEffects(S.Effect[0], Key, &Result.Lines);

		if (D->TimeBonusPerSec > 0 && BonusTime > 0.f)
		{
			const int32 Bonus = FMath::RoundToInt(BonusTime * D->TimeBonusPerSec);
			if (E->EarnOnce(FName(*FString::Printf(TEXT("%s_time"), *Key.ToString())), Bonus, TEXT("Time bonus")))
				Result.Lines.Add(FString::Printf(TEXT("Time bonus (%ds left) +%s"), FMath::RoundToInt(BonusTime), *UCADEconomySubsystem::Money(Bonus)));
		}
		TArray<FString> Parts;
		D->Optional.ParseIntoArray(Parts, TEXT(";"), true);
		for (const FString& P : Parts)
		{
			FString K, V;
			if (!P.Split(TEXT(":"), &K, &V)) continue;
			const int32 Amount = FCString::Atoi(*V);
			bool bOk = false;
			if (K == TEXT("NoDamage")) bOk = MinHealth >= 75.f;
			else if (K == TEXT("NoWanted")) bOk = !bEverWanted;
			if (bOk && E->EarnOnce(FName(*FString::Printf(TEXT("%s_opt_%s"), *Key.ToString(), *K)), Amount, FString::Printf(TEXT("Optional: %s"), *K)))
				Result.Lines.Add(FString::Printf(TEXT("Optional objective %s +%s"), K == TEXT("NoDamage") ? TEXT("(clean driving)") : TEXT("(off the radar)"), *UCADEconomySubsystem::Money(Amount)));
		}

		if (!D->RewardVehicle.IsNone())
		{
			if (UCADFleetSubsystem* F = UCADFleetSubsystem::Get(this))
			{
				FGuid Id;
				if (F->GrantVehicle(D->RewardVehicle, &Id))
				{
					const FCADVehicleRow* Row = Data()->FindVehicle(D->RewardVehicle);
					Result.Lines.Add(FString::Printf(TEXT("You keep the %s"), Row ? *Row->DisplayName : *D->RewardVehicle.ToString()));
					if (MissionVehicle && MissionVehicle->VehicleId == D->RewardVehicle && !MissionVehicle->bWrecked)
					{
						MissionVehicle->OwnedId = Id;
						MissionVehicle->Role = ECADVehicleRole::Player;
						MissionVehicle->MissionTag.Reset();
						if (FCADOwnedVehicle* O = F->FindOwned(Id)) O->Health = MissionVehicle->Health;
						F->Active = MissionVehicle;
						G->Profile.ActiveVehicle = Id;
						MissionVehicle = nullptr;
					}
				}
			}
		}
		if (!bGig) G->Profile.CompletedMissions.AddUnique(ActiveId);
		else G->Profile.DeliveriesDone++;
	}
	Result.Cash = G->Profile.Cash - CashBefore;

	RestoreDensity();
	ClearAllActors();
	bActive = false;
	bFailed = false;
	bResultReady = true;
	bInputLocked = false;
	CountdownText.Reset();
	if (OnResultReady) OnResultReady();
}
