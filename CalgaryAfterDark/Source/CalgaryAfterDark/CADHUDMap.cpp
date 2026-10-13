// Full-screen city map for ACADHUD.
#include "CADHUD.h"
#include "CADDataSubsystem.h"
#include "CADEnvironmentSubsystem.h"
#include "CADGameInstance.h"
#include "CADGameMode.h"
#include "CADMissionSubsystem.h"
#include "CADPlayerController.h"
#include "CADPoliceSubsystem.h"
#include "CADTerrain.h"
#include "CADVehicle.h"
#include "CalgaryAfterDark.h"
#include "Engine/Canvas.h"
#include "Engine/World.h"
#include "GameFramework/PlayerInput.h"

namespace
{
	const FLinearColor Amber(1.f, 0.69f, 0.13f);
	const FLinearColor Teal(0.2f, 0.82f, 0.76f);
	const FLinearColor TextCol(0.93f, 0.95f, 0.98f);
	const FLinearColor Dim(0.6f, 0.66f, 0.74f);
}

FBox2D ACADHUD::MapRect() const { return FBox2D(FVector2D(0, 0), FVector2D(W - 330.f * S, H)); }

FVector2D ACADHUD::MapToScreen(const FVector& Wp) const
{
	const FBox2D R = MapRect();
	const FVector2D C = (R.Min + R.Max) * 0.5f;
	const float PxPerCm = MapZoom / 100.f;
	return C + FVector2D(Wp.X - MapCenter.X, Wp.Y - MapCenter.Y) * PxPerCm;
}

FVector ACADHUD::WorldFromMapScreen(const FVector2D& P) const
{
	const FBox2D R = MapRect();
	const FVector2D C = (R.Min + R.Max) * 0.5f;
	const float PxPerCm = MapZoom / 100.f;
	const FVector2D D = (P - C) / PxPerCm;
	return FVector(MapCenter.X + D.X, MapCenter.Y + D.Y, 0.f);
}

