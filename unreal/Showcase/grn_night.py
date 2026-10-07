"""The night Gulf Road shot: a Movie Render Queue executor that runs the
GAME, not a map — the port builds its world at runtime in AGRNGameMode —
parks the Black Demon on the corniche, clears the road and renders one
frame from the car's own chase camera.

    unreal/Showcase/run.sh night city      # station 587 m, the web build's "sweep" place
    unreal/Showcase/run.sh night coast     # station 3304 m

run.sh launches UnrealEditor-Cmd with -game, the Python host executor and
-GRNNight=<shot>; init_unreal.py imports this module so the class below
exists when MRQ asks for /Engine/PythonTypes.GRNNightExecutor.

The game mode asks the web build for its tables and builds the world when
they arrive or after 6 s, so execute_delayed only notes the shot and the
staging happens from on_begin_frame once UGRNShowcase::SelectCar says
there is a player to select a car for. Then: select the Black Demon,
dress it in SM_BlackDemon (GRNShowcase::WearArt, through the port's own
hero-art slot), park it, hide the traffic and the rival, aim the chase
camera, let a second of frames settle, and start the pipeline on
LS_night (one frame, no camera cut, so MRQ renders the player's view).
"""
import json
import math
import os
import sys

import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import showcase_math as sm  # noqa: E402

ENTRY_MAP = "/Engine/Maps/Entry"


def shot_from_command_line():
    cl = str(unreal.SystemLibrary.get_command_line())
    for tok in cl.split():
        if tok.startswith("-GRNNight="):
            return tok.split("=", 1)[1].strip('"')
    return "city"


