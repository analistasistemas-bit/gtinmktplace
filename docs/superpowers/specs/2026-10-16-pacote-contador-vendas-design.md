# Pacote do contador: vendas (ADR-0181, Plano 2a) — design

**Data:** 2026-10-16 · **ADR:** [0181](../../decisions/0181-entrada-por-nota-de-compra-e-pacote-do-contador.md) (D-13, parte "vendas")
**Fora deste plano:** compras e inventário (D-12, D-13 "compras"/"inventário") → Plano 2b.

## Objetivo

A loja sem ERP baixa, em `/estoque`, **um arquivo por mês** para entregar ao contador:
`pacote-AAAA-MM.zip` com os XMLs de venda do Mercado Livre + `relatorio-vendas.xlsx` + `relatorio-vendas.pdf`.
O contador real pediu "o XML de todas as vendas e um relatório detalhado, venda por venda, nota por nota,
com valores e datas, em ordem crescente de data".

**Sucesso:** o contador recebe o pacote de um mês e não precisa pedir mais nada para as vendas.

## Restrições (decisões já tomadas)

- XML de venda é buscado **ao vivo** no ML na hora da exportação; **nada é gravado** (nem banco, nem storage).
- Custo de precificação fora do pacote. ST, livro de inventário estadual e devoluções ao fornecedor: V2.
- API indisponível ≠ ausência de nota; pacote parcial é declarado parcial.

## API medida (spike 2026-10-16, só leitura, duas lojas)

`GET /users/{id}/invoices/sites/MLB/batch_request/period/stream?start=AAAAMMDD&end=AAAAMMDD&sale=all&return=all&full=all&others=all&file_types=xml&simple_folder=false`

- Devolve `application/zip` direto. Token atual do app basta (sem escopo novo).
- **Intervalo máximo ~1 mês:** 2 meses ou 1 ano → `400 Invalid input.`
- **Mês sem documento → 404** (não zip vazio).
- **429 após 3–4 chamadas em poucos minutos**, sem `Retry-After`; ~5 min depois volta.
- Volume real (loja com ~1.400 vendas/mês, emissão por ERP): 2.698 arquivos (1.351 NF-e autorizadas +
  1.347 CT-e), 11,6 MB compactado / 20,7 MB descompactado, **56 s**. Sem filtros: 1.350 XMLs, 6,1 MB, 30 s.
- Pastas variam por origem e filtro (`Emitidas_Mercado_Livre/...`, `Emitidas_ERP/NF-e de venda/XML/Autorizadas/...`,
  `.../Inutilizadas/Nao_Inutilizadas/...`, `Outros documentos/CT-e/...`) → classificar pelo **conteúdo** do XML.
- `GET /users/{id}/invoices/orders/{order_id}` → **403 PolicyAgent** na loja que emite por ERP; e é 1 chamada
  por pedido (inviável com o 429). Não é usado.
- O prefixo numérico do nome do arquivo **não** é pedido, pack nem envio (conferido contra `ml_vendas`).

## Arquitetura (abordagem A: edge repassa, navegador monta)

```
/estoque [Pacote do contador · mês · Baixar]
  └─ navegador ── POST {mes} ──▶ edge baixar-notas-venda
                                  JWT → org (do JWT) → módulo estoque → conexão ML
                                  getValidAccessTokenConexao (renovação existente, com trava)
                                  GET .../period/stream (mês inteiro, todos os filtros, xml)
                 ◀── stream ───── bytes do zip como chegaram (sem gravar)
  ler.ts → linhas + conferência → relatorio-xlsx.ts / relatorio-pdf.ts → montar pacote (fflate) → download
```

Rejeitado: edge parsear 20 MB de XML e gerar xlsx/pdf (estoura CPU, ADR-0173).

### Unidades

| Unidade | Faz | Entrada → saída |
|---|---|---|
| `supabase/functions/baixar-notas-venda/` | gate, intervalo do mês, chamada ML, mapeia status, repassa stream | `{mes:'AAAA-MM'}` → zip \| erro JSON |
| `src/lib/pacote-contador/ler.ts` | abre zip, classifica e lê cada XML (puro) | `Uint8Array` → `{ documentos, conferencia }` |
| `src/lib/pacote-contador/relatorio-xlsx.ts` | abas Vendas + Conferência | documentos → `Uint8Array` |
| `src/lib/pacote-contador/relatorio-pdf.ts` | tabela paisagem + página de resumo | documentos → `Uint8Array` |
| `src/lib/pacote-contador/montar.ts` | zip final: XMLs originais + 2 relatórios | → `Blob` `pacote-AAAA-MM.zip` |
| card em `src/pages/Estoque.tsx` | seletor de mês (padrão: anterior), botão, progresso em 3 etapas | — |

Reuso: `src/lib/export/` (excel/pdf), `jspdf` + `jspdf-autotable`, `xlsx` (SheetJS). Dependência nova: `fflate`.

### Edge `baixar-notas-venda`

