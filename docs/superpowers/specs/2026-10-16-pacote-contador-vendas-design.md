# Pacote do contador: vendas (ADR-0181, Plano 2a) — design

**Data:** 2026-10-16 · **ADR:** [0181](../../decisions/0181-entrada-por-nota-de-compra-e-pacote-do-contador.md) (D-13, parte "vendas")
**Revisão:** adversarial Codex `gpt-6.1-sol` high (2026-10-16) — 15 achados incorporados, 1 recusado, 2 decididos pelo Diego.
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
  └─ navegador ── fetch POST {mes} (JWT, x-region) ──▶ edge baixar-notas-venda
                                  requireUserOrg(read) → módulo estoque → conexão ML da org
                                  trava Redis por conexão (1 download por vez + 60 s de intervalo)
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

- `verify_jwt = true` (bloco no `supabase/config.toml`); CORS aceita `x-region`. `requireUserOrg(req, { access: 'read' })`
  resolve a org pelo perfil/sessão de suporte; essa org vai no header `X-Org-Id` e a tela recusa montar o pacote se
  divergir da org exibida. Sessão de suporte → `auditarOperacaoSuporte` antes de liberar os bytes.
- Gate: **módulo `estoque`** (o da tela) + conexão ML da org. Sem conexão → 409 "Conecte a conta do Mercado Livre em Canais."
- `mes` validado `^\d{4}-(0[1-9]|1[0-2])$`; mês futuro (em America/Sao_Paulo) → 400. `start` = dia 1, `end` = último dia.
- **Trava por conexão** (Redis, padrão do lock de refresh em `token.ts`): download em andamento ou terminado há menos
  de 60 s → 429 local "Já há um download deste mês em andamento ou recém-feito — aguarde 1 minuto." Protege a cota do
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
- `// ponytail:` teto de 150 s até começar a responder (duração total até 400 s no plano pago): 30–56 s medidos para
  ~1.400 vendas/mês sem medir TTFB. Medir TTFB na validação; se passar de ~100 s, evolução = dividir o mês em
  quinzenas (aceito pelo `stream`), ao custo de mais chamadas contra a cota.

### `ler.ts` — integridade e classificação pelo conteúdo

**Integridade do download:** o zip inteiro é aberto antes de qualquer leitura (diretório central presente, toda
entrada descompacta com o tamanho declarado e o CRC confere). Falhou → erro "O download veio incompleto — gere o
pacote de novo." e **nenhum** pacote é montado.

**Por documento** (um `DOMParser` por vez, descartado em seguida; `<parsererror>` conta como ilegível):

| Documento | Regra | Vai para |
|---|---|---|
| NF-e de venda | `nfeProc` com `protNFe` `cStat` 100/150, `tpNF`=1, `finNFe` 1 ou 2, e todo item com CFOP de venda (5.1xx, 6.1xx, 5.4xx, 6.4xx, 7.1xx) | aba Vendas, tipo **venda** (ou **complementar** se `finNFe`=2) |
| NF-e de devolução de venda | `tpNF`=0, `finNFe`=4, com `refNFe` | aba Vendas, tipo **devolução** |
| NF-e de saída sem CFOP de venda (remessa Full, etc.) ou CFOP misto | demais `nfeProc` | Conferência, "outros documentos fiscais" (lista chave + CFOPs) |
| Cancelamento | `procEventoNFe` `tpEvento` 110111 com `retEvento` `cStat` 135/155 | marca a chave como cancelada; sem nota no zip → Conferência "cancelamento de nota de outro mês" |
| CC-e | `tpEvento` 110110 com `cStat` 135/155 | coluna "Carta de correção" (maior `nSeqEvento`) |
| Evento rejeitado | `cStat` diferente dos aceitos | Conferência, "eventos rejeitados" — não altera status |
| Inutilização | `procInutNFe`/`inutNFe`: homologada só com `retInutNFe` `cStat` 102 | Conferência (faixa e resultado, homologada ou rejeitada) |
| Ilegível ou campo obrigatório ausente (`chNFe`, `dhEmi`, `nNF`, `serie`, `vNF`) | — | Conferência + **PACOTE PARCIAL** |

- **Deduplicação por chave:** a mesma chave em dois caminhos conta uma vez; se os conteúdos divergirem → Conferência + PARCIAL.
- **Competência e fuso:** `dhEmi` convertida para instante; competência = mês de `dhEmi` em America/Sao_Paulo. Nota do
  zip fora do mês pedido → Conferência "fora do período" (não entra nos totais do mês). Ordenação por instante,
  desempate pela chave.
- **Valores em centavos inteiros**; chave, número e série como **texto** no xlsx.

## Relatório

**Aba "Vendas"** — uma linha por NF-e de venda/complementar/devolução, ordem crescente de `dhEmi`:
Data de emissão (America/Sao_Paulo) · Tipo · Status (autorizada/cancelada) · Número · Série · Chave · Produtos (`vProd`) ·
Frete (`vFrete`) · Desconto (`vDesc`) · Total (`vNF`) · Carta de correção.

**Totais por grupo** (sem "faturamento líquido", que é apuração do contador): vendas autorizadas · vendas canceladas ·
complementares autorizadas · devoluções autorizadas · devoluções canceladas.

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
