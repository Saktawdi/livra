import assert from 'node:assert/strict';

const base = (process.argv[2] || 'http://127.0.0.1:3400').replace(/\/$/, '');
const page = await fetch(base);
assert.equal(page.status, 200);
assert.match(await page.text(), /Livra/);
const health = await fetch(base + '/api/health');
assert.equal((await health.json()).ok, true);
const bootstrap = await fetch(base + '/api/bootstrap');
assert.equal(bootstrap.status, 200);
const cookie = bootstrap.headers.getSetCookie().find((s) => s.startsWith('livra_session='));
assert.match(cookie, /HttpOnly/i);
const headers = {
  'Content-Type': 'application/json',
  'X-Livra-Client': 'web',
  Cookie: cookie.split(';')[0],
};
const data = await bootstrap.json();
assert.ok(data.settings.personas.length);
assert.equal(data.settings.speechSpeed, 1);
for (const asset of [
  '/vendor/live2dcubismcore.min.js',
  '/vendor/pixi-live2d-display-0.4.0.min.js',
  '/models/hiyori/Hiyori.model3.json',
  '/models/haru/Haru.model3.json',
])
  assert.equal((await fetch(base + asset)).status, 200, asset);
const created = await fetch(base + '/api/tools/execute', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    name: 'create_slides',
    args: { title: 'Production smoke', markdown: '# Livra\n\n---\n\n# Ready' },
  }),
});
assert.equal(created.status, 200, await created.clone().text());
const artifact = await created.json();
assert.ok(artifact.artifactId);
const read = await fetch(base + '/api/artifacts/' + artifact.artifactId, { headers });
const saved = await read.json();
assert.match(saved.data.html, /Livra/);
const isolated = await fetch(base + '/api/bootstrap');
const other = isolated.headers
  .getSetCookie()
  .find((s) => s.startsWith('livra_session='))
  .split(';')[0];
assert.equal(
  (await fetch(base + '/api/artifacts/' + artifact.artifactId, { headers: { Cookie: other } }))
    .status,
  404,
);
const denied = await fetch(base + '/api/settings', {
  method: 'PUT',
  headers: { ...headers, Origin: 'https://untrusted.example' },
  body: JSON.stringify(data.settings),
});
assert.equal(denied.status, 403);
assert.equal(
  (
    await fetch(base + '/api/artifacts/' + artifact.artifactId, {
      method: 'DELETE',
      headers: { 'X-Livra-Client': 'web', Cookie: headers.Cookie },
    })
  ).status,
  200,
);
console.log(
  'Production smoke passed: Web, API, Live2D assets, Marp persistence, workspace isolation, origin checks.',
);
