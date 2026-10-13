#include "CADDataSubsystem.h"
#include "CADTerrain.h"
#include "CalgaryAfterDark.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

template<typename RowT>
UDataTable* UCADDataSubsystem::LoadTable(const TCHAR* File)
{
	const FString Path = FPaths::Combine(FPaths::ProjectContentDir(), TEXT("Data"), File);
	FString Text;
	if (!FFileHelper::LoadFileToString(Text, *Path))
	{
		LoadErrors.Add(FString::Printf(TEXT("Missing data file: %s"), *Path));
		UE_LOG(LogCAD, Error, TEXT("Missing data file %s"), *Path);
		return nullptr;
	}
	UDataTable* T = NewObject<UDataTable>(this);
	T->RowStruct = RowT::StaticStruct();
	const TArray<FString> Problems = T->CreateTableFromCSVString(Text);
	for (const FString& P : Problems)
	{
		LoadErrors.Add(FString::Printf(TEXT("%s: %s"), File, *P));
		UE_LOG(LogCAD, Warning, TEXT("%s: %s"), File, *P);
	}
	return T;
}

static TArray<FName> SplitNames(const FString& S)
{
	TArray<FName> Out;
	TArray<FString> Parts;
	S.ParseIntoArray(Parts, TEXT(";"), true);
	for (FString& P : Parts)
	{
		P.TrimStartAndEndInline();
		if (!P.IsEmpty()) Out.Add(FName(*P));
	}
	return Out;
}

static ECADRoadKind ParseKind(const FString& S)
{
	if (S == TEXT("Highway")) return ECADRoadKind::Highway;
	if (S == TEXT("Expressway")) return ECADRoadKind::Expressway;
	if (S == TEXT("Arterial")) return ECADRoadKind::Arterial;
	if (S == TEXT("Collector")) return ECADRoadKind::Collector;
	if (S == TEXT("Ramp")) return ECADRoadKind::Ramp;
	if (S == TEXT("Industrial")) return ECADRoadKind::Industrial;
	if (S == TEXT("Service")) return ECADRoadKind::Service;
	if (S == TEXT("Path")) return ECADRoadKind::Path;
	return ECADRoadKind::Local;
}

static ECADStageType ParseStageType(const FString& S)
{
	static const TCHAR* Names[] = { TEXT("Dialogue"), TEXT("GoTo"), TEXT("DriveTo"), TEXT("EnterVehicle"), TEXT("FindVehicle"),
		TEXT("Checkpoints"), TEXT("Choice"), TEXT("Evade"), TEXT("Ram"), TEXT("Race"), TEXT("Escape"), TEXT("OpenMap"), TEXT("Complete") };
	for (int32 i = 0; i < UE_ARRAY_COUNT(Names); ++i)
	{
		if (S == Names[i]) return static_cast<ECADStageType>(i);
	}
	UE_LOG(LogCAD, Warning, TEXT("Unknown stage type '%s'"), *S);
	return ECADStageType::Dialogue;
}

FLinearColor UCADDataSubsystem::ParseColor(const FString& Hex)
{
	return FLinearColor::FromSRGBColor(FColor::FromHex(Hex));
}

void UCADDataSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	ParseAll();
}

