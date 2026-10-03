# Vitrine — melhorias de leitura e identificação (design)

- **Data:** 2026-10-03
- **Base:** ADR-0176 (Vitrine), ADR-0172 (coleta de tráfego). Tela `/vitrine` em produção desde 2026-10-02 (`ee832ab2`).
- **Escopo:** só a Vitrine. Formato de título no app inteiro fica para depois.

## Objetivo

A Vitrine precisa se explicar sozinha e cada anúncio precisa ser identificável e alcançável:
1. dicas "O que é / Como ler" em cada bloco;
2. título correto para todo anúncio (bug: MLB4876171545 sem nome);
3. títulos exibidos em formato de título;
4. atalho para abrir o anúncio no Mercado Livre;
5. legenda dos rótulos (significa / o que fazer / por que entrou);
6. variação (cor/tamanho) visível — hoje 36 anúncios "FITA CETIM PROGRESSO N.3" são indistinguíveis.

## Diagnóstico (dados reais Avil, 2026-10-03)

- **#2:** `vitrine_resumo.info` usa `distinct on` por prioridade; `anuncios_externos` (prio 1) tem `titulo = null` para MLB4876171545 e bloqueia o fallback — `familias.titulo_ml` tem "FITA REFLETIVA FLOURESCENTE 5CMX100M 100MT CINZA".
- **#6:** os 36 MLBs da fita N.3 são User Products (uma cor por MLB) publicados fora do PubliAI: não estão em `familias`, `anuncios_externos` nem `anuncios_externos_itens`; título só vem de `ml_vendas_itens`, cor só para os 3 que venderam.
- **#4:** `permalink` existe para 266 de 575 MLBs (`anuncios_externos`/`_itens`); o resto é montável pelo MLB.

## Decisões

### D-1 Dados no coletor (`coletar-trafego-ml`, só GET no ML)
- O multiget de status já existente passa de `attributes=id,status` para `attributes=id,status,title,permalink,attributes` — **mesma chamada, zero requisições novas**.
- `variacao` = valores legíveis de `COLOR` e `SIZE` (nessa ordem, separados por " · "; ausentes são omitidos; nenhum → `null`). Parser puro em `_shared/trafego/`.
- `ml_trafego_item` ganha `titulo text`, `permalink text`, `variacao text` (migration aditiva, nulas). Cada coleta sobrescreve com o valor atual do ML; resposta sem o campo não apaga valor existente.
- Fan-out/posse/cursor (ADR-0173) intactos; só o parser e a gravação do status mudam.

### D-2 `vitrine_resumo` (migration nova, `create or replace`)
- **Título:** primeiro não-nulo entre `ml_trafego_item.titulo` (o que o comprador vê) → fontes do cadastro na ordem atual (Legacy, UP, kit, catálogo, família) → `ml_vendas_itens.titulo`. Corrige #2 (fonte com título nulo não bloqueia as seguintes).
- **Novos campos por item:** `variacao` (`ml_trafego_item.variacao` → cor da venda mais recente do MLB → `null`) e `permalink` (`ml_trafego_item.permalink` → `anuncios_externos(_itens).permalink` → `null`; o front monta `https://produto.mercadolivre.com.br/MLB-<n>` quando nulo).
- Resto da função idêntico (escopo `current_org_id()`, D-3, grade, kit por pack, limites).

### D-3 Formato de título (só exibição, só Vitrine)
Função pura `tituloLegivel(s)`:
1. palavra: 1ª letra maiúscula, resto minúsculo (respeita acentos, `toLocaleLowerCase('pt-BR')`);
2. conectivos minúsculos exceto no início: de, da, do, das, dos, e, em, com, para, por, a, o;
3. palavra contendo dígito → toda minúscula (`151,3g`, `10mt`, `5cmx100m`), exceto padrão `N.<num>` que fica `N.3`;
4. siglas mantidas maiúsculas: MDF, EVA, PVC, LED, USB, TNT, UV, e tamanhos isolados P, M, G, GG;
5. separadores (`|`, `-`, `/`, espaços) preservados.

