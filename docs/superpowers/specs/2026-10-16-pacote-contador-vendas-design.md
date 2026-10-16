# Pacote do contador: vendas (ADR-0181, Plano 2a) — design

**Data:** 2026-10-16 · **ADR:** [0181](../../decisions/0181-entrada-por-nota-de-compra-e-pacote-do-contador.md) (D-13, parte "vendas")
**Revisão:** adversarial Codex `gpt-6.1-sol` high (2026-10-16) — 15 achados incorporados, 1 recusado, 2 decididos pelo Diego.
**Status:** implementado na branch `worktree-plano2-pacote-contador`, aguardando revisão final, merge e deploy da edge. Reconciliado com os rulings R1–R7 do plano (`docs/superpowers/plans/2026-10-16-pacote-contador-vendas.md`).
**Fora deste plano:** compras e inventário (D-12, D-13 "compras"/"inventário") → Plano 2b.

## Objetivo

A loja baixa, em `/estoque`, **um arquivo por mês** para entregar ao contador:
`pacote-AAAA-MM.zip` com os XMLs fiscais que o Mercado Livre tem do mês + `relatorio-vendas.xlsx` + `relatorio-vendas.pdf`.
O contador real pediu "o XML de todas as vendas e um relatório detalhado, venda por venda, nota por nota,
com valores e datas, em ordem crescente de data".

**Sucesso:** o contador recebe o pacote de um mês com **todas as notas disponíveis no ML** para aquele mês,
o relatório nota a nota conferível contra os XMLs, e nenhuma incompletude escondida.

**Cobertura (o que o pacote NÃO garante):** nota emitida em ERP externo e não enviada ao ML não está no download do
ML e não aparece no pacote. A Conferência diz isso por escrito.

## Decisões que emendam o D-13 (Diego, 2026-10-16)

1. **"Vendas sem nota" fica fora do 2a e é declarada pendente.** O vínculo venda↔nota depende de onde o pedido ML
   aparece no XML do Faturador — sem amostra até a primeira venda faturada. O 2a não promete o que não entrega:
   colunas "Pedido ML"/"Data da venda" não existem nesta versão; a Conferência avisa que a conciliação com as vendas
   não está incluída.
2. **1 lote = 1 mês.** A API limita a ~3–4 chamadas em poucos minutos (429), então lotes menores batem no limite.
   "Retomar" = baixar o mês de novo. O manifesto é a aba Conferência.

## Restrições (decisões anteriores)

- XMLs e relatórios **não são gravados** (nem banco, nem storage). Exceções operacionais existentes, que gravam:
  renovação do token do ML (rotação obrigatória) e auditoria do modo suporte.
- Custo de precificação fora do pacote. ST, livro de inventário estadual e devoluções ao fornecedor: V2.
- API indisponível ≠ ausência de nota; pacote parcial é declarado parcial. Formatos: **xlsx e PDF** (decisão do Diego).

## API medida (spike 2026-10-16, só leitura, duas lojas)

`GET /users/{id}/invoices/sites/MLB/batch_request/period/stream?start=AAAAMMDD&end=AAAAMMDD&sale=all&return=all&full=all&others=correction_letter&file_types=xml&simple_folder=false`

- Devolve `application/zip` direto. Token atual do app basta (sem escopo novo).
- **Intervalo máximo ~1 mês:** 2 meses ou 1 ano → `400 Invalid input.`
- **Mês sem documento → 404 com corpo vazio** (observado).
- **429 após 3–4 chamadas em poucos minutos**, sem `Retry-After`; ~5 min depois voltou. Escopo da cota (por conta ou
  por app) **não medido**.
- Volume real (loja com ~1.400 vendas/mês, emissão por ERP), com `others=all`: 2.698 arquivos (1.351 NF-e + 1.347
  CT-e), 11,6 MB, 56 s; sem filtros: 1.350 XMLs, 6,1 MB, 30 s. **CT-e fica fora** (`others=correction_letter`):
  documento de transporte, não de venda, e dobra tamanho e tempo.
