// Loader resolve khusus test: petakan import relatif extensionless (gaya bundler
// Workers, mis. "./middleware/auth") ke file .ts yang sebenarnya agar bisa jalan
// di node --test tanpa mengubah satu byte pun kode src/ yang dibekukan.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const parentPath = fileURLToPath(context.parentURL);
      const base = path.resolve(path.dirname(parentPath), specifier);
      for (const cand of [`${base}.ts`, path.join(base, 'index.ts')]) {
        if (existsSync(cand)) return { url: pathToFileURL(cand).href, shortCircuit: true };
      }
    }
    throw err;
  }
}
