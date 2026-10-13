#include "CADEconomySubsystem.h"
#include "CADGameInstance.h"
#include "CADDataSubsystem.h"

UCADGameInstance* UCADEconomySubsystem::GI() const
{
	return Cast<UCADGameInstance>(GetGameInstance());
}

int32 UCADEconomySubsystem::Cash() const { return GI() ? GI()->Profile.Cash : 0; }
int32 UCADEconomySubsystem::Bank() const { return GI() ? GI()->Profile.Bank : 0; }
bool UCADEconomySubsystem::CanAfford(int32 Amount) const { return Amount >= 0 && Cash() >= Amount; }

FString UCADEconomySubsystem::Money(int32 Amount)
{
	const FString Digits = FString::FormatAsNumber(FMath::Abs(Amount));
	return FString::Printf(TEXT("%s$%s"), Amount < 0 ? TEXT("-") : TEXT(""), *Digits);
}

void UCADEconomySubsystem::Record(const FString& Reason, int32 Delta)
{
	UCADGameInstance* G = GI();
	if (!G) return;
	FCADTransaction T;
	T.Description = Reason;
	T.Amount = Delta;
	T.BalanceAfter = G->Profile.Cash;
	T.Stamp = FDateTime::Now().ToString(TEXT("%H:%M"));
	G->Profile.History.Add(T);
	if (G->Profile.History.Num() > 40) G->Profile.History.RemoveAt(0);
	OnMoney.Broadcast(Delta, Reason);
}

bool UCADEconomySubsystem::Spend(int32 Amount, const FString& Reason)
{
	UCADGameInstance* G = GI();
	if (!G || Amount < 0 || G->Profile.Cash < Amount) return false;
	G->Profile.Cash -= Amount;
	if (Amount > 0) Record(Reason, -Amount);
	return true;
}

void UCADEconomySubsystem::Earn(int32 Amount, const FString& Reason)
{
	UCADGameInstance* G = GI();
	if (!G || Amount <= 0) return;
	G->Profile.Cash = CADMath::Min(G->Profile.Cash + Amount, 999999999);
	Record(Reason, Amount);
}

bool UCADEconomySubsystem::EarnOnce(FName Key, int32 Amount, const FString& Reason)
{
	UCADGameInstance* G = GI();
	if (!G || G->Profile.RewardKeys.Contains(Key)) return false;
	G->Profile.RewardKeys.Add(Key);
	Earn(Amount, Reason);
	return true;
}

bool UCADEconomySubsystem::Deposit(int32 Amount)
{
	UCADGameInstance* G = GI();
	if (!G || Amount <= 0 || G->Profile.Cash < Amount) return false;
	G->Profile.Cash -= Amount;
	G->Profile.Bank += Amount;
	Record(TEXT("Bank deposit"), 0);
	return true;
}

bool UCADEconomySubsystem::Withdraw(int32 Amount)
{
	UCADGameInstance* G = GI();
	if (!G || Amount <= 0 || G->Profile.Bank < Amount) return false;
	G->Profile.Bank -= Amount;
	G->Profile.Cash += Amount;
	Record(TEXT("Bank withdrawal"), 0);
	return true;
}

int32 UCADEconomySubsystem::PayPropertyIncome()
{
	UCADGameInstance* G = GI();
	UCADDataSubsystem* D = G ? G->GetSubsystem<UCADDataSubsystem>() : nullptr;
	if (!G || !D) return 0;
	int32 Total = 0;
	for (const FName& P : G->Profile.OwnedProperties)
	{
		if (const FCADPropertyRow* R = D->Properties.Find(P)) Total += R->IncomePerDay;
	}
	if (Total > 0)
	{
		G->Profile.Bank += Total;
		Record(TEXT("Business income (to bank)"), 0);
		G->Toast(FString::Printf(TEXT("Business income %s deposited"), *Money(Total)));
	}
	return Total;
}
