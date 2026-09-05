---
tags: [modulo, marketing, brand, standalone]
atualizado: 2026-09-04
---

# Landing Page

Artefato de marketing standalone em `docs/brand/landing/`, não integrado ao app principal (`src/`).
Ver [[Marketplace]] para o módulo de produto real (distinto deste artefato de marketing).

**Status:** reconstruída em 2026-09-04 ([[Índice de ADRs|ADR-0152]]). Não hospedada — o domínio
ainda é decisão do Diego.

## O que é

Página de conversão do **PubliAI**, tratada como o site próprio do produto. Vende a **operação de
marketplace conduzida pela Daludi Innovit Consult** — prestação de serviço, nunca licença de
software. HTML único e autocontido, sem build, tema dark, identidade indigo→violeta e tipografia
Geist, herdadas do design system real do deck comercial.

Headline: *"Sua operação de marketplace, conduzida por quem mostra a conta."*
Público: empresa que já vende no Mercado Livre e quer escalar sem montar time interno de canal.
CTA: *"Enviar 5 produtos para análise"*.

### As 13 seções

Hero → Problema (4 dores) → **Como funciona** (ciclo de 6 etapas com scroll-lock) → Quem faz o quê
→ Torre de controle → Inteligência (tabs Radar/Sonar) → **Prova** (duas operações reais) → O que não
prometemos → Como começamos → **Modalidades** (preço publicado) → CTA (formulário dos 5 produtos +
WhatsApp) → FAQ → Rodapé.

## Onde vive no código

- `docs/brand/landing/index.html` — a página inteira: HTML, CSS e JS num arquivo só.
- `docs/brand/landing/PLANO.md` — o plano de implementação, com a checklist de aceite.
- `docs/brand/landing/assets/` — 8 capturas em WebP, o logo da Daludi e a fonte Geist local.
- Não faz parte do build do frontend (`src/`) — é artefato isolado, não uma rota da SPA.

## Decisões que regem a página

Todas em [[Índice de ADRs|ADR-0152]]. As que mais surpreendem quem chega depois:

- **A página é do PubliAI, mas quem vende é a Daludi.** O header traz a marca do produto; a Daludi
  aparece no ciclo, nas Modalidades e no rodapé como quem conduz. Isso é deliberado: o PubliAI tem
  site próprio, e `daludi.com.br` (verde-água, vende diagnóstico de IA) é outro site, com outra
  identidade e outra oferta.
- **A seção "Planos" da versão anterior não existe mais.** Ela vendia o PubliAI como SaaS, o que
  contradiz a decisão comercial de 30/08/2026 (a Daludi não licencia o produto). No lugar entrou a
  tabela das duas Modalidades de serviço.
- **Só um scroll-lock**, na seção do ciclo. No celular vira lista vertical.
- **Padrão de evidência herdado do material comercial**: nenhum percentual sem denominador, todo
  número com janela e data de leitura, nenhuma promessa de resultado, e o bloco "o que não
  prometemos" como seção própria e visível.

## De qual organização vem cada captura

Decidido em 2026-09-05, a pedido do Diego: as telas de operação vêm da **org AVIL** (a Operação A da
seção de prova), porque é a operação com volume. Três capturas foram refeitas lá — `dashboard`
(90 dias), `publicados-saude` (30 dias) e `financeiro` (30 dias).

Duas exceções, e o motivo de cada uma:

- **Radar e Sonar continuam vindo da org DSA**: a AVIL não tem o módulo Pulse habilitado.
- **`viabilidade` continua sendo a simulação genérica**: a tela é uma calculadora, não mostra dado
  de operação nenhuma — não há "versão AVIL" dela.

Duas armadilhas ao recapturar o app:

- **Navegar por `goto` com hash (`#/publicados`) deixa componentes em placeholder cinza** que
  parecem skeletons mas não são (`.animate-pulse` = 0) e não somem com espera. Capturar **clicando
  no item do menu** resolve. Perdi três rodadas de captura nisso.
- **O que rola é o `<main>`** (`overflow-y-auto`), não a janela: `window.scrollTo(0,0)` não volta ao
  topo, e a captura sai do meio da página.

## Capturas — o que passou e o que foi barrado

As 9 candidatas foram inspecionadas visualmente, uma a uma. Duas foram **descartadas**:

- `revisao-completa.png` — exibe a foto do produto do cliente.
- `telegram.png` — expõe o ID do anúncio no Mercado Livre (`MLB-…`), um EAN e a URL de um pedido
  real. No lugar entraram três cartões em HTML rotulados "Exemplos ilustrativos".

Duas receberam tarja: `radar` (3 títulos **e 3 EANs** — o EAN identifica o produto melhor que o
título) e `publicados-saude` (5 títulos em "Top produtos"). Nenhum original sem tarja entrou no
histórico do git.

## Rodada de ajustes de 2026-09-05

Treze pontos de feedback do Diego. Os que mudaram decisão registrada:

