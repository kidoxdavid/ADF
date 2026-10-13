#include "CADHUD.h"
#include "CADDataSubsystem.h"
#include "CADEconomySubsystem.h"
#include "CADEnvironmentSubsystem.h"
#include "CADFleetSubsystem.h"
#include "CADGameInstance.h"
#include "CADGameMode.h"
#include "CADInteractionSubsystem.h"
#include "CADMissionSubsystem.h"
#include "CADPlayerCharacter.h"
#include "CADPlayerController.h"
#include "CADPoliceSubsystem.h"
#include "CADTerrain.h"
#include "CADVehicle.h"
#include "CADWorldStreamer.h"
#include "CalgaryAfterDark.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Engine/Font.h"
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

// ------------------------------------------------------------------------------------------------
// Primitives
// ------------------------------------------------------------------------------------------------
UFont* ACADHUD::Font() const { return GEngine ? GEngine->GetMediumFont() : nullptr; }

void ACADHUD::Rect(float X, float Y, float Wd, float Ht, const FLinearColor& C) { DrawRect(C, X, Y, Wd, Ht); }

void ACADHUD::Frame(float X, float Y, float Wd, float Ht, const FLinearColor& C, float T)
{
	DrawRect(C, X, Y, Wd, T);
	DrawRect(C, X, Y + Ht - T, Wd, T);
	DrawRect(C, X, Y, T, Ht);
	DrawRect(C, X + Wd - T, Y, T, Ht);
}

void ACADHUD::Panel(float X, float Y, float Wd, float Ht, const FLinearColor& Accent)
{
	Rect(X, Y, Wd, Ht, FLinearColor(Ink.R, Ink.G, Ink.B, 0.86f));
	Rect(X, Y, 4.f * S, Ht, Accent);
	Frame(X, Y, Wd, Ht, FLinearColor(1.f, 1.f, 1.f, 0.07f), 1.f);
}

FVector2D ACADHUD::TxtSize(const FString& T, float Scale) const
{
	float Wd = 0.f, Ht = 0.f;
	GetTextSize(T, Wd, Ht, Font(), Scale);
	return FVector2D(Wd, Ht);
}

void ACADHUD::Txt(const FString& T, float X, float Y, float Scale, const FLinearColor& C, int32 Align, bool bShadow)
{
	if (T.IsEmpty()) return;
	const float Sc = Scale * S;
	const FVector2D Sz = TxtSize(T, Sc);
	if (Align == 1) X -= Sz.X * 0.5f; else if (Align == 2) X -= Sz.X;
	if (bShadow) DrawText(T, FLinearColor(0.f, 0.f, 0.f, 0.7f * C.A), X + 1.5f, Y + 1.5f, Font(), Sc, false);
	DrawText(T, C, X, Y, Font(), Sc, false);
}

void ACADHUD::Bar(float X, float Y, float Wd, float Ht, float Pct, const FLinearColor& C)
{
	Rect(X, Y, Wd, Ht, FLinearColor(0.f, 0.f, 0.f, 0.55f));
	Rect(X, Y, Wd * CADMath::Clamp(Pct, 0.f, 1.f), Ht, C);
	Frame(X, Y, Wd, Ht, FLinearColor(1.f, 1.f, 1.f, 0.15f), 1.f);
}

void ACADHUD::Line2(const FVector2D& A, const FVector2D& B, const FLinearColor& C, float T) { DrawLine(A.X, A.Y, B.X, B.Y, C, T); }

void ACADHUD::Circle(const FVector2D& C, float R, const FLinearColor& Col, float T, int32 Seg)
{
	FVector2D Prev = C + FVector2D(R, 0);
	for (int32 i = 1; i <= Seg; ++i)
	{
		const float A = 2.f * PI * i / Seg;
		const FVector2D P = C + FVector2D(FMath::Cos(A), FMath::Sin(A)) * R;
		Line2(Prev, P, Col, T);
		Prev = P;
	}
}

void ACADHUD::Diamond(const FVector2D& C, float R, const FLinearColor& Col)
{
	const int32 N = CADMath::Max(2, FMath::RoundToInt(R));
	for (int32 i = -N; i <= N; ++i)
	{
		const float Hw = R * (1.f - FMath::Abs(static_cast<float>(i)) / N);
		DrawLine(C.X - Hw, C.Y + i * (R / N), C.X + Hw, C.Y + i * (R / N), Col, 1.5f);
	}
}

FString ACADHUD::Money(int32 A) const { return UCADEconomySubsystem::Money(A); }

FString ACADHUD::KeyName(FName Id) const
{
	return PC ? PC->KeyFor(Id).GetDisplayName().ToString() : FString();
}

void ACADHUD::Toast(const FString& T, const FLinearColor& C)
{
	FToast X; X.Text = T; X.Time = GetWorld() ? GetWorld()->GetRealTimeSeconds() : 0.0; X.Colour = C;
	Toasts.Add(X);
	if (Toasts.Num() > 6) Toasts.RemoveAt(0);
}

