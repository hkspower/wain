import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { CopyShader } from "three/examples/jsm/shaders/CopyShader.js";

/**
 * The scene pass, with a multisampled buffer of its own.
 *
 * EffectComposer ping-pongs between two targets and clones the first one
 * for the second, so a multisampled target handed to it gives BOTH the
 * samples and a depth buffer, and every full-screen pass after the scene
 * (exposure, output, grade, fxaa) then drew its quad into a 4x buffer and
 * resolved it for nothing. Worse, the engine only ever changed the
 * samples of the first target, and RenderPass writes into whichever
 * target is the read buffer at the time. Three passes swap per frame with
 * FXAA off, an odd number, so the scene landed in the first target one
 * frame and in the clone the next: Balanced alternated between 2x and
 * 4x, and Battery, which is meant to have no samples, kept four on every
 * second frame. tools/shots/edges.mjs measured the result: MSAA moved
 * the share of one-step silhouette edges from 60.8% to 61.9%.
 *
 * Here the scene is drawn into ONE multisampled target that this pass
 * owns, and copied (the resolve happens when three finishes the render)
 * into the composer's read buffer, which is single-sampled and has no
 * depth. The samples are exactly what the tier asked for, on every
 * frame, and the post chain no longer pays for them.
 */
export class SceneMsaaPass extends RenderPass {
  private readonly copyQuad: FullScreenQuad;
  private readonly copyMat: THREE.ShaderMaterial;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    /** The multisampled target the scene is drawn into. */
    readonly target: THREE.WebGLRenderTarget
  ) {
    super(scene, camera);
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms),
      vertexShader: CopyShader.vertexShader,
      fragmentShader: CopyShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.copyQuad = new FullScreenQuad(this.copyMat);
  }

  /** Change the sample count. The renderbuffers are only (re)allocated
   * when a target is first used or resized, so a bare assignment can
   * leave the old storage in place; disposing makes the next frame
   * allocate what was asked for. */
  setSamples(n: number): void {
    if (this.target.samples === n) return;
    this.target.samples = n;
    this.target.dispose();
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget
  ): void {
    super.render(renderer, writeBuffer, this.target, 0, false);
    this.copyMat.uniforms["tDiffuse"].value = this.target.texture;
    renderer.setRenderTarget(readBuffer);
    this.copyQuad.render(renderer);
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
  }

  dispose(): void {
    super.dispose();
    this.copyQuad.dispose();
    this.copyMat.dispose();
    this.target.dispose();
  }
}