- Pastas variam por origem e filtro → classificar pelo **conteúdo** do XML, nunca pela pasta.
- `invoices/orders/{order_id}` → 403 PolicyAgent na loja que emite por ERP, e é 1 chamada por pedido. Não é usado.
- Prefixo numérico do nome do arquivo **não** é pedido, pack nem envio (conferido contra `ml_vendas`).
- **Não medido:** fuso e inclusividade de `start`/`end`; se o evento de cancelamento entra pelo mês do evento ou da
  nota; tempo até o primeiro byte (TTFB).

## Arquitetura (abordagem A: edge repassa, navegador monta)

```
/estoque [Pacote do contador · mês · Baixar]
  └─ navegador ── fetch POST {mes} (JWT) ──▶ edge baixar-notas-venda
                                  requireUserOrg(full) → módulo estoque → conexão ML da org
                                  trava Redis por conexão (460 s enquanto baixa + cooldown de 60 s ao terminar)
                                  getValidAccessTokenConexao → GET .../period/stream
                 ◀── stream ───── 200 application/octet-stream + X-Org-Id + X-Conta-Ml (sem gravar o zip)
  arrayBuffer → validar zip inteiro → ler.ts → relatorio-xlsx.ts / relatorio-pdf.ts → montar.ts → download
```

Rejeitado: edge parsear XML e gerar xlsx/pdf (CPU de 2 s por requisição, ADR-0173).

### Unidades

| Unidade | Faz | Entrada → saída |
|---|---|---|
| `supabase/functions/baixar-notas-venda/` (`index.ts` + `processar.ts`) | gate, trava, intervalo, chamada ML, mapeia status, repassa stream | `{mes:'AAAA-MM'}` → bytes \| erro JSON |
| `src/lib/pacote-contador/baixar.ts` | `fetch` autenticado, `arrayBuffer()`, confere `X-Org-Id` com a org da tela | mês → `Uint8Array` \| erro tipado |
| `src/lib/pacote-contador/ler.ts` | valida o zip inteiro, classifica e lê cada XML, um DOM por vez (puro) | `Uint8Array` → `{ documentos, conferencia }` |
| `src/lib/pacote-contador/relatorio-xlsx.ts` | workbook próprio: abas Vendas + Conferência (SheetJS direto; não reusa `montarWorkbook`, que tem outro formato) | → `Uint8Array` |
| `src/lib/pacote-contador/relatorio-pdf.ts` | jsPDF + autotable próprios (não reusa `gerarPdf`): paisagem, colunas ajustadas, página de Conferência | → `Uint8Array` |
| `src/lib/pacote-contador/montar.ts` | zip final: XMLs originais + 2 relatórios (`fflate`) | → `Blob` `pacote-AAAA-MM.zip` |
| card em `src/pages/Estoque.tsx` | seletor de mês (padrão: anterior; futuro não aparece), botão, progresso em 3 etapas, botão travado durante o download | — |

Dependência nova: `fflate`. O download **não** usa `supabase.functions.invoke()`: na versão instalada
(`functions-js` 2.106.2) um `application/zip` cai em `response.text()` e os bytes se perdem.

### Edge `baixar-notas-venda`

- `verify_jwt = true` (bloco no `supabase/config.toml`). O `x-region` **não é enviado** (R5): nenhum `fetch` cru do app
  o envia e a edge não exige região. `requireUserOrg` resolve a org pelo perfil/sessão de suporte; essa org vai no header
  `X-Org-Id` e a tela recusa montar o pacote se divergir da org exibida.
- **Suporte em modo somente leitura não exporta** (R4): o `AppShell` envolve a página em `<fieldset disabled>` e tirar os
  controles dele mexe no shell inteiro. Suporte "full" exporta (com `auditarOperacaoSuporte` antes de liberar os bytes).
  Custo se errado: o suporte read pede escalonamento para baixar o pacote.
