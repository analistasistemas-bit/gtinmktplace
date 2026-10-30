# Anexo do spike 058 — saídas sanitizadas da Task 04

Transcrição de `python3 scripts/spike-ads-redesenho.py conciliar <connection_id>` (2026-10-30, só GET, janela atual
2026-09-30..2026-10-29). A saída do script já é sanitizada (sem token, nome, e-mail; só ids, status HTTP, tipos e
números agregados). Sustenta: classificação por campo (confirmado só com número válido em **todas** as linhas e, em
E5, em **todas** as páginas; 4xx isolado por sonda; 5xx seria "falha operacional"), CVR 8/8 (linhas `ESCALA`,
campos `cvr_nativo` × `cvr/units`) e diferença zero nas 15 métricas aditivas (linhas `Σ anúncios`). Ver
[058](058-ads-redesenho-metricas.md).

## Avil (33 chamadas)

```
[1] advertisers http=200 746ms
janela atual=('2026-09-30', '2026-10-29')

[2] E1-todas http=400 694ms
  erro ML: <omitido>

[3] E1-resto http=200 531ms

[4] E1-impression_share http=400 516ms
  erro ML: <omitido>

[5] E1-top_impression_share http=400 527ms
  erro ML: <omitido>

[6] E1-lost_impression_share_by_budget http=400 530ms
  erro ML: <omitido>

[7] E1-lost_impression_share_by_ad_rank http=400 521ms
  erro ML: <omitido>
  CLASSIFICAÇÃO E1 (11 linhas/blocos):
    clicks: confirmado 11/11
    prints: confirmado 11/11
    ctr: confirmado 11/11 min=0.0 max=1.62
    cost: confirmado 11/11
    cpc: confirmado 11/11 min=0.0 max=0.58
    acos: confirmado 11/11 min=0.0 max=17.77
    roas: confirmado 11/11 min=0.0 max=18.3
    cvr: confirmado 11/11 min=0.0 max=16.42
    sov: confirmado 11/11 min=0.0 max=80.81
    direct_amount: confirmado 11/11
    indirect_amount: confirmado 11/11
    total_amount: confirmado 11/11
    direct_items_quantity: confirmado 11/11
    indirect_items_quantity: confirmado 11/11
    advertising_items_quantity: confirmado 11/11
    direct_units_quantity: confirmado 11/11
    indirect_units_quantity: confirmado 11/11
    units_quantity: confirmado 11/11
    organic_items_quantity: confirmado 11/11
    organic_units_quantity: confirmado 11/11
    organic_units_amount: confirmado 11/11
    impression_share: RECUSADO (http=400)
    top_impression_share: RECUSADO (http=400)
    lost_impression_share_by_budget: RECUSADO (http=400)
    lost_impression_share_by_ad_rank: RECUSADO (http=400)
  ESCALA resumo E1: {'ctr': (0.36, 0.003554), 'acos': (7.87, 0.078729), 'roas': (12.7, 12.701816), 'cpc': (0.39, 0.386521), 'cvr_nativo': 10.31, 'cvr/advertising_items': 0.076868, 'cvr/units': 0.103092, 'cvr/direct_items': 0.070853, 'cvr/direct_units': 0.096115, 'sov': 43.59}
  ESCALA campanha 358339031: {'ctr': (0.47, 0.004708), 'acos': (5.46, 0.054649), 'roas': (18.3, 18.298523), 'cpc': (0.31, 0.311267), 'cvr_nativo': 12.13, 'cvr/advertising_items': 0.093342, 'cvr/units': 0.121344, 'cvr/direct_items': 0.08463, 'cvr/direct_units': 0.111803, 'sov': 44.2}
  ESCALA campanha 358508113: {'ctr': (0.14, 0.001436), 'acos': (10.97, 0.109666), 'roas': (9.12, 9.118632), 'cpc': (0.58, 0.583908), 'cvr_nativo': 7.3, 'cvr/advertising_items': 0.056895, 'cvr/units': 0.072975, 'cvr/direct_items': 0.053185, 'cvr/direct_units': 0.067409, 'sov': 70.77}
  ESCALA campanha 7289535: {'ctr': (1.62, 0.016232), 'acos': (17.77, 0.177678), 'roas': (5.63, 5.628159), 'cpc': (0.4, 0.396617), 'cvr_nativo': 7.58, 'cvr/advertising_items': 0.045951, 'cvr/units': 0.075818, 'cvr/direct_items': 0.044802, 'cvr/direct_units': 0.074095, 'sov': 80.81}
  ESCALA campanha 7289297: {'ctr': (0.16, 0.001635), 'acos': (9.07, 0.090746), 'roas': (11.02, 11.019784), 'cpc': (0.58, 0.580896), 'cvr_nativo': 16.42, 'cvr/advertising_items': 0.126866, 'cvr/units': 0.164179, 'cvr/direct_items': 0.126866, 'cvr/direct_units': 0.164179, 'sov': 53.13}

[8] E2-todas http=400 519ms
  erro ML: <omitido>

[9] E2-resto http=200 524ms

[10] E2-impression_share http=400 526ms
  erro ML: <omitido>

[11] E2-top_impression_share http=400 524ms
  erro ML: <omitido>

[12] E2-lost_impression_share_by_budget http=400 539ms
  erro ML: <omitido>

[13] E2-lost_impression_share_by_ad_rank http=400 664ms
  erro ML: <omitido>
  CLASSIFICAÇÃO E2 (30 linhas/blocos):
    clicks: confirmado 30/30
    prints: confirmado 30/30
    ctr: confirmado 30/30 min=0.26 max=0.6
    cost: confirmado 30/30
    cpc: confirmado 30/30 min=0.26 max=0.72
    acos: confirmado 30/30 min=2.91 max=18.85
    roas: confirmado 30/30 min=5.3 max=34.32
    cvr: confirmado 30/30 min=3.91 max=22.33
    sov: confirmado 30/30 min=26.67 max=62.86
    direct_amount: confirmado 30/30
    indirect_amount: confirmado 30/30
    total_amount: confirmado 30/30
    direct_items_quantity: confirmado 30/30
    indirect_items_quantity: confirmado 30/30
    advertising_items_quantity: confirmado 30/30
    direct_units_quantity: confirmado 30/30
    indirect_units_quantity: confirmado 30/30
    units_quantity: confirmado 30/30
    organic_items_quantity: confirmado 30/30
    organic_units_quantity: confirmado 30/30
    organic_units_amount: confirmado 30/30
    impression_share: RECUSADO (http=400)
    top_impression_share: RECUSADO (http=400)
    lost_impression_share_by_budget: RECUSADO (http=400)
    lost_impression_share_by_ad_rank: RECUSADO (http=400)
campanha do detalhe: 358339031

[14] E3-todas http=200 630ms
  CLASSIFICAÇÃO E3 (1 linhas/blocos):
    clicks: confirmado 1/1
    prints: confirmado 1/1
    ctr: confirmado 1/1 min=0.47 max=0.47
    cost: confirmado 1/1
    cpc: confirmado 1/1 min=0.31 max=0.31
    acos: confirmado 1/1 min=5.46 max=5.46
    roas: confirmado 1/1 min=18.3 max=18.3
    cvr: confirmado 1/1 min=12.13 max=12.13
    sov: confirmado 1/1 min=44.2 max=44.2
    direct_amount: confirmado 1/1
    indirect_amount: confirmado 1/1
    total_amount: confirmado 1/1
    direct_items_quantity: confirmado 1/1
    indirect_items_quantity: confirmado 1/1
    advertising_items_quantity: confirmado 1/1
    direct_units_quantity: confirmado 1/1
    indirect_units_quantity: confirmado 1/1
    units_quantity: confirmado 1/1
    organic_items_quantity: confirmado 1/1
    organic_units_quantity: confirmado 1/1
    organic_units_amount: confirmado 1/1
    impression_share: confirmado 1/1 min=0.05 max=0.05
    top_impression_share: confirmado 1/1 min=3.5 max=3.5
    lost_impression_share_by_budget: confirmado 1/1 min=0.61 max=0.61
    lost_impression_share_by_ad_rank: confirmado 1/1 min=0.34 max=0.34
  ESCALA E3: {'ctr': (0.47, 0.004708), 'acos': (5.46, 0.054649), 'roas': (18.3, 18.298523), 'cpc': (0.31, 0.311267), 'cvr_nativo': 12.13, 'cvr/advertising_items': 0.093342, 'cvr/units': 0.121344, 'cvr/direct_items': 0.08463, 'cvr/direct_units': 0.111803, 'sov': 44.2}
  COMPETITIVIDADE E3: {'impression_share': 0.05, 'top_impression_share': 3.5, 'lost_impression_share_by_budget': 0.61, 'lost_impression_share_by_ad_rank': 0.34}

[15] E4-todas http=200 519ms
  CLASSIFICAÇÃO E4 (30 linhas/blocos):
    clicks: confirmado 30/30
    prints: confirmado 30/30
    ctr: confirmado 30/30 min=0.35 max=0.62
    cost: confirmado 30/30
    cpc: confirmado 30/30 min=0.24 max=0.42
    acos: confirmado 30/30 min=1.96 max=14.78
    roas: confirmado 30/30 min=6.76 max=51.01
    cvr: confirmado 30/30 min=5.19 max=33.61
    sov: confirmado 30/30 min=20.0 max=69.57
    direct_amount: confirmado 30/30
    indirect_amount: confirmado 30/30
    total_amount: confirmado 30/30
    direct_items_quantity: confirmado 30/30
    indirect_items_quantity: confirmado 30/30
    advertising_items_quantity: confirmado 30/30
    direct_units_quantity: confirmado 30/30
    indirect_units_quantity: confirmado 30/30
    units_quantity: confirmado 30/30
    organic_items_quantity: confirmado 30/30
    organic_units_quantity: confirmado 30/30
    organic_units_amount: confirmado 30/30
    impression_share: confirmado 30/30 min=0.0 max=0.21
    top_impression_share: confirmado 30/30 min=0.0 max=10.0
    lost_impression_share_by_budget: confirmado 30/30 min=0.0 max=0.8
    lost_impression_share_by_ad_rank: confirmado 30/30 min=0.0 max=0.95

[16] E5-todas http=400 529ms
  erro ML: <omitido>

[17] E5-resto http=200 725ms

[18] E5-impression_share http=400 507ms
  erro ML: <omitido>

[19] E5-top_impression_share http=400 526ms
  erro ML: <omitido>

[20] E5-lost_impression_share_by_budget http=400 521ms
  erro ML: <omitido>

[21] E5-lost_impression_share_by_ad_rank http=400 521ms
  erro ML: <omitido>

[22] E5-pag-50 http=200 520ms

[23] E5-pag-100 http=200 525ms

[24] E5-pag-150 http=200 665ms

[25] E5-pag-200 http=200 712ms

[26] E5-pag-250 http=200 1135ms

[27] E5-pag-300 http=200 699ms

[28] E5-pag-350 http=200 440ms

[29] E5-pag-400 http=200 659ms

[30] E5-pag-450 http=200 493ms

[31] E5-pag-500 http=200 753ms

[32] E5-pag-550 http=200 356ms

[33] E5-pag-600 http=200 394ms
  CLASSIFICAÇÃO E5 (603 linhas/blocos):
    clicks: confirmado 603/603
    prints: confirmado 603/603
    ctr: confirmado 603/603 min=0.0 max=2.78
    cost: confirmado 603/603
    cpc: confirmado 603/603 min=0.0 max=1.54
    acos: confirmado 603/603 min=0.0 max=263.21
    roas: confirmado 603/603 min=0.0 max=402.78
    cvr: confirmado 603/603 min=0.0 max=166.67
    sov: confirmado 603/603 min=0.0 max=100.0
    direct_amount: confirmado 603/603
    indirect_amount: confirmado 603/603
    total_amount: confirmado 603/603
    direct_items_quantity: confirmado 603/603
    indirect_items_quantity: confirmado 603/603
    advertising_items_quantity: confirmado 603/603
    direct_units_quantity: confirmado 603/603
    indirect_units_quantity: confirmado 603/603
    units_quantity: confirmado 603/603
    organic_items_quantity: confirmado 603/603
    organic_units_quantity: confirmado 603/603
    organic_units_amount: confirmado 603/603
    impression_share: RECUSADO (http=400)
    top_impression_share: RECUSADO (http=400)
    lost_impression_share_by_budget: RECUSADO (http=400)
    lost_impression_share_by_ad_rank: RECUSADO (http=400)

E5: 603 anúncios lidos de paging.total=603; item_id distintos=603
  Σ anúncios advertising_items_quantity: 639 | resumo E1 da conta: 639 | diferença: 0 (centavos para valores em R$)
  Σ anúncios clicks: 8313 | resumo E1 da conta: 8313 | diferença: 0 (centavos para valores em R$)
  Σ anúncios cost: 321315 | resumo E1 da conta: 321315 | diferença: 0 (centavos para valores em R$)
  Σ anúncios direct_amount: 3768134 | resumo E1 da conta: 3768134 | diferença: 0 (centavos para valores em R$)
  Σ anúncios direct_items_quantity: 589 | resumo E1 da conta: 589 | diferença: 0 (centavos para valores em R$)
  Σ anúncios direct_units_quantity: 799 | resumo E1 da conta: 799 | diferença: 0 (centavos para valores em R$)
  Σ anúncios indirect_amount: 313150 | resumo E1 da conta: 313150 | diferença: 0 (centavos para valores em R$)
  Σ anúncios indirect_items_quantity: 50 | resumo E1 da conta: 50 | diferença: 0 (centavos para valores em R$)
  Σ anúncios indirect_units_quantity: 58 | resumo E1 da conta: 58 | diferença: 0 (centavos para valores em R$)
  Σ anúncios organic_items_quantity: 827 | resumo E1 da conta: 827 | diferença: 0 (centavos para valores em R$)
  Σ anúncios organic_units_amount: 4449200 | resumo E1 da conta: 4449200 | diferença: 0 (centavos para valores em R$)
  Σ anúncios organic_units_quantity: 1179 | resumo E1 da conta: 1179 | diferença: 0 (centavos para valores em R$)
  Σ anúncios prints: 2338925 | resumo E1 da conta: 2338925 | diferença: 0 (centavos para valores em R$)
  Σ anúncios total_amount: 4081284 | resumo E1 da conta: 4081284 | diferença: 0 (centavos para valores em R$)
  Σ anúncios units_quantity: 857 | resumo E1 da conta: 857 | diferença: 0 (centavos para valores em R$)
  acos por anúncio × 100·cost/total_amount: 47 anúncios com receita; maior diferença absoluta 0.0049

chamadas ML: 33/60
```

