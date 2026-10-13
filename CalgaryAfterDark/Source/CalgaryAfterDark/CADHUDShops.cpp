// Garage, shop and property screens for ACADHUD.
#include "CADHUD.h"
#include "CADDataSubsystem.h"
#include "CADEconomySubsystem.h"
#include "CADFleetSubsystem.h"
#include "CADGameInstance.h"
#include "CADGameMode.h"
#include "CADPlayerCharacter.h"
#include "CADPlayerController.h"
#include "CADVehicle.h"
#include "CalgaryAfterDark.h"
#include "Engine/Canvas.h"
#include "Engine/World.h"

namespace
{
	const FLinearColor Amber(1.f, 0.69f, 0.13f);
	const FLinearColor Teal(0.2f, 0.82f, 0.76f);
	const FLinearColor TextCol(0.93f, 0.95f, 0.98f);
	const FLinearColor Dim(0.6f, 0.66f, 0.74f);
	const FLinearColor Red(0.95f, 0.25f, 0.2f);
	const FLinearColor Green(0.3f, 0.9f, 0.45f);

	struct FStats { float Accel, Top, Brake, Handling; };
	FStats StatsFor(const FCADVehicleRow& R, UCADDataSubsystem* D, int32 E, int32 B, int32 Hn, int32 Wh)
	{
		const float Eb = D->UpgradeBonus(TEXT("Engine"), E), Bb = D->UpgradeBonus(TEXT("Brakes"), B);
		const float Hb = D->UpgradeBonus(TEXT("Handling"), Hn), Wb = D->UpgradeBonus(TEXT("Wheels"), Wh);
		FStats S;
		S.Accel = CADMath::Clamp(R.AccelMps2 * (1.f + Eb) / 11.f, 0.f, 1.f);
		S.Top = CADMath::Clamp(R.TopSpeedKph * (1.f + Eb * 0.5f) / 290.f, 0.f, 1.f);
		S.Brake = CADMath::Clamp(R.BrakeMps2 * (1.f + Bb) / 18.f, 0.f, 1.f);
		S.Handling = CADMath::Clamp(R.Grip * (1.f + Hb + Wb) * (R.MaxSteerDeg * (1.f + Hb * 0.25f)) / 60.f, 0.f, 1.f);
		return S;
	}
}

