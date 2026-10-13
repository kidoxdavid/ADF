// Menu screens of ACADHUD: main menu, pause, settings (with key rebinding), mission briefing/choices/results, inventory.
#include "CADHUD.h"
#include "CADDataSubsystem.h"
#include "CADEconomySubsystem.h"
#include "CADEnvironmentSubsystem.h"
#include "CADFleetSubsystem.h"
#include "CADGameInstance.h"
#include "CADGameMode.h"
#include "CADMissionSubsystem.h"
#include "CADPlayerCharacter.h"
#include "CADPlayerController.h"
#include "CADPoliceSubsystem.h"
#include "CADVehicle.h"
#include "CalgaryAfterDark.h"
#include "Engine/Canvas.h"
#include "Engine/World.h"

namespace
{
	const FLinearColor Amber(1.f, 0.69f, 0.13f);
	const FLinearColor Teal(0.2f, 0.82f, 0.76f);
	const FLinearColor Ink(0.03f, 0.05f, 0.09f);
	const FLinearColor TextCol(0.93f, 0.95f, 0.98f);
	const FLinearColor Dim(0.6f, 0.66f, 0.74f);
	const FLinearColor Red(0.95f, 0.25f, 0.2f);
	const FLinearColor Green(0.3f, 0.9f, 0.45f);
}

void ACADHUD::DrawBackdrop(float Alpha) { Rect(0, 0, W, H, FLinearColor(0.01f, 0.02f, 0.04f, Alpha)); }

void ACADHUD::DrawScreenTitle(const FString& Title, const FString& Sub)
{
	Txt(Title, 70.f * S, 50.f * S, 2.6f, Amber);
	Rect(70.f * S, 112.f * S, 120.f * S, 4.f * S, Amber);
	if (!Sub.IsEmpty()) Txt(Sub, 70.f * S, 124.f * S, 1.0f, Dim);
}

// ------------------------------------------------------------------------------------------------
// Main menu
// ------------------------------------------------------------------------------------------------
void ACADHUD::DrawMainMenu()
{
	// left gradient panel over the fly-over camera
	for (int32 i = 0; i < 24; ++i)
	{
		const float A = 0.82f * (1.f - i / 24.f);
		Rect(i * 22.f * S, 0, 22.f * S, H, FLinearColor(0.01f, 0.02f, 0.05f, A));
	}
	Txt(TEXT("CALGARY"), 90.f * S, 130.f * S, 5.2f, TextCol);
	Txt(TEXT("AFTER DARK"), 90.f * S, 130.f * S + 92.f * S, 5.2f, Amber);
	Rect(94.f * S, 130.f * S + 190.f * S, 180.f * S, 5.f * S, Amber);
	Txt(TEXT("The city is yours. Every decision has a price."), 94.f * S, 130.f * S + 206.f * S, 1.15f, Dim);

	const float X = 94.f * S, Wd = 380.f * S, Ht = 54.f * S;
	float Y = H * 0.55f;
	if (!GM->StartupError.IsEmpty())
	{
		Panel(X, Y - 10.f * S, W * 0.5f, 150.f * S, Red);
		TArray<FString> Lines;
		GM->StartupError.ParseIntoArray(Lines, TEXT("\n"), true);
		float Cy = Y;
		for (int32 i = 0; i < CADMath::Min(5, Lines.Num()); ++i) { Txt(Lines[i], X + 20.f * S, Cy, 0.8f, TextCol); Cy += 24.f * S; }
		return;
	}
	const bool bSave = GI->HasSave();
	Button(TEXT("Continue"), X, Y, Wd, Ht, [this]() { GM->ContinueGame(); }, bSave); Y += Ht + 12.f * S;
	Button(TEXT("New Game"), X, Y, Wd, Ht, [this]() { GM->StartNewGame(); }); Y += Ht + 12.f * S;
	Button(TEXT("Settings"), X, Y, Wd, Ht, [this]() { GM->SetState(ECADGameState::Settings); }); Y += Ht + 12.f * S;
	if (bConfirmQuit) { Button(TEXT("Really quit?  Click to confirm"), X, Y, Wd, Ht, [this]() { GM->QuitGame(); }, true, Red); }
	else Button(TEXT("Quit"), X, Y, Wd, Ht, [this]() { bConfirmQuit = true; });
	if (!GI->LastError.IsEmpty() && !bSave) Txt(GI->LastError, X, Y + Ht + 20.f * S, 0.8f, Dim);
	Txt(TEXT("A fictionalized Calgary, Alberta. All characters and businesses are fictional."), 94.f * S, H - 50.f * S, 0.75f, Dim);
}

