import { parseFileToText } from '@hermesoffice/file-parse'

async function main() {
  const parsed = await parseFileToText('packages/pptx-engine/tests/fixtures/01_standard_business.pptx')
  console.log('kind:', parsed.kind)
  console.log('--- texto extraído (primeiros 500 chars) ---')
  console.log(parsed.text.slice(0, 500))
}
main()
