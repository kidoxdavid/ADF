#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "CADEconomySubsystem.generated.h"

DECLARE_MULTICAST_DELEGATE_TwoParams(FCADOnMoney, int32 /*Delta*/, const FString& /*Reason*/);

/** Canadian-dollar economy: cash, bank, validated transactions, history, property income. */
UCLASS()
class CALGARYAFTERDARK_API UCADEconomySubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()
public:
	FCADOnMoney OnMoney;

	int32 Cash() const;
	int32 Bank() const;
	bool CanAfford(int32 Amount) const;
	/** Fails (returns false, nothing changes) if the player can't afford it or Amount is invalid. */
	bool Spend(int32 Amount, const FString& Reason);
	void Earn(int32 Amount, const FString& Reason);
	/** Pays at most once per Key (mission rewards, discoveries). Returns false if already paid. */
	bool EarnOnce(FName Key, int32 Amount, const FString& Reason);
	bool Deposit(int32 Amount);
	bool Withdraw(int32 Amount);
	/** Called when the in-game day changes; deposits property income into the bank. */
	int32 PayPropertyIncome();
	static FString Money(int32 Amount);

private:
	class UCADGameInstance* GI() const;
	void Record(const FString& Reason, int32 Delta);
};