bool ACADHUD::Button(const FString& Label, float X, float Y, float Wd, float Ht, TFunction<void()> Fn, bool bEnabled, const FLinearColor& Accent)
{
	const int32 Idx = Buttons.Num();
	FButton B;
	B.Rect = FBox2D(FVector2D(X, Y), FVector2D(X + Wd, Y + Ht));
	B.Label = Label; B.Fn = MoveTemp(Fn); B.bEnabled = bEnabled;
	Buttons.Add(B);
	float MX = 0.f, MY = 0.f;
	const bool bHave = PC && PC->GetMousePosition(MX, MY);
	const bool bHover = bHave && B.Rect.IsInside(FVector2D(MX, MY));
	if (bHover && (FVector2D(MX, MY) - LastMouse).SizeSquared() > 1.f) Sel = Idx;
	const bool bFocus = (Sel == Idx);
	const FLinearColor Bg = bFocus ? FLinearColor(Accent.R * 0.35f, Accent.G * 0.3f, Accent.B * 0.15f, 0.95f) : FLinearColor(0.08f, 0.11f, 0.17f, 0.92f);
	Rect(X, Y, Wd, Ht, Bg);
	Frame(X, Y, Wd, Ht, bFocus ? Accent : FLinearColor(1.f, 1.f, 1.f, 0.12f), bFocus ? 2.f : 1.f);
	if (bFocus) Rect(X, Y, 4.f * S, Ht, Accent);
	Txt(Label, X + Wd * 0.5f, Y + (Ht - 20.f * S) * 0.5f, 1.f, bEnabled ? TextCol : FLinearColor(0.45f, 0.48f, 0.55f), 1, true);
	return bFocus;
}

bool ACADHUD::ClipSegmentToCircle(FVector2D& A, FVector2D& B, const FVector2D& C, float R) const
{
	// clip segment AB to the disc (C, R); returns false if fully outside
	const FVector2D D = B - A;
	const FVector2D F = A - C;
	const float a = D.SizeSquared();
	if (a < 1e-6f) return F.SizeSquared() <= R * R;
	const float b = 2.f * FVector2D::DotProduct(F, D);
	const float c = F.SizeSquared() - R * R;
	const bool bAIn = c <= 0.f;
	const bool bBIn = (B - C).SizeSquared() <= R * R;
	if (bAIn && bBIn) return true;
	const float Disc = b * b - 4.f * a * c;
	if (Disc < 0.f) return false;
	const float Sq = FMath::Sqrt(Disc);
	float T0 = (-b - Sq) / (2.f * a), T1 = (-b + Sq) / (2.f * a);
	T0 = CADMath::Max(T0, 0.f); T1 = CADMath::Min(T1, 1.f);
	if (T0 > T1) return false;
	const FVector2D NA = A + D * T0, NB = A + D * T1;
	A = NA; B = NB;
	return true;
}

// ------------------------------------------------------------------------------------------------
// Input routing from the controller
// ------------------------------------------------------------------------------------------------
void ACADHUD::OnStateChanged() { Sel = 0; Tab = 0; ListScroll = 0; bConfirmQuit = false; bConfirmMenu = false; Message.Reset(); bMapInit = false; }

void ACADHUD::Nav(int32 Dir)
{
	if (!GM || GM->State == ECADGameState::Playing) return;
	if (GM->State == ECADGameState::Map) return;   // the map pans continuously (see DrawMap)
	if (LastButtons.Num() == 0) return;
	Sel = (Sel + Dir + LastButtons.Num()) % LastButtons.Num();
}

void ACADHUD::Step(int32 Dir)
{
	if (!GM) return;
	if (GM->State == ECADGameState::Map) return;
	if (GM->State == ECADGameState::Garage || GM->State == ECADGameState::Shop) { Tab = CADMath::Clamp(Tab + Dir, 0, 5); Sel = 0; return; }
	// settings sliders: the +/- buttons follow the selected row's button pair
	if (GM->State == ECADGameState::Settings && LastButtons.IsValidIndex(Sel))
	{
		const FString L = LastButtons[Sel].Label;
		if (L == TEXT("<") && Dir > 0 && LastButtons.IsValidIndex(Sel + 1) && LastButtons[Sel + 1].bEnabled) LastButtons[Sel + 1].Fn();
		else if (L == TEXT(">") && Dir < 0 && LastButtons.IsValidIndex(Sel - 1)) LastButtons[Sel - 1].Fn();
		else if (L == TEXT("<") && Dir < 0) LastButtons[Sel].Fn();
		else if (L == TEXT(">") && Dir > 0) LastButtons[Sel].Fn();
	}
}

void ACADHUD::Accept()
{
	if (!GM || GM->State == ECADGameState::Playing) return;
	if (LastButtons.IsValidIndex(Sel) && LastButtons[Sel].bEnabled)
	{
		TFunction<void()> Fn = LastButtons[Sel].Fn;
		if (Fn) Fn();
	}
}

void ACADHUD::Back()
{
	if (!GM) return;
	bConfirmQuit = false; bConfirmMenu = false;
	switch (GM->State)
	{
	case ECADGameState::Paused:
	case ECADGameState::Map:
	case ECADGameState::Inventory:
	case ECADGameState::Shop:
	case ECADGameState::Property:
		GM->SetState(ECADGameState::Playing);
		break;
	case ECADGameState::Garage:
		if (Fleet) Fleet->RefreshLive(SelVehicle);   // drop any unpurchased paint preview
		GM->SetState(ECADGameState::Playing);
		break;
	case ECADGameState::Briefing:
		if (Mis && !Mis->InChoice()) { Mis->DeclineBriefing(); GM->SetState(ECADGameState::Playing); }
		break;
	case ECADGameState::Settings:
		GM->SetState(GM->StateBeforeSettings == ECADGameState::MainMenu ? ECADGameState::MainMenu : ECADGameState::Paused);
		break;
	default: break;
	}
}

