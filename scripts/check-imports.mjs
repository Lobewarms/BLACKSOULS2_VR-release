// Resolve static browser-module imports using the actual import map, without game assets or a headset.
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'BLACKSOULS_VR', 'app');
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const match = html.match(/<script\s+type="importmap">([\s\S]*?)<\/script>/);
if (!match) throw new Error('Missing browser import map');
const imports = JSON.parse(match[1]).imports;
const modulePaths = new Set();
async function inspect(path) {
  if (modulePaths.has(path)) return;
  modulePaths.add(path);
  const text = await readFile(path, 'utf8');
  // Match static import/export declarations; do not scan inline examples or arbitrary quoted strings.
  const declarations = /^\s*(?:import|export)\s+(?:[^;'"\n]*?\s+from\s+)?['"]([^'"\n]+)['"]/gm;
  for (const [, specifier] of text.matchAll(declarations)) {
    let target;
    if (specifier.startsWith('.')) target = resolve(dirname(path), specifier);
    else if (imports[specifier]) target = resolve(root, imports[specifier]);
    else {
      const prefix = Object.keys(imports).find(key => key.endsWith('/') && specifier.startsWith(key));
      if (!prefix) throw new Error(`Unmapped import ${specifier} in ${relative(root, path)}`);
      target = resolve(root, imports[prefix], specifier.slice(prefix.length));
    }
    const rel = relative(root, target);
    if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Import escapes app directory');
    if (!(await stat(target)).isFile()) throw new Error(`Missing imported file: ${target}`);
    await inspect(target);
  }
}
for (const file of await readdir(resolve(root, 'src'))) {
  if (file.endsWith('.js')) await inspect(resolve(root, 'src', file));
}
for (const [, entry] of html.matchAll(/<script\s+type="module"\s+src="([^"]+)"/g)) {
  await inspect(resolve(root, entry));
}
console.log(`Validated imports across ${modulePaths.size} browser modules.`);
