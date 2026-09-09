#include "GRNApi.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Misc/Parse.h"
#include "GenericPlatform/GenericPlatformHttp.h"
#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "HAL/IConsoleManager.h"

DEFINE_LOG_CATEGORY(LogGRNApi);

namespace
{
	EGRNBodyStyle StyleFromString(const FString& S)
	{
		if (S == TEXT("zx")) return EGRNBodyStyle::ZX;
		if (S == TEXT("gtr")) return EGRNBodyStyle::GTR;
		if (S == TEXT("rx7")) return EGRNBodyStyle::RX7;
		return EGRNBodyStyle::Sedan;
	}

	/** "#rrggbb" → FColor. Falls back to white on anything unexpected. */
	FColor ColorFromHex(const FString& Hex)
	{
		FString H = Hex;
		H.RemoveFromStart(TEXT("#"));
		if (H.Len() != 6) return FColor::White;
		return FColor(
			(uint8)FParse::HexNumber(*H.Mid(0, 2)),
			(uint8)FParse::HexNumber(*H.Mid(2, 2)),
			(uint8)FParse::HexNumber(*H.Mid(4, 2)));
	}
}

void UGRNApiSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	// Command line wins, so QA can point a build at staging without a rebuild
	FString Arg;
	if (FParse::Value(FCommandLine::Get(), TEXT("grnapi="), Arg) && !Arg.IsEmpty()) BaseUrl = Arg;
	if (FParse::Value(FCommandLine::Get(), TEXT("grnhub="), Arg) && !Arg.IsEmpty()) HubUrl = Arg;
	BaseUrl.RemoveFromEnd(TEXT("/"));
	HubUrl.RemoveFromEnd(TEXT("/"));
}

void UGRNApiSubsystem::FetchGameData()
{
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Req = FHttpModule::Get().CreateRequest();
	Req->SetURL(BaseUrl + TEXT("/api/grn/v1/gamedata"));
	Req->SetVerb(TEXT("GET"));
	Req->SetHeader(TEXT("Accept"), TEXT("application/json"));
	Req->SetTimeout(6.f); // never hold the boot screen hostage

	TWeakObjectPtr<UGRNApiSubsystem> Weak(this);
	Req->OnProcessRequestComplete().BindLambda(
		[Weak](FHttpRequestPtr, FHttpResponsePtr Res, bool bOk)
		{
			UGRNApiSubsystem* Self = Weak.Get();
			if (!Self) return;
			if (bOk && Res.IsValid() && Res->GetResponseCode() == 200)
			{
				Self->ParseGameData(Res->GetContentAsString());
			}
			else
			{
				const int32 Code = Res.IsValid() ? Res->GetResponseCode() : 0;
				Self->LastResponseCode = Code;
				// Code 0 means the request never reached a server at all.
				// On macOS that is overwhelmingly App Transport Security
				// refusing a cleartext http:// URL from a packaged build,
				// and it is worth naming, because the alternative is a
				// developer concluding the server is down when it is up.
				Self->LastError =
					Code == 0
						? FString::Printf(
							  TEXT("no response from %s — server not running, wrong host, or (on a packaged ")
							  TEXT("macOS build) App Transport Security refusing cleartext http://"),
							  *Self->BaseUrl)
						: FString::Printf(TEXT("HTTP %d from %s"), Code, *Self->BaseUrl);
				UE_LOG(LogGRNApi, Warning, TEXT("game data fetch failed: %s — using baked tables"),
					*Self->LastError);
				Self->FinishReady(false);
			}
		});
	Req->ProcessRequest();
}

