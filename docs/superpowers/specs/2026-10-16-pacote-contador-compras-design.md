# Pacote do contador: compras (ADR-0181, Plano 2b-1) — design

**Data:** 2026-10-16 · **ADR:** [0181](../../decisions/0181-entrada-por-nota-de-compra-e-pacote-do-contador.md) (D-13, parte "compras")
**Base:** Plano 2a em produção (`docs/superpowers/specs/2026-10-16-pacote-contador-vendas-design.md`) — card "Pacote do contador" em `/estoque`.
**Revisão:** adversarial Codex `gpt-6.1-sol` high (2026-10-16) — 15 achados incorporados; 2 decididos pelo Diego.
**Fora deste plano:** inventário (D-12) → Plano 2b-2.

## Objetivo

O mesmo `pacote-AAAA-MM.zip` do 2a passa a levar também as **compras do mês**: os XMLs das notas de compra importadas
no PubliAI + `relatorio-compras.xlsx` e `relatorio-compras.pdf` (uma linha por item).

**Sucesso:** um arquivo por mês com vendas e compras; uma falha do Mercado Livre não impede o contador de receber as
compras (fora do suporte); nenhuma incompletude escondida.

**Cobertura (escrita na Conferência):** só notas **importadas no PubliAI** (as que passaram pela validação do Plano 1:
NF-e modelo 55, `tpNF=1`, CFOP aceito). Quantidade, unidade e CFOP são os **documentais do fornecedor** (ex.: 2 CX com fator
12 aparecem como 2 CX, embora tenham entrado 24 peças no estoque). O pacote é **regenerável**: reflete as notas conhecidas e os
estados observados no momento da geração; se uma nota do mês for importada depois, gere de novo e substitua o anterior.

## Decisões do Diego (2026-10-16)

1. **Competência = data de emissão** da nota de compra (`emitida_em`, `timestamptz`; mês em America/Sao_Paulo). A planilha mostra também a data de importação.
2. **Mesmo pacote** das vendas, com fallback "vendas indisponíveis" quando o ML falha (tabela abaixo).
3. **Uma linha por item**, com o cabeçalho da nota repetido, **incluindo CSOSN/CST** do fornecedor (lido do XML).
4. **Notas desfeitas e marcadas canceladas vão no zip, em pastas separadas** (`compras/xmls-desfeitas/`, `compras/xmls-canceladas/`), listadas na Conferência e **fora da planilha e dos totais**. "Desfazer" é operação de estoque, não cancelamento fiscal; "cancelada" é marcação do operador (D-11), não um evento SEFAZ verificado. As datas aparecem como "desfeita/marcada cancelada no PubliAI em <data>".
5. **Em sessão de suporte não há fallback:** falha na parte de vendas aborta o pacote inteiro. A edge de vendas audita o **pacote** (vendas + compras), então nenhuma exportação em suporte sai sem registro.

## Fontes e fluxo (tudo no navegador; XML como fonte fiscal)

Sem edge nova e sem migration. As policies existentes dão leitura por org (`current_org_id()` nas tabelas; bucket
`notas-compra` pelo 1º segmento do path) — `20261015231837_adr181_nota_compra.sql`, recriadas em `20261015233207`.

```
card (mês) ──▶ em paralelo:
  vendas : baixarNotasMes (2a)                        → zip | vazio | indisponível(motivo) | fatal
  compras: listarNotasCompraMes(mes, org)             → TODAS as páginas (buscarTodasPaginas), ordem emitida_em, id
           fila com 4 downloads em paralelo, 30 s cada → bytes (arrayBuffer) → sha256(bytes) = xml_sha256?
           lerCompra(texto decodificado dos bytes)    → cabeçalho + itens + totais do ICMSTot
  conferir() (abort + org) → relatórios → pacote-AAAA-MM.zip
```

Zip:
```
relatorio-vendas.xlsx · relatorio-vendas.pdf · relatorio-compras.xlsx · relatorio-compras.pdf
xmls/<caminho do ML>…                         (vendas, 2a — ausente quando indisponível)
compras/xmls/<chave>.xml                       (importadas)
compras/xmls-desfeitas/<chave>.xml · compras/xmls-canceladas/<chave>.xml
```
O XML vai para o zip com **os mesmos bytes** baixados (os que geraram o hash da importação, `TextEncoder(xml)` em
`importar-nota-compra/index.ts`). Garantia: bytes preservados desde a importação, não o arquivo local original
(a importação usa `file.text()`). `assinada` indica presença de `Signature`, não validação criptográfica.

