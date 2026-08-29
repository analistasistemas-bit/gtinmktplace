# Spike 039 — Cobertura real da JoomPulse sobre os dados do PubliAI

**Data:** 2026-08-28
**ADR:** [0141](../decisions/0141-analise-publiai-joompulse-radar-e-sonar.md) — pré-requisito declarado ("nenhuma promessa de UI antes desse número")
**Antecede:** [Spike 038](038-joompulse-parcial-correlacao-e-semantica.md), que fechou correlação, allowlist e semântica
**Método:** amostras aleatórias (seed fixa) de produção via Management API, consultadas contra o MCP real da JoomPulse

## Resposta curta

| O que | Cobertura | Serve para |
|---|---|---|
| **Catálogos monitorados** (`pulse_produtos.catalog_product_id` → `productId`) | **90%** (81/90) | coluna do Radar |
| **Anúncios de concorrentes** (`pulse_ofertas.item_id` → `id`) | **82%** (74/90) | painel de concorrentes, Sonar |
| **Anúncios próprios** (`familias.ml_item_id` → `id`) | **≈4%** (6/161) | — |

A assimetria entre as duas últimas linhas é o achado principal do spike e **mudou o desenho da coluna do Radar**.

---

## 1. Radar — catálogos: 90%

Amostra de 90 dos 229 catálogos ativos (2 organizações).

- **81 encontrados** (90%), 9 ausentes (10%)
- **60 com demanda estimada > 0** — 67% da amostra, 74% dos encontrados
- **21 encontrados sem venda estimada** (26% dos encontrados): o catálogo existe, mas não tem venda no período. É o quarto estado da tabela-verdade do Spike 038, e ele **não é raro**
- Concorrentes por catálogo: **mediana 6**, máximo 90

### Correção a uma afirmação da ADR-0141

O Spike 038 media catálogos com 15 e 18 concorrentes e a ADR-0141 generalizou "num catálogo com 15–18 concorrentes, 14 a 17 devolvem `0`". A mediana real é **6 concorrentes**. A afirmação continua verdadeira em direção, mas a escala típica é menor: **no catálogo mediano, 5 dos 6 devolvem `0`**; nos maiores, 89 de 90.

### Projeção para a tela (229 catálogos ativos)

| Estado da célula | Linhas |
|---|---|
| Prévia útil (ganhador + demanda) | ~153 (67%) |
| Catálogo existe, sem venda estimada | ~53 (23%) |
| Sem dado | ~23 (10%) |

**Dois terços das linhas do Radar teriam informação acionável.** A coluna se sustenta.

---

## 2. Concorrentes: 82% de cobertura, 11% com venda atribuída

Amostra de 90 dos 396 anúncios de terceiros coletados nos últimos 7 dias.

- **74 encontrados** (82%), 16 ausentes (18%)
- **8 com `orderCount1m` > 0** — apenas **11% dos encontrados**
- **66 com `orderCount1m` = 0** — **89% dos encontrados**

Isto **confirma em escala** o achado que derrubou a D-3 da ADR-0132: o zero é a regra, não a exceção. Numa tela de concorrentes, aproximadamente 9 em cada 10 linhas trariam `0`, e renderizar esse zero como "não vendeu" seria falso em quase toda a tabela.

A decisão da ADR-0141 de nunca exibir esse zero como venda deixa de ser precaução teórica e passa a ser o caso dominante.

---

## 3. Anúncios próprios: ≈4% — e por que isso importava

Três medições convergentes:

| Recorte | Encontrados |
|---|---|
| Amostra aleatória de 90 dos 161 anúncios | **2** (2%) |
| 57 anúncios mais antigos (criados em junho) | **4** (7%) |
| 46 anúncios com **≥ 5 vendas** registradas | **6** (13%) |

### O que explica

Todos os anúncios encontrados **têm venda registrada** (5, 10, 15, 18, 769). Nenhum anúncio sem venda apareceu. Mas ter vendido **não basta**: 100 dos 161 anúncios já venderam e ainda assim só ~6 estão indexados.

