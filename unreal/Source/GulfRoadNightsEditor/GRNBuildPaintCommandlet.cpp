#include "GRNBuildPaintCommandlet.h"
#include "GRNPaintBuilder.h"
#include "Misc/Parse.h"

DEFINE_LOG_CATEGORY_STATIC(LogGRNBuildPaint, Log, All);

UGRNBuildPaintCommandlet::UGRNBuildPaintCommandlet()
{
	IsClient = false;
	IsServer = false;
	IsEditor = true;
	LogToConsole = true;
}

int32 UGRNBuildPaintCommandlet::Main(const FString& Params)
{
	const bool bForce = FParse::Param(*Params, TEXT("force"));
	FString Message;
	const GRNPaintBuilder::EResult Result = GRNPaintBuilder::Build(bForce, Message);
	const bool bOk = Result == GRNPaintBuilder::EResult::Built || Result == GRNPaintBuilder::EResult::AlreadyThere;
	if (bOk)
	{
		UE_LOG(LogGRNBuildPaint, Display, TEXT("GRNBuildPaint: %s — %s"), GRNPaintBuilder::ResultName(Result), *Message);
	}
	else
	{
		UE_LOG(LogGRNBuildPaint, Error, TEXT("GRNBuildPaint: %s — %s"), GRNPaintBuilder::ResultName(Result), *Message);
	}
	return bOk ? 0 : 1;
}