### Unidades

| Unidade | Faz |
|---|---|
| `src/lib/pacote-contador/compras-fonte.ts` | `listarNotasCompraMes(mes, org)`: `notas_compra` com `.eq('org_id', org)` + RLS, `emitida_em >= <dia 1 00:00 SP em ISO com offset>` e `< <dia 1 do mês seguinte 00:00 SP>`, `order('emitida_em').order('id')`, via `buscarTodasPaginas` (falha em qualquer página aborta). `baixarXmlCompra(nota, signal)`: `storage.from('notas-compra').download(xml_path)` → `arrayBuffer` → SHA-256 (Web Crypto) dos bytes. Fila com concorrência 4 e timeout 30 s por XML, cancelável, com callback de progresso |
| `src/lib/pacote-contador/compras-ler.ts` | `lerCompra(texto)`: `lerNfe` (reuso, sem alteração) + extração própria de, por item, `det/imposto/ICMS/<grupo>/CSOSN` ou `CST` (só dentro do grupo ICMS; zeros preservados; tipo `csosn`/`cst`; ausente = "não informado") e de `ide/finNFe`. `montarCompras(...)` (puro) → linhas por item, totais por nota e mês, conferência |
| `src/lib/pacote-contador/relatorio-compras-xlsx.ts` / `-pdf.ts` | abas "Compras" + "Conferência de compras"; PDF paisagem |
| `src/lib/pacote-contador/montar.ts` | aceita vendas (zip, vazio ou indisponível) + compras (3 pastas + 2 relatórios) |
| `src/lib/pacote-contador/baixar.ts` | org divergente → **`ErroOrgMudou`**; erro com `codigo: 'auditoria'` → **`ErroAuditoria`** (fatal) |
| `supabase/functions/baixar-notas-venda/index.ts` | alvo da auditoria passa a `{ type: 'pacote_contador_mes', id: mes }`; falha de auditoria responde `{ error, codigo: 'auditoria' }` (502). **Redeploy da edge.** `_shared/nfe/ler-nfe.ts` **não muda** (sem redeploy de `importar-nota-compra`) |
| card `card-pacote-contador.tsx` | vendas e compras em paralelo; classifica a falha de vendas; `conferir()` lança `ErroOrgMudou` (os dois pontos de checagem de org); progresso "Compras: N de M XMLs" |

## Relatório de compras

**Aba "Compras"** — uma linha por item, ordem: `emitida_em` (instante), número, `nItem`.

| Bloco | Colunas |
|---|---|
| Nota | Data de emissão (SP) · Data de importação · Fornecedor · CNPJ · Número · Série · Chave · Finalidade (`finNFe`) |
| Item | Nº item · Código do fornecedor · Descrição (`xProd`) · NCM · CFOP · Tipo trib. (CSOSN/CST) · Código trib. · Quantidade (documental) · Unidade (documental) |
| Valores do item (do XML) | Produtos · Frete · Seguro · Desconto · Outras · IPI · ST · FCP-ST |

**Totais por nota** (componentes do `ICMSTot`, não a soma dos itens): chave · número · fornecedor · vProd · vFrete · vSeg ·
vDesc · vOutro · vIPI · vST · vFCPST · **vNF** · **diferença** (`vNF − (vProd − vDesc + vFrete + vSeg + vOutro + vII + vIPI + vIPIDevol + vST + vFCPST)`; vII e vIPIDevol integram o vNF no leiaute)
· divergência aceita na importação (`divergencia_total_aceita`, quando houver). **Total do mês** = soma dos `vNF` das notas
**detalhadas**; a Conferência informa à parte o total das notas listadas sem detalhe (XML indisponível/ilegível), se houver.

- Chave, número, série, CNPJ, NCM, CFOP e códigos tributários como **texto**; dinheiro em **centavos inteiros** com
  `#,##0.00` em toda coluna de dinheiro; quantidade `#,##0.####`.
- `finNFe` ≠ 1 (complementar, ajuste, devolução) → marcada na coluna Finalidade e listada na Conferência; continua na
  planilha com seus valores (o sistema não reclassifica).

