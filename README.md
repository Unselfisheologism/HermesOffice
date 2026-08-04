# HermesOffice

Suíte office AI-nativa para macOS e Windows: processador de texto,
planilha, apresentações e PDF — cinco apps Electron compartilhando uma
camada de engines, construída em torno de edição por IA como fluxo de
primeira classe, não um chat acoplado.

> **Fork de [genspark-ai/hermesoffice](https://github.com/genspark-ai/hermesoffice)**
> (Apache-2.0). Este é um *thin fork*: o código de engines e apps segue o
> upstream, com uma camada própria de identidade e integração com o
> **Hermes Agent** (Nous Research) como IA nativa.

## Download

Releases assinados do fork serão publicados aqui (em construção — use o
[HermesOffice upstream](https://github.com/genspark-ai/hermesoffice/releases) ou
compile local com `npm run dist:mac`).

## Apps

| App           | Product              | O que é                                                                                                                                                                                                                                                                                                                                                 |
| ------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/docs`   | **HermesOffice Docs**   | Processador `.docx`. Round-trip byte-preserving: só parágrafos "dirty" são regenerados (paragraph patch); todo o resto do arquivo original permanece byte a byte, então abrir e salvar nunca quebra layout no Word. Visualização paginada cuja métrica de linha reproduz o layout do original, tracked changes, comentários, estilos, equações, ink. |
| `apps/sheets` | **HermesOffice Sheets** | Planilha `.xlsx`. UI sobre o core open-source [Univer](https://github.com/dream-num/univer) (Apache-2.0) com camada extensa de extensões próprias; import/export xlsx via sidecar Rust (calamine + IronCalc), gráficos renderizados in-house (Konva), pivot tables, slicers, formatação condicional e formula tracing.                                     |
| `apps/slides` | **HermesOffice Slides** | Apresentações `.pptx`. Engine própria de parse/render/edit pptx com masters, gráficos, crop, ink e text shaping (métricas HarfBuzz).                                                                                                                                                                                                                      |
| `apps/pdf`    | **HermesOffice PDF**    | Visualizador/editor PDF em pdf.js + pdf-lib: anotações, formulários, outlines, carimbos, assinaturas, operações de página, impressão.                                                                                                                                                                                                                       |
| `apps/shell`  | **HermesOffice**        | O shell da suíte: home screen, hosting em abas dos quatro editores, auto-update.                                                                                                                                                                                                                                                                          |

Cada app embute o mesmo painel de IA: edição por IA em granularidade de bloco
com snapshots e diffs no docs, agente com tool-calling sobre o estado de
planilha/slides/PDF nos outros.

**IA nativa (Hermes).** Neste fork o provider padrão é o **Hermes Agent**
local — o gateway do Hermes expõe um endpoint OpenAI-compatible
(`http://127.0.0.1:8642/v1`) que roda o agente completo (memória, skills,
tools, MCP). Sem conta Genspark, sem proxy de terceiros: 100% local.
*(Integração em desenvolvimento — ver `docs/hermes-integration.md`.)*

## Engine packages

TypeScript puro, sem dependência de Electron, com testes unitários (exceto o UI kit):

- `packages/docx-engine` — parse de docx → árvore de blocos (com âncoras `docxIndex` e passthrough), geração de fragmentos OOXML, patch de parágrafos em nível de byte.
- `packages/pptx-engine` / `packages/pptx-render` — modelo e renderização pptx.
- `packages/file-parse` — extração de texto para anexos de IA (formatos office e texto).
- `packages/agent-core` — o loop de agente e composição de skills compartilhado por todos os apps.
- `packages/ai-provider` — abstração de provider e streaming para os backends de modelo.
- `packages/ai-search` — auth Genspark + ferramentas de busca web/imagem (mantido do upstream; o fork não depende dele).
- `packages/i18n`, `packages/ui`, `packages/project-store`, `packages/electron-utils` — i18n compartilhado, kit React UI, store de recentes e helpers do processo main.

## Development

```bash
npm install
npm run fixtures     # gera fixtures .docx de teste
npm test             # testes unitários de engines + apps (docs/sheets/slides sem display)
npm run typecheck    # tsc --noEmit em todos os workspaces
npm run dev          # todos os editores + shell contra dev servers Vite
npm run dev:docs     # um único app (mesmo padrão por workspace)
npm run dist:mac     # empacota dmg macOS (regenera third-party notices)
npm run dist:win     # empacota instalador nsis Windows
```

O app sheets adicionalmente precisa de toolchain Rust para o sidecar xlsx
(`cargo` no PATH); `npm run build -w @hermesoffice/sheets` compila
automaticamente.

### Sync com o upstream

```bash
git fetch upstream
git merge upstream/main        # resolve conflitos na camada de fork (rebrand/integração)
python3 tools/rebrand-hermesoffice.py   # garante que nenhum "hermesoffice" voltou
npm install && npm run typecheck
```

## Arquitetura (docx round trip)

```
open docx ─► arquiva original por hash (nunca tocado)
          ─► docx-engine parseia os elementos top-level de word/document.xml (w:p / w:tbl / …)
          ─► árvore de blocos, cada bloco ancorado por docxIndex + fatia XML original
          ─► editor streaming TipTap (manual + edição IA, dirty tracking)
save      ─► blocos dirty → fragmentos OOXML (referenciando só estilos existentes)
          ─► splice no document.xml original (blocos intocados mantêm os bytes originais)
          ─► reempacota zip; todos os outros entries copiados byte a byte
```

A mesma filosofia vale em sheets e slides: o arquivo original é a fonte da
verdade, edições são patches estreitos, e tudo que o editor não tocou
sobrevive ao round trip intacto.

## Segurança

Ver [SECURITY.md](SECURITY.md) para a postura de segurança do processo
(sandboxing do renderer, validação IPC, gating de links externos) e os threat
models para conteúdo gerado por IA.

## Third-party notices

`npm run notices` regenera o resumo de licenças de terceiros
(`tools/gen-third-party-notices.mjs`); todas as dependências runtime são
MIT/Apache-2.0/OFL, e as fontes embutidas (Liberation, Carlito, Caladea, Noto
CJK subsets) são OFL/Apache.

## Licença

HermesOffice é licenciado sob a [Apache License 2.0](LICENSE), com uma
exceção: o diretório `ee/` é reservado para futuros módulos enterprise e é
coberto pela [HermesOffice Enterprise License](ee/LICENSE).

**Atribuição**: este projeto é um fork de
[genspark-ai/hermesoffice](https://github.com/genspark-ai/hermesoffice) (Apache-2.0,
Copyright Mainfunc, Inc.), mantendo o [NOTICE](NOTICE) original. Os nomes e
logos HermesOffice e Genspark são trademarks da Mainfunc, Inc. e não são usados
por este fork — que adota branding próprio, conforme a licença.
