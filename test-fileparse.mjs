import { parseFileToText } from '@hermesoffice/file-parse'
import { readFileSync } from 'node:fs'
const buf = readFileSync('packages/pptx-engine/tests/fixtures/01_standard_business.pptx')
const parsed = await parseFileToText(buf)
console.log('kind:', parsed.kind)
console.log('--- texto extraído (primeiros 400 chars) ---')
console.log(parsed.text.slice(0, 400))
