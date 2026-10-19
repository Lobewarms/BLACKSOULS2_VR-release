const KINDS = ['item', 'weapon', 'armor'];
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;

// EasyCompose's note prices are separate from a shop's gold price. Resolve only
// existing database materials; the caller chooses the active inventory container.
export function exchangeRequirements(item, config, lookup) {
  if (!config || config.active === false) return { materials: [], valid: true };
  if (typeof config.word !== 'string' || !config.word) return { materials: [], valid: false };
  const word = config.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tag = new RegExp(`<${word}[:：]([^>]*)>`);
  const materials = new Map();
  let valid = true;
  for (const line of String(item?.note || '').split(/\r?\n/)) {
    // The original reads only the first matching tag on each note line.
    const match = tag.exec(line);
    if (!match) continue;
    const fields = match[1].split(',').map(value => value.trim());
    if (!/^[012]$/.test(fields[0]) || !/^\d+$/.test(fields[1] || '')) continue;
    const kind = KINDS[Number(fields[0])], id = Number(fields[1]);
    if (!positiveInteger(id)) continue;
    const data = lookup(kind, id);
    if (!data) continue;
    const raw = fields[2], count = raw === undefined ? 1 : /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!positiveInteger(count)) { valid = false; continue; }
    materials.set(`${kind}:${id}`, { kind, id, count, data });
  }
  return { materials: [...materials.values()], valid };
}

export function exchangeMax(requirements, countFn) {
  if (!requirements?.valid || !Array.isArray(requirements.materials)) return 0;
  let max = Infinity;
  for (const material of requirements.materials) {
    if (!positiveInteger(material.count)) return 0;
    const owned = countFn(material.kind, material.id);
    if (!Number.isSafeInteger(owned) || owned < 0) return 0;
    max = Math.min(max, Math.floor(owned / material.count));
  }
  return max;
}

export function purchaseQuantityValid(n, max) {
  return positiveInteger(n) && typeof max === 'number' && n <= max;
}