**Aba "Conferência de compras"** (no PDF: página própria): org, CNPJ (de `empresa_fiscal` buscado na hora), mês,
data/hora da geração; contagens: notas **selecionadas** no mês, **detalhadas**, **desfeitas**, **marcadas canceladas**,
**com falha**; itens; listas de: desfeitas e canceladas (chave, número, fornecedor, "desfeita/marcada cancelada no PubliAI em
<data>"), cópias sem assinatura digital, finalidade ≠ 1, XML **indisponível** (não baixou / timeout), **integridade não
comprovada** (hash nulo ou malformado), **diferente do importado** (sha256), **ilegível** (íntegro mas `lerNfe` falhou — XML vai no
zip mesmo assim); selo **PACOTE PARCIAL** quando houver qualquer falha; avisos fixos de cobertura e de regeneração (seção
Objetivo); "Nenhuma nota de compra no mês" quando a lista vier vazia.

## Vendas: estados e classificação de falha

O relatório de vendas do 2a passa a ter **três estados**: `zip` (como hoje), `vazio` (ML confirmou sem notas — "Nenhuma nota
no mês", totais zero) e **`indisponível`** (sem totais: a aba Vendas mostra só "Vendas indisponíveis: <motivo> — gere o pacote
de novo depois."; sem `xmls/`). `indisponível` marca o **pacote inteiro** como PARCIAL (selo nos 4 relatórios).

| Falha da parte de vendas | Fora do suporte | Em suporte |
|---|---|---|
| `ErroPacote` 429 (ML ou trava local), 409 (sem conexão / sem permissão), 502/503/504, `ErroRede` (falha do `fetch` antes dos headers — só esse ponto vira erro de rede; `TypeError` de código continua bug), 200 sem `X-Org-Id`, `ErroDownloadIncompleto` (também quando o zip de vendas não abre) | **indisponível** | aborta |
| `ErroAuditoria`, `ErroOrgMudou`, `ErroPacote` 401 ou 403 (sessão/perfil/módulo), `AbortError` | aborta | aborta |
| erro inesperado (bug) | aborta (não vira "indisponível") | aborta |

Compras: falha ao **listar** aborta tudo; falha de uma nota (download, timeout, hash, leitura) vai para a Conferência e marca PARCIAL.
Toast único combinado: `Pacote de AAAA-MM gerado`, ou `Pacote de AAAA-MM gerado como PARCIAL — <motivos curtos>` (ex.:
"vendas indisponíveis; 2 compras com falha").

`// ponytail:` sem orçamento de bytes: fila de 4, timeout 30 s; tudo em memória como no 2a. Teto: meses com milhares de notas de
compra — upgrade = gerar compras em zip separado ou em stream.

## Testes

1. `lerCompra`: grupos `ICMSSN102` (CSOSN 102), `ICMS00` (CST 00), `ICMS60` (CST 60), mistos na mesma nota, ausência ("não informado"), CST de IPI/PIS **não** capturado; `finNFe` 2 e 4; XML ilegível.
2. `montarCompras`: ordem, centavos exatos, totais por componente e diferença (frete só no total; FCP-ST), divergência aceita, desfeita/cancelada fora dos totais e com XML na pasta própria, `assinada=false`, hash nulo/divergente, ilegível no zip, contagens, mês vazio.
3. `listarNotasCompraMes`: limites `>= 2026-10-01T03:00:00Z` e `< 2026-11-01T03:00:00Z` para outubro, com o fuso do processo **diferente** de São Paulo; mais de uma página; falha na página intermediária aborta.
4. `baixarXmlCompra`: hash sobre bytes com BOM confere; divergente; timeout; cancelamento da fila; concorrência máxima 4.
5. xlsx relido com SheetJS (tipos texto, formatos, totais, diferença) e PDF (`output()` com Conferência e selo).
6. `montarPacote`: 3 pastas de compras + 4 relatórios; sem `xmls/` de vendas quando indisponível.
7. Card: vendas 429/502/`TypeError` → indisponível + PARCIAL + toast combinado; `ErroAuditoria`/`ErroOrgMudou`/401 abortam; em suporte, 429 aborta; vazio continua "Nenhuma nota no mês".
8. Edge `baixar-notas-venda` (processar/index): alvo `pacote_contador_mes`; falha de auditoria → `codigo: 'auditoria'`.

**Runtime:** org de teste descartável + conta VALIDATION (procedimento do Plano 1): importar uma nota de teste, gerar o pacote
do mês da emissão, conferir linhas e totais contra o XML; desfazer a nota e gerar de novo (vai para `xmls-desfeitas/`); limpar
tudo depois.

## Pendências

- Inventário (Plano 2b-2): custo médio ponderado móvel com unidades sem nota (planilha/cadastro) e ausência de separação Full no banco.