void ACADHUD::Click(float X, float Y)
{
	if (!GM) return;
	if (GM->State == ECADGameState::Map)
	{
		// buttons first (close), else set a waypoint
		for (const FButton& B : LastButtons) if (B.bEnabled && B.Rect.IsInside(FVector2D(X, Y))) { TFunction<void()> F = B.Fn; if (F) F(); return; }
		if (MapRect().IsInside(FVector2D(X, Y)))
		{
			GM->SetWaypoint(WorldFromMapScreen(FVector2D(X, Y)));
			Toast(TEXT("Waypoint set"), Teal);
		}
		return;
	}
	for (int32 i = 0; i < LastButtons.Num(); ++i)
	{
		const FButton& B = LastButtons[i];
		if (B.bEnabled && B.Rect.IsInside(FVector2D(X, Y)))
		{
			Sel = i;
			TFunction<void()> F = B.Fn;
			if (F) F();
			return;
		}
	}
}

void ACADHUD::RightClick(float X, float Y)
{
	if (GM && GM->State == ECADGameState::Map) { GM->ClearWaypoint(); Toast(TEXT("Waypoint removed"), Dim); }
}

void ACADHUD::GamepadWaypoint()
{
	if (GM && GM->State == ECADGameState::Map)
	{
		if (GM->bHasWaypoint) { GM->ClearWaypoint(); Toast(TEXT("Waypoint removed"), Dim); }
		else GM->SetWaypoint(FVector(MapCenter.X, MapCenter.Y, 0.f)), Toast(TEXT("Waypoint set"), Teal);
	}
}

void ACADHUD::Scroll(float Delta)
{
	if (!GM) return;
	if (GM->State == ECADGameState::Map) { MapZoom = CADMath::Clamp(MapZoom * (Delta > 0 ? 1.2f : 1.f / 1.2f), 0.004f, 0.6f); return; }
	ListScroll = CADMath::Max(0, ListScroll - FMath::RoundToInt(Delta));
}

void ACADHUD::BeginPlay()
{
	Super::BeginPlay();
	if (UCADGameInstance* G = UCADGameInstance::Get(this))
	{
		TWeakObjectPtr<ACADHUD> Self(this);
		G->OnToast.AddLambda([Self](const FString& T) { if (Self.IsValid()) Self->Toast(T); });
		if (UCADEconomySubsystem* E = G->GetSubsystem<UCADEconomySubsystem>())
		{
			E->OnMoney.AddLambda([Self](int32 Delta, const FString& Reason)
			{
				if (!Self.IsValid() || Delta == 0) return;
				Self->Toast(FString::Printf(TEXT("%s%s  %s"), Delta > 0 ? TEXT("+") : TEXT(""), *UCADEconomySubsystem::Money(Delta), *Reason), Delta > 0 ? Green : Red);
			});
		}
	}
}

// ------------------------------------------------------------------------------------------------
// Frame
// ------------------------------------------------------------------------------------------------
void ACADHUD::DrawHUD()
{
	Super::DrawHUD();
	if (!Canvas || !GetWorld()) return;
	W = Canvas->ClipX; H = Canvas->ClipY;
	S = CADMath::Clamp(H / 1080.f, 0.5f, 2.f);
	Now = GetWorld()->GetRealTimeSeconds();
	GM = Cast<ACADGameMode>(GetWorld()->GetAuthGameMode());
	GI = UCADGameInstance::Get(this);
	PC = Cast<ACADPlayerController>(GetOwningPlayerController());
	if (!GM || !GI || !PC) return;
	Data = GI->GetSubsystem<UCADDataSubsystem>();
	Eco = GI->GetSubsystem<UCADEconomySubsystem>();
	Mis = UCADMissionSubsystem::Get(this);
	Pol = UCADPoliceSubsystem::Get(this);
	Env = UCADEnvironmentSubsystem::Get(this);
	Fleet = UCADFleetSubsystem::Get(this);

	Buttons.Reset();
	if (GM->bLoadingWorld)
	{
		DrawLoading();
	}
	else
	{
		switch (GM->State)
		{
		case ECADGameState::MainMenu: DrawMainMenu(); break;
		case ECADGameState::Playing: DrawGameplay(); break;
		case ECADGameState::Paused: DrawGameplay(); DrawPause(); break;
		case ECADGameState::Map: DrawMap(); break;
		case ECADGameState::Inventory: DrawGameplay(); DrawInventory(); break;
		case ECADGameState::Garage: DrawGameplay(); DrawGarage(); break;
		case ECADGameState::Shop: DrawGameplay(); DrawShop(); break;
		case ECADGameState::Property: DrawGameplay(); DrawProperty(); break;
		case ECADGameState::Briefing: DrawGameplay(); DrawBriefing(); break;
		case ECADGameState::Results: DrawGameplay(); DrawResults(); break;
		case ECADGameState::Settings: if (GM->bInSession) DrawGameplay(); DrawSettings(); break;
		}
		DrawToasts();
		DrawOverlay();
	}
	float MX = 0, MY = 0;
	if (PC->GetMousePosition(MX, MY)) LastMouse = FVector2D(MX, MY);
	if (Buttons.Num() > 0) Sel = CADMath::Clamp(Sel, 0, Buttons.Num() - 1); else Sel = 0;
	LastButtons = Buttons;
}

