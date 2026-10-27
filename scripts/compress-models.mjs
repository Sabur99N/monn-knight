/**
 * Model optimisation pipeline.
 * Reads the raw glTF models from ./models-raw and writes highly compressed
 * .glb files (Draco geometry + WebP textures) into ./public/models.
 *
 * Run with:  npm run compress
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  prune,
  weld,
  resample,
  flatten,
  join,
  textureCompress,
  draco,
} from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { statSync } from 'node:fs';
import { mkdirSync } from 'node:fs';

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });

const jobs = [
  {
    input: 'models-raw/moon_knight/scene.gltf',
    output: 'public/models/moon_knight.glb',
    maxTexture: 2048,
  },
  {
    input: 'models-raw/moon_knights_boomerang_low_poly/scene.gltf',
    output: 'public/models/boomerang.glb',
    maxTexture: 1024,
  },
];

const kb = (n) => (n / 1024).toFixed(0);
const mb = (n) => (n / 1024 / 1024).toFixed(2);

mkdirSync('public/models', { recursive: true });

for (const job of jobs) {
  const before = statSync(job.input).size;
  console.log(`\n▶ Optimising ${job.input} ...`);

  const document = await io.read(job.input);

  await document.transform(
    dedup(),
    flatten(),
    join(),
    weld(),
    prune(),
    resample(),
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [job.maxTexture, job.maxTexture],
      quality: 85,
    }),
    draco({
      quantizePosition: 14,
      quantizeNormal: 10,
      quantizeTexcoord: 12,
      quantizeColor: 8,
    }),
  );

  await io.write(job.output, document);
  const after = statSync(job.output).size;
  const saved = (100 * (1 - after / before)).toFixed(1);
  console.log(
    `✔ ${job.output}\n   ${mb(before)} MB  →  ${mb(after)} MB  (-${saved}%, ${kb(after)} KB)`,
  );
}

console.log('\n✅ All models optimised.\n');
