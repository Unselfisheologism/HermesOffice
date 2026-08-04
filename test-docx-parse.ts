import { parseDocx } from '@hermesoffice/docx-engine'
import { readFileSync } from 'node:fs'

async function main() {
  const fixture = 'fixtures/generated/' + (await import('node:fs')).readdirSync('fixtures/generated')[0]
  console.log('fixture:', fixture)
  const buf = readFileSync(fixture)
  const parsed = await parseDocx(buf)
  const blocks = parsed.blocks ?? parsed.document?.blocks ?? []
  console.log('tipo de parse:', parsed && Object.keys(parsed).slice(0, 10))
  console.log('blocos:', Array.isArray(blocks) ? blocks.length : 'n/a')
  if (Array.isArray(blocks) && blocks.length) {
    const b = blocks[0]
    console.log('primeiro bloco keys:', Object.keys(b))
    console.log('amostra:', JSON.stringify(b).slice(0, 300))
  }
}
main()