### D-4 Dicas ⓘ e legenda
- Ícone ⓘ ao lado do título de: Visitas, Conversão, Venda por visita, gráfico, Onde agir. Popover (clique/teclado, Esc fecha) com "O que é" + "Como ler" (textos aprovados no brainstorming, ver Apêndice).
- ⓘ do Onde agir abre a legenda: tabela Rótulo · Significa · O que fazer · Por que entrou (critério em linguagem simples).
- Chip de rótulo com tooltip da frase curta.

### D-5 Linha do anúncio
- Ponto ● colorido + nome do rótulo (substitui o chip vermelho cheio), título legível, etiqueta de variação (contorno, discreta, só se houver), ↗ (abre ML em nova aba, `aria-label="Abrir anúncio no Mercado Livre"`, `rel="noopener noreferrer"`).
- Métricas em colunas à direita, `tabular-nums`: visitas, conversão, ≈ pedidos em jogo. Visitas com o período ("11 visitas em 4 sem" no mobile; cabeçalho de coluna no desktop).
- Motivo em linguagem simples (Invisível: "Sem visita há 7+ dias (o normal seria ~N)", com N = esperado7 arredondado).
- Ação sugerida + "Ver no dossiê ›".
- Mobile 390px: empilha (rótulo + ↗ / título + variação / métricas em linha / ação).
- Sem título: mostra o MLB + selo discreto "título ainda não coletado".

## Fora de escopo
Formato de título fora da Vitrine; agrupar cores de um produto; alertas/notificações.

## Testes
- Parser de variação (cor; cor+tamanho; sem attributes; valor vazio).
- `tituloLegivel` com os 4 exemplos do brainstorming + siglas + conectivo inicial.
- SQL local (docker): prioridade de título com fonte nula; `variacao`/`permalink` com fallback; nada mais muda (asserções antigas continuam).
- Componente: popovers abrem/fecham, legenda com 4 linhas, link ML correto (permalink e fallback).
- Validação real: coletor contra o ML (só GET) com um lote de 20 MLBs da Avil, conferindo título/variação; Playwright desktop + 390px + tema claro com dados reais injetados.

## Entrega
Migration(s) via `db push`; redeploy de `coletar-trafego-ml`; disparo manual de uma coleta pós-deploy para preencher sem esperar o cron; nota no ADR-0176; glossário (verbete "Variação do anúncio" se necessário).

## Apêndice — textos das dicas

| Bloco | O que é | Como ler |
|---|---|---|
| Visitas | Total de visitas de todos os anúncios no período | ▲ entrou mais gente que no período anterior. ▲ aqui e ▼ em Conversão: chegou tráfego que não compra. ▼ aqui com Conversão estável: falta exposição (Ads, posição). |
| Conversão | De cada 100 visitas, quantas viraram pedido | 3,6% = ~36 pedidos a cada 1.000 visitas. O Δ é em pontos percentuais (+0,10 p.p. = de 3,5% para 3,6%). Queda com visitas estáveis aponta preço, foto ou concorrência. |
| Venda por visita | Quanto cada visita rendeu em vendas (R$) | Junta conversão e ticket médio: sobe com mais conversão ou com venda mais cara. Bom para comparar meses de volumes diferentes. |
| Gráfico | Visitas por dia (média da semana) e conversão semanal | As duas sobem: melhorando. Barra sobe e linha cai: tráfego que não compra. Barra cai e linha se mantém: o problema é exposição, não o anúncio. Semana em branco: dados insuficientes. |

Legenda dos rótulos:

| Rótulo | Significa | O que fazer | Por que entrou |
|---|---|---|---|
| Invisível | Ativo, recebia visitas e zerou nos últimos 7 dias | Ver se foi moderado ou perdeu indexação no ML — é o mais urgente | Pelo ritmo do período, esperava ≥ 3 visitas em 7 dias e teve 0 |
| Vitrine sem venda | Muita visita e conversão bem abaixo da média | Revisar preço, foto principal e título | ≥ 100 visitas e conversão < metade da média da conta |
| Converte e ninguém vê | Converte bem acima da média, mas tem pouca visita | Colocar em Ads (o selo diz se já está) | ≥ 5 pedidos, conversão ≥ 1,5× a média e visitas abaixo de 3/4 dos anúncios que vendem |
| Perdendo visitas | Caiu mais de 30% de visitas contra o período anterior | Ver concorrência e preço | ≥ 100 visitas no período anterior e queda > 30% |
