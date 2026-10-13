#include "CADFleetSubsystem.h"
#include "CADDataSubsystem.h"
#include "CADEconomySubsystem.h"
#include "CADGameInstance.h"
#include "CADTrafficSubsystem.h"
#include "CADVehicle.h"
#include "CalgaryAfterDark.h"
#include "Engine/World.h"

UCADFleetSubsystem* UCADFleetSubsystem::Get(const UObject* Ctx)
{
	const UWorld* W = Ctx ? Ctx->GetWorld() : nullptr;
	return W ? W->GetSubsystem<UCADFleetSubsystem>() : nullptr;
}

bool UCADFleetSubsystem::ShouldCreateSubsystem(UObject* Outer) const
{
	const UWorld* W = Cast<UWorld>(Outer);
	return W && W->IsGameWorld();
}

#define CAD_GI() UCADGameInstance* GI = UCADGameInstance::Get(this); if (!GI) return
#define CAD_DATA() UCADDataSubsystem* Data = GI->GetSubsystem<UCADDataSubsystem>(); UCADEconomySubsystem* Eco = GI->GetSubsystem<UCADEconomySubsystem>()

FCADOwnedVehicle* UCADFleetSubsystem::FindOwned(const FGuid& Id)
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	if (!GI) return nullptr;
	for (FCADOwnedVehicle& V : GI->Profile.Vehicles) if (V.Id == Id) return &V;
	return nullptr;
}

int32 UCADFleetSubsystem::NumOwned() const
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	return GI ? GI->Profile.Vehicles.Num() : 0;
}

int32 UCADFleetSubsystem::Capacity() const
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* D = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	int32 Cap = 2;
	if (GI && D)
	{
		for (const FName& P : GI->Profile.OwnedProperties)
			if (const FCADPropertyRow* R = D->Properties.Find(P)) Cap += R->VehicleSlots;
	}
	return Cap;
}

bool UCADFleetSubsystem::GrantVehicle(FName VehicleId, FGuid* OutId)
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* D = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	const FCADVehicleRow* Row = D ? D->FindVehicle(VehicleId) : nullptr;
	if (!Row) return false;
	FCADOwnedVehicle V;
	V.Id = FGuid::NewGuid();
	V.VehicleId = VehicleId;
	V.Paint = UCADDataSubsystem::ParseColor(Row->Color);
	GI->Profile.Vehicles.Add(V);
	if (OutId) *OutId = V.Id;
	return true;
}

bool UCADFleetSubsystem::BuyVehicle(FName VehicleId, FString& Msg, FGuid* OutId)
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* D = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	UCADEconomySubsystem* E = GI ? GI->GetSubsystem<UCADEconomySubsystem>() : nullptr;
	const FCADVehicleRow* Row = D ? D->FindVehicle(VehicleId) : nullptr;
	if (!Row || !E) { Msg = TEXT("Unknown vehicle."); return false; }
	if (!Row->Dealer) { Msg = TEXT("Not for sale."); return false; }
	if (NumOwned() >= Capacity()) { Msg = FString::Printf(TEXT("Garage full (%d/%d). Sell a vehicle or buy a property with storage."), NumOwned(), Capacity()); return false; }
	if (!E->Spend(Row->Price, FString::Printf(TEXT("Bought %s"), *Row->DisplayName)))
	{
		Msg = FString::Printf(TEXT("You need %s."), *UCADEconomySubsystem::Money(Row->Price));
		return false;
	}
	GrantVehicle(VehicleId, OutId);
	Msg = FString::Printf(TEXT("Purchased %s."), *Row->DisplayName);
	return true;
}

bool UCADFleetSubsystem::SellVehicle(const FGuid& Id, FString& Msg)
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* D = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	UCADEconomySubsystem* E = GI ? GI->GetSubsystem<UCADEconomySubsystem>() : nullptr;
	FCADOwnedVehicle* O = FindOwned(Id);
	if (!O || !D || !E) { Msg = TEXT("Vehicle not found."); return false; }
	const FCADVehicleRow* Row = D->FindVehicle(O->VehicleId);
	const int32 Price = Row ? FMath::RoundToInt(Row->Price * 0.5f * (0.5f + 0.5f * O->Health / 100.f)) : 0;
	if (Active.IsValid() && Active->OwnedId == Id) { Active->Destroy(); Active.Reset(); }
	if (GI->Profile.ActiveVehicle == Id) GI->Profile.ActiveVehicle = FGuid();
	GI->Profile.Vehicles.RemoveAll([&](const FCADOwnedVehicle& V) { return V.Id == Id; });
	E->Earn(Price, TEXT("Vehicle sale"));
	Msg = FString::Printf(TEXT("Sold for %s."), *UCADEconomySubsystem::Money(Price));
	return true;
}

ACADVehicle* UCADFleetSubsystem::SpawnOwned(const FGuid& Id, const FVector& Loc, const FRotator& Rot)
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADTrafficSubsystem* T = GetWorld()->GetSubsystem<UCADTrafficSubsystem>();
	FCADOwnedVehicle* O = FindOwned(Id);
	if (!GI || !T || !O) return nullptr;
	ACADVehicle* V = T->SpawnAt(O->VehicleId, Loc, Rot, ECADVehicleRole::Player, O);
	if (V)
	{
		Active = V;
		GI->Profile.ActiveVehicle = Id;
	}
	return V;
}

void UCADFleetSubsystem::SyncActive()
{
	if (Active.IsValid())
	{
		if (FCADOwnedVehicle* O = FindOwned(Active->OwnedId)) O->Health = CADMath::Max(1.f, Active->Health);
		if (UCADGameInstance* GI = UCADGameInstance::Get(this))
		{
			GI->Profile.ActiveVehicleLocation = Active->GetActorLocation();
			GI->Profile.ActiveVehicleRotation = Active->GetActorRotation();
		}
	}
}