void ACADHUD::DrawLoading()
{
	Rect(0, 0, W, H, FLinearColor(0.01f, 0.02f, 0.04f, 1.f));
	Txt(TEXT("CALGARY AFTER DARK"), W * 0.5f, H * 0.38f, 3.2f, Amber, 1);
	const int32 Dots = static_cast<int32>(Now * 3.0) % 4;
	Txt(FString::Printf(TEXT("Streaming the city%s"), *FString::ChrN(Dots, TEXT('.'))), W * 0.5f, H * 0.52f, 1.4f, TextCol, 1);
	if (UCADWorldStreamer* St = GetWorld()->GetSubsystem<UCADWorldStreamer>())
		Txt(FString::Printf(TEXT("%d districts loaded, %d building"), St->NumLoaded(), St->NumBuilding()), W * 0.5f, H * 0.58f, 0.9f, Dim, 1);
}

void ACADHUD::DrawOverlay()
{
	if (GM->FadeAlpha > 0.01f)
	{
		Rect(0, 0, W, H, FLinearColor(0.f, 0.f, 0.f, GM->FadeAlpha));
		if (!GM->OverlayTitle.IsEmpty() && GM->OverlayTimer < 3.4f && GM->OverlayTimer > 0.2f)
		{
			Txt(GM->OverlayTitle, W * 0.5f, H * 0.4f, 5.f, GM->OverlayTitle == TEXT("BUSTED") ? FLinearColor(0.35f, 0.55f, 1.f) : Red, 1);
			Txt(GM->OverlaySub, W * 0.5f, H * 0.4f + 110.f * S, 1.2f, TextCol, 1);
		}
	}
}

void ACADHUD::DrawToasts()
{
	float Y = 150.f * S;
	for (int32 i = Toasts.Num() - 1; i >= 0; --i)
	{
		const double Age = Now - Toasts[i].Time;
		if (Age > 5.0) { Toasts.RemoveAt(i); continue; }
	}
	for (int32 i = Toasts.Num() - 1; i >= 0; --i)
	{
		const double Age = Now - Toasts[i].Time;
		const float A = Age > 4.0 ? static_cast<float>(5.0 - Age) : 1.f;
		const FVector2D Sz = TxtSize(Toasts[i].Text, 1.0f * S);
		const float X = W - 30.f * S - Sz.X - 24.f * S;
		Rect(X, Y, Sz.X + 24.f * S, 34.f * S, FLinearColor(Ink.R, Ink.G, Ink.B, 0.8f * A));
		Rect(X, Y, 3.f * S, 34.f * S, FLinearColor(Toasts[i].Colour.R, Toasts[i].Colour.G, Toasts[i].Colour.B, A));
		Txt(Toasts[i].Text, X + 14.f * S, Y + 6.f * S, 1.0f, FLinearColor(Toasts[i].Colour.R, Toasts[i].Colour.G, Toasts[i].Colour.B, A));
		Y += 40.f * S;
	}
}

// ------------------------------------------------------------------------------------------------
// Gameplay HUD
// ------------------------------------------------------------------------------------------------
void ACADHUD::DrawGameplay()
{
	if (!GM->bInSession) return;
	const APawn* P = PC->GetPawn();
	if (!P) return;
	DrawTopBar();
	DrawMinimap();
	DrawMissionPanel();
	DrawWanted();
	if (const ACADVehicle* V = Cast<ACADVehicle>(P)) DrawSpeedo(V);
	else if (const ACADPlayerCharacter* C = Cast<ACADPlayerCharacter>(P))
	{
		const float X = W - 330.f * S, Y = H - 90.f * S;
		Txt(TEXT("HEALTH"), X, Y - 4.f * S, 0.7f, Dim);
		Bar(X + 80.f * S, Y, 230.f * S, 14.f * S, C->Health / 100.f, Red);
		Txt(TEXT("STAMINA"), X, Y + 26.f * S, 0.7f, Dim);
		Bar(X + 80.f * S, Y + 30.f * S, 230.f * S, 10.f * S, C->Stamina / 100.f, Teal);
	}
	if (GM->State == ECADGameState::Playing)
	{
		DrawPrompts();
		DrawDialogue();
		DrawChoices();
		if (Pol && Pol->BustProgress() > 0.02f)
		{
			Txt(TEXT("BEING ARRESTED"), W * 0.5f, H * 0.62f, 1.2f, FLinearColor(0.4f, 0.6f, 1.f), 1);
			Bar(W * 0.5f - 150.f * S, H * 0.62f + 34.f * S, 300.f * S, 12.f * S, Pol->BustProgress(), FLinearColor(0.4f, 0.6f, 1.f));
		}
	}
}