// ------------------------------------------------------------------------------------------------
// Garage: vehicles / repair & sell / paint / upgrades
// ------------------------------------------------------------------------------------------------
void ACADHUD::DrawGarage()
{
	DrawBackdrop(0.8f);
	DrawScreenTitle(TEXT("BOW VALLEY AUTO WORKS"), TEXT("Store, repair, paint and upgrade your vehicles"));
	if (!Data || !Eco || !Fleet) return;
	FCADProfile& P = GI->Profile;
	ACADVehicle* Driven = Cast<ACADVehicle>(PC->GetPawn());
	if (!SelVehicle.IsValid() || !Fleet->FindOwned(SelVehicle))
	{
		SelVehicle = (Driven && Driven->OwnedId.IsValid()) ? Driven->OwnedId : (P.Vehicles.Num() ? P.Vehicles[0].Id : FGuid());
	}
	Txt(Money(Eco->Cash()), W - 70.f * S, 56.f * S, 2.0f, Green, 2);

	// tabs
	static const TCHAR* Tabs[4] = { TEXT("Vehicles"), TEXT("Repair / Sell"), TEXT("Paint"), TEXT("Upgrades") };
	float TX = 70.f * S;
	for (int32 i = 0; i < 4; ++i)
	{
		int32 Idx = i;
		Button(Tabs[i], TX, 150.f * S, 190.f * S, 44.f * S, [this, Idx]() { Tab = Idx; }, true, Tab == i ? Teal : Amber);
		TX += 200.f * S;
	}
	// vehicle list
	float Y = 220.f * S;
	Txt(FString::Printf(TEXT("YOUR VEHICLES  %d / %d"), P.Vehicles.Num(), Fleet->Capacity()), 70.f * S, Y, 0.9f, Teal); Y += 30.f * S;
	if (P.Vehicles.Num() == 0) Txt(TEXT("You don't own a vehicle yet."), 70.f * S, Y, 0.9f, Dim);
	for (const FCADOwnedVehicle& V : P.Vehicles)
	{
		const FCADVehicleRow* R = Data->FindVehicle(V.VehicleId);
		const bool bSel = V.Id == SelVehicle;
		FGuid Id = V.Id;
		const bool bActive = Fleet->Active.IsValid() && Fleet->Active->OwnedId == V.Id;
		Button(FString::Printf(TEXT("%s%s"), R ? *R->DisplayName : TEXT("?"), bActive ? TEXT("  [out]") : TEXT("  [stored]")), 70.f * S, Y, 330.f * S, 44.f * S,
			[this, Id]() { Fleet->RefreshLive(SelVehicle); SelVehicle = Id; }, true, bSel ? Teal : Amber);
		Y += 50.f * S;
	}

	FCADOwnedVehicle* O = Fleet->FindOwned(SelVehicle);
	const float DX = 460.f * S, DW = W - DX - 70.f * S;
	if (!O) { if (Message.Len() && Now - MessageTime < 4.0) Txt(Message, DX, 240.f * S, 1.1f, Amber); Button(TEXT("Leave garage"), 70.f * S, H - 100.f * S, 260.f * S, 50.f * S, [this]() { GM->SetState(ECADGameState::Playing); }); return; }
	const FCADVehicleRow* Row = Data->FindVehicle(O->VehicleId);
	if (!Row) return;
	if (Fleet->Active.IsValid() && Fleet->Active->OwnedId == O->Id) O->Health = Fleet->Active->Health;
	Panel(DX, 220.f * S, DW, H - 340.f * S, Teal);
	Txt(Row->DisplayName.ToUpper(), DX + 28.f * S, 236.f * S, 2.0f, Amber);
	Txt(FString::Printf(TEXT("%s   |   Condition %d%%"), *Row->Category, FMath::RoundToInt(O->Health)), DX + 28.f * S, 286.f * S, 1.0f, Dim);
	const FStats St = StatsFor(*Row, Data, O->Engine, O->Brakes, O->Handling, O->Wheels);
	const float BX = DX + 28.f * S, BW = 320.f * S;
	float BY = 330.f * S;
	auto StatRow = [&](const TCHAR* Name, float V) { Txt(Name, BX, BY, 0.9f, TextCol); Bar(BX + 130.f * S, BY + 5.f * S, BW, 14.f * S, V, Teal); BY += 30.f * S; };
	StatRow(TEXT("Acceleration"), St.Accel); StatRow(TEXT("Top speed"), St.Top); StatRow(TEXT("Braking"), St.Brake); StatRow(TEXT("Handling"), St.Handling);

	const float AX = DX + 28.f * S + BW + 220.f * S;
	float AY = 330.f * S;
	switch (Tab)
	{
	case 0:
	{
		FGuid Id = O->Id;
		const bool bActive = Fleet->Active.IsValid() && Fleet->Active->OwnedId == Id;
		Txt(bActive ? TEXT("This vehicle is out on the street.") : TEXT("This vehicle is in storage."), AX, AY, 0.95f, Dim); AY += 40.f * S;
		if (!bActive || !Driven)
		{
			Button(TEXT("Take it out"), AX, AY, 280.f * S, 46.f * S, [this, Id]()
			{
				FVector Pos; FRotator Rot;
				GM->GarageSpawnTransform(Pos, Rot);
				FString Msg;
				if (Fleet->Retrieve(Id, Pos, Rot, Msg)) { GI->Toast(TEXT("Your vehicle is waiting outside.")); GM->SetState(ECADGameState::Playing); }
				else Say(Msg);
			}, !(Driven && Driven->OwnedId == Id));
			AY += 56.f * S;
		}
		if (Driven && Driven->OwnedId == Id)
		{
			Button(TEXT("Store this vehicle"), AX, AY, 280.f * S, 46.f * S, [this]()
			{
				PC->ExitVehicle();
				if (!Cast<ACADVehicle>(PC->GetPawn())) { Fleet->StoreActive(); GI->Toast(TEXT("Vehicle stored.")); GM->SetState(ECADGameState::Playing); }
				else Say(TEXT("Slow down before parking it."));
			});
			AY += 56.f * S;
		}
		break;
	}
	case 1:
	{
		FGuid Id = O->Id;
		const int32 Cost = Fleet->RepairCost(Id);
		const bool bDrivingThis = Driven && Driven->OwnedId == Id;
		Txt(Cost > 0 ? FString::Printf(TEXT("Repairs: %s"), *Money(Cost)) : FString(TEXT("No damage.")), AX, AY, 1.0f, TextCol); AY += 40.f * S;
		Button(TEXT("Repair"), AX, AY, 280.f * S, 46.f * S, [this, Id]() { FString M; Fleet->Repair(Id, M); Say(M); }, Cost > 0 && Eco->CanAfford(Cost)); AY += 70.f * S;
		const int32 Sale = FMath::RoundToInt(Row->Price * 0.5f * (0.5f + 0.5f * O->Health / 100.f));
		Txt(FString::Printf(TEXT("Sell for %s"), *Money(Sale)), AX, AY, 1.0f, TextCol); AY += 40.f * S;
		Button(TEXT("Sell vehicle"), AX, AY, 280.f * S, 46.f * S, [this, Id, bDrivingThis]()
		{
			if (bDrivingThis) { Say(TEXT("Step out of the vehicle first.")); return; }
			FString M; Fleet->SellVehicle(Id, M); Say(M); SelVehicle.Invalidate();
		}, Row->Price > 0, Red);
		break;
	}
	case 2:
	{
		static const FLinearColor Palette[12] = { FLinearColor(0.7f, 0.7f, 0.72f), FLinearColor(0.02f, 0.02f, 0.03f), FLinearColor(0.85f, 0.85f, 0.85f), FLinearColor(0.7f, 0.05f, 0.05f),
			FLinearColor(0.05f, 0.15f, 0.45f), FLinearColor(0.05f, 0.35f, 0.15f), FLinearColor(0.9f, 0.55f, 0.05f), FLinearColor(0.85f, 0.75f, 0.1f),
			FLinearColor(0.3f, 0.08f, 0.4f), FLinearColor(0.02f, 0.4f, 0.45f), FLinearColor(0.35f, 0.2f, 0.1f), FLinearColor(0.9f, 0.3f, 0.45f) };
		Txt(FString::Printf(TEXT("Respray: %s"), *Money(UCADFleetSubsystem::PaintCost)), AX, AY, 1.0f, TextCol); AY += 36.f * S;
		FGuid Id = O->Id;
		for (int32 i = 0; i < 12; ++i)
		{
			const float SX = AX + (i % 6) * 62.f * S, SY = AY + (i / 6) * 62.f * S;
			FLinearColor Col = Palette[i];
			const bool bFocus = Button(TEXT(""), SX, SY, 54.f * S, 54.f * S, [this, Id, Col]()
			{
				FString M; Fleet->Paint(Id, Col, M); Say(M);
			}, true, Amber);
			Rect(SX + 6.f * S, SY + 6.f * S, 42.f * S, 42.f * S, FLinearColor(FMath::Pow(Col.R, 0.45f), FMath::Pow(Col.G, 0.45f), FMath::Pow(Col.B, 0.45f), 1.f));
			if (bFocus && Fleet->Active.IsValid() && Fleet->Active->OwnedId == Id) Fleet->Active->SetPaint(Col);   // live preview while focused
		}
		AY += 140.f * S;
		Txt(TEXT("Hover or select a colour to preview it on the vehicle, click to buy."), AX, AY, 0.8f, Dim);
		break;
	}
	default:
	{
		FGuid Id = O->Id;
		static const TCHAR* Cats[4] = { TEXT("Engine"), TEXT("Brakes"), TEXT("Handling"), TEXT("Wheels") };
		const int32 Lv[4] = { O->Engine, O->Brakes, O->Handling, O->Wheels };
		for (int32 i = 0; i < 4; ++i)
		{
			FString Cat = Cats[i], NextName;
			const int32 Cost = Fleet->UpgradeCost(Id, Cat, &NextName);
			Txt(FString::Printf(TEXT("%s  %d/3"), *Cat, Lv[i]), AX, AY + 8.f * S, 1.0f, TextCol);
			Txt(Cost >= 0 ? NextName : FString(TEXT("Maxed")), AX + 220.f * S, AY + 8.f * S, 0.9f, Cost >= 0 ? Dim : Green);
			if (Cost >= 0) Button(Money(Cost), AX + 520.f * S, AY, 170.f * S, 40.f * S, [this, Id, Cat]() { FString M; Fleet->Upgrade(Id, Cat, M); Say(M); }, Eco->CanAfford(Cost));
			AY += 56.f * S;
		}
		break;
	}
	}
	if (Message.Len() && Now - MessageTime < 4.0) Txt(Message, W * 0.5f, H - 130.f * S, 1.1f, Amber, 1);
	Button(TEXT("Leave garage"), 70.f * S, H - 100.f * S, 260.f * S, 50.f * S, [this]()
	{
		if (Fleet) Fleet->RefreshLive(SelVehicle);   // drop any unpurchased paint preview
		GM->SetState(ECADGameState::Playing);
	});
}

