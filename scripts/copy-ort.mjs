// Copies the onnxruntime-web WebGPU runtime into public/ort/, where the
// in-browser stem separation loads it on demand. Run after upgrading
// onnxruntime-web:  node scripts/copy-ort.mjs
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = join(root, 'node_modules', 'onnxruntime-web')
const out = join(root, 'public', 'ort')
mkdirSync(out, { recursive: true })
for (const f of ['ort.webgpu.min.mjs', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) copyFileSync(join(pkg, 'dist', f), join(out, f))
// The package ships no LICENSE file; record its license.
writeFileSync(join(out, 'LICENSE.txt'), 'onnxruntime-web - MIT License, Copyright (c) Microsoft Corporation. https://github.com/microsoft/onnxruntime\n')
const version = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version
writeFileSync(join(out, 'VERSION.txt'), version + '\n')
console.log(`onnxruntime-web ${version} copied to public/ort/`)