## Hairfly (21 chamadas)

```
[1] advertisers http=200 297ms
janela atual=('2026-09-30', '2026-10-29')

[2] E1-todas http=400 463ms
  erro ML: <omitido>

[3] E1-resto http=200 347ms

[4] E1-impression_share http=400 371ms
  erro ML: <omitido>

[5] E1-top_impression_share http=400 336ms
  erro ML: <omitido>

[6] E1-lost_impression_share_by_budget http=400 328ms
  erro ML: <omitido>

[7] E1-lost_impression_share_by_ad_rank http=400 386ms
  erro ML: <omitido>
  CLASSIFICAÇÃO E1 (3 linhas/blocos):
    clicks: confirmado 3/3
    prints: confirmado 3/3
    ctr: confirmado 3/3 min=0.73 max=0.74
    cost: confirmado 3/3
    cpc: confirmado 3/3 min=0.24 max=0.55
    acos: confirmado 3/3 min=2.43 max=7.03
    roas: confirmado 3/3 min=14.22 max=41.21
    cvr: confirmado 3/3 min=13.64 max=22.5
    sov: confirmado 3/3 min=50.0 max=76.92
    direct_amount: confirmado 3/3
    indirect_amount: confirmado 3/3
    total_amount: confirmado 3/3
    direct_items_quantity: confirmado 3/3
    indirect_items_quantity: confirmado 3/3
    advertising_items_quantity: confirmado 3/3
    direct_units_quantity: confirmado 3/3
    indirect_units_quantity: confirmado 3/3
    units_quantity: confirmado 3/3
    organic_items_quantity: confirmado 3/3
    organic_units_quantity: confirmado 3/3
    organic_units_amount: confirmado 3/3
    impression_share: RECUSADO (http=400)
    top_impression_share: RECUSADO (http=400)
    lost_impression_share_by_budget: RECUSADO (http=400)
    lost_impression_share_by_ad_rank: RECUSADO (http=400)
  ESCALA resumo E1: {'ctr': (0.74, 0.007399), 'acos': (6.09, 0.060935), 'roas': (16.41, 16.410927), 'cpc': (0.5, 0.501429), 'cvr_nativo': 15.13, 'cvr/advertising_items': 0.105042, 'cvr/units': 0.151261, 'cvr/direct_items': 0.092437, 'cvr/direct_units': 0.134454, 'sov': 69.44}
  ESCALA campanha 7667430: {'ctr': (0.73, 0.007349), 'acos': (2.43, 0.024264), 'roas': (41.21, 41.214064), 'cpc': (0.24, 0.24175), 'cvr_nativo': 22.5, 'cvr/advertising_items': 0.125, 'cvr/units': 0.225, 'cvr/direct_items': 0.1, 'cvr/direct_units': 0.175, 'sov': 50.0}
  ESCALA campanha 7500229: {'ctr': (0.74, 0.007409), 'acos': (7.03, 0.070304), 'roas': (14.22, 14.223945), 'cpc': (0.55, 0.553889), 'cvr_nativo': 13.64, 'cvr/advertising_items': 0.10101, 'cvr/units': 0.136364, 'cvr/direct_items': 0.090909, 'cvr/direct_units': 0.126263, 'sov': 76.92}

[8] E2-todas http=400 333ms
  erro ML: <omitido>

[9] E2-resto http=200 309ms

[10] E2-impression_share http=400 287ms
  erro ML: <omitido>

[11] E2-top_impression_share http=400 449ms
  erro ML: <omitido>

[12] E2-lost_impression_share_by_budget http=400 284ms
  erro ML: <omitido>

[13] E2-lost_impression_share_by_ad_rank http=400 302ms
  erro ML: <omitido>
  CLASSIFICAÇÃO E2 (30 linhas/blocos):
    clicks: confirmado 30/30
    prints: confirmado 30/30
    ctr: confirmado 30/30 min=0.0 max=2.3
    cost: confirmado 30/30
    cpc: confirmado 30/30 min=0.0 max=1.11
    acos: confirmado 30/30 min=0.0 max=60.79
    roas: confirmado 30/30 min=0.0 max=56.93
    cvr: confirmado 30/30 min=0.0 max=39.02
    sov: confirmado 30/30 min=0.0 max=100.0
    direct_amount: confirmado 30/30
    indirect_amount: confirmado 30/30
    total_amount: confirmado 30/30
    direct_items_quantity: confirmado 30/30
    indirect_items_quantity: confirmado 30/30
    advertising_items_quantity: confirmado 30/30
    direct_units_quantity: confirmado 30/30
    indirect_units_quantity: confirmado 30/30
    units_quantity: confirmado 30/30
    organic_items_quantity: confirmado 30/30
    organic_units_quantity: confirmado 30/30
    organic_units_amount: confirmado 30/30
    impression_share: RECUSADO (http=400)
    top_impression_share: RECUSADO (http=400)
    lost_impression_share_by_budget: RECUSADO (http=400)
    lost_impression_share_by_ad_rank: RECUSADO (http=400)
campanha do detalhe: 7500229

[14] E3-todas http=200 460ms
  CLASSIFICAÇÃO E3 (1 linhas/blocos):
    clicks: confirmado 1/1
    prints: confirmado 1/1
    ctr: confirmado 1/1 min=0.74 max=0.74
    cost: confirmado 1/1
    cpc: confirmado 1/1 min=0.55 max=0.55
    acos: confirmado 1/1 min=7.03 max=7.03
    roas: confirmado 1/1 min=14.22 max=14.22
    cvr: confirmado 1/1 min=13.64 max=13.64
    sov: confirmado 1/1 min=76.92 max=76.92
    direct_amount: confirmado 1/1
    indirect_amount: confirmado 1/1
    total_amount: confirmado 1/1
    direct_items_quantity: confirmado 1/1
    indirect_items_quantity: confirmado 1/1
    advertising_items_quantity: confirmado 1/1
    direct_units_quantity: confirmado 1/1
    indirect_units_quantity: confirmado 1/1
    units_quantity: confirmado 1/1
    organic_items_quantity: confirmado 1/1
    organic_units_quantity: confirmado 1/1
    organic_units_amount: confirmado 1/1
    impression_share: confirmado 1/1 min=0.13 max=0.13
    top_impression_share: confirmado 1/1 min=0.5 max=0.5
    lost_impression_share_by_budget: confirmado 1/1 min=0.17 max=0.17
    lost_impression_share_by_ad_rank: confirmado 1/1 min=0.7 max=0.7
  ESCALA E3: {'ctr': (0.74, 0.007409), 'acos': (7.03, 0.070304), 'roas': (14.22, 14.223945), 'cpc': (0.55, 0.553889), 'cvr_nativo': 13.64, 'cvr/advertising_items': 0.10101, 'cvr/units': 0.136364, 'cvr/direct_items': 0.090909, 'cvr/direct_units': 0.126263, 'sov': 76.92}
  COMPETITIVIDADE E3: {'impression_share': 0.13, 'top_impression_share': 0.5, 'lost_impression_share_by_budget': 0.17, 'lost_impression_share_by_ad_rank': 0.7}

[15] E4-todas http=200 520ms
  CLASSIFICAÇÃO E4 (30 linhas/blocos):
    clicks: confirmado 30/30
    prints: confirmado 30/30
    ctr: confirmado 30/30 min=0.0 max=2.3
    cost: confirmado 30/30
    cpc: confirmado 30/30 min=0.0 max=1.5
    acos: confirmado 30/30 min=0.0 max=60.79
    roas: confirmado 30/30 min=0.0 max=50.1
    cvr: confirmado 30/30 min=0.0 max=33.33
    sov: confirmado 30/30 min=0.0 max=100.0
    direct_amount: confirmado 30/30
    indirect_amount: confirmado 30/30
    total_amount: confirmado 30/30
    direct_items_quantity: confirmado 30/30
    indirect_items_quantity: confirmado 30/30
    advertising_items_quantity: confirmado 30/30
    direct_units_quantity: confirmado 30/30
    indirect_units_quantity: confirmado 30/30
    units_quantity: confirmado 30/30
    organic_items_quantity: confirmado 30/30
    organic_units_quantity: confirmado 30/30
    organic_units_amount: confirmado 30/30
    impression_share: confirmado 30/30 min=0.0 max=0.8
    top_impression_share: confirmado 30/30 min=0.0 max=1.0
    lost_impression_share_by_budget: confirmado 30/30 min=0.0 max=0.68
    lost_impression_share_by_ad_rank: confirmado 30/30 min=0.0 max=0.99

[16] E5-todas http=400 292ms
  erro ML: <omitido>

[17] E5-resto http=200 585ms

[18] E5-impression_share http=400 389ms
  erro ML: <omitido>

[19] E5-top_impression_share http=400 300ms
  erro ML: <omitido>

[20] E5-lost_impression_share_by_budget http=400 408ms
  erro ML: <omitido>

[21] E5-lost_impression_share_by_ad_rank http=400 353ms
  erro ML: <omitido>
  CLASSIFICAÇÃO E5 (45 linhas/blocos):
    clicks: confirmado 45/45
    prints: confirmado 45/45
    ctr: confirmado 45/45 min=0.0 max=3.73
    cost: confirmado 45/45
    cpc: confirmado 45/45 min=0.0 max=2.04
    acos: confirmado 45/45 min=0.0 max=13.28
    roas: confirmado 45/45 min=0.0 max=38.16
    cvr: confirmado 45/45 min=0.0 max=30.61
    sov: confirmado 45/45 min=0.0 max=100.0
    direct_amount: confirmado 45/45
    indirect_amount: confirmado 45/45
    total_amount: confirmado 45/45
    direct_items_quantity: confirmado 45/45
    indirect_items_quantity: confirmado 45/45
    advertising_items_quantity: confirmado 45/45
    direct_units_quantity: confirmado 45/45
    indirect_units_quantity: confirmado 45/45
    units_quantity: confirmado 45/45
    organic_items_quantity: confirmado 45/45
    organic_units_quantity: confirmado 45/45
    organic_units_amount: confirmado 45/45
    impression_share: RECUSADO (http=400)
    top_impression_share: RECUSADO (http=400)
    lost_impression_share_by_budget: RECUSADO (http=400)
    lost_impression_share_by_ad_rank: RECUSADO (http=400)

E5: 45 anúncios lidos de paging.total=45; item_id distintos=45
  Σ anúncios advertising_items_quantity: 25 | resumo E1 da conta: 25 | diferença: 0 (centavos para valores em R$)
  Σ anúncios clicks: 238 | resumo E1 da conta: 238 | diferença: 0 (centavos para valores em R$)
  Σ anúncios cost: 11934 | resumo E1 da conta: 11934 | diferença: 0 (centavos para valores em R$)
  Σ anúncios direct_amount: 173688 | resumo E1 da conta: 173688 | diferença: 0 (centavos para valores em R$)
  Σ anúncios direct_items_quantity: 22 | resumo E1 da conta: 22 | diferença: 0 (centavos para valores em R$)
  Σ anúncios direct_units_quantity: 32 | resumo E1 da conta: 32 | diferença: 0 (centavos para valores em R$)
  Σ anúncios indirect_amount: 22160 | resumo E1 da conta: 22160 | diferença: 0 (centavos para valores em R$)
  Σ anúncios indirect_items_quantity: 3 | resumo E1 da conta: 3 | diferença: 0 (centavos para valores em R$)
  Σ anúncios indirect_units_quantity: 4 | resumo E1 da conta: 4 | diferença: 0 (centavos para valores em R$)
  Σ anúncios organic_items_quantity: 11 | resumo E1 da conta: 11 | diferença: 0 (centavos para valores em R$)
  Σ anúncios organic_units_amount: 48500 | resumo E1 da conta: 48500 | diferença: 0 (centavos para valores em R$)
  Σ anúncios organic_units_quantity: 14 | resumo E1 da conta: 14 | diferença: 0 (centavos para valores em R$)
  Σ anúncios prints: 32168 | resumo E1 da conta: 32168 | diferença: 0 (centavos para valores em R$)
  Σ anúncios total_amount: 195848 | resumo E1 da conta: 195848 | diferença: 0 (centavos para valores em R$)
  Σ anúncios units_quantity: 36 | resumo E1 da conta: 36 | diferença: 0 (centavos para valores em R$)
  acos por anúncio × 100·cost/total_amount: 5 anúncios com receita; maior diferença absoluta 0.0044

chamadas ML: 21/60
```
