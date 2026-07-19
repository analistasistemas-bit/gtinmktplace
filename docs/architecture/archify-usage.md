# Uso da skill Archify neste projeto

> Referência de como os 8 diagramas em `docs/architecture/diagrams/` foram gerados e como regenerá-los.

## Localização e versão

- Instalada globalmente em `~/.agents/skills/archify` (symlink para Claude Code), instalada via `npx skills add tt-a1i/archify -g` em 2026-07-19.
- `metadata.version` no `SKILL.md`: **2.11**. Baseada em Cocoon-AI/architecture-diagram-generator (MIT, v1.0).
- Verificação de instalação: `node bin/archify.mjs doctor` (a partir da pasta da skill) — confirma Node ≥18, template, validadores standalone e os 5 renderers (architecture, workflow, sequence, dataflow, lifecycle).

## Forma de uso

Não há dependências para instalar — os validadores são compilados a partir dos 5 JSON Schemas e distribuídos com a skill. Todo comando roda com `node bin/archify.mjs <comando> ...` **a partir de `~/.agents/skills/archify`** (os caminhos de input/output podem ser absolutos, apontando para fora da pasta da skill).

## Comandos usados neste projeto

```bash
# validar o JSON antes de renderizar (pega overlap de label, componente fora do viewBox, etc.)
node bin/archify.mjs validate <tipo> <arquivo>.json --json

# renderizar o HTML final a partir do JSON
node bin/archify.mjs render <tipo> <arquivo>.json <saida>.html

# verificar um HTML já gerado (SVG único, sem valores non-finite, setas ortogonais, legenda sem sobreposição)
node bin/archify.mjs check <saida>.html

# inspecionar retângulos/paths computados sem abrir o HTML (útil para calibrar labelAt)
node bin/archify.mjs inspect <tipo> <arquivo>.json
```

`<tipo>` é um de: `architecture`, `workflow`, `sequence`, `dataflow`, `lifecycle`. Este projeto usou apenas `architecture` (diagramas 01, 02, 05, 06, 07, 08) e `workflow` (diagramas 03, 04) — `sequence`, `dataflow` e `lifecycle` ficaram sem uso real (ver `backlog.md`).

## Tipos suportados e por que cada um foi escolhido aqui

| Diagrama | Tipo Archify | Por quê |
|---|---|---|
| 01 Visão Geral | `architecture` | componentes + fronteiras, ≤12 elementos |
| 02 Arquitetura Geral | `architecture` | contêineres, sem processo/sequência |
| 03 Fluxo de Publicação | `workflow` | processo com etapas e lanes (operador/pipeline/publicação) |
| 04 Fluxo de Sincronização | `workflow` | processo com fonte principal + 2 fontes paralelas agendadas |
| 05 Modelo de Dados | `architecture` (pseudo-ERD) | Archify não tem modo ERD nativo; entidades = componentes, relações = conexões |
| 06 Multi-Tenant | `architecture` | fronteiras `security-group` mapeiam bem o conceito de tenant |
| 07 Infraestrutura | `architecture` | mesmo padrão do 02, foco em onde roda / deploy |
| 08 TO-BE | `architecture` | delta pequeno sobre o AS-IS, sem redesenho |

## Formatos de saída

- **HTML** — artefato-fonte canônico. Self-contained (CSS + SVG inline + ~19KB de JS), com toggle de tema claro/escuro e menu de exportação.
- **SVG / PNG** — exportados pelo **mecanismo oficial da própria página** (menu "Export" no HTML: `#btn-export` → `button[data-format="png"|"svg"]`), automatizado neste projeto via Playwright (script descartável, ver "Processo de exportação" abaixo) — não existe subcomando de CLI para export.
- **JPEG/WebP** — suportados pelo mesmo menu, não usados aqui (PNG + SVG bastam para README/onboarding).

## Processo de validação

1. `validate` — schema JSON + regras de layout (overlap de componente/label, componente fora do viewBox, setas diagonais de 2 pontos, colunas/lanes grudadas). Falha com mensagem `Suggested fix: labelAt [x,y] ...` — aplicar o valor sugerido é o caminho mais rápido.
2. `render` — gera o HTML. Só roda se `validate` passar (o próprio `render` valida de novo internamente).
3. `check` — roda os mesmos 4 checks (`single_svg`, `finite_svg`, `orthogonal_arrows`, `legend_clearance`) sobre o HTML já gerado, útil para confirmar depois de editar manualmente.

Nos 8 diagramas deste projeto, o padrão que mais exigiu iteração foi label sobrepondo componente ou outro label — sempre resolvido com o `labelAt` exato sugerido pelo validador, sem precisar adivinhar offsets.

## Processo de exportação (SVG/PNG)

A skill não tem subcomando de CLI para exportar SVG/PNG — o mecanismo oficial é o menu "Export" dentro do próprio HTML (JS do navegador, `canvas.toDataURL`/download de SVG). Para automatizar sem intervenção manual, este projeto usou um script Playwright descartável que abre o HTML headless e clica nos botões reais do menu (`#btn-export` → `button[data-format="png"|"svg"]`), aguardando o evento de download — **não é uma exportação fabricada manualmente**, é o mesmo mecanismo que um humano acionaria clicando no navegador.

Para regenerar manualmente (sem Playwright): abrir `diagram.html` em qualquer navegador → clicar no ícone de export na toolbar → "Download PNG" / "Download SVG" → salvar como `diagram.png` / `diagram.svg` na mesma pasta.

## Limitações conhecidas da skill (relevantes para este projeto)

- **Cards (`cards: [...]`) não aparecem no PNG/SVG exportado.** São renderizados como HTML (`<div class="cards">`) **abaixo** da tag `</svg>`, não como parte do desenho. O HTML continua sendo o artefato canônico e completo; PNG/SVG cobrem só o diagrama, não os cards de contexto. Isso não é um bug dos diagramas deste projeto — é como a skill funciona.
- **Sem estilo nativo de "borda tracejada" em componente** (só em conexões, via `variant: "dashed"`). No diagrama 08 (TO-BE), a distinção AS-IS/proposto usa a tag de texto `"PROPOSTO"` em vez de um traço visual do próprio nó.
- **Sem modo ERD dedicado** — o diagrama 05 usa `architecture` com componentes/conexões fazendo o papel de entidades/relações; sem cardinalidade formal além do texto do label.
- **Layout budget do `workflow`**: colunas 1↔2 e 3↔4 ficam a só 70-80px — nós do mesmo lane em colunas adjacentes nessa faixa colidem por padrão; a solução que funcionou neste projeto foi usar 1 lane por nó do caminho principal, evitando 2 nós do mesmo lane em colunas vizinhas apertadas.
- **`validate`/`render` lançam exceção (exit code ≠ 0) em vez de só reportar erro** — script/CI precisa tratar isso, não é um retorno JSON de erro tranquilo quando o layout falha (só quando passa).

## Instruções de regeneração (resumo)

Para qualquer diagrama:
```bash
cd ~/.agents/skills/archify
node bin/archify.mjs validate <tipo> "<projeto>/docs/architecture/diagrams/NN-nome/diagram.<tipo>.json" --json
node bin/archify.mjs render   <tipo> "<projeto>/docs/architecture/diagrams/NN-nome/diagram.<tipo>.json" "<projeto>/docs/architecture/diagrams/NN-nome/diagram.html"
node bin/archify.mjs check    "<projeto>/docs/architecture/diagrams/NN-nome/diagram.html"
```
Depois, para SVG/PNG: abrir o HTML no navegador e usar o menu Export, ou repetir a automação Playwright descrita acima.
