import * as THREE from 'three';

// Billboard positions are offsets, not map coordinates. The shader rotates each
// local x offset around its center in XZ and adds local y without rotating it.
// Keep a complete quad in its center's chunk, including pictures wider than the
// chunk. Bounds therefore follow the artwork, rather than the chunk cell edges.
// A minimum allows small buffers to keep one draw, with the same valid bounds.
export function billboardGeometryChunks(attributes, indices, chunkSize, minimumQuads = 0) {
  return quadGeometryChunks(attributes, indices, chunkSize, true, minimumQuads);
}

// Ordinary map quads use their real vertices. A wide wall/floor remains intact
// in its centroid's chunk, with bounds covering every vertex beyond that cell.
export function ordinaryGeometryChunks(attributes, indices, chunkSize, minimumQuads = 0) {
  return quadGeometryChunks(attributes, indices, chunkSize, false, minimumQuads);
}

function quadGeometryChunks(attributes, indices, chunkSize, billboard, minimumQuads) {
  if (!(chunkSize > 0) || !Number.isFinite(chunkSize)) throw new RangeError('Invalid map chunk size');
  if (!Number.isSafeInteger(minimumQuads) || minimumQuads < 0) throw new RangeError('Invalid minimum quad count');
  const position = attributes.position, center = attributes.center;
  const count = position.array.length / position.itemSize;
  if (position.itemSize !== 3 || (billboard && center?.itemSize !== 3) || count % 4 || indices.length !== count / 4 * 6 ||
    Object.values(attributes).some(attribute => attribute.array.length !== count * attribute.itemSize))
    throw new RangeError('Map geometry must contain complete indexed quads');
  const chunks = new Map();
  for (let first = 0; first < count; first += 4) {
    let x = 0, z = 0;
    if (billboard) { x = center.array[first * 3]; z = center.array[first * 3 + 2]; }
    else for (let i = first * 3; i < (first + 4) * 3; i += 3) { x += position.array[i] / 4; z += position.array[i + 2] / 4; }
    const key = count / 4 < minimumQuads ? 'all' : `${Math.floor(x / chunkSize)},${Math.floor(z / chunkSize)}`;
    let chunk = chunks.get(key);
    if (!chunk) {
      chunk = { attributes: Object.fromEntries(Object.keys(attributes).map(name => [name, []])), indices: [], count: 0 };
      chunks.set(key, chunk);
    }
    for (const [name, attribute] of Object.entries(attributes)) {
      const values = chunk.attributes[name], size = attribute.itemSize;
      for (let i = first * size; i < (first + 4) * size; i++) values.push(attribute.array[i]);
    }
    for (let i = first / 4 * 6; i < first / 4 * 6 + 6; i++) {
      const local = indices[i] - first;
      if (local < 0 || local >= 4 || !Number.isInteger(local)) throw new RangeError('Map indices cross a quad');
      chunk.indices.push(chunk.count + local);
    }
    chunk.count += 4;
  }
  return [...chunks.values()].map(chunk => {
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(attributes))
      geometry.setAttribute(name, new THREE.Float32BufferAttribute(chunk.attributes[name], attribute.itemSize));
    geometry.setIndex(chunk.indices);
    if (!billboard) {
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      geometry.boundingSphere.radius += Math.max(1, geometry.boundingSphere.radius) * 1e-6;
      return geometry;
    }
    const box = new THREE.Box3(), p = geometry.getAttribute('position'), c = geometry.getAttribute('center');
    for (let i = 0; i < p.count; i++) {
      const radius = Math.abs(p.getX(i)), x = c.getX(i), y = c.getY(i) + p.getY(i), z = c.getZ(i);
      box.min.x = Math.min(box.min.x, x - radius); box.max.x = Math.max(box.max.x, x + radius);
      box.min.y = Math.min(box.min.y, y); box.max.y = Math.max(box.max.y, y);
      box.min.z = Math.min(box.min.z, z - radius); box.max.z = Math.max(box.max.z, z + radius);
    }
    // Include float32 shader arithmetic at the map's coordinate magnitude.
    const magnitude = Math.max(1, ...box.min.toArray().map(Math.abs), ...box.max.toArray().map(Math.abs));
    box.expandByScalar(magnitude * 1e-6);
    geometry.boundingBox = box;
    geometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    return geometry;
  });
}