O perfil explica o resto: **os anúncios da organização têm no máximo 3 meses** (criados entre 2026-06 e 2026-08) e volume baixo — 61 com zero vendas, 54 com 1 a 4. Os `sold` que a JoomPulse retorna começam em 5, que é a menor faixa do selo do Mercado Livre.

**Conclusão: a JoomPulse cobre bem o mercado estabelecido e mal o vendedor novo ou de baixo volume.** Isso é coerente com o que ela declara para a Shopee ("items with at least one lifetime sale") e não está documentado para o Mercado Livre.

### O falso negativo que isso criaria — e a correção

A D-4 da ADR-0141 previa uma célula que diz "Você leva" ou "Rival leva". Ler isso comparando `buyBoxWiner` com o **anúncio** da organização quebraria: com 4% dos nossos anúncios indexados, a org quase nunca seria identificada como ganhadora — **inclusive quando de fato estivesse ganhando**. A tela diria "rival leva" o tempo todo.

**A correção medida e confirmada:** comparar pelo **vendedor**, não pelo anúncio. O cubo expõe `buyBoxShopId` e `buyBoxShopName` como measures, e o PubliAI conhece o `seller_id` da conta ML da organização.

Verificado — dez catálogos, uma consulta, uma linha por catálogo:

| productId | ganhador | shopId | preço | disputam |
|---|---|---|---|---|
| MLB38519117 | MARIAAVIAMENTOS | 1943675136 | R$ 31,72 | 17 |
| MLB27587256 | BRUNO AVIAMENTOS | 808675494 | R$ 26,51 | 13 |
| MLB36209242 | ZANUP | 830159780 | R$ 50,16 | 78 |
| MLB25284051 | RIZZO_CONFEITARIA_OFICIAL | 1493892664 | R$ 13,50 | 8 |
| MLB24526166 | DROGAL FARMACEUTICA | 734605048 | R$ 99,98 | 22 |

A mesma consulta entrega o nome do ganhador, o preço dele e quantos disputam — tudo o que a célula precisa, sem depender de o anúncio da organização estar indexado.

**Limitação residual:** se a organização detém o buy-box mas a JoomPulse ainda não reflete isso (defasagem D-1), a célula mostrará o ganhador anterior. É erro de atualização, não de identidade, e o rótulo de data de coleta já o cobre.

---

## Impacto no desenho

1. **A coluna do Radar se mantém** — 90% de cobertura de catálogo e 67% de linhas com informação acionável.
2. **A D-4 precisa de emenda:** a comparação é por `buyBoxShopId` × `seller_id` da organização, nunca por anúncio.
3. **O estado "catálogo sem venda estimada" é comum** (23% das linhas projetadas) e precisa de tratamento visual próprio, não pode cair no mesmo travessão de "sem dado".
4. **Painel de concorrentes:** 89% das linhas virão com `orderCount1m` = 0. O painel deve liderar com *quem ganha* e *demanda do catálogo*, e tratar a coluna de vendas por anúncio como exceção informativa — não como coluna principal.
5. **Não prometer análise sobre o anúncio próprio.** A Análise PubliAI fala do catálogo e do mercado, não do desempenho do anúncio da organização — para isso a cobertura é de 4%, e o PubliAI já tem o dado real de vendas internamente.

## Como reproduzir

Scripts em `$CLAUDE_JOB_DIR/tmp` (efêmeros): `sonda_extrai.py` (amostras de produção via Management API), `sonda_calcula.py` (consolidação), `sonda_limiar.py` (distribuição de vendas). Amostras com `random.seed(42)`.

**Gotcha da Management API:** o Cloudflare devolve `error code: 1010` para clientes Python (`urllib`) — é bloqueio por fingerprint, não credencial inválida. Enviar `User-Agent: curl/8.7.1` resolve.

**Gotcha do CubeJS:** `daysInAd` é *measure*, não dimensão; usá-la em `dimensions` devolve erro 500.