@unreal.uclass()
class GRNNightExecutor(unreal.MoviePipelinePythonHostExecutor):
    pipeline = unreal.uproperty(unreal.MoviePipeline)
    queue = unreal.uproperty(unreal.MoviePipelineQueue)
    frames = unreal.uproperty(int)
    staged_at = unreal.uproperty(int)
    staged = unreal.uproperty(bool)
    shot = unreal.uproperty(str)

    def _post_init(self):
        self.pipeline = None
        self.queue = None
        self.frames = 0
        self.staged_at = 0
        self.staged = False
        self.shot = "city"

    @unreal.ufunction(override=True)
    def execute_delayed(self, in_queue):
        self.shot = shot_from_command_line()
        key = "night-" + self.shot
        if key not in sm.NIGHT_SHOTS:
            unreal.log_error(f"[night] no shot called {self.shot}; one of {[k[6:] for k in sm.NIGHT_SHOTS]}")
            self.finish(None)
            return
        unreal.log(f"[night] shot {key}: waiting for the game to build its world")

    @unreal.ufunction(override=True)
    def on_begin_frame(self):
        super(GRNNightExecutor, self).on_begin_frame()
        if self.pipeline is not None:
            return
        self.frames += 1
        world = self.get_last_loaded_world()
        if world is None:
            return
        if not self.staged:
            if not hasattr(unreal, "GRNShowcase"):
                unreal.log_error("[night] unreal.GRNShowcase is missing: rebuild the project with GRNShowcase.cpp")
                self.finish(world)
                return
            if not unreal.GRNShowcase.select_car(world, sm.CAR_ID):
                if self.frames > 60 * 30:
                    unreal.log_error("[night] the world never built (no player after 30 s)")
                    self.finish(world)
                return
            self.stage(world)
            self.staged = True
            self.staged_at = self.frames
            return
        if self.frames - self.staged_at < 60:
            return  # a second for the lamps, Lumen and the car to settle
        self.start_pipeline(world)

    def stage(self, world):
        spec = sm.NIGHT_SHOTS["night-" + self.shot]
        slot, param = 0, "None"
        try:
            with open(os.path.join(sm.OUT_DIR, "build.json")) as f:
                r = json.load(f)
            slot, param = int(r.get("paint_slot", 0)), str(r.get("paint_param", "None"))
        except Exception as e:  # noqa: BLE001
            unreal.log_warning(f"[night] no build.json ({e}); paint slot 0, no respray parameter")
        mesh = unreal.load_asset(sm.MERGED_MESH)
        if mesh:
            unreal.GRNShowcase.wear_art(world, mesh, slot, unreal.Name(param))
        else:
            unreal.log_warning(f"[night] {sm.MERGED_MESH} is not in the project (run build); the game's own primitive car is used")
        unreal.GRNShowcase.park_player(world, float(spec["station_m"]), float(spec["lateral_m"]), 0.0, True)
        n = unreal.GRNShowcase.clear_others(world)
        pawn = unreal.GameplayStatics.get_player_pawn(world, 0)
        cam = None
        try:
            cam = pawn.get_editor_property("camera")
        except Exception:  # noqa: BLE001
            comps = pawn.get_components_by_class(unreal.CameraComponent)
            cam = comps[0] if comps else None
        if cam is None:
            unreal.log_warning("[night] no camera component on the pawn; MRQ renders whatever view there is")
        else:
            # Behind and beside the car in its own frame (X forward), looking at the cabin
            loc = (-spec["cam_back_m"] * 100.0, spec["cam_side_m"] * 100.0, spec["cam_up_m"] * 100.0)
            aim = (0.0, 0.0, 70.0)
            cam.set_relative_location_and_rotation(unreal.Vector(*loc), unreal.Rotator(
                roll=0.0, pitch=sm.look_rotator(loc, aim)[0], yaw=sm.look_rotator(loc, aim)[1]))
            cam.set_field_of_view(2.0 * math.degrees(math.atan(18.0 / sm.studio.LENS_MM)))
        unreal.log(f"[night] staged: {sm.CAR_ID} at {spec['station_m']} m, {n} other cars cleared, camera set")

    def start_pipeline(self, world):
        cfg = unreal.load_asset(f"{sm.MRQ_PATH}/MRQ_night")
        if cfg is None:
            unreal.log_error(f"[night] {sm.MRQ_PATH}/MRQ_night is missing — run build")
            self.finish(world)
            return
        self.queue = unreal.new_object(unreal.MoviePipelineQueue, outer=self)
        job = self.queue.allocate_new_job(unreal.MoviePipelineExecutorJob)
        job.set_editor_property("sequence", unreal.SoftObjectPath(f"{sm.SEQ_PATH}/LS_night"))
        job.set_editor_property("map", unreal.SoftObjectPath(ENTRY_MAP))
        job.set_editor_property("job_name", f"black-demon night {self.shot}")
        job.set_configuration(cfg)
        # The output folder carries the shot's name, so city and coast do not overwrite each other
        out = job.get_configuration().find_or_add_setting_by_class(unreal.MoviePipelineOutputSetting)
        out.set_editor_property("file_name_format", "night-" + self.shot + ".{frame_number}")
        self.pipeline = unreal.new_object(self.target_pipeline_class, outer=world, base_type=unreal.MoviePipeline)
        self.pipeline.on_movie_pipeline_work_finished_delegate.add_function_unique(self, "on_finished")
        self.pipeline.initialize(job)
        unreal.log("[night] rendering")

    @unreal.ufunction(ret=None, params=[unreal.MoviePipelineOutputData])
    def on_finished(self, results):
        try:
            for shot in results.shot_data:
                for pass_id, data in shot.render_pass_data.items():
                    for p in data.file_paths:
                        unreal.log(f"[night] wrote {p}")
        except Exception as e:  # noqa: BLE001
            unreal.log_warning(f"[night] could not list the output: {e}")
        self.finish(self.get_last_loaded_world())

    def finish(self, world):
        self.on_executor_finished_impl()
        try:
            unreal.SystemLibrary.quit_game(world, None, unreal.QuitPreference.QUIT, False)
        except Exception:  # noqa: BLE001
            pass
