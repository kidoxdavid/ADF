#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "CADTypes.h"
#include "CADRoadNetwork.h"
#include "CADHUD.generated.h"

class ACADGameMode;
class ACADVehicle;
class ACADPlayerController;
class UCADDataSubsystem;
class UCADEconomySubsystem;
class UCADMissionSubsystem;
class UCADPoliceSubsystem;
class UCADEnvironmentSubsystem;
class UCADFleetSubsystem;
class UCADGameInstance;
class UFont;

/**
 * Immediate-mode canvas UI: gameplay HUD (minimap, wanted, money, mission, speedometer, prompts, dialogue,
 * toasts) and every menu screen (main, pause, settings with key rebinding, full map, inventory, garage,
 * shops, property, mission briefing and results). Needs no UMG assets.
 */
UCLASS()
class CALGARYAFTERDARK_API ACADHUD : public AHUD
{
	GENERATED_BODY()
public:
	virtual void DrawHUD() override;
	virtual void BeginPlay() override;

	void OnStateChanged();
	void Nav(int32 Dir);
	void Step(int32 Dir);
	void Accept();
	void Back();
	void Click(float X, float Y);
	void RightClick(float X, float Y);
	void Scroll(float Delta);
	void GamepadWaypoint();

private:
	// ---- shared state ----------------------------------------------------------------------------
	struct FButton { FBox2D Rect; FString Label; TFunction<void()> Fn; bool bEnabled = true; };
	struct FToast { FString Text; double Time; FLinearColor Colour; };
	TArray<FButton> Buttons, LastButtons;
	TArray<FToast> Toasts;
	int32 Sel = 0;
	FVector2D LastMouse = FVector2D::ZeroVector;
	float S = 1.f;                 // UI scale (1 at 1080p)
	float W = 0.f, H = 0.f;        // canvas size
	double Now = 0.0;

	ACADGameMode* GM = nullptr;
	UCADGameInstance* GI = nullptr;
	UCADDataSubsystem* Data = nullptr;
	UCADEconomySubsystem* Eco = nullptr;
	UCADMissionSubsystem* Mis = nullptr;
	UCADPoliceSubsystem* Pol = nullptr;
	UCADEnvironmentSubsystem* Env = nullptr;
	UCADFleetSubsystem* Fleet = nullptr;
	ACADPlayerController* PC = nullptr;

	// ---- screens state -----------------------------------------------------------------------------
	int32 Tab = 0;
	int32 ListScroll = 0;
	FGuid SelVehicle;
	FString Message;
	double MessageTime = -10.0;
	bool bConfirmQuit = false;
	bool bConfirmMenu = false;

	// map
	FVector2D MapCenter = FVector2D::ZeroVector;   // world cm
	float MapZoom = 0.12f;                        // pixels per metre
	bool bMapInit = false;
	FVector2D MapMouseDragStart = FVector2D::ZeroVector;

	// route cache
	TArray<FVector> RouteLine;
	double RouteTime = -100.0;
	FVector RouteTarget = FVector::ZeroVector;

	// ---- drawing primitives ------------------------------------------------------------------------
	UFont* Font() const;
	void Rect(float X, float Y, float Wd, float Ht, const FLinearColor& C);
	void Frame(float X, float Y, float Wd, float Ht, const FLinearColor& C, float T = 1.f);
	void Panel(float X, float Y, float Wd, float Ht, const FLinearColor& Accent = FLinearColor(1.f, 0.69f, 0.13f));
	void Txt(const FString& T, float X, float Y, float Scale, const FLinearColor& C, int32 Align = 0, bool bShadow = true);
	FVector2D TxtSize(const FString& T, float Scale) const;
	void Bar(float X, float Y, float Wd, float Ht, float Pct, const FLinearColor& C);
	bool Button(const FString& Label, float X, float Y, float Wd, float Ht, TFunction<void()> Fn, bool bEnabled = true, const FLinearColor& Accent = FLinearColor(1.f, 0.69f, 0.13f));
	void Line2(const FVector2D& A, const FVector2D& B, const FLinearColor& C, float T);
	void Circle(const FVector2D& C, float R, const FLinearColor& Col, float T = 2.f, int32 Seg = 40);
	void Diamond(const FVector2D& C, float R, const FLinearColor& Col);
	void Toast(const FString& T, const FLinearColor& C = FLinearColor::White);
	void Say(const FString& T) { Message = T; MessageTime = Now; }
	FString Money(int32 A) const;
	FString KeyName(FName Id) const;
	bool ClipSegmentToCircle(FVector2D& A, FVector2D& B, const FVector2D& C, float R) const;

	// ---- gameplay HUD --------------------------------------------------------------------------------
	void DrawGameplay();
	void DrawMinimap();
	void DrawMissionPanel();
	void DrawWanted();
	void DrawSpeedo(const ACADVehicle* V);
	void DrawPrompts();
	void DrawDialogue();
	void DrawChoices();
	void DrawToasts();
	void DrawTopBar();
	void DrawOverlay();
	void UpdateRoute();
	void DrawLoading();

	// ---- screens -------------------------------------------------------------------------------------
	void DrawMainMenu();
	void DrawPause();
	void DrawSettings();
	void DrawResults();
	void DrawBriefing();
	void DrawInventory();
	void DrawMap();
	void DrawGarage();
	void DrawShop();
	void DrawProperty();
	void DrawScreenTitle(const FString& Title, const FString& Sub = FString());
	void DrawBackdrop(float Alpha);
	void SettingRow(float X, float& Y, float Wd, const FString& Label, const FString& Value, TFunction<void()> Minus, TFunction<void()> Plus);

	// map transforms
	FVector2D MapToScreen(const FVector& World) const;
	FVector WorldFromMapScreen(const FVector2D& P) const;
	FBox2D MapRect() const;
};