void ACADHUD::DrawTopBar()
{
	const float X = W - 30.f * S;
	Txt(Money(Eco ? Eco->Cash() : 0), X, 24.f * S, 2.2f, Green, 2);
	Txt(FString::Printf(TEXT("Bank %s"), *Money(Eco ? Eco->Bank() : 0)), X, 64.f * S, 0.9f, Dim, 2);
	if (Env)
	{
		Txt(FString::Printf(TEXT("Day %d   %s   %s"), Env->Day, *Env->TimeString(), *Env->WeatherName()), 30.f * S, 24.f * S, 1.0f, TextCol);
	}
	Txt(GM->CurrentDistrictName(), 30.f * S, 50.f * S, 0.9f, Teal);
}

void ACADHUD::DrawWanted()
{
	if (!Pol) return;
	const int32 L = Pol->Level();
	if (L <= 0) return;
	const float X = W - 30.f * S - 5.f * 34.f * S;
	const float Y = 100.f * S;
	const bool bFlash = Pol->State() == ECADPoliceState::Search && FMath::Fmod(Now, 0.8) < 0.4;
	for (int32 i = 0; i < 5; ++i)
	{
		const bool bOn = i < L;
		FLinearColor C = bOn ? (bFlash ? FLinearColor(0.3f, 0.5f, 1.f) : FLinearColor(1.f, 0.85f, 0.2f)) : FLinearColor(0.25f, 0.27f, 0.32f);
		Diamond(FVector2D(X + 17.f * S + i * 34.f * S, Y), 13.f * S, C);
	}
	FString State = Pol->State() == ECADPoliceState::Pursuit ? TEXT("SPOTTED") : (Pol->State() == ECADPoliceState::Search ? TEXT("SEARCHING") : TEXT("LAYING LOW"));
	Txt(State, W - 30.f * S, Y + 22.f * S, 0.8f, Pol->PlayerSeen() ? Red : Dim, 2);
}

void ACADHUD::DrawSpeedo(const ACADVehicle* V)
{
	const float X = W - 40.f * S, Y = H - 190.f * S;
	Rect(X - 300.f * S, Y - 10.f * S, 310.f * S, 170.f * S, FLinearColor(Ink.R, Ink.G, Ink.B, 0.7f));
	Txt(FString::Printf(TEXT("%d"), FMath::RoundToInt(V->SpeedKph())), X - 20.f * S, Y, 4.2f, TextCol, 2);
	Txt(TEXT("km/h"), X - 8.f * S, Y + 86.f * S, 0.9f, Dim, 2);
	Txt(V->DisplayName(), X - 285.f * S, Y + 4.f * S, 1.0f, Amber);
	Txt(V->bHeadlightsOn ? TEXT("LIGHTS ON") : TEXT("lights off"), X - 285.f * S, Y + 30.f * S, 0.7f, V->bHeadlightsOn ? Teal : Dim);
	Txt(TEXT("VEHICLE"), X - 285.f * S, Y + 104.f * S, 0.65f, Dim);
	Bar(X - 285.f * S, Y + 124.f * S, 270.f * S, 12.f * S, V->Health / 100.f, V->Health > 35.f ? Teal : Red);
}

void ACADHUD::DrawPrompts()
{
	FString Prompt;
	const APawn* P = PC->GetPawn();
	UCADInteractionSubsystem* I = UCADInteractionSubsystem::Get(this);
	if (Mis && Mis->InDialogue() ) return;
	if (I && I->Current()) Prompt = FString::Printf(TEXT("[%s]  %s"), *KeyName(TEXT("Interact")), *I->Prompt);
	else if (Cast<ACADVehicle>(P)) Prompt = FString::Printf(TEXT("[%s]  Exit vehicle"), *KeyName(TEXT("Interact")));
	else if (P)
	{
		if (const ACADVehicle* N = ACADVehicle::FindNearest(GetWorld(), P->GetActorLocation(), 420.f))
			Prompt = FString::Printf(TEXT("[%s]  %s %s"), *KeyName(TEXT("Interact")), N->Role == ECADVehicleRole::Traffic ? TEXT("Take (carjack)") : TEXT("Enter"), *N->DisplayName());
	}
	if (Prompt.IsEmpty()) return;
	const FVector2D Sz = TxtSize(Prompt, 1.3f * S);
	Rect(W * 0.5f - Sz.X * 0.5f - 18.f * S, H - 190.f * S, Sz.X + 36.f * S, 46.f * S, FLinearColor(Ink.R, Ink.G, Ink.B, 0.85f));
	Frame(W * 0.5f - Sz.X * 0.5f - 18.f * S, H - 190.f * S, Sz.X + 36.f * S, 46.f * S, Amber, 1.f);
	Txt(Prompt, W * 0.5f, H - 180.f * S, 1.3f, TextCol, 1);
}

static void WrapText(const FString& Text, float MaxW, TFunction<float(const FString&)> Measure, TArray<FString>& Out)
{
	TArray<FString> Words;
	Text.ParseIntoArray(Words, TEXT(" "), true);
	FString Cur;
	for (const FString& Wd : Words)
	{
		const FString Try = Cur.IsEmpty() ? Wd : Cur + TEXT(" ") + Wd;
		if (Measure(Try) > MaxW && !Cur.IsEmpty()) { Out.Add(Cur); Cur = Wd; }
		else Cur = Try;
	}
	if (!Cur.IsEmpty()) Out.Add(Cur);
}