- **Modalidades sem hierarquia** ([[Índice de ADRs|ADR-0152]] D4). O título virou "Duas formas de
  trabalhar com a gente" e os selos passaram a descrever o **cliente**, não o produto: "Você delega
  a leitura de mercado" / "Você lê o mercado junto com a gente". O selo antigo ("Recomendado sem
  equipe interna") saía com peso visual só na Modalidade 1 e fazia a 2 ler como plano inferior —
  quando é a de maior valor. Nenhuma modalidade pode ter destaque maior que a outra.
- **O scroll-lock fica** (D10 mantida). A referência do Diego (a seção "Start free" de
  `aiautomationsociety.ai`) usa cards empilhados sem pin; ele preferiu manter o pin e só aumentar as
  capturas.
- **Vão entre seções**: `padding` de 128px virou a variável `--sec-y` (88px, 56px no celular). Eram
  256px de vazio entre duas seções.
- **Aba nova de Alertas** na seção de inteligência, com alertas de **mercado** (preço, oportunidade,
  margem) — distintos dos alertas operacionais que já existiam na seção da torre de controle.
- **Crescimento da Operação A** virou gráfico de barras: junho R$ 2.621,90 → julho R$ 36.504,43
  (×14) → agosto R$ 71.429,40 (×27). Setembro (2 dias, R$ 5.439,87) fica como nota de rodapé e
  **não entra no gráfico** — a barra mentiria a comparação.
- **Peso e dimensões** no formulário foram separados nos mesmos quatro campos da planilha
  (`PESO_GRAMAS`, `ALTURA_CM`, `LARGURA_CM`, `COMPRIMENTO_CM`).

## Qualidade medida (2026-09-05)

Lighthouse: **performance 96, acessibilidade 100, boas práticas 100, SEO 100**, LCP 2,7s,
CLS 0,004, TBT 0ms. Zero recursos externos. O pin do ciclo foi medido em 7 posições de scroll e em
1366×768.

Performance era 99 em 2026-09-04. Os três pontos foram gastos de propósito, um a um: tirar o
`loading="lazy"` da captura do Sonar (sem isso a aba não mostrava nada) e trocar as três capturas
pelas da AVIL, que são maiores e mais altas. Acessibilidade, boas práticas e SEO seguem em 100.

## Armadilhas conhecidas

- **`body{overflow-x:hidden}` desativa `position:sticky`** em todos os descendentes. A página usa
  `overflow-x:clip`. Trocar de volta quebra o scroll-lock sem aviso.
- **O formulário exige servidor web.** O FormSubmit recusa requisições sem `Origin` — abrir a
  página por duplo clique mostra tudo, mas não envia o formulário.
- **O FormSubmit recusa com HTTP 200.** Quando o formulário não está ativado para aquele domínio, a
  resposta é `200 {"success":"false", "message":"This form needs Activation…"}`. O handler checava
  só `response.ok`, então escondia o formulário e exibia "Recebemos seus produtos" para um envio que
  nunca foi entregue — o lead sumia em silêncio. Corrigido em 05/09/2026 lendo o campo `success` do
  corpo; hoje esse caso cai no fallback do WhatsApp, com os dados preservados na tela.
- **A ativação do FormSubmit é por domínio de origem, não por e-mail.** Diego ativou em 05/09/2026 e
  o serviço registrou o form em `https://publiai.daludi.com.br/`; um envio a partir de
  `localhost:8099` continuou sendo recusado. Quando a página for hospedada, a ativação terá de ser
  refeita a partir do host definitivo.
- Elementos com `z-index` negativo somem atrás do background do `body` — foi o que deixou a aurora
  invisível na primeira montagem.
- **`loading="lazy"` em imagem dentro de painel `hidden` nunca carrega**, nem quando o painel
  aparece: o Chrome avalia a elegibilidade uma vez e não reavalia ao sair de `display:none`, e nem
  rolar a página destrava. Foi o que deixou a captura do Sonar invisível para quem clicava na aba
  (achado em 2026-09-05, corrigido removendo o atributo). Toda imagem em painel de aba deve nascer
  sem `loading="lazy"` — a do Radar já era assim, e por isso só o Sonar quebrava.
- `.tabpanel{display:block}` (regra mais abaixo no CSS) anula `.grid{display:grid}`, de igual
  especificidade. As classes `grid g2` no markup dos dois painéis de aba estão inertes: o layout de
  duas colunas nunca vale ali. É intencional manter assim — as capturas são de 1600px de largura e
  ficam ilegíveis em meia coluna —, mas "consertar" a cascata mudaria o layout das duas abas.

## Pendências

- **Domínio onde a página vai ao ar.** `publiai.daludi.com.br` **não serve**: a raiz já é o app
  PubliAI em produção (verificado em 05/09/2026). Ou outro host, ou uma rota desse mesmo domínio.
  Trava a `og:image`, a URL canônica e a ativação do formulário.
- **Reativar o FormSubmit a partir do host definitivo** — a ativação atual vale para
  `publiai.daludi.com.br`, não para onde a página vai ficar.
- Os dois sites (este e `daludi.com.br`) não se linkam entre si além do rodapé daqui.