void UCADDataSubsystem::ParseAll()
{
	UDataTable* TVeh = LoadTable<FCADVehicleRow>(TEXT("Vehicles.csv"));
	UDataTable* TUpg = LoadTable<FCADUpgradeRow>(TEXT("Upgrades.csv"));
	UDataTable* TItm = LoadTable<FCADItemRow>(TEXT("Items.csv"));
	UDataTable* TShp = LoadTable<FCADShopRow>(TEXT("Shops.csv"));
	UDataTable* TPrp = LoadTable<FCADPropertyRow>(TEXT("Properties.csv"));
	UDataTable* TLoc = LoadTable<FCADLocationRow>(TEXT("Locations.csv"));
	UDataTable* TMis = LoadTable<FCADMissionRow>(TEXT("Missions.csv"));
	UDataTable* TStg = LoadTable<FCADMissionStageRow>(TEXT("MissionStages.csv"));
	UDataTable* TNod = LoadTable<FCADRoadNodeRow>(TEXT("RoadNodes.csv"));
	UDataTable* TEdg = LoadTable<FCADRoadEdgeRow>(TEXT("RoadEdges.csv"));
	UDataTable* TRiv = LoadTable<FCADRiverRow>(TEXT("River.csv"));

	if (TVeh) for (const auto& P : TVeh->GetRowMap()) { Vehicles.Add(P.Key, *reinterpret_cast<const FCADVehicleRow*>(P.Value)); VehicleOrder.Add(P.Key); }
	VehicleOrder.Sort([this](const FName& A, const FName& B) { return Vehicles[A].Price < Vehicles[B].Price; });
	if (TUpg) for (const auto& P : TUpg->GetRowMap()) Upgrades.Add(P.Key, *reinterpret_cast<const FCADUpgradeRow*>(P.Value));
	if (TItm) for (const auto& P : TItm->GetRowMap()) { Items.Add(P.Key, *reinterpret_cast<const FCADItemRow*>(P.Value)); ItemOrder.Add(P.Key); }
	if (TShp) for (const auto& P : TShp->GetRowMap()) Shops.Add(P.Key, *reinterpret_cast<const FCADShopRow*>(P.Value));
	if (TPrp) for (const auto& P : TPrp->GetRowMap()) { Properties.Add(P.Key, *reinterpret_cast<const FCADPropertyRow*>(P.Value)); PropertyOrder.Add(P.Key); }
	if (TLoc) for (const auto& P : TLoc->GetRowMap()) { Locations.Add(P.Key, *reinterpret_cast<const FCADLocationRow*>(P.Value)); LocationOrder.Add(P.Key); }

	// Missions: header rows + ordered stages
	if (TMis)
	{
		for (const auto& P : TMis->GetRowMap())
		{
			const FCADMissionRow& R = *reinterpret_cast<const FCADMissionRow*>(P.Value);
			FCADMissionDef D;
			D.Id = P.Key;
			D.Title = R.Title; D.Brief = R.Brief; D.Category = R.Category;
			D.Giver = FName(*R.Giver);
			D.Prereq = SplitNames(R.Prereq);
			D.MinRep = R.MinRep;
			D.bNight = R.Night;
			D.RewardCash = R.RewardCash; D.RewardPublic = R.RewardPublic;
			D.RewardBusiness = R.RewardBusiness; D.RewardUnderworld = R.RewardUnderworld;
			D.RewardVehicle = FName(*R.RewardVehicle);
			D.TimeBonusPerSec = R.TimeBonusPerSec;
			D.Optional = R.Optional;
			D.bRepeatable = R.Repeatable;
			Missions.Add(P.Key, D);
		}
	}
	if (TStg)
	{
		TArray<const FCADMissionStageRow*> Rows;
		for (const auto& P : TStg->GetRowMap()) Rows.Add(reinterpret_cast<const FCADMissionStageRow*>(P.Value));
		Rows.Sort([](const FCADMissionStageRow* A, const FCADMissionStageRow* B)
		{
			return A->MissionId == B->MissionId ? A->Index < B->Index : A->MissionId < B->MissionId;
		});
		for (const FCADMissionStageRow* R : Rows)
		{
			FCADMissionDef* M = Missions.Find(FName(*R->MissionId));
			if (!M) { LoadErrors.Add(FString::Printf(TEXT("Stage for unknown mission %s"), *R->MissionId)); continue; }
			FCADStageDef S;
			S.Type = ParseStageType(R->Type);
			S.Text = R->Text;
			S.Locations = SplitNames(R->Location);
			S.Radius = R->Radius;
			S.TimeLimit = R->TimeLimit;
			R->Dialogue.ParseIntoArray(S.Lines, TEXT("|"), true);
			S.Param = R->Param;
			S.VehicleId = FName(*R->VehicleId);
			const FString* Labels[3] = { &R->ChoiceA, &R->ChoiceB, &R->ChoiceC };
			const FString* Effects[3] = { &R->EffectA, &R->EffectB, &R->EffectC };
			const int32 Jumps[3] = { R->JumpA, R->JumpB, R->JumpC };
			for (int32 i = 0; i < 3; ++i)
			{
				FString L = *Labels[i], Req;
				L.Split(TEXT("|"), &L, &Req);
				S.ChoiceLabel[i] = L;
				S.ChoiceReq[i] = Req;
				S.Jump[i] = Jumps[i];
				S.Effect[i] = *Effects[i];
			}
			S.OnEnter = R->OnEnter;
			S.bCheckpoint = R->Checkpoint;
			M->Stages.Add(S);
		}
		for (const auto& P : Missions) MissionOrder.Add(P.Key);
		MissionOrder.Sort([](const FName& A, const FName& B) { return A.LexicalLess(B); });
	}

	BuildNetwork(TNod, TEdg, TRiv);
	bLoaded = Vehicles.Num() > 0 && Network.IsBuilt() && Locations.Num() > 0 && Missions.Num() > 0;
	UE_LOG(LogCAD, Log, TEXT("Data loaded: %d vehicles, %d upgrades, %d locations, %d missions, %d load problems"),
		Vehicles.Num(), Upgrades.Num(), Locations.Num(), Missions.Num(), LoadErrors.Num());
}