// ------------------------------------------------------------------------------------------------
// Pause
// ------------------------------------------------------------------------------------------------
void ACADHUD::DrawPause()
{
	DrawBackdrop(0.55f);
	const float Wd = 440.f * S, X = (W - Wd) * 0.5f, Ht = 52.f * S;
	float Y = H * 0.24f;
	Txt(TEXT("PAUSED"), W * 0.5f, Y - 80.f * S, 3.f, Amber, 1);
	Button(TEXT("Resume"), X, Y, Wd, Ht, [this]() { GM->SetState(ECADGameState::Playing); }); Y += Ht + 10.f * S;
	Button(TEXT("Save Game"), X, Y, Wd, Ht, [this]() { GM->SaveGameNow(true); }); Y += Ht + 10.f * S;
	Button(TEXT("Map"), X, Y, Wd, Ht, [this]() { GM->SetState(ECADGameState::Map); }); Y += Ht + 10.f * S;
	Button(TEXT("Inventory"), X, Y, Wd, Ht, [this]() { GM->SetState(ECADGameState::Inventory); }); Y += Ht + 10.f * S;
	if (Mis && Mis->bActive)
	{
		Button(TEXT("Abandon current mission"), X, Y, Wd, Ht, [this]() { Mis->Abandon(); GM->SetState(ECADGameState::Playing); }, true, Red); Y += Ht + 10.f * S;
	}
	Button(TEXT("Settings"), X, Y, Wd, Ht, [this]() { GM->SetState(ECADGameState::Settings); }); Y += Ht + 10.f * S;
	if (bConfirmMenu) Button(TEXT("Unsaved progress is lost. Confirm"), X, Y, Wd, Ht, [this]() { GM->ReturnToMainMenu(); }, true, Red);
	else Button(TEXT("Main Menu"), X, Y, Wd, Ht, [this]() { bConfirmMenu = true; });
	Y += Ht + 10.f * S;
	if (bConfirmQuit) Button(TEXT("Quit to desktop. Confirm"), X, Y, Wd, Ht, [this]() { GM->QuitGame(); }, true, Red);
	else Button(TEXT("Quit Game"), X, Y, Wd, Ht, [this]() { bConfirmQuit = true; });
}

// ------------------------------------------------------------------------------------------------
// Settings + key bindings
// ------------------------------------------------------------------------------------------------
void ACADHUD::SettingRow(float X, float& Y, float Wd, const FString& Label, const FString& Value, TFunction<void()> Minus, TFunction<void()> Plus)
{
	const float Ht = 44.f * S;
	Rect(X, Y, Wd, Ht, FLinearColor(0.07f, 0.1f, 0.15f, 0.9f));
	Txt(Label, X + 16.f * S, Y + 10.f * S, 1.0f, TextCol);
	Txt(Value, X + Wd - 150.f * S, Y + 10.f * S, 1.0f, Amber, 1);
	Button(TEXT("<"), X + Wd - 100.f * S, Y + 4.f * S, 40.f * S, Ht - 8.f * S, MoveTemp(Minus));
	Button(TEXT(">"), X + Wd - 50.f * S, Y + 4.f * S, 40.f * S, Ht - 8.f * S, MoveTemp(Plus));
	Y += Ht + 6.f * S;
}

