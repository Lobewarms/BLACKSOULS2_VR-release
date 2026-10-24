// Legacy voice wire format: base64 of big-endian uint16 length + Opus bytes.
export const VOICE_MESSAGE_MAX = 6000;
export function encodeVoiceFrames(chunks) {
  if (!Array.isArray(chunks) || !chunks.length || chunks.length > 8 || chunks.some(c => !(c instanceof Uint8Array) || !c.length || c.length > 1200)) return null;
  const out = new Uint8Array(chunks.reduce((n, c) => n + 2 + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) { out[offset++] = chunk.length >> 8; out[offset++] = chunk.length & 255; out.set(chunk, offset); offset += chunk.length; }
  const text = btoa(String.fromCharCode(...out));
  return text.length <= VOICE_MESSAGE_MAX ? text : null;
}
export function decodeVoiceFrames(text) {
  if (typeof text !== 'string' || !text.length || text.length > VOICE_MESSAGE_MAX || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) return null;
  let data;
  try { data = Uint8Array.from(atob(text), c => c.charCodeAt(0)); } catch { return null; }
  const frames = [];
  for (let offset = 0; offset < data.length;) {
    if (offset + 2 > data.length || frames.length >= 8) return null;
    const size = (data[offset] << 8) | data[offset + 1]; offset += 2;
    if (!size || size > 1200 || offset + size > data.length) return null;
    frames.push(data.subarray(offset, offset + size)); offset += size;
  }
  return frames.length ? frames : null;
}