- A camada HTTP (`index.ts`) não tem teste unitário (R5); a lógica está em `processar.ts` (testado). Cobertura do handler:
  `deno check` + validação de runtime.
- Gate: **módulo `estoque`** (o da tela) + conexão ML da org. Sem conexão → 409 "Conecte a conta do Mercado Livre em Canais."
- `mes` validado `^\d{4}-(0[1-9]|1[0-2])$`; mês futuro (em America/Sao_Paulo) → 400. `start` = dia 1, `end` = último dia.
- **Trava por conexão** (R1; Redis, `lock:notas-venda:<conexaoId>`, padrão do lock de refresh em `token.ts`): `SET NX` de
  **460 s** no início (> teto de 400 s de execução da edge). Ao **terminar** (stream lido até o fim, erro do stream,
  cancelamento, ou qualquer resposta não-zip depois de travar) a chave vira um **cooldown de 60 s**. Trava ocupada → 429
  local "Já há um download de notas desta conta em andamento ou recém-feito — aguarde alguns minutos." Protege a cota do
  ML contra cliques e abas repetidas.
- Status do ML:

  | ML | Edge | Tela |
  |---|---|---|
  | 200 com corpo | 200 `application/octet-stream`, stream do body | segue |
  | 404 com corpo vazio | 200 JSON `{ vazio: true }` | pacote com "Nenhuma nota no mês" |
  | 404 com corpo, 400, 200 sem corpo, tipo inesperado | 502 JSON | "Não foi possível confirmar as notas do mês." |
  | 429 | 429 JSON | "O Mercado Livre limitou os downloads — tente de novo em alguns minutos (cerca de 5)." |
  | 401 / 403 | 409 JSON | "A conta do Mercado Livre não autorizou o download das notas." |
  | 5xx / timeout antes dos headers | 502 JSON | "Mercado Livre indisponível — o pacote não foi gerado." |

- Falha **depois** dos headers (stream cortado) não vira 502: o cliente detecta pelo zip inválido (abaixo). Cancelar no
  navegador aborta a chamada ao ML (`AbortSignal` propagado).
- Nenhuma escrita além das exceções operacionais. Lógica pura em `processar.ts` com dependências injetadas.
- `// ponytail:` teto de 120 s para token + headers + 1º chunk (o gateway corta em 150 s sem resposta; duração total até 400 s no plano pago): 30–56 s medidos para
  ~1.400 vendas/mês sem medir TTFB. Medir TTFB na validação; se passar de ~100 s, evolução = dividir o mês em
  quinzenas (aceito pelo `stream`), ao custo de mais chamadas contra a cota.

### `ler.ts` — integridade e classificação pelo conteúdo

**Integridade do download:** o zip inteiro é aberto antes de qualquer leitura (diretório central presente, toda
entrada descompacta sem erro, com o tamanho declarado, e o **CRC32 calculado confere com o CRC32 do diretório central** —
R2; sem ZIP64, pois os zips do ML medidos têm ≤ 12 MB). Falhou → erro "O download veio incompleto — gere o
pacote de novo." e **nenhum** pacote é montado.

**Por documento** (um `DOMParser` por vez, descartado em seguida; `<parsererror>` conta como ilegível):

