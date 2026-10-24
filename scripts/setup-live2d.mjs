import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
const names = process.argv.slice(2);
for (const name of (names.length ? names : ['Haru', 'Hiyori', 'Mark', 'Natori', 'Rice']).filter(
  (name) => name !== 'Whale',
)) {
  if (!['Haru', 'Hiyori', 'Mark', 'Natori', 'Rice'].includes(name))
    throw Error('Unknown official sample: ' + name);
  const root = resolve(import.meta.dirname, '../apps/web/public/models', name.toLowerCase());
  const base = `https://raw.githubusercontent.com/Live2D/CubismWebSamples/4-r.1/Samples/Resources/${name}/`;
  const model = await (await fetch(base + name + '.model3.json')).json();
  const refs = model.FileReferences;
  const files = new Set(
    [
      name + '.model3.json',
      refs.Moc,
      ...refs.Textures,
      refs.Pose,
      refs.Physics,
      refs.UserData,
      refs.DisplayInfo,
      ...(refs.Expressions || []).map((e) => e.File),
      ...Object.values(refs.Motions)
        .flat()
        .flatMap((m) => [m.File, m.Sound]),
    ].filter(Boolean),
  );
  await Promise.all(
    [...files].map(async (file) => {
      const response = await fetch(base + file);
      if (!response.ok) throw Error(`Cannot download ${file}: ${response.status}`);
      const path = resolve(root, file);
      if (!path.startsWith(root)) throw Error('Invalid model file path');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(await response.arrayBuffer()));
    }),
  );
  await writeFile(
    resolve(root, 'LICENSE.txt'),
    `${name} — © Live2D Inc.\nOfficial sample from Live2D/CubismWebSamples, tag 4-r.1.\nFree Material License: https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html\nSample model terms: https://www.live2d.com/eula/live2d-sample-model-terms_en.html\nThese assets are not covered by Livra's MIT license.\n`,
  );
  console.log(`Installed ${files.size} official ${name} sample files locally.`);
}
if (!names.length || names.includes('Whale')) await import('./setup-whale.mjs');