void ACADHUD::DrawMissionPanel()
{
	if (!Mis || !Mis->bActive || Mis->bFailed) return;
	const FCADMissionDef* D = Mis->Def();
	if (!D) return;
	const float X = 30.f * S, Y = 100.f * S, Wd = 430.f * S;
	TArray<FString> Lines;
	WrapText(Mis->ObjectiveText(), Wd - 40.f * S, [this](const FString& T) { return TxtSize(T, 1.05f * S).X; }, Lines);
	const FString Opt = Mis->OptionalText();
	TArray<FString> OptLines;
	if (!Opt.IsEmpty()) WrapText(Opt, Wd - 40.f * S, [this](const FString& T) { return TxtSize(T, 0.75f * S).X; }, OptLines);
	const float Ht = (62.f + Lines.Num() * 26.f + (Mis->TimeLeft >= 0.f ? 34.f : 0.f) + OptLines.Num() * 20.f) * S;
	Panel(X, Y, Wd, Ht);
	Txt(D->Title.ToUpper(), X + 18.f * S, Y + 10.f * S, 0.85f, Amber);
	float Cy = Y + 40.f * S;
	for (const FString& L : Lines) { Txt(L, X + 18.f * S, Cy, 1.05f, TextCol); Cy += 26.f * S; }
	if (Mis->TimeLeft >= 0.f)
	{
		const int32 T = FMath::CeilToInt(Mis->TimeLeft);
		Txt(FString::Printf(TEXT("%d:%02d"), T / 60, T % 60), X + 18.f * S, Cy + 2.f * S, 1.6f, Mis->TimeLeft < 20.f && FMath::Fmod(Now, 0.6) < 0.3 ? Red : Teal);
		Cy += 34.f * S;
	}
	for (const FString& L : OptLines) { Txt(L, X + 18.f * S, Cy + 4.f * S, 0.75f, Dim); Cy += 20.f * S; }
}

void ACADHUD::DrawDialogue()
{
	if (!Mis || !Mis->InDialogue()) return;
	FString Speaker, Text;
	if (!Mis->GetDialogueLine(Speaker, Text)) return;
	const float Wd = CADMath::Min(W - 80.f * S, 1100.f * S), X = (W - Wd) * 0.5f, Y = H - 250.f * S, Ht = 190.f * S;
	Panel(X, Y, Wd, Ht, Teal);
	if (!Speaker.IsEmpty()) Txt(Speaker.ToUpper(), X + 26.f * S, Y + 14.f * S, 1.2f, Amber);
	TArray<FString> Lines;
	WrapText(Text, Wd - 60.f * S, [this](const FString& T) { return TxtSize(T, 1.15f * S).X; }, Lines);
	float Cy = Y + 52.f * S;
	for (const FString& L : Lines) { Txt(L, X + 26.f * S, Cy, 1.15f, TextCol); Cy += 30.f * S; }
	Txt(FString::Printf(TEXT("[%s] Continue"), *KeyName(TEXT("Interact"))), X + Wd - 24.f * S, Y + Ht - 34.f * S, 0.9f, Dim, 2);
}

void ACADHUD::DrawChoices()
{
	if (!Mis || !Mis->InChoice()) return;
	const FCADStageDef* St = Mis->Stage();
	if (!St) return;
	// choices need the mouse: show the cursor and temporarily use the UI context
	const float Wd = 640.f * S, X = (W - Wd) * 0.5f, Y = H * 0.30f;
	Panel(X, Y, Wd, 90.f * S + 3 * 62.f * S);
	Txt(St->Text, X + Wd * 0.5f, Y + 22.f * S, 1.3f, Amber, 1);
	float Cy = Y + 76.f * S;
	for (int32 i = 0; i < 3; ++i)
	{
		if (St->ChoiceLabel[i].IsEmpty()) continue;
		FString Why;
		const bool bOk = Mis->ChoiceAvailable(i, &Why);
		Button(bOk ? St->ChoiceLabel[i] : FString::Printf(TEXT("%s  (%s)"), *St->ChoiceLabel[i], *Why), X + 20.f * S, Cy, Wd - 40.f * S, 50.f * S,
			[this, i]() { if (Mis) Mis->ChooseOption(i); }, bOk);
		Cy += 62.f * S;
	}
}

void ACADHUD::UpdateRoute()
{
	if (!Data || !GM || !PC || !PC->GetPawn()) return;
	FVector Target; bool bHave = false;
	if (GM->bHasWaypoint) { Target = GM->Waypoint; bHave = true; }
	else if (Mis && Mis->bActive)
	{
		TArray<FCADObjTarget> T; Mis->GetTargets(T);
		for (const FCADObjTarget& O : T) if (O.bPrimary) { Target = O.Pos; bHave = true; break; }
	}
	if (!bHave) { RouteLine.Reset(); return; }
	const FVector PL = PC->GetPawn()->GetActorLocation();
	if (GM->bHasWaypoint && FVector::Dist2D(PL, Target) < 2500.f) { GM->ClearWaypoint(); RouteLine.Reset(); Toast(TEXT("Arrived at waypoint"), Teal); return; }
	if (Now - RouteTime < 1.5 && FVector::Dist2D(Target, RouteTarget) < 100.f) return;
	RouteTime = Now; RouteTarget = Target;
	TArray<FCADDirEdge> R;
	RouteLine.Reset();
	if (Data->Network.FindRouteBetween(PL, PC->GetPawn()->GetActorForwardVector(), Target, R))
	{
		RouteLine.Add(PL);
		TArray<FVector> C;
		Data->Network.BuildCentreline(R, C);
		RouteLine.Append(C);
		RouteLine.Add(Target);
	}
	else { RouteLine = { PL, Target }; }
}

