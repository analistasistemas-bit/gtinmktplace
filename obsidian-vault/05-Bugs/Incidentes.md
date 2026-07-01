---
tags: [bugs, incidentes]
atualizado: 2026-07-01
---

# Incidentes

Ocorrências reais em produção, documentadas em ADRs e `docs/TASKS.md`/`project-history.md`. Ver
[[Bugs Conhecidos]] (o que ainda está aberto), [[Problemas Resolvidos]].

## Título duplicado derruba anúncio (2026-06-22)

Duas famílias que diferem só na cor (ex.: "ALFINETE N.0 PRATA" e "ALFINETE N.0 DOURADO") viram
anúncios separados (1 família = 1 anúncio), mas o copywriter de IA removia a cor do título
(tratando como agrupado multi-cor) — os dois anúncios ficavam com título **100% idêntico**. O ML
detecta como duplicado e baixa o segundo (`under_review`, `sub_status=forbidden`). Item nesse
estado não é editável por API — só recriando.

**Impacto real:** 3 alfinetes Prata baixados (N.0/N.02/N.04); o N.03 Prata, cujo título já
continha "PRATA", permaneceu ativo — prova de que título diferenciado basta. Corrigido pelo
ADR-0044 (cor cravada no título de anúncios mono-cor). Ver `reference_ml_duplicado_titulo_cor`.

## Travamento em "publicando" por foto assíncrona (regressão)

Famílias ficavam muito tempo em `publicando` (parecendo travadas) ou caíam em `erro`. O ML
processa fotos de forma assíncrona: se a foto ainda não terminou, `POST /items` retorna
`item.pictures.unavailable`. Era uma **regressão**, não comportamento intrínseco. Corrigido pelo
ADR-0033 (parar de re-subir a foto no retry + retry interno).

## Vinculação de catálogo casando com ficha de kit (falso positivo)

**Gatilho real:** um cliente comprou pelo catálogo um anúncio de **1 rolo** que estava vinculado
à ficha `MLB25284234` = "Fita... Verde Menta... **Kit 5 Unidades**" — o título da ficha engana
(fichas-kit sem "kit"/quantidade no nome); a verdade está nos atributos estruturados
(`UNITS_PER_PACK`, `SALE_FORMAT`). Varredura em 3 famílias com catálogo achou **19 vinculações
erradas**: 17 fichas `SALE_FORMAT=Kit`/`UNITS_PER_PACK=5`, 1 `UNITS_PER_PACK=10`, 1 de dimensão
divergente. Os 19 foram **pausados no ML** (contenção). Corrigido pela trava `fichaEquivalente`
(anti-kit + metragem) no ADR-0021, com novo estado `catalog_status='ficha_divergente'`.

## Moderação sem visibilidade proativa

O ML modera anúncios (`under_review` + `poor_quality_thumbnail`/`forbidden`/
`waiting_for_patch`) e tira do ar sem avisar — o operador só percebia abrindo a tela Publicados.
A API do item só expõe o **código** do sub_status, sem texto do motivo; `/moderations/
infractions/search` (que teria o texto) retorna 401 (bloqueado por permissão, mesma classe do
`/orders`). Resolvido pelo ADR-0035: polling agendado (QStash a cada 6h) + alerta Telegram.

## Lote #41 travado com erro genérico "signal aborted" (2026-06-17)

A copy via IA (OpenRouter) excedeu o timeout de 30s no `process-familia`, e era a única etapa
sem fallback — derrubava a família inteira com mensagem genérica, sem indicar a causa real.
Corrigido pelo ADR-0030: `gerarCopy` com 1 retry + erro rotulado por etapa, nova edge function
`reprocessar-familia`, e botão "Reenviar" na UI.

## Colisão de numeração de ADRs (dois `0035`, dois `0037`)

Resolvida em 2026-06-27: `cor-no-titulo-mono-cor` virou **0044** (ex-0035) e
`vendas-catalogo-match-ean` virou **0045** (ex-0037). Detalhe em `docs/decisions/README.md`.
