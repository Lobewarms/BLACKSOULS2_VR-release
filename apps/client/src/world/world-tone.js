import * as THREE from 'three';

const PATCH = 'world-tone-output-v1';
const FOG = '#include <fog_fragment>';
const clamp = (value, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0;

function toneValues(tone = {}) {
  return [
    clamp(tone.r ?? tone.red, -255, 255) / 255,
    clamp(tone.g ?? tone.green, -255, 255) / 255,
    clamp(tone.b ?? tone.blue, -255, 255) / 255,
    clamp(tone.gray, 0, 255) / 255,
  ];
}

// RGSS tone works on displayed RGB: weighted grayscale first, then signed channel
// offsets. The input/output components here are sRGB in [0,1], with alpha unchanged.
export function worldTonePixel(rgba, tone = {}) {
  const [r, g, b, gray] = toneValues(tone);
  const luma = rgba[0] * 0.299 + rgba[1] * 0.587 + rgba[2] * 0.114;
  const result = [
    clamp(rgba[0] + (luma - rgba[0]) * gray + r, 0, 1),
    clamp(rgba[1] + (luma - rgba[1]) * gray + g, 0, 1),
    clamp(rgba[2] + (luma - rgba[2]) * gray + b, 0, 1),
  ];
  if (rgba.length > 3) result.push(rgba[3]);
  return result;
}

function outputIsLinear(renderer) {
  const target = renderer?.getRenderTarget?.();
  const space = target ? (target.isXRRenderTarget ? target.texture?.colorSpace : THREE.LinearSRGBColorSpace) : renderer?.outputColorSpace;
  return space === THREE.LinearSRGBColorSpace;
}

function shaderTone(linear) {
  // Three r170 converts to output colour space before fog. Apply the tone after
  // both, before premultiplication; do not encode sRGB twice in PC or XR output.
  return `
  // ${PATCH}
  vec3 worldToneRgb = ${linear ? 'sRGBTransferOETF( vec4( gl_FragColor.rgb, 1.0 ) ).rgb' : 'gl_FragColor.rgb'};
  float worldToneLuma = dot( worldToneRgb, vec3( 0.299, 0.587, 0.114 ) );
  worldToneRgb = clamp( mix( worldToneRgb, vec3( worldToneLuma ), worldTone.w ) + worldTone.rgb, 0.0, 1.0 );
  gl_FragColor.rgb = ${linear ? 'sRGBTransferEOTF( vec4( worldToneRgb, 1.0 ) ).rgb' : 'worldToneRgb'};
`;
}

// Material-local colour treatment needs no render target, second scene pass or
// per-eye copy. New meshes are discovered during apply; weak membership does not
// retain materials from maps that have been disposed.
export class WorldTone {
  constructor(scene) {
    this.scene = scene;
    this.uniform = { value: new THREE.Vector4() };
    this.patched = new WeakSet();
    this.background = null;
    this.rawBackground = null;
    this.appliedBackground = null;
    this.backgroundScratch = new THREE.Color();
  }

  patch(material) {
    if (!material || material.isShaderMaterial || material.isRawShaderMaterial || this.patched.has(material)) return;
    this.patched.add(material);
    const previousCompile = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey;
    // Material's default cache key reads onBeforeCompile dynamically. Capture its
    // original value before replacing that callback; custom keys remain dynamic.
    const defaultKey = previousKey === THREE.Material.prototype.customProgramCacheKey;
    const originalKey = defaultKey ? previousKey.call(material) : null;
    const uniform = this.uniform;
    material.onBeforeCompile = function (shader, renderer) {
      previousCompile.call(this, shader, renderer);
      if (!shader.fragmentShader.includes(FOG) || shader.fragmentShader.includes(`// ${PATCH}`)) return;
      shader.uniforms.worldTone = uniform;
      shader.fragmentShader = `uniform vec4 worldTone;\n${shader.fragmentShader}`.replace(FOG, FOG + shaderTone(outputIsLinear(renderer)));
    };
    material.customProgramCacheKey = function () {
      return `${defaultKey ? originalKey : previousKey.call(this)}|${PATCH}`;
    };
    material.needsUpdate = true;
  }

  apply(tone = {}) {
    this.uniform.value.fromArray(toneValues(tone));
    const visit = object => {
      if (object.userData?.worldTone === false || object.renderOrder >= 2900) return;
      const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of materials) {
        // The wrist HUD uses renderOrder 900. UI and full-view overlays disable
        // depth testing, unlike world sprites, sky and weather.
        if (material.depthTest !== false && material.userData?.worldTone !== false) this.patch(material);
      }
      for (const child of object.children) visit(child);
    };
    if (this.scene) visit(this.scene);
    this.applyBackground(tone);
  }

  applyBackground(tone) {
    const background = this.scene?.background;
    if (!background?.isColor) {
      this.background = this.rawBackground = this.appliedBackground = null;
      return;
    }
    // Sky/map changes can replace the Color or update it in place. A prior toned
    // result is never used as the source of the next frame's transform.
    if (background !== this.background || !background.equals(this.appliedBackground)) {
      this.background = background;
      this.rawBackground = background.clone();
      this.appliedBackground = background.clone();
    }
    const source = this.backgroundScratch.copy(this.rawBackground).convertLinearToSRGB();
    const values = this.uniform.value;
    if (values.x || values.y || values.z || values.w) {
      const pixel = worldTonePixel([source.r, source.g, source.b], tone);
      background.setRGB(pixel[0], pixel[1], pixel[2], THREE.SRGBColorSpace);
    } else background.copy(this.rawBackground);
    this.appliedBackground.copy(background);
  }
}
