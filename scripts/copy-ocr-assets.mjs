// Copies the OCR engine and its English language data into public/ocr so the
// desktop app can read labels without downloading anything at run time.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const modules = join(root, 'node_modules')
const target = join(root, 'public', 'ocr')

const files = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  [
    'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
    'tesseract-core-relaxedsimd-lstm.wasm.js',
  ],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
]

mkdirSync(target, { recursive: true })
let copied = 0
for (const [from, to] of files) {
  const source = join(modules, from)
  const destination = join(target, to)
  if (!existsSync(source)) {
    console.error(`copy-ocr-assets: missing ${from}. Run "npm install" first.`)
    process.exit(1)
  }
  if (existsSync(destination) && statSync(destination).size === statSync(source).size) {
    continue
  }
  copyFileSync(source, destination)
  copied += 1
}
if (copied > 0) console.log(`copy-ocr-assets: copied ${copied} file(s) to public/ocr`)