void UCADFleetSubsystem::StoreActive()
{
	SyncActive();
	if (Active.IsValid()) Active->Destroy();
	Active.Reset();
}

bool UCADFleetSubsystem::Retrieve(const FGuid& Id, const FVector& Loc, const FRotator& Rot, FString& Msg)
{
	FCADOwnedVehicle* O = FindOwned(Id);
	if (!O) { Msg = TEXT("Vehicle not found."); return false; }
	if (Active.IsValid() && Active->OwnedId == Id) { Msg = TEXT("That vehicle is already out."); return false; }
	if (Active.IsValid() && Active->bPlayerDriven) { Msg = TEXT("Exit your current vehicle first."); return false; }
	StoreActive();
	if (!SpawnOwned(Id, Loc, Rot)) { Msg = TEXT("Could not spawn vehicle."); return false; }
	Msg = TEXT("Vehicle retrieved.");
	return true;
}

int32 UCADFleetSubsystem::RepairCost(const FGuid& Id)
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* D = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	FCADOwnedVehicle* O = FindOwned(Id);
	if (!O || !D) return 0;
	if (Active.IsValid() && Active->OwnedId == Id) O->Health = Active->Health;
	const FCADVehicleRow* Row = D->FindVehicle(O->VehicleId);
	return FMath::CeilToInt((100.f - O->Health) * (Row ? Row->RepairPerPoint : 40));
}

bool UCADFleetSubsystem::Repair(const FGuid& Id, FString& Msg)
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADEconomySubsystem* E = GI ? GI->GetSubsystem<UCADEconomySubsystem>() : nullptr;
	FCADOwnedVehicle* O = FindOwned(Id);
	if (!O || !E) { Msg = TEXT("Vehicle not found."); return false; }
	const int32 Cost = RepairCost(Id);
	if (Cost <= 0) { Msg = TEXT("No damage to repair."); return false; }
	if (!E->Spend(Cost, TEXT("Vehicle repair"))) { Msg = FString::Printf(TEXT("Repairs cost %s."), *UCADEconomySubsystem::Money(Cost)); return false; }
	O->Health = 100.f;
	if (Active.IsValid() && Active->OwnedId == Id) Active->Repair();
	Msg = FString::Printf(TEXT("Repaired for %s."), *UCADEconomySubsystem::Money(Cost));
	return true;
}

bool UCADFleetSubsystem::Paint(const FGuid& Id, const FLinearColor& Colour, FString& Msg)
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADEconomySubsystem* E = GI ? GI->GetSubsystem<UCADEconomySubsystem>() : nullptr;
	FCADOwnedVehicle* O = FindOwned(Id);
	if (!O || !E) { Msg = TEXT("Vehicle not found."); return false; }
	if (!E->Spend(PaintCost, TEXT("Paint job"))) { Msg = FString::Printf(TEXT("A paint job costs %s."), *UCADEconomySubsystem::Money(PaintCost)); return false; }
	O->Paint = Colour;
	if (Active.IsValid() && Active->OwnedId == Id) Active->SetPaint(Colour);
	Msg = TEXT("Fresh paint.");
	return true;
}

int32 UCADFleetSubsystem::UpgradeCost(const FGuid& Id, const FString& Category, FString* OutName)
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADDataSubsystem* D = GI ? GI->GetSubsystem<UCADDataSubsystem>() : nullptr;
	FCADOwnedVehicle* O = FindOwned(Id);
	if (!O || !D) return -1;
	int32 Cur = 0;
	if (Category == TEXT("Engine")) Cur = O->Engine; else if (Category == TEXT("Brakes")) Cur = O->Brakes;
	else if (Category == TEXT("Handling")) Cur = O->Handling; else Cur = O->Wheels;
	const FCADUpgradeRow* Next = D->FindUpgrade(Category, Cur + 1);
	if (!Next) return -1;   // maxed
	if (OutName) *OutName = Next->DisplayName;
	return Next->Price;
}

bool UCADFleetSubsystem::Upgrade(const FGuid& Id, const FString& Category, FString& Msg)
{
	UCADGameInstance* GI = UCADGameInstance::Get(this);
	UCADEconomySubsystem* E = GI ? GI->GetSubsystem<UCADEconomySubsystem>() : nullptr;
	FCADOwnedVehicle* O = FindOwned(Id);
	FString Name;
	const int32 Cost = UpgradeCost(Id, Category, &Name);
	if (!O || !E) { Msg = TEXT("Vehicle not found."); return false; }
	if (Cost < 0) { Msg = TEXT("Already fully upgraded."); return false; }
	if (!E->Spend(Cost, FString::Printf(TEXT("%s: %s"), *Category, *Name))) { Msg = FString::Printf(TEXT("%s costs %s."), *Name, *UCADEconomySubsystem::Money(Cost)); return false; }
	if (Category == TEXT("Engine")) ++O->Engine; else if (Category == TEXT("Brakes")) ++O->Brakes;
	else if (Category == TEXT("Handling")) ++O->Handling; else ++O->Wheels;
	RefreshLive(Id);
	Msg = FString::Printf(TEXT("Installed %s."), *Name);
	return true;
}

void UCADFleetSubsystem::RefreshLive(const FGuid& Id)
{
	FCADOwnedVehicle* O = FindOwned(Id);
	if (!O || !Active.IsValid() || Active->OwnedId != Id) return;
	Active->EngineLvl = O->Engine; Active->BrakeLvl = O->Brakes; Active->HandlingLvl = O->Handling; Active->WheelLvl = O->Wheels;
	Active->ApplyUpgrades();
	Active->SetPaint(O->Paint);
}
