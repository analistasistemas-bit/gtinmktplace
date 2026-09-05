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

## Capturas — o que passou e o que foi barrado

As 9 candidatas foram inspecionadas visualmente, uma a uma. Duas foram **descartadas**:

- `revisao-completa.png` — exibe a foto do produto do cliente.
- `telegram.png` — expõe o ID do anúncio no Mercado Livre (`MLB-…`), um EAN e a URL de um pedido
  real. No lugar entraram três cartões em HTML rotulados "Exemplos ilustrativos".

Duas receberam tarja: `radar` (3 títulos **e 3 EANs** — o EAN identifica o produto melhor que o
título) e `publicados-saude` (5 títulos em "Top produtos"). Nenhum original sem tarja entrou no
histórico do git.

## Qualidade medida (2026-09-05)

Lighthouse: **performance 97, acessibilidade 100, boas práticas 100, SEO 100**, LCP 2,6s,
CLS 0,003, TBT 0ms. Zero recursos externos. O pin do ciclo foi medido em 7 posições de scroll e em
1366×768.

Performance era 99 até 2026-09-04. Os 2 pontos foram gastos deliberadamente ao tirar o
`loading="lazy"` da captura do Sonar (ver Armadilhas): ela passou a carregar no load inicial, o que
custou 42KB e 0,3s de LCP — e é o que faz a aba Sonar mostrar alguma coisa.

## Armadilhas conhecidas

- **`body{overflow-x:hidden}` desativa `position:sticky`** em todos os descendentes. A página usa
  `overflow-x:clip`. Trocar de volta quebra o scroll-lock sem aviso.
- **O formulário exige servidor web.** O FormSubmit recusa requisições sem `Origin` — abrir a
  página por duplo clique mostra tudo, mas não envia o formulário.
- **O FormSubmit precisa de ativação**: o primeiro envio não é entregue, só dispara um e-mail com o
  link de ativação para `sac@daludi.com.br`. Esse primeiro envio já foi queimado com um teste em
  04/09/2026.
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

- Domínio onde a página vai ao ar (trava a `og:image` e a URL canônica).
- Clique no link de ativação do FormSubmit, em `sac@daludi.com.br`.
- Os dois sites (este e `daludi.com.br`) não se linkam entre si além do rodapé daqui.