void UCADDataSubsystem::BuildNetwork(UDataTable* TNod, UDataTable* TEdg, UDataTable* TRiv)
{
	if (TRiv)
	{
		TArray<TPair<int32, FVector>> Pts;
		for (const auto& P : TRiv->GetRowMap())
		{
			const FCADRiverRow& R = *reinterpret_cast<const FCADRiverRow*>(P.Value);
			// row names are r0, r1, ... so numeric sort restores the polyline order
			Pts.Add(TPair<int32, FVector>(FCString::Atoi(*P.Key.ToString().Mid(1)), FVector(R.X * CADM, R.Y * CADM, R.HalfWidth * CADM)));
		}
		Pts.Sort([](const TPair<int32, FVector>& A, const TPair<int32, FVector>& B) { return A.Key < B.Key; });
		TArray<FVector> River;
		for (const auto& P : Pts) River.Add(P.Value);
		CADTerrain::SetRiver(River);
	}
	if (!TNod || !TEdg) return;

	TMap<FName, int32> Index;
	TArray<TPair<int32, FName>> Names;
	for (const auto& P : TNod->GetRowMap()) Names.Add(TPair<int32, FName>(FCString::Atoi(*P.Key.ToString().Mid(1)), P.Key));
	Names.Sort([](const TPair<int32, FName>& A, const TPair<int32, FName>& B) { return A.Key < B.Key; });
	for (const auto& N : Names)
	{
		const FCADRoadNodeRow& R = *reinterpret_cast<const FCADRoadNodeRow*>(TNod->GetRowMap()[N.Value]);
		FCADRoadNode Node;
		Node.Pos = FVector(R.X * CADM, R.Y * CADM, R.Z * CADM);
		Node.bSignal = R.Signal;
		Index.Add(N.Value, Network.Nodes.Add(Node));
	}
	for (const auto& P : TEdg->GetRowMap())
	{
		const FCADRoadEdgeRow& R = *reinterpret_cast<const FCADRoadEdgeRow*>(P.Value);
		const int32* A = Index.Find(FName(*R.A));
		const int32* B = Index.Find(FName(*R.B));
		if (!A || !B) { LoadErrors.Add(FString::Printf(TEXT("Edge %s references unknown node"), *P.Key.ToString())); continue; }
		FCADRoadEdge E;
		E.A = *A; E.B = *B;
		E.Kind = ParseKind(R.Kind);
		E.bOneWay = R.OneWay;
		E.bBridge = R.Bridge;
		E.Road = R.Road;
		Network.Edges.Add(E);
	}
	Network.Finalize();
}

FVector UCADDataSubsystem::LocationPos(FName Id) const
{
	if (const FCADLocationRow* L = Locations.Find(Id))
	{
		const float X = L->X * CADM, Y = L->Y * CADM;
		float Z = CADTerrain::Height(X, Y);
		// If the location sits on a road (e.g. overpass), prefer the road's surface height.
		int32 E; float T, D;
		if (Network.IsBuilt() && Network.NearestEdge(FVector(X, Y, Z), false, E, T, D) && D < 3000.f)
		{
			Z = CADMath::Max(Z, Network.PointOnEdge(E, T).Z);
		}
		return FVector(X, Y, Z);
	}
	return FVector::ZeroVector;
}

const FCADUpgradeRow* UCADDataSubsystem::FindUpgrade(const FString& Category, int32 Level) const
{
	return Upgrades.Find(FName(*FString::Printf(TEXT("%s_%d"), *Category.ToLower(), Level)));
}

float UCADDataSubsystem::UpgradeBonus(const FString& Category, int32 Level) const
{
	const FCADUpgradeRow* U = (Level > 0) ? FindUpgrade(Category, Level) : nullptr;
	return U ? U->Bonus : 0.f;
}

FString UCADDataSubsystem::LocationName(FName Id) const
{
	const FCADLocationRow* L = Locations.Find(Id);
	return L ? L->DisplayName : Id.ToString();
}