// ------------------------------------------------------------------------------------------------
// Shops: convenience stores and the dealership
// ------------------------------------------------------------------------------------------------
void ACADHUD::DrawShop()
{
	DrawBackdrop(0.8f);
	const FCADShopRow* Shop = Data ? Data->Shops.Find(GM->ShopId) : nullptr;
	if (!Shop) { GM->SetState(ECADGameState::Playing); return; }
	DrawScreenTitle(Shop->DisplayName.ToUpper(), Shop->Type == TEXT("Dealership") ? TEXT("New and used vehicles. All prices in Canadian dollars.") : TEXT("Snacks and supplies."));
	Txt(Money(Eco->Cash()), W - 70.f * S, 56.f * S, 2.0f, Green, 2);
	TArray<FString> Stock;
	Shop->Stock.ParseIntoArray(Stock, TEXT(";"), true);
	float Y = 170.f * S;
	if (Shop->Type == TEXT("Dealership"))
	{
		const int32 RowsPerPage = CADMath::Max(3, FMath::FloorToInt((H - 330.f * S) / (58.f * S)));
		ListScroll = CADMath::Clamp(ListScroll, 0, CADMath::Max(0, Stock.Num() - RowsPerPage));
		for (int32 i = ListScroll; i < Stock.Num() && i < ListScroll + RowsPerPage; ++i)
		{
			const FName Id(*Stock[i]);
			const FCADVehicleRow* R = Data->FindVehicle(Id);
			if (!R) continue;
			const bool bOk = Eco->CanAfford(R->Price) && Fleet->NumOwned() < Fleet->Capacity();
			const bool bFocus = Button(FString::Printf(TEXT("%s    %s"), *R->DisplayName, *Money(R->Price)), 70.f * S, Y, 520.f * S, 50.f * S, [this, Id]()
			{
				FString M; FGuid NewId;
				if (Fleet->BuyVehicle(Id, M, &NewId))
				{
					// deliver it to the forecourt unless the player is currently driving something
					if (!Cast<ACADVehicle>(PC->GetPawn()))
					{
						const FCADShopRow* S2 = Data->Shops.Find(GM->ShopId);
						const FVector Base = S2 ? Data->LocationPos(FName(*S2->Location)) : FVector::ZeroVector;
						Fleet->StoreActive();
						Fleet->SpawnOwned(NewId, Base + FVector(0, 0, 150.f) + (PC->GetPawn() ? PC->GetPawn()->GetActorForwardVector() * 700.f : FVector::ZeroVector), PC->GetPawn() ? PC->GetPawn()->GetActorRotation() : FRotator::ZeroRotator);
						GI->Toast(TEXT("Your new vehicle has been delivered outside."));
						GM->SetState(ECADGameState::Playing);
					}
					else Say(M + TEXT(" It is waiting in your garage."));
				}
				else Say(M);
			}, bOk);
			if (bFocus)
			{
				const float DX = 640.f * S;
				Panel(DX, 170.f * S, W - DX - 70.f * S, 420.f * S, Teal);
				Txt(R->DisplayName.ToUpper(), DX + 28.f * S, 186.f * S, 1.8f, Amber);
				Txt(FString::Printf(TEXT("%s   |   %.0f kg   |   %.0f km/h top speed"), *R->Category, R->MassKg, R->TopSpeedKph), DX + 28.f * S, 232.f * S, 0.95f, Dim);
				const FStats St = StatsFor(*R, Data, 0, 0, 0, 0);
				float BY = 280.f * S;
				auto SR = [&](const TCHAR* N, float V) { Txt(N, DX + 28.f * S, BY, 0.9f, TextCol); Bar(DX + 170.f * S, BY + 5.f * S, 320.f * S, 14.f * S, V, Teal); BY += 32.f * S; };
				SR(TEXT("Acceleration"), St.Accel); SR(TEXT("Top speed"), St.Top); SR(TEXT("Braking"), St.Brake); SR(TEXT("Handling"), St.Handling);
				Txt(FString::Printf(TEXT("Off-road %.0f%%   Durability %.1f"), R->OffRoad * 100.f, R->CollisionResistance), DX + 28.f * S, BY + 8.f * S, 0.9f, Dim);
				if (Fleet->NumOwned() >= Fleet->Capacity()) Txt(TEXT("Garage full. Sell a vehicle or buy a property with storage."), DX + 28.f * S, BY + 44.f * S, 0.85f, Red);
				else if (!Eco->CanAfford(R->Price)) Txt(FString::Printf(TEXT("You need %s more."), *Money(R->Price - Eco->Cash())), DX + 28.f * S, BY + 44.f * S, 0.85f, Red);
			}
			Y += 58.f * S;
		}
		if (Stock.Num() > RowsPerPage) Txt(TEXT("Scroll the mouse wheel for more vehicles"), 70.f * S, Y + 6.f * S, 0.8f, Dim);
	}
	else
	{
		for (const FString& ItemStr : Stock)
		{
			const FName Id(*ItemStr);
			const FCADItemRow* It = Data->Items.Find(Id);
			if (!It) continue;
			Button(FString::Printf(TEXT("%s    %s"), *It->DisplayName, *Money(It->Price)), 70.f * S, Y, 520.f * S, 50.f * S, [this, Id]()
			{
				const FCADItemRow* Row = Data->Items.Find(Id);
				if (!Row) return;
				if (Eco->Spend(Row->Price, FString::Printf(TEXT("Bought %s"), *Row->DisplayName))) { GI->Profile.Inventory.FindOrAdd(Id)++; Say(FString::Printf(TEXT("Bought %s. Use it from the inventory (Tab)."), *Row->DisplayName)); }
				else Say(TEXT("Not enough cash."));
			}, Eco->CanAfford(It->Price));
			Txt(It->Description, 620.f * S, Y + 14.f * S, 0.9f, Dim);
			Y += 58.f * S;
		}
	}
	if (Message.Len() && Now - MessageTime < 4.0) Txt(Message, W * 0.5f, H - 130.f * S, 1.1f, Amber, 1);
	Button(TEXT("Leave"), 70.f * S, H - 100.f * S, 260.f * S, 50.f * S, [this]() { GM->SetState(ECADGameState::Playing); });
}

