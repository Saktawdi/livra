import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';

const revision = 'f977bef508690e75ba6535cd8f4ce18e7f6ba9b0';
const source = `https://raw.githubusercontent.com/Andersen216/dsh-whale-girl-live2d/${revision}/`;
const root = resolve(import.meta.dirname, '../apps/web/public/models/whale');
async function fetchFile(path) {
  const response = await fetch(source + path.split('/').map(encodeURIComponent).join('/'));
  if (!response.ok) throw Error(`Whale asset ${path}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
const model = JSON.parse(
  new TextDecoder().decode(await fetchFile('assets/model/c_0120.model3.json')),
);
const manifest = JSON.parse(
  new TextDecoder().decode(await fetchFile('assets/model/manifest.json')),
);
model.FileReferences.Expressions = Object.entries(manifest.expressions).map(([Name, value]) => ({
  Name,
  File: value.file,
}));
const refs = model.FileReferences;
const files = [
  refs.Moc,
  ...refs.Textures,
  refs.Physics,
  refs.DisplayInfo,
  ...refs.Expressions.map((e) => e.File),
  ...Object.values(refs.Motions)
    .flat()
    .map((m) => m.File),
  'manifest.json',
  'icon.png',
].filter(Boolean);
for (let start = 0; start < files.length; start += 6) {
  await Promise.all(
    files.slice(start, start + 6).map(async (file) => {
      const path = resolve(root, file);
      const assetPath = relative(root, path);
      if (assetPath.startsWith('..') || isAbsolute(assetPath))
        throw Error('Invalid whale asset path');
      const bytes = await fetchFile('assets/model/' + file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    }),
  );
}
await writeFile(resolve(root, 'c_0120.model3.json'), JSON.stringify(model, null, 2) + '\n');
for (const file of ['NOTICE.md', 'PROVENANCE.md', 'AUTHORS.md'])
  await writeFile(resolve(root, file), await fetchFile(file));
await writeFile(
  resolve(root, 'LIVRA-NOTICE.md'),
  `DS 鲸鱼娘 / DeepSeek 大肥鱼\n\nSource: https://github.com/Andersen216/dsh-whale-girl-live2d/tree/${revision}\nArtwork: 上善无形 / ZipZipPipe / 氵六青. Model assets: CC BY-NC-SA 4.0.\nLicense: https://creativecommons.org/licenses/by-nc-sa/4.0/\nLivra change: registered the upstream 44 expressions in FileReferences.Expressions.\nAll artwork files retain the same CC BY-NC-SA 4.0 terms and the upstream notices.\nThese model assets are not covered by Livra's MIT code license.\n`,
);
console.log(
  `Installed DS Whale: ${files.length} assets, ${refs.Expressions.length} expressions; source ${revision}.`,
);