void ACADHUD::DrawMap()
{
	if (!Data || !PC || !PC->GetPawn()) return;
	const APawn* P = PC->GetPawn();
	static double LastTime = 0.0;
	const float Dt = static_cast<float>(CADMath::Clamp(Now - LastTime, 0.0, 0.1));
	LastTime = Now;
	if (!bMapInit)
	{
		bMapInit = true;
		MapCenter = FVector2D(P->GetActorLocation().X, P->GetActorLocation().Y);
		MapZoom = 0.13f * S;
	}
	// continuous panning with WASD / arrows / left stick
	{
		const float Speed = 700.f * Dt / (MapZoom / 100.f);
		FVector2D Pan(0, 0);
		if (PC->IsInputKeyDown(EKeys::W) || PC->IsInputKeyDown(EKeys::Up)) Pan.Y -= 1.f;
		if (PC->IsInputKeyDown(EKeys::S) || PC->IsInputKeyDown(EKeys::Down)) Pan.Y += 1.f;
		if (PC->IsInputKeyDown(EKeys::A) || PC->IsInputKeyDown(EKeys::Left)) Pan.X -= 1.f;
		if (PC->IsInputKeyDown(EKeys::D) || PC->IsInputKeyDown(EKeys::Right)) Pan.X += 1.f;
		Pan.X += PC->GetInputAnalogKeyState(EKeys::Gamepad_LeftX);
		Pan.Y -= PC->GetInputAnalogKeyState(EKeys::Gamepad_LeftY);
		MapCenter += Pan * Speed;
		const float Zs = PC->GetInputAnalogKeyState(EKeys::Gamepad_RightY);
		if (FMath::Abs(Zs) > 0.2f) MapZoom = CADMath::Clamp(MapZoom * (1.f + Zs * Dt * 1.5f), 0.04f, 3.f);
	}
	MapZoom = CADMath::Clamp(MapZoom, 0.04f, 3.f);

	const FBox2D R = MapRect();
	Rect(0, 0, W, H, FLinearColor(0.045f, 0.075f, 0.06f, 1.f));
	Rect(R.Min.X, R.Min.Y, R.Max.X - R.Min.X, R.Max.Y - R.Min.Y, FLinearColor(0.07f, 0.11f, 0.08f, 1.f));

	// city boundary
	{
		const float B = CADTerrain::RingHalfExtent;
		const FVector2D A = MapToScreen(FVector(-B, -B, 0)), Bq = MapToScreen(FVector(B, -B, 0)), C = MapToScreen(FVector(B, B, 0)), D = MapToScreen(FVector(-B, B, 0));
		Rect(CADMath::Max(A.X, R.Min.X), CADMath::Max(A.Y, R.Min.Y), CADMath::Max(0.f, CADMath::Min(C.X, R.Max.X) - CADMath::Max(A.X, R.Min.X)), CADMath::Max(0.f, CADMath::Min(C.Y, R.Max.Y) - CADMath::Max(A.Y, R.Min.Y)), FLinearColor(0.09f, 0.14f, 0.1f, 1.f));
		Line2(A, Bq, FLinearColor(1, 1, 1, 0.1f), 1.f); Line2(Bq, C, FLinearColor(1, 1, 1, 0.1f), 1.f); Line2(C, D, FLinearColor(1, 1, 1, 0.1f), 1.f); Line2(D, A, FLinearColor(1, 1, 1, 0.1f), 1.f);
	}
	auto Visible = [&](const FVector2D& A, const FVector2D& B)
	{
		return !(CADMath::Max(A.X, B.X) < R.Min.X || CADMath::Min(A.X, B.X) > R.Max.X || CADMath::Max(A.Y, B.Y) < R.Min.Y || CADMath::Min(A.Y, B.Y) > R.Max.Y);
	};
	auto ClipRect = [&](FVector2D& A, FVector2D& B) -> bool
	{
		// Liang-Barsky against the map rectangle
		float T0 = 0.f, T1 = 1.f;
		const FVector2D D = B - A;
		const float P[4] = { -D.X, D.X, -D.Y, D.Y };
		const float Q[4] = { A.X - R.Min.X, R.Max.X - A.X, A.Y - R.Min.Y, R.Max.Y - A.Y };
		for (int32 i = 0; i < 4; ++i)
		{
			if (FMath::IsNearlyZero(P[i])) { if (Q[i] < 0.f) return false; }
			else
			{
				const float Tt = Q[i] / P[i];
				if (P[i] < 0.f) { if (Tt > T1) return false; T0 = CADMath::Max(T0, Tt); }
				else { if (Tt < T0) return false; T1 = CADMath::Min(T1, Tt); }
			}
		}
		const FVector2D NA = A + D * T0, NB = A + D * T1;
		A = NA; B = NB;
		return true;
	};

	// district labels
	struct FLabel { const TCHAR* Name; float X, Y; };
	static const FLabel Labels[] = { { TEXT("DOWNTOWN"), 0, -250 }, { TEXT("BELTLINE"), -100, 900 }, { TEXT("INDUSTRIAL"), 2700, 1100 }, { TEXT("AIRPORT DISTRICT"), 2600, -2700 },
		{ TEXT("SOUTH SUBURBS"), -700, 2900 }, { TEXT("WEST SUBURBS"), -2700, 500 }, { TEXT("NORTH BANK"), -100, -1800 }, { TEXT("FOOTHILLS"), -4250, 300 }, { TEXT("PRAIRIE"), 4100, 1500 } };
	for (const FLabel& L : Labels)
	{
		const FVector2D Sp = MapToScreen(FVector(L.X * CADM, L.Y * CADM, 0));
		if (Sp.X > R.Min.X && Sp.X < R.Max.X && Sp.Y > R.Min.Y && Sp.Y < R.Max.Y) Txt(L.Name, Sp.X, Sp.Y - 6.f * S, 1.1f, FLinearColor(1, 1, 1, 0.22f), 1, false);
	}

	// river
	const TArray<FVector>& River = CADTerrain::GetRiver();
	for (int32 i = 0; i + 1 < River.Num(); ++i)
	{
		FVector2D A = MapToScreen(FVector(River[i].X, River[i].Y, 0)), B = MapToScreen(FVector(River[i + 1].X, River[i + 1].Y, 0));
		if (!Visible(A, B) || !ClipRect(A, B)) continue;
		Line2(A, B, FLinearColor(0.16f, 0.38f, 0.62f), CADMath::Max(3.f, River[i].Z * 2.f * MapZoom / 100.f));
	}
	Txt(TEXT("Bow River"), MapToScreen(FVector(-1500.f * CADM, -950.f * CADM, 0)).X, MapToScreen(FVector(-1500.f * CADM, -950.f * CADM, 0)).Y - 24.f * S, 0.8f, FLinearColor(0.5f, 0.75f, 1.f, 0.7f), 1, false);

	// roads, level of detail by zoom
	const int32 Detail = MapZoom < 0.075f ? 0 : (MapZoom < 0.22f ? 1 : 2);
	for (int32 Pass = 0; Pass < 3; ++Pass)
	{
		for (const FCADRoadEdge& E : Data->Network.Edges)
		{
			int32 EdgePass; FLinearColor Col; float T;
			switch (E.Kind)
			{
			case ECADRoadKind::Highway: EdgePass = 2; Col = FLinearColor(0.95f, 0.48f, 0.2f); T = 5.f; break;
			case ECADRoadKind::Expressway: EdgePass = 2; Col = FLinearColor(0.95f, 0.7f, 0.25f); T = 4.f; break;
			case ECADRoadKind::Ramp: EdgePass = 2; Col = FLinearColor(0.7f, 0.5f, 0.9f); T = 3.f; break;
			case ECADRoadKind::Arterial: EdgePass = 1; Col = FLinearColor(0.85f, 0.87f, 0.9f); T = 3.f; break;
			case ECADRoadKind::Industrial: EdgePass = 1; Col = FLinearColor(0.62f, 0.58f, 0.48f); T = 2.5f; break;
			case ECADRoadKind::Collector: EdgePass = 1; Col = FLinearColor(0.6f, 0.64f, 0.7f); T = 2.f; break;
			case ECADRoadKind::Path: EdgePass = 0; Col = FLinearColor(0.3f, 0.75f, 0.45f, 0.8f); T = 1.2f; break;
			default: EdgePass = 0; Col = FLinearColor(0.42f, 0.46f, 0.52f); T = 1.4f; break;
			}
			if (EdgePass != Pass) continue;
			if (Detail == 0 && Pass < 1) continue;
			if (Detail == 1 && Pass == 0) continue;
			FVector2D A = MapToScreen(Data->Network.Nodes[E.A].Pos), B = MapToScreen(Data->Network.Nodes[E.B].Pos);
			if (!Visible(A, B) || !ClipRect(A, B)) continue;
			if (E.bBridge) Col = FLinearColor(0.75f, 0.88f, 1.f);
			Line2(A, B, Col, CADMath::Max(1.f, T * S * (0.5f + CADMath::Min(MapZoom, 1.f) * 1.5f)));
		}
	}

	// route
	for (int32 i = 0; i + 1 < RouteLine.Num(); ++i)
	{
		FVector2D A = MapToScreen(RouteLine[i]), B = MapToScreen(RouteLine[i + 1]);
		if (Visible(A, B) && ClipRect(A, B)) Line2(A, B, FLinearColor(1.f, 0.2f, 0.8f), 3.5f * S);
	}

	// locations with hover tooltip
	float MX = 0, MY = 0;
	const bool bMouse = PC->GetMousePosition(MX, MY);
	const FVector2D Mouse(MX, MY);
	FString Tip; FVector TipPos = FVector::ZeroVector; bool bTip = false;
	for (const FName& Id : Data->LocationOrder)
	{
		const FCADLocationRow& L = Data->Locations[Id];
		FLinearColor Col; bool bAlways = true;
		if (L.Kind == TEXT("Giver")) Col = FLinearColor(1.f, 0.8f, 0.1f);
		else if (L.Kind == TEXT("Shop")) Col = FLinearColor(0.25f, 0.6f, 1.f);
		else if (L.Kind == TEXT("Garage")) Col = FLinearColor(1.f, 0.5f, 0.1f);
		else if (L.Kind == TEXT("Property")) Col = FLinearColor(0.3f, 0.9f, 0.4f);
		else if (L.Kind == TEXT("Police")) Col = FLinearColor(0.35f, 0.45f, 1.f);
		else if (L.Kind == TEXT("Hospital")) Col = FLinearColor(1.f, 0.4f, 0.7f);
		else if (L.Kind == TEXT("Landmark") || L.Kind == TEXT("Overlook")) { Col = FLinearColor(0.7f, 0.5f, 0.95f); bAlways = GI->Profile.Discovered.Contains(Id) || MapZoom > 0.08f; }
		else continue;
		const FVector Wp(L.X * CADM, L.Y * CADM, 0);
		const FVector2D Sp = MapToScreen(Wp);
		if (Sp.X < R.Min.X || Sp.X > R.Max.X || Sp.Y < R.Min.Y || Sp.Y > R.Max.Y || !bAlways) continue;
		Diamond(Sp, 7.f * S, Col);
		if (MapZoom > 0.09f) Txt(L.DisplayName, Sp.X + 11.f * S, Sp.Y - 8.f * S, 0.7f, FLinearColor(Col.R, Col.G, Col.B, 0.95f));
		if (bMouse && (Sp - Mouse).Size() < 12.f * S && !bTip) { bTip = true; Tip = L.DisplayName; TipPos = Wp; }
	}
	if (Mis && Mis->bActive)
	{
		TArray<FCADObjTarget> T; Mis->GetTargets(T);
		for (const FCADObjTarget& O : T)
		{
			const FVector2D Sp = MapToScreen(O.Pos);
			if (Sp.X < R.Min.X || Sp.X > R.Max.X || Sp.Y < R.Min.Y || Sp.Y > R.Max.Y) continue;
			Diamond(Sp, (O.bPrimary ? 10.f : 7.f) * S, O.Colour);
			Circle(Sp, 14.f * S, O.Colour, 2.f, 24);
			if (!O.Label.IsEmpty()) Txt(O.Label, Sp.X + 16.f * S, Sp.Y - 8.f * S, 0.8f, O.Colour);
		}
	}
	if (GM->bHasWaypoint)
	{
		const FVector2D Sp = MapToScreen(GM->Waypoint);
		Diamond(Sp, 10.f * S, FLinearColor(1.f, 0.2f, 0.8f));
		Line2(Sp, Sp - FVector2D(0, 24.f * S), FLinearColor(1.f, 0.2f, 0.8f), 3.f);
	}
	for (const TWeakObjectPtr<ACADVehicle>& Wv : ACADVehicle::Registry)
	{
		const ACADVehicle* V = Wv.Get();
		if (V && V->Role == ECADVehicleRole::Police && !V->bWrecked && Pol && Pol->Level() > 0) Diamond(MapToScreen(V->GetActorLocation()), 5.f * S, FLinearColor(0.3f, 0.45f, 1.f));
	}
	// player
	{
		const FVector2D C = MapToScreen(P->GetActorLocation());
		const float Ang = FMath::DegreesToRadians(P->GetActorRotation().Yaw);
		const FVector2D F(FMath::Cos(Ang), FMath::Sin(Ang)), Rt(-F.Y, F.X);
		const FVector2D Tip2 = C + F * 13.f * S, L = C - F * 8.f * S + Rt * 8.f * S, Rr = C - F * 8.f * S - Rt * 8.f * S;
		Line2(Tip2, L, FLinearColor::White, 3.f); Line2(Tip2, Rr, FLinearColor::White, 3.f); Line2(L, Rr, FLinearColor::White, 3.f);
	}
	if (bTip && bMouse)
	{
		const FVector2D Sz = TxtSize(Tip, 0.9f * S);
		Rect(MX + 14.f * S, MY + 10.f * S, Sz.X + 16.f * S, 28.f * S, FLinearColor(0.02f, 0.03f, 0.06f, 0.95f));
		Txt(Tip, MX + 22.f * S, MY + 14.f * S, 0.9f, TextCol);
	}

	// side panel / legend
	const float PX = R.Max.X;
	Rect(PX, 0, W - PX, H, FLinearColor(0.02f, 0.03f, 0.06f, 0.96f));
	Rect(PX, 0, 3.f * S, H, Amber);
	Txt(TEXT("CITY MAP"), PX + 24.f * S, 24.f * S, 2.0f, Amber);
	float Y = 90.f * S;
	struct FLeg { const TCHAR* Name; FLinearColor C; };
	const FLeg Legend[] = { { TEXT("Mission giver"), FLinearColor(1.f, 0.8f, 0.1f) }, { TEXT("Shop / dealership"), FLinearColor(0.25f, 0.6f, 1.f) }, { TEXT("Garage"), FLinearColor(1.f, 0.5f, 0.1f) },
		{ TEXT("Property"), FLinearColor(0.3f, 0.9f, 0.4f) }, { TEXT("Police station"), FLinearColor(0.35f, 0.45f, 1.f) }, { TEXT("Hospital"), FLinearColor(1.f, 0.4f, 0.7f) },
		{ TEXT("Landmark / overlook"), FLinearColor(0.7f, 0.5f, 0.95f) }, { TEXT("Waypoint"), FLinearColor(1.f, 0.2f, 0.8f) } };
	for (const FLeg& L : Legend) { Diamond(FVector2D(PX + 36.f * S, Y + 10.f * S), 7.f * S, L.C); Txt(L.Name, PX + 54.f * S, Y, 0.9f, TextCol); Y += 30.f * S; }
	Y += 16.f * S;
	Line2(FVector2D(PX + 24.f * S, Y + 8.f * S), FVector2D(PX + 56.f * S, Y + 8.f * S), FLinearColor(0.95f, 0.48f, 0.2f), 4.f); Txt(TEXT("Highway"), PX + 66.f * S, Y, 0.85f, TextCol); Y += 24.f * S;
	Line2(FVector2D(PX + 24.f * S, Y + 8.f * S), FVector2D(PX + 56.f * S, Y + 8.f * S), FLinearColor(0.85f, 0.87f, 0.9f), 3.f); Txt(TEXT("Arterial"), PX + 66.f * S, Y, 0.85f, TextCol); Y += 24.f * S;
	Line2(FVector2D(PX + 24.f * S, Y + 8.f * S), FVector2D(PX + 56.f * S, Y + 8.f * S), FLinearColor(0.75f, 0.88f, 1.f), 4.f); Txt(TEXT("Bridge"), PX + 66.f * S, Y, 0.85f, TextCol); Y += 24.f * S;
	Line2(FVector2D(PX + 24.f * S, Y + 8.f * S), FVector2D(PX + 56.f * S, Y + 8.f * S), FLinearColor(0.3f, 0.75f, 0.45f), 2.f); Txt(TEXT("Riverwalk path"), PX + 66.f * S, Y, 0.85f, TextCol); Y += 36.f * S;
	Txt(TEXT("Left click   set waypoint"), PX + 24.f * S, Y, 0.85f, Dim); Y += 24.f * S;
	Txt(TEXT("Right click  clear waypoint"), PX + 24.f * S, Y, 0.85f, Dim); Y += 24.f * S;
	Txt(TEXT("Wheel        zoom"), PX + 24.f * S, Y, 0.85f, Dim); Y += 24.f * S;
	Txt(TEXT("WASD/arrows  pan"), PX + 24.f * S, Y, 0.85f, Dim); Y += 40.f * S;
	if (GM->bHasWaypoint)
	{
		Txt(FString::Printf(TEXT("Waypoint: %.1f km away"), FVector::Dist2D(P->GetActorLocation(), GM->Waypoint) / 100000.f), PX + 24.f * S, Y, 0.95f, FLinearColor(1.f, 0.4f, 0.85f)); Y += 30.f * S;
	}
	if (Mis && Mis->bActive) { Txt(TEXT("MISSION"), PX + 24.f * S, Y, 0.85f, Teal); Y += 24.f * S; Txt(Mis->ObjectiveText().Left(40), PX + 24.f * S, Y, 0.85f, TextCol); }
	Button(TEXT("Close map"), PX + 24.f * S, H - 90.f * S, W - PX - 48.f * S, 50.f * S, [this]() { GM->SetState(ECADGameState::Playing); });
	if (bTip && bMouse)
	{
		// clicking an icon snaps the waypoint onto it (handled in Click: icons are within the map rect)
		(void)TipPos;
	}
}