| Documento | Regra | Vai para |
|---|---|---|
| NF-e de venda | `nfeProc` com `protNFe` `cStat` 100/150, `tpNF`=1, `finNFe` 1 ou 2, e **todo** item com CFOP da lista explícita de venda (R6, abaixo) | aba Vendas, tipo **venda** (ou **complementar** se `finNFe`=2) |
| NF-e de devolução de venda | `tpNF`=0, `finNFe`=4, com `refNFe`, e **todo** item com CFOP da lista explícita de devolução de venda (R6, abaixo) | aba Vendas, tipo **devolução** |
| NF-e de saída sem CFOP de venda (remessa Full, transferência etc.) ou CFOP misto | demais `nfeProc` | Conferência, "outros documentos fiscais" (lista chave + CFOPs) |
| Cancelamento | `procEventoNFe` `tpEvento` 110111 com `retEvento` `cStat` **135/155** | marca a chave como cancelada; sem nota no zip → Conferência "cancelamento de nota de outro mês" |
| CC-e | `tpEvento` 110110 com `retEvento` `cStat` **135** (R7) | coluna booleana "Carta de correção" (sim/não); a "maior sequência" saiu, pois o relatório não exibe o texto da correção |
| Evento sem aplicação | cancelamento/CC-e com `cStat` fora dos aceitos (ex.: **136** = evento registrado sem vinculação, não aplicado) | Conferência, "eventos não aplicados" — não altera status |
| Evento sem retorno ou inconsistente com o pedido | sem `retEvento`, chave/`tpEvento`/`nSeqEvento` divergentes | Conferência + **PACOTE PARCIAL** (incompleto) |
| Inutilização | `procInutNFe`/`inutNFe`: homologada só com `retInutNFe` `cStat` 102; **sem `retInutNFe`** = incompleto | Conferência (faixa e resultado, homologada ou rejeitada); sem retorno → incompleto + **PACOTE PARCIAL** |
| Ilegível ou campo obrigatório ausente (`chNFe`, `dhEmi`, `nNF`, `serie`, `vNF`) ou valor fora do formato | — | Conferência + **PACOTE PARCIAL** |

**Listas de CFOP (R6)** — explícitas, não faixas; copiadas de `src/lib/pacote-contador/ler.ts`:

- Venda: 5101, 5102, 5103, 5104, 5105, 5106, 5109, 5110, 5111, 5112, 5113, 5114, 5115, 5116, 5117, 5118, 5119, 5120, 5122, 5123,
  5401, 5402, 5403, 5405; 6101, 6102, 6103, 6104, 6105, 6106, 6107, 6108, 6109, 6110, 6111, 6112, 6113, 6114, 6115, 6116,
  6117, 6118, 6119, 6120, 6122, 6123, 6401, 6402, 6403, 6404; 7101, 7102, 7105, 7106, 7127.
- Devolução de venda: 1201, 1202, 1203, 1204, 1410, 1411, 2201, 2202, 2203, 2204, 2410, 2411, 3201, 3202, 3211.
- Transferências (5151/5152/5408/5409/1208/1209…) e remessas vão para "outros".

**Valores:** `vProd`, `vFrete`, `vDesc` e `vNF` no formato `^\d{1,13}(\.\d{1,2})?$` (ausente = 0; fora do formato = incompleto).

- **Deduplicação por chave:** a mesma chave em dois caminhos conta uma vez; se os conteúdos divergirem → Conferência + PARCIAL.
- **Competência e fuso:** `dhEmi` convertida para instante; competência = mês de `dhEmi` em America/Sao_Paulo. Nota do
  zip fora do mês pedido → Conferência "fora do período" (não entra nos totais do mês). Ordenação por instante,
  desempate pela chave.
- **Valores em centavos inteiros**; chave, número e série como **texto** no xlsx.

## Relatório

**Aba "Vendas"** — uma linha por NF-e de venda/complementar/devolução, ordem crescente de `dhEmi`:
Data de emissão (America/Sao_Paulo) · Tipo · Status (autorizada/cancelada) · Número · Série · Chave · Produtos (`vProd`) ·
Frete (`vFrete`) · Desconto (`vDesc`) · Total (`vNF`) · Carta de correção.

**Totais por grupo** (R3; sem "faturamento líquido", que é apuração do contador): os 6 grupos venda/complementar/devolução ×
autorizada/cancelada, em ordem fixa, mesmo com zero.

