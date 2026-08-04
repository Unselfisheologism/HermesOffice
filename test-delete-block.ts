// Empirical: does saveDocx DROP blocks omitted from finalBlocks? (deletion test)
import { parseDocx, saveDocx } from '@hermesoffice/docx-engine'
import { readFileSync } from 'node:fs'

async function main() {
  const buf = readFileSync('fixtures/generated/simple.docx')
  const parsed = await parseDocx(buf) as any
  const visible = parsed.blocks.filter((b: any) => !b.hidden)
  console.log('blocos originais:', visible.map((b: any) => b.docxIndex))
  // omit block index 1 (keep 0 and 2)
  const finalBlocks = visible.filter((b: any, i: number) => i !== 1).map((b: any) => ({ kind: 'original', docxIndex: b.docxIndex }))
  const saved = await saveDocx(parsed, finalBlocks)
  const reparsed = await parseDocx(saved) as any
  const after = reparsed.blocks.filter((b: any) => !b.hidden)
  console.log('blocos após delete:', after.map((b: any) => b.docxIndex), '→', after.length === 2 ? 'DELETE FUNCIONA ✅' : 'não removeu ❌')
  console.log('textos:', after.map((b: any) => (b.runs?.[0]?.text ?? '').slice(0, 30)))
}
main().catch(e => { console.error('ERRO:', e.message); process.exit(1) })