void ACADHUD::DrawSettings()
{
	DrawBackdrop(GM->bInSession ? 0.8f : 0.88f);
	DrawScreenTitle(TEXT("SETTINGS"), TEXT("Changes are saved automatically"));
	FCADSettings& St = GI->Settings;
	auto Save = [this]() { GI->SaveSettings(); };
	const float X = 70.f * S, Wd = 700.f * S;
	float Y = 170.f * S;
	SettingRow(X, Y, Wd, TEXT("Mouse sensitivity"), FString::Printf(TEXT("%.1f"), St.MouseSensitivity),
		[&St, Save]() { St.MouseSensitivity = CADMath::Clamp(St.MouseSensitivity - 0.1f, 0.1f, 5.f); Save(); }, [&St, Save]() { St.MouseSensitivity = CADMath::Clamp(St.MouseSensitivity + 0.1f, 0.1f, 5.f); Save(); });
	SettingRow(X, Y, Wd, TEXT("Invert Y axis"), St.bInvertY ? TEXT("On") : TEXT("Off"),
		[&St, Save]() { St.bInvertY = !St.bInvertY; Save(); }, [&St, Save]() { St.bInvertY = !St.bInvertY; Save(); });
	SettingRow(X, Y, Wd, TEXT("Field of view"), FString::Printf(TEXT("%d"), FMath::RoundToInt(St.FieldOfView)),
		[&St, Save]() { St.FieldOfView = CADMath::Clamp(St.FieldOfView - 5.f, 60.f, 120.f); Save(); }, [&St, Save]() { St.FieldOfView = CADMath::Clamp(St.FieldOfView + 5.f, 60.f, 120.f); Save(); });
	SettingRow(X, Y, Wd, TEXT("Master volume"), FString::Printf(TEXT("%d%%"), FMath::RoundToInt(St.MasterVolume * 100.f)),
		[&St, Save]() { St.MasterVolume = CADMath::Clamp(St.MasterVolume - 0.1f, 0.f, 1.f); Save(); }, [&St, Save]() { St.MasterVolume = CADMath::Clamp(St.MasterVolume + 0.1f, 0.f, 1.f); Save(); });
	static const TCHAR* Dens[4] = { TEXT("Off"), TEXT("Low"), TEXT("Normal"), TEXT("High") };
	SettingRow(X, Y, Wd, TEXT("Traffic density"), Dens[CADMath::Clamp(St.TrafficDensity, 0, 3)],
		[&St, Save]() { St.TrafficDensity = CADMath::Clamp(St.TrafficDensity - 1, 0, 3); Save(); }, [&St, Save]() { St.TrafficDensity = CADMath::Clamp(St.TrafficDensity + 1, 0, 3); Save(); });
	SettingRow(X, Y, Wd, TEXT("Pedestrian density"), Dens[CADMath::Clamp(St.PedestrianDensity, 0, 3)],
		[&St, Save]() { St.PedestrianDensity = CADMath::Clamp(St.PedestrianDensity - 1, 0, 3); Save(); }, [&St, Save]() { St.PedestrianDensity = CADMath::Clamp(St.PedestrianDensity + 1, 0, 3); Save(); });
	static const TCHAR* VD[4] = { TEXT(""), TEXT("Near"), TEXT("Medium"), TEXT("Far") };
	SettingRow(X, Y, Wd, TEXT("City streaming distance"), VD[CADMath::Clamp(St.ViewDistanceLevel, 1, 3)],
		[&St, Save]() { St.ViewDistanceLevel = CADMath::Clamp(St.ViewDistanceLevel - 1, 1, 3); Save(); }, [&St, Save]() { St.ViewDistanceLevel = CADMath::Clamp(St.ViewDistanceLevel + 1, 1, 3); Save(); });
	SettingRow(X, Y, Wd, TEXT("Minimap rotates with you"), St.bMinimapRotates ? TEXT("On") : TEXT("Off"),
		[&St, Save]() { St.bMinimapRotates = !St.bMinimapRotates; Save(); }, [&St, Save]() { St.bMinimapRotates = !St.bMinimapRotates; Save(); });

	if (GM->bInSession)
	{
		SettingRow(X, Y, Wd, TEXT("Outfit"), FString::Printf(TEXT("Style %d"), St.OutfitIndex + 1),
			[this, &St, Save]() { St.OutfitIndex = (St.OutfitIndex + ACADPlayerCharacter::NumOutfits - 1) % ACADPlayerCharacter::NumOutfits; Save(); if (GM->GetPlayerChar()) GM->GetPlayerChar()->ApplyOutfit(St.OutfitIndex); },
			[this, &St, Save]() { St.OutfitIndex = (St.OutfitIndex + 1) % ACADPlayerCharacter::NumOutfits; Save(); if (GM->GetPlayerChar()) GM->GetPlayerChar()->ApplyOutfit(St.OutfitIndex); });
	}

	// key bindings
	const float KX = X + Wd + 50.f * S, KW = W - KX - 70.f * S;
	float KY = 170.f * S;
	Txt(TEXT("KEYBOARD CONTROLS  (click to rebind)"), KX, KY - 30.f * S, 0.9f, Teal);
	for (const FCADBinding& B : ACADPlayerController::Bindings())
	{
		const bool bThis = PC->IsRebinding() && PC->RebindingId() == B.Id;
		const FString Key = bThis ? TEXT("Press a key...") : KeyName(B.Id);
		Rect(KX, KY, KW, 40.f * S, FLinearColor(0.07f, 0.1f, 0.15f, 0.9f));
		Txt(B.Name, KX + 14.f * S, KY + 9.f * S, 0.95f, TextCol);
		FName Id = B.Id;
		Button(Key, KX + KW - 190.f * S, KY + 4.f * S, 180.f * S, 32.f * S, [this, Id]() { PC->BeginRebind(Id); }, true, bThis ? Teal : Amber);
		KY += 44.f * S;
	}
	Txt(TEXT("Mouse look, wheel and gamepad controls are fixed. Gamepad: left stick move, right stick look,"), KX, KY + 6.f * S, 0.75f, Dim);
	Txt(TEXT("RT/LT throttle & brake, A jump, RB handbrake, Y interact, Back map, Start pause."), KX, KY + 26.f * S, 0.75f, Dim);
	KY += 54.f * S;
	Button(TEXT("Reset keyboard bindings"), KX, KY, 300.f * S, 40.f * S, [this]() { PC->ResetBindings(); });
	Button(TEXT("Back"), X, H - 100.f * S, 240.f * S, 50.f * S, [this]() { GM->SetState(GM->StateBeforeSettings == ECADGameState::MainMenu ? ECADGameState::MainMenu : ECADGameState::Paused); });
}

