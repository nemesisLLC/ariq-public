// Derived first-paint placeholders only. Original final images and textures stay intact.
const sharp = require('sharp');
const fs = require('node:fs');
(async () => {
  for (const name of ['preview', 'preview-mobile']) {
    const target = `public/media/registan/${name}-instant-v1.avif`;
    await sharp(`public/media/registan/${name}.webp`)
      .resize({width:name === 'preview' ? 480 : 195})
      .avif({quality:30,effort:6}).toFile(target);
    console.log(target, fs.statSync(target).size);
  }
})().catch(error => {console.error(error);process.exitCode=1;});