void UGRNApiSubsystem::ParseGameData(const FString& Json)
{
	TSharedPtr<FJsonObject> Root;
	const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Json);
	if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
	{
		LastError = TEXT("the reply was not JSON this build could read");
		UE_LOG(LogGRNApi, Warning, TEXT("malformed payload — using baked tables"));
		FinishReady(false);
		return;
	}

	// A payload we do not understand is worse than no payload
	const int32 Version = Root->GetIntegerField(TEXT("apiVersion"));
	if (Version != GRN_API_VERSION)
	{
		LastError = FString::Printf(
			TEXT("server serves apiVersion %d, this build understands %d"), Version, GRN_API_VERSION);
		UE_LOG(LogGRNApi, Warning, TEXT("%s — using baked tables"), *LastError);
		FinishReady(false);
		return;
	}

	Rivals.Reset();
	Cars.Reset();
	TrackPoints.Reset();

	const TArray<TSharedPtr<FJsonValue>>* RivalArr = nullptr;
	if (Root->TryGetArrayField(TEXT("rivals"), RivalArr))
	{
		for (const TSharedPtr<FJsonValue>& V : *RivalArr)
		{
			const TSharedPtr<FJsonObject> O = V->AsObject();
			if (!O.IsValid()) continue;
			FGRNRuntimeRival R;
			R.Id = O->GetStringField(TEXT("id"));
			R.Name = O->GetStringField(TEXT("name"));
			R.ArabicName = O->GetStringField(TEXT("arabicName"));
			R.Crew = O->GetStringField(TEXT("crew"));
			R.Area = O->GetStringField(TEXT("area"));
			R.BodyColor = ColorFromHex(O->GetStringField(TEXT("bodyColor")));
			R.TopSpeedKmh = (float)O->GetNumberField(TEXT("topSpeedKmh"));
			R.PrizeKd = O->GetIntegerField(TEXT("prizeKd"));
			R.Style = StyleFromString(O->GetStringField(TEXT("bodyStyle")));
			Rivals.Add(MoveTemp(R));
		}
	}

	const TArray<TSharedPtr<FJsonValue>>* CarArr = nullptr;
	if (Root->TryGetArrayField(TEXT("cars"), CarArr))
	{
		for (const TSharedPtr<FJsonValue>& V : *CarArr)
		{
			const TSharedPtr<FJsonObject> O = V->AsObject();
			if (!O.IsValid()) continue;
			FGRNRuntimeCar C;
			C.Id = O->GetStringField(TEXT("id"));
			C.Name = O->GetStringField(TEXT("name"));
			C.Price = O->GetIntegerField(TEXT("price"));
			C.Power = (float)O->GetNumberField(TEXT("power"));
			C.TopSpeedKmh = (float)O->GetNumberField(TEXT("topSpeedKmh"));
			C.Grip = (float)O->GetNumberField(TEXT("grip"));
			C.Brake = (float)O->GetNumberField(TEXT("brake"));
			C.Paint = ColorFromHex(O->GetStringField(TEXT("color")));
			C.Style = StyleFromString(O->GetStringField(TEXT("bodyStyle")));
			FString Kit;
			C.bAttackKit = O->TryGetStringField(TEXT("kit"), Kit) && Kit == TEXT("attack");
			Cars.Add(MoveTemp(C));
		}
	}

	// Track points arrive in web space (metres, x/z); convert to UE
	// (centimetres, z→X and x→Y) exactly like AGRNTrack does.
	const TSharedPtr<FJsonObject>* TrackObj = nullptr;
	if (Root->TryGetObjectField(TEXT("track"), TrackObj))
	{
		const TArray<TSharedPtr<FJsonValue>>* Pts = nullptr;
		if ((*TrackObj)->TryGetArrayField(TEXT("controlPoints"), Pts))
		{
			for (const TSharedPtr<FJsonValue>& V : *Pts)
			{
				const TSharedPtr<FJsonObject> O = V->AsObject();
				if (!O.IsValid()) continue;
				TrackPoints.Add(FVector(
					GRN_M((float)O->GetNumberField(TEXT("z"))),
					GRN_M((float)O->GetNumberField(TEXT("x"))),
					0.f));
			}
		}
	}

	// A half-parsed payload is a trap: demand a usable roster before
	// letting live data override the tables we know are good.
	if (Rivals.Num() == 0 || Cars.Num() == 0)
	{
		LastError = TEXT("the payload parsed but carried no rivals, cars or track");
		UE_LOG(LogGRNApi, Warning, TEXT("payload missing tables — using baked"));
		Rivals.Reset();
		Cars.Reset();
		TrackPoints.Reset();
		FinishReady(false);
		return;
	}

	bLive = true;
	UE_LOG(LogGRNApi, Log, TEXT("live data — %d rivals, %d cars, %d track points"),
		Rivals.Num(), Cars.Num(), TrackPoints.Num());
	FinishReady(true);
}