// ------------------------------------------------------------------------------------------------
// Briefing / choices / results
// ------------------------------------------------------------------------------------------------
void ACADHUD::DrawBriefing()
{
	DrawBackdrop(0.5f);
	if (!Mis) return;
	if (Mis->InChoice())
	{
		const FCADStageDef* St = Mis->Stage();
		if (!St) return;
		const float Wd = 700.f * S, X = (W - Wd) * 0.5f, Y = H * 0.28f;
		Panel(X, Y, Wd, 100.f * S + 3 * 62.f * S);
		Txt(TEXT("A DECISION"), X + Wd * 0.5f, Y + 14.f * S, 0.9f, Teal, 1);
		Txt(St->Text, X + Wd * 0.5f, Y + 42.f * S, 1.5f, Amber, 1);
		float Cy = Y + 96.f * S;
		for (int32 i = 0; i < 3; ++i)
		{
			if (St->ChoiceLabel[i].IsEmpty()) continue;
			FString Why;
			const bool bOk = Mis->ChoiceAvailable(i, &Why);
			Button(bOk ? St->ChoiceLabel[i] : FString::Printf(TEXT("%s   (locked: %s)"), *St->ChoiceLabel[i], *Why), X + 20.f * S, Cy, Wd - 40.f * S, 50.f * S,
				[this, i]() { Mis->ChooseOption(i); if (!Mis->InChoice() && Mis->BriefingId == NAME_None) GM->SetState(ECADGameState::Playing); }, bOk);
			Cy += 62.f * S;
		}
		return;
	}
	if (Mis->BriefingId == NAME_None) { GM->SetState(ECADGameState::Playing); return; }
	const FCADMissionDef* D = Data ? Data->Missions.Find(Mis->BriefingId) : nullptr;
	if (!D) { GM->SetState(ECADGameState::Playing); return; }
	const float Wd = 820.f * S, X = (W - Wd) * 0.5f, Y = H * 0.2f;
	Panel(X, Y, Wd, 520.f * S);
	Txt(D->Category == TEXT("Legit") ? TEXT("LEGITIMATE WORK") : (D->Category == TEXT("Crime") ? TEXT("UNDERGROUND") : TEXT("MIXED CAREER")), X + 28.f * S, Y + 18.f * S, 0.8f, Teal);
	Txt(D->Title.ToUpper(), X + 28.f * S, Y + 44.f * S, 2.2f, Amber);
	TArray<FString> Lines;
	const FString Brief = D->Brief + (D->bNight ? TEXT("  (This job takes place after dark.)") : TEXT(""));
	// simple word wrap
	TArray<FString> Words; Brief.ParseIntoArray(Words, TEXT(" "), true);
	FString Cur;
	for (const FString& Wd2 : Words)
	{
		const FString Try = Cur.IsEmpty() ? Wd2 : Cur + TEXT(" ") + Wd2;
		if (TxtSize(Try, 1.1f * S).X > Wd - 60.f * S && !Cur.IsEmpty()) { Lines.Add(Cur); Cur = Wd2; } else Cur = Try;
	}
	if (!Cur.IsEmpty()) Lines.Add(Cur);
	float Cy = Y + 112.f * S;
	for (const FString& L : Lines) { Txt(L, X + 28.f * S, Cy, 1.1f, TextCol); Cy += 30.f * S; }
	Cy += 16.f * S;
	if (D->RewardCash > 0) { Txt(FString::Printf(TEXT("Base reward: %s"), *Money(D->RewardCash)), X + 28.f * S, Cy, 1.0f, Green); Cy += 26.f * S; }
	else Txt(TEXT("Reward depends on how you play it."), X + 28.f * S, Cy, 1.0f, Green), Cy += 26.f * S;
	if (!D->Optional.IsEmpty()) { Txt(Mis->OptionalText().IsEmpty() ? FString() : FString(TEXT("Optional bonuses available")), X + 28.f * S, Cy, 0.9f, Dim); Cy += 24.f * S; }
	if (!Mis->BriefingWhy.IsEmpty()) Txt(Mis->BriefingWhy, X + 28.f * S, Cy + 10.f * S, 1.0f, Red);
	const bool bOk = Mis->BriefingWhy.IsEmpty();
	Button(TEXT("Accept job"), X + 28.f * S, Y + 520.f * S - 78.f * S, 280.f * S, 52.f * S, [this]() { Mis->AcceptBriefing(); GM->SetState(ECADGameState::Playing); }, bOk);
	Button(TEXT("Not now"), X + Wd - 308.f * S, Y + 520.f * S - 78.f * S, 280.f * S, 52.f * S, [this]() { Mis->DeclineBriefing(); GM->SetState(ECADGameState::Playing); });
}

