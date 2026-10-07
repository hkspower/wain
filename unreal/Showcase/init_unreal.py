# Run by the Python plugin at start-up for every directory on its path
# (run.sh puts this folder there through UE_PYTHONPATH). It defines the
# night executor only when a night render was asked for, so an ordinary
# editor session is not touched.
import unreal

if "-GRNNight=" in str(unreal.SystemLibrary.get_command_line()):
    import grn_night  # noqa: F401  (defines GRNNightExecutor)
    unreal.log("[night] GRNNightExecutor registered")
