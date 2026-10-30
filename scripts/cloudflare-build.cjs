const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
// Never copy local AI credentials into the Cloudflare build's .dev.vars.
const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
  stdio:'inherit', env:{...process.env,CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false'},
});
process.exitCode = result.status ?? 1;
if (result.status === 0) {
  // No user-specific server data exists on this one-page application shell.
  // Serve its existing prerender directly from free Static Assets.
  fs.copyFileSync('dist/server/prerendered-routes/index.html','dist/client/index.html');
  const assets = spawnSync(process.execPath,['--experimental-strip-types','scripts/prepare-cloudflare-static.ts'],{stdio:'inherit'});
  process.exitCode = assets.status ?? 1;
}
