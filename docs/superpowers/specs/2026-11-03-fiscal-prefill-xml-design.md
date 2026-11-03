# Pré-preenchimento fiscal completo na importação do XML — design

**Data:** 2026-11-03 · **Emenda:** ADR-0181 D-10 (e o "nunca pré-escolher origem" do ADR-0055/0107 no fluxo da nota)
**Pedido do Diego:** "quero que já venha preenchida toda a parte fiscal quando eu importar o XML, só irei conferir".

## Intenção

Hoje, ao cadastrar um produto novo a partir de um item da nota de compra, só NCM, origem NF-e e
descrição fiscal chegam preenchidos; o CSOSN é um botão "usar padrão", o CEST não é lido e a origem
binária (NACIONAL/IMPORTADO, que define 8%/16%) nasce vazia. O operador quer conferir, não digitar.

Regra-mãe preservada: **nada fiscal entra em silêncio**. Tudo pré-preenchido continua com o selo
"veio da nota" e o "Conferi" obrigatório; casos em que a nota não basta viram **decisão explícita**.

## Fonte das regras

Contador da Daludi Shop (2026-11-03) + revisão Codex gpt-6.1-sol high (2 rodadas):

- Venda sem ST → CSOSN **102**; venda com ST → **500**.
- Entrada "com ST": fornecedor Simples CSOSN **201/202/203/500**; Regime Normal CST **10/30/60/70**.
  CST 60 com `vICMSST`=0 continua ST (decide o código, não o valor). Grupo `ICMSST` (CST 41 com retenção
  anterior) também é ST.
- Isento/imune/não tributado (103/300/400, CST 40/41/50) e casos sem regra (900, 90, 51, monofásicos,
  ausente/desconhecido): **não deixar em branco nem copiar — analisar caso a caso** → escolha manual
  obrigatória, sem sugestão.
- CEST: cadastrar sempre que o NCM tiver CEST vigente — independente de ST.
- Origem: manter a do fornecedor, 1→2 e 6→7.
- Antecipação de ST só existe em compra **interestadual**; hoje a Daludi só compra dentro do estado.

## Regras (produto NOVO cadastrado a partir do item da nota)

| Campo | Pré-preenchimento | Conferência |
|---|---|---|
| NCM | `prod/NCM` | "Conferi" geral; trava ADR-0187 continua |
| Origem NF-e | `orig` traduzido (1→2, 6→7) | "Conferi" geral |
| Origem binária | **pré-selecionada** por `ORIGENS_NFE_POR_ORIGEM` (nacional 0/3/4/5/8, importado 1/2/6/7) | "Conferi" geral; sem `orig` → vazia (operador escolhe) |
| FCI | `prod/nFCI` quando a origem for 3/5/8 | já obrigatório pelo form |
| CSOSN — entrada ST | `500` | "Conferi" geral |
| CSOSN — entrada sem ST | `empresa_fiscal.csosn_padrao_revenda` (se válido) | "Conferi" geral; padrão nulo → vazio + aviso |
| CSOSN — exceção | **vazio** + aviso com o código do fornecedor e a tabela do contador | escolha obrigatória (já travada por `fiscalCompleto`) |
| CEST | `prod/CEST` | ausente → aviso + checkbox "Este NCM não tem CEST vigente" obrigatório, a menos que o operador preencha |
| Descrição fiscal | `xProd` (limpeza atual) | — |
| Fornecedor de outra UF | `emit/enderEmit/UF` ≠ `empresa_fiscal.uf` | aviso + checkbox "Conferi o CSOSN com o contador (compra interestadual)" obrigatório |

**Invalidação:** qualquer alteração em NCM, origem NF-e, origem binária, CSOSN, CEST ou FCI depois de
marcado o "Conferi" desmarca o "Conferi" (os checkboxes específicos também caem se o campo que eles
atestam mudar: CEST preenchido dispensa o de CEST).

**Produto já existente vinculado ao item:** o fiscal do produto **não muda**. Se o CSOSN indicado pela
nota (500 para ST, padrão para sem-ST) divergir do `familias.tributacao_icms` do produto, a etapa de
itens mostra um aviso não bloqueante. Exceção não gera aviso (não há CSOSN indicado).

## Fora de escopo

- Tabela NCM → ST/antecipação por org (só necessária com compra interestadual).
- CSOSN 101 para venda a contribuinte revendedor (CSOSN é do cadastro, não da venda).
- Tabela oficial NCM → CEST (hoje só aviso + confirmação).
- Alterar fiscal de produto existente.
- Regime Normal (CST de saída) — fora da v1 fiscal (ADR-0135 D-6).

## Decisões de construção (do agente)

- Classificação ICMS em arquivo novo `supabase/functions/_shared/nfe/icms-entrada.ts` (puro): `regras.ts`
  é importado por `_shared/canais/fiscal-ml.ts` e `_shared/produto/gtin.ts`; mexer nele forçaria redeploy
  amplo. Só `ler-nfe.ts`/`tipos.ts` mudam no caminho da edge → redeploy só de `importar-nota-compra`.
- `CadastroInicial.origemSugerida` passa a pré-selecionar a origem binária **somente** com
  `sugestaoDaNota` (a Viabilidade, que não usa `sugestaoDaNota`, continua com a trava V-3).
- Sem migration, sem RPC nova. Divergência de produto existente lê `tributacaoIcms` do resumo de produtos
  (família canônica), só com o módulo fiscal ligado. Sem módulo fiscal a origem binária continua vazia (não há etapa de conferência).