void ACADHUD::DrawMinimap()
{
	const APawn* P = PC->GetPawn();
	if (!P || !Data) return;
	UpdateRoute();
	const float R = 140.f * S;
	const FVector2D C(40.f * S + R, H - 40.f * S - R);
	const FVector PL = P->GetActorLocation();
	const bool bVeh = Cast<ACADVehicle>(P) != nullptr;
	const float SpeedMps = P->GetVelocity().Size() / 100.f;
	const float RadM = bVeh ? CADMath::Clamp(300.f + SpeedMps * 4.f, 300.f, 650.f) : 280.f;
	const float Scale = R / (RadM * CADM);
	const bool bRot = GI->Settings.bMinimapRotates;
	const float Yaw = bRot ? FMath::DegreesToRadians(P->GetActorRotation().Yaw) : 0.f;
	const FVector2D Fwd(FMath::Cos(Yaw), FMath::Sin(Yaw));
	const FVector2D Rgt(-FMath::Sin(Yaw), FMath::Cos(Yaw));
	auto ToScreen = [&](const FVector& Wp) -> FVector2D
	{
		const FVector2D D(Wp.X - PL.X, Wp.Y - PL.Y);
		if (bRot) return FVector2D(C.X + FVector2D::DotProduct(D, Rgt) * Scale, C.Y - FVector2D::DotProduct(D, Fwd) * Scale);
		return FVector2D(C.X + D.X * Scale, C.Y + D.Y * Scale);
	};

	// background disc
	for (float Dy = -R; Dy <= R; Dy += 2.f)
	{
		const float Hw = FMath::Sqrt(CADMath::Max(0.f, R * R - Dy * Dy));
		DrawLine(C.X - Hw, C.Y + Dy, C.X + Hw, C.Y + Dy, FLinearColor(0.09f, 0.13f, 0.1f, 0.9f), 2.f);
	}
	// river
	const TArray<FVector>& River = CADTerrain::GetRiver();
	for (int32 i = 0; i + 1 < River.Num(); ++i)
	{
		FVector2D A = ToScreen(FVector(River[i].X, River[i].Y, 0)), B = ToScreen(FVector(River[i + 1].X, River[i + 1].Y, 0));
		if (ClipSegmentToCircle(A, B, C, R - 2.f)) Line2(A, B, FLinearColor(0.2f, 0.42f, 0.65f), CADMath::Max(3.f, River[i].Z * 2.f * Scale));
	}
	// roads (layers: minor first)
	TArray<int32> Near;
	Data->Network.EdgesNear(PL, RadM * CADM * 1.15f, Near);
	for (int32 Pass = 0; Pass < 2; ++Pass)
	{
		for (int32 ei : Near)
		{
			const FCADRoadEdge& E = Data->Network.Edges[ei];
			const bool bMajor = E.Kind == ECADRoadKind::Highway || E.Kind == ECADRoadKind::Expressway || E.Kind == ECADRoadKind::Arterial || E.Kind == ECADRoadKind::Ramp || E.Kind == ECADRoadKind::Industrial;
			if ((Pass == 0) == bMajor) continue;
			FLinearColor Col; float T;
			switch (E.Kind)
			{
			case ECADRoadKind::Highway: Col = FLinearColor(0.95f, 0.5f, 0.2f); T = 5.f; break;
			case ECADRoadKind::Expressway: Col = FLinearColor(0.95f, 0.7f, 0.25f); T = 4.f; break;
			case ECADRoadKind::Arterial: Col = FLinearColor(0.85f, 0.87f, 0.9f); T = 3.5f; break;
			case ECADRoadKind::Ramp: Col = FLinearColor(0.7f, 0.5f, 0.9f); T = 3.f; break;
			case ECADRoadKind::Industrial: Col = FLinearColor(0.65f, 0.6f, 0.5f); T = 3.f; break;
			case ECADRoadKind::Path: Col = FLinearColor(0.3f, 0.7f, 0.4f, 0.8f); T = 1.5f; break;
			default: Col = FLinearColor(0.5f, 0.54f, 0.6f); T = 2.f; break;
			}
			FVector2D A = ToScreen(Data->Network.Nodes[E.A].Pos), B = ToScreen(Data->Network.Nodes[E.B].Pos);
			if (E.bBridge) { Col = FLinearColor(0.75f, 0.85f, 1.f); }
			if (ClipSegmentToCircle(A, B, C, R - 2.f)) Line2(A, B, Col, T * S * 0.6f + 0.5f);
		}
	}
	// route
	for (int32 i = 0; i + 1 < RouteLine.Num(); ++i)
	{
		FVector2D A = ToScreen(RouteLine[i]), B = ToScreen(RouteLine[i + 1]);
		if (ClipSegmentToCircle(A, B, C, R - 2.f)) Line2(A, B, FLinearColor(1.f, 0.2f, 0.8f), 3.5f * S);
	}
	// map icons
	auto Icon = [&](const FVector& Wp, const FLinearColor& Col, float Rad, bool bArrow)
	{
		FVector2D Sp = ToScreen(Wp);
		FVector2D D = Sp - C;
		if (D.Size() > R - Rad - 2.f)
		{
			if (!bArrow) return;
			D.Normalize();
			Sp = C + D * (R - 8.f * S);
			Diamond(Sp, Rad * 0.9f, Col);
			return;
		}
		Diamond(Sp, Rad, Col);
	};
	for (const FName& Id : Data->LocationOrder)
	{
		const FCADLocationRow& L = Data->Locations[Id];
		FLinearColor Col;
		if (L.Kind == TEXT("Giver")) Col = FLinearColor(1.f, 0.8f, 0.1f);
		else if (L.Kind == TEXT("Shop")) Col = FLinearColor(0.25f, 0.6f, 1.f);
		else if (L.Kind == TEXT("Garage")) Col = FLinearColor(1.f, 0.5f, 0.1f);
		else if (L.Kind == TEXT("Property")) Col = FLinearColor(0.3f, 0.9f, 0.4f);
		else if (L.Kind == TEXT("Police")) Col = FLinearColor(0.3f, 0.4f, 1.f);
		else if (L.Kind == TEXT("Hospital")) Col = FLinearColor(1.f, 0.4f, 0.7f);
		else if (L.Kind == TEXT("Landmark") || L.Kind == TEXT("Overlook")) Col = FLinearColor(0.7f, 0.5f, 0.95f);
		else continue;
		Icon(FVector(L.X * CADM, L.Y * CADM, 0), Col, 6.f * S, false);
	}
	if (Mis && Mis->bActive)
	{
		TArray<FCADObjTarget> T; Mis->GetTargets(T);
		for (const FCADObjTarget& O : T) { Icon(O.Pos, O.Colour, O.bPrimary ? 9.f * S : 6.f * S, true); }
	}
	if (GM->bHasWaypoint) Icon(GM->Waypoint, FLinearColor(1.f, 0.2f, 0.8f), 9.f * S, true);
	for (const TWeakObjectPtr<ACADVehicle>& Wv : ACADVehicle::Registry)
	{
		const ACADVehicle* V = Wv.Get();
		if (V && V->Role == ECADVehicleRole::Police && !V->bWrecked && FVector::Dist2D(V->GetActorLocation(), PL) < RadM * CADM)
			Icon(V->GetActorLocation(), FMath::Fmod(Now, 0.5) < 0.25 ? FLinearColor(1.f, 0.1f, 0.1f) : FLinearColor(0.2f, 0.4f, 1.f), 5.f * S, false);
	}
	if (Pol && Pol->State() == ECADPoliceState::Search)
	{
		FVector2D Sp = ToScreen(Pol->LastKnown());
		Circle(Sp, Pol->SearchRadius() * Scale, FLinearColor(0.3f, 0.5f, 1.f, 0.6f), 2.f, 24);
	}
	// player arrow
	{
		const float Ang = FMath::DegreesToRadians(P->GetActorRotation().Yaw);
		const FVector2D F3 = bRot ? FVector2D(0, -1) : FVector2D(FMath::Cos(Ang), FMath::Sin(Ang));
		const FVector2D Tip = C + F3 * 11.f * S, L = C - F3 * 7.f * S + FVector2D(-F3.Y, F3.X) * 7.f * S, Rr = C - F3 * 7.f * S - FVector2D(-F3.Y, F3.X) * 7.f * S;
		Line2(Tip, L, FLinearColor::White, 3.f); Line2(Tip, Rr, FLinearColor::White, 3.f); Line2(L, C - F3 * 3.f * S, FLinearColor::White, 3.f); Line2(Rr, C - F3 * 3.f * S, FLinearColor::White, 3.f);
	}
	// frame + north marker (north is world -Y, projected into the rotated frame)
	Circle(C, R, FLinearColor(0.9f, 0.7f, 0.2f), 3.f * S, 64);
	{
		const FVector2D NorthWorld(0.f, -1.f);
		const FVector2D Nd = bRot ? FVector2D(FVector2D::DotProduct(NorthWorld, Rgt), -FVector2D::DotProduct(NorthWorld, Fwd)) : FVector2D(0.f, -1.f);
		Txt(TEXT("N"), C.X + Nd.X * (R - 14.f * S), C.Y + Nd.Y * (R - 14.f * S) - 8.f * S, 0.8f, Amber, 1);
	}
	// info under the minimap
	const FString Road = GM->CurrentRoadName();
	if (!Road.IsEmpty()) Txt(Road, C.X + R + 16.f * S, C.Y + R - 52.f * S, 0.9f, TextCol);
	if (GM->bHasWaypoint)
	{
		Txt(FString::Printf(TEXT("Waypoint  %.1f km"), FVector::Dist2D(PL, GM->Waypoint) / 100000.f), C.X + R + 16.f * S, C.Y + R - 26.f * S, 0.85f, FLinearColor(1.f, 0.4f, 0.85f));
	}
}