namespace
{
	/**
	 * `GRN.Api.Status` in the console.
	 *
	 * One command, because "is this build actually talking to the web
	 * server" is a question that gets asked on every machine the port is
	 * moved to, and the honest answer needs the URL, the outcome and the
	 * reason together. Before this it was three log lines in LogTemp and
	 * a guess.
	 *
	 * Walks the worlds rather than taking one, so it answers from the
	 * editor, from Play-In-Editor and from a packaged build without
	 * caring which it is in.
	 */
	void GRNApiStatusCommand(const TArray<FString>&, UWorld* World, FOutputDevice& Ar)
	{
		const UGameInstance* GI = World ? World->GetGameInstance() : nullptr;
		const UGRNApiSubsystem* Api = GI ? GI->GetSubsystem<UGRNApiSubsystem>() : nullptr;
		if (!Api)
		{
			Ar.Logf(TEXT("GRN.Api: no subsystem in this world — is this the editor with no PIE running?"));
			return;
		}
		Ar.Logf(TEXT("GRN.Api: %s"), *Api->StatusLine());
		Ar.Logf(TEXT("GRN.Api: data %s, hub %s"), *Api->BaseUrl, *Api->HubUrl);
		Ar.Logf(TEXT("GRN.Api: point elsewhere with -grnapi=<url> -grnhub=<url> on the command line"));
	}

	FAutoConsoleCommandWithWorldArgsAndOutputDevice GRNApiStatusCmd(
		TEXT("GRN.Api.Status"),
		TEXT("Where the game's tables came from: the web server, or the ones baked into this build."),
		FConsoleCommandWithWorldArgsAndOutputDeviceDelegate::CreateStatic(
			[](const TArray<FString>& Args, UWorld* World, FOutputDevice& Ar)
			{
				GRNApiStatusCommand(Args, World, Ar);
			}));
}

FString UGRNApiSubsystem::StatusLine() const
{
	if (!bReady) return FString::Printf(TEXT("not ready — still asking %s"), *BaseUrl);
	if (bLive)
	{
		return FString::Printf(
			TEXT("LIVE from %s — %d rivals, %d cars, %d track points"),
			*BaseUrl, Rivals.Num(), Cars.Num(), TrackPoints.Num());
	}
	return FString::Printf(
		TEXT("BAKED tables (%d rivals, %d cars) — %s"),
		GRNRivalCount, GRNCarCount,
		LastError.IsEmpty() ? TEXT("no reason recorded") : *LastError);
}

void UGRNApiSubsystem::FinishReady(bool bFromNetwork)
{
	bReady = true;
	// Said once, at the volume the answer deserves. A game running on
	// the baked tables because it could not reach the server is not a
	// detail, and a Log line among a thousand others is where that fact
	// went to die before this.
	UE_LOG(LogGRNApi, Display, TEXT("%s"), *StatusLine());
	OnGameDataReady.Broadcast(bFromNetwork);
}

int32 UGRNApiSubsystem::NumRivals() const
{
	return bLive ? Rivals.Num() : GRNRivalCount;
}

FGRNRuntimeRival UGRNApiSubsystem::GetRival(int32 Index) const
{
	if (bLive && Rivals.IsValidIndex(Index)) return Rivals[Index];

	// Baked fallback, presented through the same struct
	const int32 I = FMath::Clamp(Index, 0, GRNRivalCount - 1);
	const FGRNRivalDef& D = GRNRivals[I];
	FGRNRuntimeRival R;
	R.Name = D.Name;
	R.ArabicName = D.ArabicName;
	R.Crew = D.Crew;
	R.Area = D.Area;
	R.BodyColor = D.BodyColor;
	R.TopSpeedKmh = D.TopSpeedKmh;
	R.PrizeKd = 400 + I * 300;
	R.Style = D.Style;
	return R;
}

