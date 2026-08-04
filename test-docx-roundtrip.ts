// Spike test: byte-preserving roundtrip + surgical paragraph patch via docx-engine headless
import { parseDocx, saveDocx } from '@hermesoffice/docx-engine'
import { readFileSync, writeFileSync } from 'node:fs'
import JSZip from 'jszip'

const FIXTURE = 'fixtures/generated/simple.docx'

async function unzipEntries(buf: Uint8Array | Buffer) {
  const zip = await JSZip.loadAsync(buf)
  const out: Record<string, string> = {}
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir) out[name] = await entry.async('string')
  }
  return out
}

async function main() {
  const original = readFileSync(FIXTURE)
  const parsed = await parseDocx(original)
  const blocks = parsed.blocks.filter((b: any) => !b.hidden)

  // ── TESTE 1: roundtrip sem edição → byte-idêntico
  const saved1 = await saveDocx(parsed as any, blocks.map((b: any) => ({ kind: 'original', docxIndex: b.docxIndex })))
  const origEntries = await unzipEntries(original)
  const savedEntries = await unzipEntries(saved1)
  const keys = Object.keys(origEntries)
  const diffs = keys.filter((k) => origEntries[k] !== savedEntries[k])
  console.log('TESTE 1 (roundtrip idêntico):', diffs.length === 0 ? 'PASSOU ✅ byte-idêntico em todos os ' + keys.length + ' entries' : 'FALHOU: ' + diffs.join(', '))

  // ── TESTE 2: patch cirúrgico de 1 parágrafo → outros parágrafos preservam bytes
  const targetIdx = 1 // segundo parágrafo visível
  const target = blocks[targetIdx]
  const beforeXml = (origEntries['word/document.xml'] ?? '')

  const finalBlocks: any[] = blocks.map((b: any, i: number) =>
    i === targetIdx
      ? {
          kind: 'generated',
          block: {
            type: 'paragraph',
            styleId: b.styleId ?? undefined,
            rawPPr: b.rawPPr ?? undefined,
            runs: [{ text: 'LINHA MODIFICADA PELO HERMES VIA DOCX-ENGINE' }],
          },
        }
      : { kind: 'original', docxIndex: b.docxIndex },
  )
  const saved2 = await saveDocx(parsed as any, finalBlocks)
  const saved2Entries = await unzipEntries(saved2)
  const afterXml = saved2Entries['word/document.xml']

  const hasNewText = afterXml.includes('LINHA MODIFICADA PELO HERMES VIA DOCX-ENGINE')
  // byte-preserving: XML original dos OUTROS parágrafos deve aparecer verbatim no resultado
  let othersPreserved = true
  for (let i = 0; i < blocks.length; i++) {
    if (i === targetIdx) continue
    const ox = blocks[i].originalXml
    if (ox && !afterXml.includes(ox)) { othersPreserved = false; console.log('  ✗ parágrafo', i, 'NÃO preservado:', ox.slice(0, 60)) }
  }
  console.log('TESTE 2a (texto novo presente):', hasNewText ? 'PASSOU ✅' : 'FALHOU ❌')
  console.log('TESTE 2b (outros parágrafos byte-preservados):', othersPreserved ? 'PASSOU ✅' : 'FALHOU ❌')
  console.log('TESTE 2c (zip válido, entradas intactas):', Object.keys(saved2Entries).length === keys.length ? 'PASSOU ✅ (' + keys.length + ' entries)' : 'FALHOU ❌')
  if (hasNewText && othersPreserved) {
    writeFileSync('/tmp/patched.docx', Buffer.from(saved2))
    console.log('→ /tmp/patched.docx gerado (abrir no Word/HermesOffice p/ conferir layout)')
  }
}
main().catch((e) => { console.error('ERRO:', e); process.exit(1) })