// ------------------------------------------------------------------------------------------------
// Property management
// ------------------------------------------------------------------------------------------------
void ACADHUD::DrawProperty()
{
	DrawBackdrop(0.8f);
	const FCADPropertyRow* Pr = Data ? Data->Properties.Find(GM->PropertyId) : nullptr;
	if (!Pr) { GM->SetState(ECADGameState::Playing); return; }
	const bool bOwned = GI->Profile.OwnedProperties.Contains(GM->PropertyId);
	DrawScreenTitle(Pr->DisplayName.ToUpper(), bOwned ? TEXT("You own this property") : TEXT("Available to purchase"));
	Txt(Money(Eco->Cash()), W - 70.f * S, 56.f * S, 2.0f, Green, 2);
	const float X = 70.f * S;
	float Y = 190.f * S;
	Panel(X, Y, 760.f * S, 340.f * S, Teal);
	Txt(Pr->Description, X + 28.f * S, Y + 20.f * S, 1.0f, TextCol);
	Txt(FString::Printf(TEXT("Price                 %s"), *Money(Pr->Price)), X + 28.f * S, Y + 80.f * S, 1.1f, TextCol);
	Txt(FString::Printf(TEXT("Income              %s per in-game day (paid to your bank at 6:00)"), *Money(Pr->IncomePerDay)), X + 28.f * S, Y + 116.f * S, 1.0f, TextCol);
	Txt(FString::Printf(TEXT("Vehicle storage   +%d slots"), Pr->VehicleSlots), X + 28.f * S, Y + 152.f * S, 1.0f, TextCol);
	Txt(Pr->SavePoint ? TEXT("Save point         Yes (save and sleep until morning)") : TEXT("Save point         No"), X + 28.f * S, Y + 188.f * S, 1.0f, TextCol);
	Y += 360.f * S;
	if (!bOwned)
	{
		FName Id = GM->PropertyId;
		Button(FString::Printf(TEXT("Buy for %s"), *Money(Pr->Price)), X, Y, 360.f * S, 54.f * S, [this, Id]()
		{
			const FCADPropertyRow* R = Data->Properties.Find(Id);
			if (R && Eco->Spend(R->Price, FString::Printf(TEXT("Bought %s"), *R->DisplayName))) { GI->Profile.OwnedProperties.AddUnique(Id); GI->Toast(TEXT("Property purchased.")); }
			else Say(R ? FString::Printf(TEXT("You need %s."), *Money(R->Price)) : FString(TEXT("Unavailable.")));
		}, Eco->CanAfford(Pr->Price));
	}
	else
	{
		Button(TEXT("Save game"), X, Y, 360.f * S, 54.f * S, [this]() { GM->SaveGameNow(true); });
		Button(TEXT("Sleep until morning (and save)"), X + 380.f * S, Y, 380.f * S, 54.f * S, [this]() { GM->SleepUntilMorning(); GM->SetState(ECADGameState::Playing); }, Pr->SavePoint);
	}
	if (Message.Len() && Now - MessageTime < 4.0) Txt(Message, W * 0.5f, H - 130.f * S, 1.1f, Amber, 1);
	Button(TEXT("Leave"), 70.f * S, H - 100.f * S, 260.f * S, 50.f * S, [this]() { GM->SetState(ECADGameState::Playing); });
}