void ACADHUD::DrawResults()
{
	DrawBackdrop(0.6f);
	if (!Mis) return;
	const bool bOk = Mis->Result.bSuccess;
	const float Wd = 760.f * S, X = (W - Wd) * 0.5f, Y = H * 0.18f;
	const float Ht = (210.f + CADMath::Max(1, Mis->Result.Lines.Num()) * 32.f) * S + 70.f * S;
	Panel(X, Y, Wd, Ht, bOk ? Green : Red);
	Txt(bOk ? TEXT("MISSION PASSED") : TEXT("MISSION FAILED"), X + Wd * 0.5f, Y + 24.f * S, 3.0f, bOk ? Green : Red, 1);
	Txt(Mis->Result.Title.ToUpper(), X + Wd * 0.5f, Y + 92.f * S, 1.4f, Amber, 1);
	float Cy = Y + 140.f * S;
	for (const FString& L : Mis->Result.Lines) { Txt(L, X + Wd * 0.5f, Cy, 1.15f, TextCol, 1); Cy += 32.f * S; }
	if (bOk && Mis->Result.Cash != 0) { Txt(FString::Printf(TEXT("Total earned %s"), *Money(Mis->Result.Cash)), X + Wd * 0.5f, Cy + 8.f * S, 1.3f, Green, 1); Cy += 44.f * S; }
	Cy += 14.f * S;
	if (bOk)
	{
		Button(TEXT("Continue"), X + Wd * 0.5f - 150.f * S, Cy, 300.f * S, 52.f * S, [this]() { Mis->DismissResult(); GM->SetState(ECADGameState::Playing); });
	}
	else
	{
		Button(TEXT("Retry from checkpoint"), X + 40.f * S, Cy, 330.f * S, 52.f * S, [this]() { Mis->Retry(); GM->SetState(ECADGameState::Playing); });
		Button(TEXT("Abandon mission"), X + Wd - 370.f * S, Cy, 330.f * S, 52.f * S, [this]() { Mis->DismissResult(); GM->SetState(ECADGameState::Playing); }, true, Red);
	}
}

