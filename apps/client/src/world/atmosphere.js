import * as THREE from 'three';
import { areaProfile } from './area-profiles.js';

const bound = (n, low, high) => Math.max(low, Math.min(high, Number(n) || 0));

// Original automatic-tone/weather scripts reset missing tags on map setup.
// Keep these separate from lighting: an authored blue night is not a request
// to darken the lamps a second time.
export function mapAtmosphereNotes(note = '') {
  const tone = /<色調\s+(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)(?:\s*,\s*(-?\d+))?\s*>/i.exec(note);
  const weather = /<天候\s+(none|rain|storm|snow)\s*,\s*(\d+)\s*>/i.exec(note);
  return {
    tone: { red: bound(tone?.[1], -255, 255), green: bound(tone?.[2], -255, 255),
      blue: bound(tone?.[3], -255, 255), gray: bound(tone?.[4], 0, 255) },
    weather: { type: weather?.[1].toLowerCase() || 'none', power: bound(weather?.[2], 0, 9) },
  };
}

export class MapAtmosphere {
  constructor(scene) {
    this.scene = scene;
    this.ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0.8);
    this.headlight = new THREE.PointLight(0xffffff, 2, 8, 1.5);
    this.headlight.name = 'local-readability-light';
    scene.add(this.ambient, this.hemi, this.headlight);
    this.profile = null;
  }
  setMap(map, { mapId = 0, tileset = null, rebuild = false, screen, sky, environment } = {}) {
    this.screen = screen;
    this.environment = environment;
    this.profile = areaProfile(map, { mapId, tileset });
    const p = this.profile;
    this.hemi.groundColor.set(p.groundColor);
    this.headlight.intensity = p.headlightIntensity;
    this.headlight.distance = p.headlightRange;
    if (!this.scene.fog) this.scene.fog = new THREE.Fog(p.fogColor, p.fogNear, p.fogFar);
    this.scene.fog.near = p.fogNear;
    this.scene.fog.far = p.fogFar;
    this.scene.fog.color.set(p.fogColor);
    this.scene.background = new THREE.Color(p.background);
    if (!rebuild) {
      const notes = mapAtmosphereNotes(map?.note);
      screen?.startTone(notes.tone, 0);
      screen?.setWeather(notes.weather.type, notes.weather.power, 0);
      Promise.resolve(environment?.setMap(map)).catch(error => console.warn('Map environment unavailable', error));
    }
    // Sky owns its sampled horizon after loading. Its fallback must agree with
    // this area while absent, disabled, failed, or still loading.
    Promise.resolve(sky?.setMap(map, { background: p.background, fogColor: p.fogColor, fallbackSky: p.fallbackSky }))
      .catch(error => console.warn('Map sky unavailable', error));
    this.update();
    return p;
  }
  update(head) {
    if (!this.profile) return;
    const cloud = 1 - bound(this.screen?.weatherDimness, 0, 54) / 255;
    this.ambient.intensity = this.profile.ambient * cloud;
    this.hemi.intensity = this.profile.hemi * cloud;
    if (head) this.headlight.position.set(head.x, head.y + 0.2, head.z);
  }
  clear() {
    this.screen?.clearWeather();
    this.screen?.startTone({ red: 0, green: 0, blue: 0, gray: 0 }, 0);
    this.environment?.clear();
    this.profile = null;
  }
  dispose() {
    this.clear();
    for (const light of [this.ambient, this.hemi, this.headlight]) {
      this.scene.remove(light); light.dispose();
    }
  }
}
