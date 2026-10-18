// Only original Game_System cue settings belong in a save; generated particles do not.
export function normalizeEnvironmentState(value = {}) {
  return {
    richFog: value?.richFog === true,
    sunshineType: [1, 2].includes(value?.sunshineType) ? value.sunshineType : 0,
    sunshinePosition: [1, 2, 3].includes(value?.sunshinePosition) ? value.sunshinePosition : 2,
    leavesType: Number.isInteger(value?.leavesType) && value.leavesType >= 1 && value.leavesType <= 12 ? value.leavesType : 0,
  };
}

export function originalEnvironmentState(system) {
  return normalizeEnvironmentState({ richFog: system?.rich_fog,
    sunshineType: system?.sunshine_type, sunshinePosition: system?.sunshine_position,
    leavesType: system?.fallen_leaves_type });
}