**Aba "Conferência"** (no PDF: página própria): org, CNPJ (de `empresa_fiscal`, se houver), conta ML, mês, data/hora da
geração; contagem por classificação; outros documentos fiscais; cancelamentos de nota de outro mês; eventos
rejeitados; inutilizações; ilegíveis/incompletos e divergências de chave; notas fora do período; avisos fixos:
"Conciliação com as vendas não incluída nesta versão" e "Notas emitidas fora do Mercado Livre e não enviadas a ele
não aparecem aqui"; "Mês em andamento" quando for o mês atual; "Nenhuma nota no mês" quando o ML respondeu 404 vazio.
Selo **PACOTE PARCIAL** em destaque (topo das duas abas e do PDF) com os motivos listados.

**PDF:** paisagem A4, tabela multipágina com cabeçalho repetido, chave em fonte menor/quebra controlada, totais no fim.

## Testes

1. `ler.ts` — zips montados com `fflate` a partir de XMLs sintéticos (formato SEFAZ com namespace, CNPJs de fixture
   `11222333000181`/`11444777000161`): venda; complementar; remessa Full (CFOP 5949/6949) fora das vendas; CFOP misto;
   devolução de venda; cancelamento homologado; cancelamento rejeitado; cancelamento de nota fora do zip; CC-e com 2
   sequências; inutilização homologada e rejeitada; chave duplicada igual e divergente; XML com `<parsererror>`;
   campo obrigatório ausente; zip truncado (rejeitado inteiro); zip sem documentos; nota de 30/09 23:30−03:00 em
   pacote de setembro e de outubro; os dois formatos de nome de pasta medidos.
2. xlsx: reler com SheetJS — tipos das células (chave como texto), ordem, totais por grupo, Conferência, selo PARCIAL.
3. pdf: gerar com 300 linhas e conferir número de páginas e texto extraído (cabeçalho, totais, selo) pelo próprio jsPDF/autotable em teste.
4. `baixar.ts`: `X-Org-Id` divergente recusa; bytes binários preservados (fetch mockado devolvendo zip real).
5. edge (`processar.ts`): intervalo do mês (fevereiro/bissexto), mês futuro no fuso de São Paulo, toda a tabela de
   status, trava ocupada → 429 local.
6. **Runtime** (app em produção, org DSA com a conta VALIDATION, que já é membro dela; nenhuma conexão alterada):
   - setembro: tempo até o primeiro byte e total; zip binário íntegro; preflight com `x-region`;
   - **conferência independente:** nº de NF-e de venda autorizadas × pedidos pagos de `ml_vendas` no mês (diferença
     explicada) e 5 notas sorteadas conferidas campo a campo contra o XML aberto à mão;
   - duplo clique / duas abas → segunda recebe 429 local;
   - **filtro sem CT-e não perde nada fiscal:** o mesmo mês baixado com `others=all` (uma chamada, respeitando o
     intervalo da cota) tem exatamente os mesmos NF-e, eventos de cancelamento e CC-e; só os CT-e somem. Se não tiver,
     volta para `others=all` e o CT-e cai na Conferência como "outros documentos";
   - leitura direta (token, só GET, autorizada) de um mês de outra loja para conferir contagens e tempo.
   Zips de teste só no tmp do job, apagados no fim (dados de clientes).

## Pendências (a verificar)

1. **Pedido ML no XML do Faturador** (primeira venda faturada pelo Faturador): onde aparece (`xPed`, `infCpl`, outro —
   `xPed` não é, por leiaute, o pedido do ML) e se há vários pedidos por nota. Com isso: colunas Pedido ML/Data da
   venda e aba **"Vendas sem nota"** (incremento seguinte).
2. Critério temporal da API para eventos (mês do evento ou da nota) e fuso de `start`/`end` — sem amostra; a
   Conferência cobre os dois casos (cancelamento de outro mês, nota fora do período).
3. Escopo da cota 429 (por conta ou por app).

## Docs a atualizar na entrega

ADR-0181 (resultado do spike, emendas 1 e 2 do D-13, 2a entregue), `docs/reference/edge-functions.md` (nova edge),
`docs/TASKS.md` (e corrigir a linha de deploy do Plano 1 já feito), `docs/project-status.md`, vault `Fiscal.md`/`Estoque.md`.
