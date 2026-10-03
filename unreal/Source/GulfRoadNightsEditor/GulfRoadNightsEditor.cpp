#include "Modules/ModuleManager.h"

// No module class of its own: everything this module does hangs off
// UGRNPaintEditorSubsystem (created by the editor when it starts) and
// UGRNBuildPaintCommandlet (created by -run=GRNBuildPaint).
IMPLEMENT_MODULE(FDefaultModuleImpl, GulfRoadNightsEditor);