int32 UGRNApiSubsystem::NumCars() const
{
	return bLive ? Cars.Num() : GRNCarCount;
}

FGRNRuntimeCar UGRNApiSubsystem::GetCar(int32 Index) const
{
	if (bLive && Cars.IsValidIndex(Index)) return Cars[Index];

	const int32 I = FMath::Clamp(Index, 0, GRNCarCount - 1);
	const FGRNCarDef& D = GRNCars[I];
	FGRNRuntimeCar C;
	C.Id = D.Id;
	C.Name = D.Name;
	C.Price = D.Price;
	C.Power = D.Power;
	C.TopSpeedKmh = D.TopSpeedKmh;
	C.Grip = D.Grip;
	C.Brake = D.Brake;
	C.Paint = D.Paint;
	C.Style = D.Style;
	C.bAttackKit = D.bAttackKit;
	return C;
}

// ------------------------------------------------------------ hub writes

void UGRNApiSubsystem::SubmitLap(const FString& PlayerName, int32 LapMs)
{
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Req = FHttpModule::Get().CreateRequest();
	Req->SetURL(HubUrl + TEXT("/api/v1/lap"));
	Req->SetVerb(TEXT("POST"));
	Req->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Req->SetContentAsString(FString::Printf(
		TEXT("{\"name\":\"%s\",\"ms\":%d}"), *PlayerName.Left(24), LapMs));
	Req->SetTimeout(5.f);
	Req->ProcessRequest(); // fire and forget: a lost lap must never stall a race
}

void UGRNApiSubsystem::PushCareer(const FString& PlayerName, int32 RivalIndex, int32 Kd, int32 Xp)
{
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Req = FHttpModule::Get().CreateRequest();
	Req->SetURL(HubUrl + TEXT("/api/v1/career/") + FGenericPlatformHttp::UrlEncode(PlayerName));
	Req->SetVerb(TEXT("PUT"));
	Req->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Req->SetContentAsString(FString::Printf(
		TEXT("{\"rivalIndex\":%d,\"kd\":%d,\"xp\":%d}"), RivalIndex, Kd, Xp));
	Req->SetTimeout(5.f);
	Req->ProcessRequest();
}

void UGRNApiSubsystem::PullCareer(const FString& PlayerName, FGRNOnCareerPulled Done)
{
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Req = FHttpModule::Get().CreateRequest();
	Req->SetURL(HubUrl + TEXT("/api/v1/career/") + FGenericPlatformHttp::UrlEncode(PlayerName));
	Req->SetVerb(TEXT("GET"));
	Req->SetTimeout(5.f);
	Req->OnProcessRequestComplete().BindLambda(
		[Done](FHttpRequestPtr, FHttpResponsePtr Res, bool bOk)
		{
			if (!bOk || !Res.IsValid() || Res->GetResponseCode() != 200)
			{
				Done.ExecuteIfBound(false, 0, 0);
				return;
			}
			TSharedPtr<FJsonObject> Root;
			const TSharedRef<TJsonReader<>> R = TJsonReaderFactory<>::Create(Res->GetContentAsString());
			const TSharedPtr<FJsonObject>* Career = nullptr;
			if (FJsonSerializer::Deserialize(R, Root) && Root.IsValid() &&
				Root->TryGetObjectField(TEXT("career"), Career))
			{
				Done.ExecuteIfBound(true,
					(*Career)->GetIntegerField(TEXT("rivalIndex")),
					(*Career)->GetIntegerField(TEXT("kd")));
			}
			else
			{
				Done.ExecuteIfBound(false, 0, 0);
			}
		});
	Req->ProcessRequest();
}
