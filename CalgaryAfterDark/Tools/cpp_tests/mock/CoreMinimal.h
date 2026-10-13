// Minimal stand-in for the handful of Unreal types used by the engine-independent core
// (CADRoadNetwork, CADTerrain, CADTypes). ONLY for the offline test in Tools/cpp_tests - never used by the game build.
#pragma once
#include <vector>
#include <unordered_map>
#include <unordered_set>
#include <string>
#include <cmath>
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <functional>
#include <limits>
#include <initializer_list>

typedef int32_t int32; typedef uint8_t uint8; typedef uint32_t uint32; typedef int64_t int64; typedef uint64_t uint64;
typedef char TCHAR;
#define TEXT(x) x
#define USTRUCT(...)
#define UPROPERTY(...)
#define UENUM(...)
#define UCLASS(...)
#define GENERATED_BODY()
#define CALGARYAFTERDARK_API
#define INDEX_NONE (-1)
#define UE_LOG(...)
#define DECLARE_LOG_CATEGORY_EXTERN(...)
#define DEFINE_LOG_CATEGORY(...)
#define PI 3.14159265358979323846

struct FString
{
	std::string S;
	FString() {}
	FString(const char* C) : S(C) {}
	FString(const std::string& C) : S(C) {}
	bool operator==(const FString& O) const { return S == O.S; }
	bool IsEmpty() const { return S.empty(); }
	const char* operator*() const { return S.c_str(); }
};
struct FName { std::string S; bool operator!=(const FName& O) const { return S != O.S; } FName() {} FName(const char* C) : S(C) {} FName(const std::string& C) : S(C) {} bool operator==(const FName& O) const { return S == O.S; } };
namespace std { template<> struct hash<FName> { size_t operator()(const FName& N) const { return hash<string>()(N.S); } }; }

struct FLinearColor { float R = 0, G = 0, B = 0, A = 1; FLinearColor() {} FLinearColor(float r, float g, float b, float a = 1) : R(r), G(g), B(b), A(a) {} };
struct FGuid { uint32 A = 0; };
struct FKey {};
struct FRotator { double Pitch = 0, Yaw = 0, Roll = 0; static FRotator ZeroRotator; };
inline FRotator FRotator::ZeroRotator;
struct FTableRowBase {};

struct FVector
{
	double X = 0, Y = 0, Z = 0;
	static FVector ZeroVector;
	FVector() {}
	FVector(double x, double y, double z) : X(x), Y(y), Z(z) {}
	FVector operator+(const FVector& O) const { return FVector(X + O.X, Y + O.Y, Z + O.Z); }
	FVector operator-(const FVector& O) const { return FVector(X - O.X, Y - O.Y, Z - O.Z); }
	FVector operator*(double S) const { return FVector(X * S, Y * S, Z * S); }
	FVector operator/(double S) const { return FVector(X / S, Y / S, Z / S); }
	FVector& operator+=(const FVector& O) { X += O.X; Y += O.Y; Z += O.Z; return *this; }
	double Size() const { return std::sqrt(X * X + Y * Y + Z * Z); }
	double SizeSquared() const { return X * X + Y * Y + Z * Z; }
	double Size2D() const { return std::sqrt(X * X + Y * Y); }
	static double Dist(const FVector& A, const FVector& B) { return (A - B).Size(); }
	static double Dist2D(const FVector& A, const FVector& B) { return (A - B).Size2D(); }
	static double DistSquared(const FVector& A, const FVector& B) { return (A - B).SizeSquared(); }
	static double DotProduct(const FVector& A, const FVector& B) { return A.X * B.X + A.Y * B.Y + A.Z * B.Z; }
	FVector GetSafeNormal() const { double S = Size(); return S > 1e-8 ? *this / S : FVector(); }
	bool IsZero() const { return X == 0 && Y == 0 && Z == 0; }
};
inline FVector FVector::ZeroVector;
inline FVector operator*(double S, const FVector& V) { return V * S; }

struct FVector2D
{
	double X = 0, Y = 0;
	FVector2D() {}
	FVector2D(double x, double y) : X(x), Y(y) {}
	FVector2D operator+(const FVector2D& O) const { return FVector2D(X + O.X, Y + O.Y); }
	FVector2D operator-(const FVector2D& O) const { return FVector2D(X - O.X, Y - O.Y); }
	FVector2D operator-() const { return FVector2D(-X, -Y); }
	FVector2D operator*(double S) const { return FVector2D(X * S, Y * S); }
	FVector2D operator/(double S) const { return FVector2D(X / S, Y / S); }
	double Size() const { return std::sqrt(X * X + Y * Y); }
	double SizeSquared() const { return X * X + Y * Y; }
	FVector2D GetSafeNormal() const { double S = Size(); return S > 1e-8 ? *this / S : FVector2D(); }
	static double DotProduct(const FVector2D& A, const FVector2D& B) { return A.X * B.X + A.Y * B.Y; }
	static double Distance(const FVector2D& A, const FVector2D& B) { return (A - B).Size(); }
};