- `verify_jwt = true` (bloco no `supabase/config.toml`). `requireUserOrg(req, { access: 'read' })`; suporte só pela sessão auditada existente.
- Gate: **módulo `estoque`** (o da tela) + conexão ML da org. Sem conexão → 409 "Conecte a conta do Mercado Livre em Canais."
- `mes` validado `^\d{4}-(0[1-9]|1[0-2])$`; mês futuro → 400. `start` = dia 1, `end` = último dia do mês.
- Status do ML: 200 → repassa `body` com `Content-Type: application/zip`; 404 → 200 JSON `{ vazio: true }`;
  429 → 429 "O Mercado Livre limitou os downloads — tente de novo em 5 minutos."; 401/403 → 409 permissão da conta;
  5xx/timeout → 502 "Mercado Livre indisponível — o pacote não foi gerado." Sem retry automático.
- Nenhuma escrita em banco/storage. Lógica pura em `processar.ts` com dependências injetadas (padrão de `importar-nota-compra`).
- `// ponytail:` teto de 150 s de wall-clock: 56 s medidos para ~1.400 vendas/mês; loja ~3× maior estoura →
  evolução: dividir o mês em quinzenas (o `stream` aceita qualquer intervalo dentro do mês).

### `ler.ts` — classificação pelo conteúdo

| Documento | Como reconhece | Vai para |
|---|---|---|
| NF-e de venda | `nfeProc` com `finNFe` 1 | aba Vendas |
| NF-e de devolução | `finNFe` 4 | aba Vendas (tipo devolução) |
| Cancelamento | `procEventoNFe` `tpEvento` 110111 | marca a chave como cancelada |
| CC-e | `tpEvento` 110110 | coluna "Carta de correção" da chave |
| Inutilização | `inutNFe`/`procInutNFe` | Conferência (faixa e resultado) |
| CT-e, Full (remessa/retorno) e outros | demais | só Conferência e zip |
| Ilegível | erro de parse | Conferência + **PACOTE PARCIAL** |

Leitura de XML com `DOMParser` (navegador; nos testes, ambiente jsdom do vitest).

## Relatório

**Aba "Vendas"** — uma linha por NF-e de venda/devolução, **ordem crescente de `dhEmi`**:
Data de emissão · Tipo · Status · Número · Série · Chave · Produtos (`vProd`) · Frete (`vFrete`) ·
Desconto (`vDesc`) · Total (`vNF`) · Pedido ML · Data da venda · Carta de correção.

- **Totais por grupo:** vendas autorizadas, vendas canceladas, devoluções autorizadas. **Sem** "faturamento líquido"
  (apuração é do contador).
- **Pedido ML e Data da venda:** preenchidos só se o XML trouxer o pedido (ver Pendências); a data vem de `ml_vendas`
  da org (RLS) pelo `order_id`. Sem pedido → células vazias, nunca inventadas.

**Aba "Conferência"** (no PDF: página de resumo): org, CNPJ (de `empresa_fiscal`, se houver), mês, data/hora da
geração; contagem de arquivos por tipo; inutilizações; XMLs ilegíveis com o nome do arquivo; selo **PACOTE PARCIAL**
quando houver ilegível; aviso "mês em andamento" quando o mês é o atual; "Nenhuma nota no mês" quando o ML respondeu 404.

## Erros na tela

| Situação | Mensagem |
|---|---|
| 404 do ML | pacote gerado com relatório vazio e "Nenhuma nota no mês" |
| 429 | "O Mercado Livre limitou os downloads — tente de novo em 5 minutos." |
| sem conexão / sem permissão | "Conecte a conta do Mercado Livre em Canais." |
| 5xx / timeout | "Mercado Livre indisponível — o pacote não foi gerado." (nunca pacote vazio) |
| mês futuro | seletor não oferece; edge recusa |

## Testes

1. `ler.ts`: zips montados com `fflate` a partir de XMLs sintéticos (formato SEFAZ, CNPJs de fixture
   `11222333000181`/`11444777000161`): venda, venda + cancelamento, devolução, CC-e, CT-e, inutilização,
   XML quebrado (parcial), zip sem documentos; pastas com os dois formatos de nome medidos.
2. xlsx: reler com SheetJS — ordem por data, totais por grupo, Conferência.
3. pdf: gera bytes; "PACOTE PARCIAL" presente quando há ilegível.
4. edge (`processar.ts`): intervalo do mês (inclui fevereiro/bissexto), mês futuro, mapeamento 200/404/429/401/403/5xx.
5. Runtime: org DSA com a conta VALIDATION pelo app em produção (setembro: nº de NF-e do relatório = do zip);
   leitura direta (token, só GET, já autorizada) de um mês de outra loja para conferir contagens. Zips de teste só no
   tmp do job, apagados no fim (dados de clientes).

## Pendências (a verificar)

1. **Pedido ML no XML do Faturador:** confirmar na primeira venda faturada pelo Faturador (onde o pedido aparece:
   `xPed`, `infCpl`, outro). Até lá as colunas Pedido ML/Data da venda ficam vazias. Com a confirmação, vira aba
   **"Vendas sem nota"** (pedidos de `ml_vendas` do mês sem NF-e correspondente) — próximo incremento, não este plano.
2. Nomes de pasta para canceladas/devoluções ainda não vistos em loja real (nenhuma amostra) — por isso a
   classificação é pelo conteúdo.

## Docs a atualizar na entrega

ADR-0181 (resultado do spike + 2a entregue), `docs/reference/edge-functions.md` (nova edge), `docs/TASKS.md`
(e corrigir a linha de deploy do Plano 1 já feito), `docs/project-status.md`, vault `Fiscal.md`/`Estoque.md`.
