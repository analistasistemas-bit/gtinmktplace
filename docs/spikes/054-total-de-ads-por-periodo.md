# Spike 054 — Total de Ads da conta por período (I2, Fatia 0)

**Data:** 2026-10-04 · **ADR:** [0179](../decisions/0179-painel-de-ads.md) · base: [spike 053](053-product-ads-ml.md)

Medido contra a **API real** do ML (Avil, DSA, Daludi Shop), **somente GET**, token lido em memória via
`public.get_connection_tokens(...)` e nunca renovado. Script reproduzível:
`python3 scripts/spike-ads-periodo.py <connection_id> <org_nome> <saida_dir>` (18 chamadas na Avil, 12 nas demais,
nenhum 429).

## Pergunta

A D2 do ADR-0179 exige o **total da conta** e o **gasto não identificado** para qualquer período (7/30/90 dias),
mas o banco só guarda `custo_resumo` de 90 dias (`ml_ads_sync`). De onde vem o total por período, e ele fecha?

## Medição (janelas até ontem = 2026-10-03, R$)

| Org | Janela | `ad_groups/search` resumo | Σ grupos listados | `campaigns/search` resumo | Série diária do anunciante | Σ `ml_ads_grupo_dia` | Não identificado |
|---|---|---|---|---|---|---|---|
| Avil | 7 d | 590,42 | 590,42 | 590,42 | 590,42 (7/7 dias) | 590,42 | 0,00 (0 %) |
| Avil | 30 d | 3.875,54 | 3.874,28 | 3.875,54 | 3.875,54 (30/30) | 3.874,28 | 1,26 (0,03 %) |
| Avil | 90 d | 11.090,24 | 10.801,86 | 11.090,24 | 11.090,24 (90/90) | 10.801,86 | 288,38 (2,6 %) |
| Daludi Shop | 7 d | 65,82 | 65,82 | 65,82 | 65,82 | 65,82 | 0 |
| Daludi Shop | 30/90 d | 114,66 | 107,78 | 114,66 | 114,66 | 107,78 | 6,88 (6,0 %) |
| DSA | 90 d | 268,63 | 268,63 | 268,63 | 268,63 | 268,63 | 0 |

`campaigns/search` com `filters[status]=active,paused,deleted` e com `…,error` deram o mesmo valor em todas as
janelas (hoje nenhuma campanha em `error` com gasto; o filtro com `error` fica por segurança, ver spike 053 §3.1).

## Conclusões

1. **Quatro fontes do ML batem ao centavo** em todas as janelas: resumo dos grupos, resumo das campanhas e Σ da
   série diária do anunciante (`campaigns/search?aggregation_type=DAILY`).
2. **A série diária do anunciante é densa** (N/N dias, zero explícito) e soma exatamente o total → gravar o
   **total da conta por dia** (1 GET por rodada cobre 90 dias) fecha qualquer período.
   **Não identificado(período) = Σ total da conta − Σ grupos**, nos mesmos dias.
3. **O banco tem 100 % dos grupos listados** (Σ listados = Σ `ml_ads_grupo_dia`): a diferença é só gasto de grupos
   que o search não lista mais (excluídos), não falha de coleta.
4. **O gasto não identificado é antigo:** Avil 0 % em 7 d, 0,03 % em 30 d, 2,6 % em 90 d (julho/agosto). O aviso
   `fora_dos_grupos` da Fatia 2c olha sempre 90 dias (Ruling 2c-8), por isso bloqueia o Lucro após Ads mesmo quando
   o período visto está limpo. Calculado por período, a Avil em 30 dias fica praticamente sem aviso.
5. DSA sem linha em `ml_ads_grupo_dia` desde 26/09 não é falha: coleta `ok` em 04/10 e gasto 0 desde então
   (dia sem linha dentro da cobertura vale 0).

## Consequência para o desenho

- Nova série persistida: total diário da conta (custo e vendas atribuídas) a partir de
  `GET /marketplace/advertising/MLB/advertisers/{adv}/product_ads/campaigns/search?…&aggregation_type=DAILY&filters[status]=active,paused,deleted,error`,
  relida com a mesma janela de 15 dias da atribuição em aberto.
- O % de não identificado do aviso (D2) passa a ser **do período exibido**, não fixo em 90 dias.
- Sem novo escopo OAuth, sem escrita, ~1 GET a mais por org por dia.