struct FIntPoint { int32 X = 0, Y = 0; FIntPoint() {} FIntPoint(int32 x, int32 y) : X(x), Y(y) { } bool operator==(const FIntPoint& O) const { return X == O.X && Y == O.Y; } };
namespace std { template<> struct hash<FIntPoint> { size_t operator()(const FIntPoint& P) const { return (size_t)P.X * 73856093u ^ (size_t)P.Y * 19349663u; } }; }

namespace FMath
{
	template<class T> T Min(T a, T b) { return a < b ? a : b; }
	template<class T> T Max(T a, T b) { return a > b ? a : b; }
	template<class T> T Min3(T a, T b, T c) { return Min(a, Min(b, c)); }
	template<class T> T Max3(T a, T b, T c) { return Max(a, Max(b, c)); }
	template<class T> T Clamp(T v, T lo, T hi) { return v < lo ? lo : (v > hi ? hi : v); }
	inline float Lerp(float a, float b, float t) { return a + (b - a) * t; }
	inline FVector Lerp(const FVector& a, const FVector& b, float t) { return a + (b - a) * t; }
	template<class T> T Square(T v) { return v * v; }
	inline float Sqrt(float v) { return std::sqrt(v); }
	inline float Abs(float v) { return std::fabs(v); }
	inline double Abs(double v) { return std::fabs(v); }
	inline float Atan2(float y, float x) { return std::atan2(y, x); }
	inline float Acos(float v) { return std::acos(v); }
	inline float Cos(float v) { return std::cos(v); }
	inline float Sin(float v) { return std::sin(v); }
	inline float Fmod(float a, float b) { return std::fmod(a, b); }
	inline float Exp(float v) { return std::exp(v); }
	inline int32 FloorToInt(float v) { return (int32)std::floor(v); }
	inline int32 RoundToInt(float v) { return (int32)std::lround(v); }
	inline float DegreesToRadians(float d) { return d * (float)PI / 180.f; }
	inline float RadiansToDegrees(float r) { return r * 180.f / (float)PI; }
	inline bool IsNearlyZero(float v) { return std::fabs(v) < 1e-4f; }
}

template<class T> struct TNumericLimits { static T Max() { return std::numeric_limits<T>::max(); } };
template<class A, class B> struct TPair { A Key; B Value; };

template<class T>
struct TArray : std::vector<T>
{
	using std::vector<T>::vector;
	TArray() {}
	TArray(std::initializer_list<T> I) : std::vector<T>(I) {}
	int32 Num() const { return (int32)this->size(); }
	int32 Add(const T& V) { this->push_back(V); return Num() - 1; }
	void Reset() { this->clear(); }
	void Append(const TArray& O) { this->insert(this->end(), O.begin(), O.end()); }
	bool IsValidIndex(int32 I) const { return I >= 0 && I < Num(); }
	T& operator[](int32 I) { return std::vector<T>::operator[](I); }
	const T& operator[](int32 I) const { return std::vector<T>::operator[](I); }
	T& Last() { return this->back(); }
	void Init(const T& V, int32 N) { this->assign(N, V); }
	bool Contains(const T& V) const { return std::find(this->begin(), this->end(), V) != this->end(); }
	int32 AddUnique(const T& V) { if (!Contains(V)) { this->push_back(V); } return Num() - 1; }
	template<class P> void HeapPush(const T& V, P Pred) { this->push_back(V); std::push_heap(this->begin(), this->end(), [&](const T& a, const T& b) { return Pred(b, a); }); }
	template<class P> void HeapPop(T& Out, P Pred) { std::pop_heap(this->begin(), this->end(), [&](const T& a, const T& b) { return Pred(b, a); }); Out = this->back(); this->pop_back(); }
};
template<class T> struct TSet : std::unordered_set<T> { void Add(const T& V, bool* bAlready = nullptr) { auto R = this->insert(V); if (bAlready) *bAlready = !R.second; } bool Contains(const T& V) const { return this->count(V) > 0; } };
template<class K, class V> struct TMap : std::unordered_map<K, V>
{
	V& FindOrAdd(const K& k) { return (*this)[k]; }
	V* Find(const K& k) { auto it = this->find(k); return it == this->end() ? nullptr : &it->second; }
	const V* Find(const K& k) const { auto it = this->find(k); return it == this->end() ? nullptr : &it->second; }
	void Reset() { this->clear(); }
};
template<int = 0> struct TBitArray { std::vector<char> D; TBitArray(bool v, int32 n) : D(n, v) {} char& operator[](int32 i) { return D[i]; } };
namespace Algo { template<class C> void Reverse(C& c) { std::reverse(c.begin(), c.end()); } }