// ------------------------------------------------------------------------------------------------
// Inventory
// ------------------------------------------------------------------------------------------------
void ACADHUD::DrawInventory()
{
	DrawBackdrop(0.82f);
	DrawScreenTitle(TEXT("INVENTORY & STATUS"), TEXT("Press Tab or Esc to return"));
	if (!Data || !Eco) return;
	const FCADProfile& P = GI->Profile;
	const float Col1 = 70.f * S, Col2 = W * 0.36f, Col3 = W * 0.66f;
	float Y = 170.f * S;

	// column 1: money + reputation
	Txt(TEXT("MONEY"), Col1, Y, 1.0f, Teal); Y += 30.f * S;
	Txt(FString::Printf(TEXT("Cash   %s"), *Money(P.Cash)), Col1, Y, 1.4f, Green); Y += 38.f * S;
	Txt(FString::Printf(TEXT("Bank   %s"), *Money(P.Bank)), Col1, Y, 1.4f, TextCol); Y += 46.f * S;
	Button(TEXT("Deposit $100"), Col1, Y, 180.f * S, 40.f * S, [this]() { if (!Eco->Deposit(100)) Say(TEXT("Not enough cash.")); });
	Button(TEXT("Withdraw $100"), Col1 + 190.f * S, Y, 180.f * S, 40.f * S, [this]() { if (!Eco->Withdraw(100)) Say(TEXT("Not enough in the bank.")); });
	Y += 50.f * S;
	Button(TEXT("Deposit all"), Col1, Y, 180.f * S, 40.f * S, [this]() { Eco->Deposit(GI->Profile.Cash); });
	Button(TEXT("Withdraw all"), Col1 + 190.f * S, Y, 180.f * S, 40.f * S, [this]() { Eco->Withdraw(GI->Profile.Bank); });
	Y += 70.f * S;
	Txt(TEXT("REPUTATION"), Col1, Y, 1.0f, Teal); Y += 32.f * S;
	auto RepBar = [&](const TCHAR* Name, int32 V, const FLinearColor& C)
	{
		Txt(Name, Col1, Y, 0.95f, TextCol);
		Bar(Col1 + 150.f * S, Y + 4.f * S, 220.f * S, 14.f * S, (V + 100.f) / 200.f, C);
		Txt(FString::Printf(TEXT("%d"), V), Col1 + 385.f * S, Y, 0.95f, C);
		Y += 32.f * S;
	};
	RepBar(TEXT("Public"), P.RepPublic, Green);
	RepBar(TEXT("Business"), P.RepBusiness, Amber);
	RepBar(TEXT("Underworld"), P.RepUnderworld, Red);
	const float Heat = Pol ? Pol->GetHeat() : 0.f;
	Txt(TEXT("Police attention"), Col1, Y, 0.95f, TextCol);
	Bar(Col1 + 150.f * S, Y + 4.f * S, 220.f * S, 14.f * S, Heat / 15.f, FLinearColor(0.4f, 0.55f, 1.f));
	Y += 50.f * S;
	Txt(FString::Printf(TEXT("Missions completed  %d / %d"), P.CompletedMissions.Num(), Data->Missions.Num()), Col1, Y, 0.95f, TextCol); Y += 28.f * S;
	Txt(FString::Printf(TEXT("Places discovered  %d"), P.Discovered.Num()), Col1, Y, 0.95f, TextCol); Y += 28.f * S;
	Txt(FString::Printf(TEXT("Courier jobs  %d"), P.DeliveriesDone), Col1, Y, 0.95f, TextCol);

	// column 2: items + vehicles + properties
	Y = 170.f * S;
	Txt(TEXT("ITEMS"), Col2, Y, 1.0f, Teal); Y += 32.f * S;
	bool bAny = false;
	for (const FName& Id : Data->ItemOrder)
	{
		const int32* Count = P.Inventory.Find(Id);
		if (!Count || *Count <= 0) continue;
		bAny = true;
		const FCADItemRow& It = Data->Items[Id];
		Txt(FString::Printf(TEXT("%s  x%d"), *It.DisplayName, *Count), Col2, Y + 8.f * S, 0.95f, TextCol);
		FName ItemId = Id;
		Button(TEXT("Use"), Col2 + 270.f * S, Y, 90.f * S, 36.f * S, [this, ItemId]()
		{
			ACADPlayerCharacter* C = GM->GetPlayerChar();
			int32* Cnt = GI->Profile.Inventory.Find(ItemId);
			const FCADItemRow* Row = Data->Items.Find(ItemId);
			if (!C || !Cnt || *Cnt <= 0 || !Row) return;
			FString K, V;
			if (Row->Effect.Split(TEXT("+"), &K, &V))
			{
				if (K == TEXT("health")) C->Health = CADMath::Min(100.f, C->Health + FCString::Atof(*V));
				else if (K == TEXT("stamina")) C->Stamina = 100.f;
			}
			--(*Cnt);
			Say(FString::Printf(TEXT("Used %s"), *Row->DisplayName));
		});
		Y += 42.f * S;
	}
	if (!bAny) { Txt(TEXT("Nothing yet. Convenience stores sell coffee and first aid."), Col2, Y, 0.85f, Dim); Y += 30.f * S; }
	Y += 24.f * S;
	Txt(TEXT("YOUR VEHICLES"), Col2, Y, 1.0f, Teal); Y += 32.f * S;
	if (P.Vehicles.Num() == 0) { Txt(TEXT("None. Visit Macleod Motor Mile or finish Welcome to Calgary."), Col2, Y, 0.85f, Dim); Y += 30.f * S; }
	for (const FCADOwnedVehicle& V : P.Vehicles)
	{
		const FCADVehicleRow* R = Data->FindVehicle(V.VehicleId);
		Txt(FString::Printf(TEXT("%s%s"), R ? *R->DisplayName : TEXT("?"), P.ActiveVehicle == V.Id ? TEXT("   (active)") : TEXT("")), Col2, Y, 0.95f, TextCol);
		Txt(FString::Printf(TEXT("E%d B%d H%d W%d   %d%%"), V.Engine, V.Brakes, V.Handling, V.Wheels, FMath::RoundToInt(V.Health)), Col2 + 300.f * S, Y, 0.85f, Dim);
		Y += 28.f * S;
	}
	Y += 20.f * S;
	Txt(TEXT("PROPERTIES"), Col2, Y, 1.0f, Teal); Y += 32.f * S;
	if (P.OwnedProperties.Num() == 0) Txt(TEXT("None owned."), Col2, Y, 0.85f, Dim);
	for (const FName& Pn : P.OwnedProperties)
	{
		if (const FCADPropertyRow* R = Data->Properties.Find(Pn)) { Txt(FString::Printf(TEXT("%s   %s/day"), *R->DisplayName, *Money(R->IncomePerDay)), Col2, Y, 0.95f, TextCol); Y += 28.f * S; }
	}

	// column 3: transactions
	Y = 170.f * S;
	Txt(TEXT("RECENT TRANSACTIONS"), Col3, Y, 1.0f, Teal); Y += 32.f * S;
	int32 Shown = 0;
	for (int32 i = P.History.Num() - 1; i >= 0 && Shown < 12; --i, ++Shown)
	{
		const FCADTransaction& T = P.History[i];
		Txt(T.Description.Left(26), Col3, Y, 0.85f, TextCol);
		Txt(T.Amount == 0 ? TEXT("-") : FString::Printf(TEXT("%s%s"), T.Amount > 0 ? TEXT("+") : TEXT(""), *Money(T.Amount)), Col3 + 320.f * S, Y, 0.85f, T.Amount >= 0 ? Green : Red, 2);
		Y += 26.f * S;
	}
	if (P.History.Num() == 0) Txt(TEXT("No transactions yet."), Col3, Y, 0.85f, Dim);
	if (Message.Len() && Now - MessageTime < 3.0) Txt(Message, W * 0.5f, H - 130.f * S, 1.1f, Amber, 1);
	Button(TEXT("Close"), 70.f * S, H - 100.f * S, 240.f * S, 50.f * S, [this]() { GM->SetState(ECADGameState::Playing); });
}
