# ADR-0152: Landing page da oferta "Operação de Marketplace" — página da Daludi com identidade visual do PubliAI

**Status:** Aceito e implementado (2026-09-04) — ver `docs/brand/landing/index.html`
**Data:** 2026-09-04
**Decisores:** Diego
**Relacionado:** `apresentacao/H-Briefing-Site-Acelerador.md` (briefing original da oferta), `apresentacao/C-Mapa-dos-Slides.md` (narrativa dos 18 slides), `apresentacao/E-Mapa-de-Screenshots.md` (allowlist de capturas), `apresentacao/G-Pendencias.md` (P17 logotipo, decisão comercial de 30/08/2026), `obsidian-vault/03-Módulos/Landing Page.md` (estado da landing anterior)

## Contexto

Existia em `docs/brand/landing/index.html` uma landing single-file que vendia o **PubliAI como
produto SaaS**, com seção "Planos" placeholder. Ela contradiz frontalmente a decisão comercial
registrada em `G-Pendencias.md`:

> Modalidade de licenciamento do PubliAI — retirada por decisão comercial (30/08/2026): a Daludi
> trabalha exclusivamente com prestação de serviço e não licencia produto.

Diego pediu uma landing "premium", inspirada em `aiautomationsociety.ai`, seguindo seis diretrizes
(brand guidelines, os 3 Ps, scroll-lock responsivo, inspiração externa, componentes prontos,
mobile). A entrevista resolveu doze pontos que decidem a página inteira.

## Decisões

### D1 — A página vende a operação da Daludi; o PubliAI aparece nomeado como torre de controle

Não é venda de software, não sugere assinatura, licença ou SaaS. A seção "Planos" da landing
antiga é substituída pela tabela de **Modalidades** do serviço.
_Descartado:_ PubliAI como SaaS (reabriria decisão comercial fechada); plataforma sem nome
(H-Briefing §8.3 deixava em aberto — Diego optou por nomear).

### D2 — Os números das duas operações reais entram, anônimos

Operação A (R$ 115.995,60 · 1.724 pedidos · 2.777 unidades, jun–set/2026) e Operação B
(R$ 35.029,99 · 519 pedidos · 584 unidades · 10 anúncios ativos, 30 dias), lidos em 02/09/2026.
Cada número carrega **denominador, janela e data de leitura**. Nenhum cliente é nomeado.
_Descartado:_ publicar só uma operação; omitir números (a página perderia o bloco que responde
"isso funciona mesmo?").

### D3 — Capturas reais com tarja nos títulos de produto de terceiro

`radar.png`, `publicados-*.png`, `revisao-completa.png` e `telegram.png` mostram catálogo de
cliente. Aplica-se o mesmo precedente já usado nos nomes de comprador do `telegram.png`: mascarar.
Nenhuma interface é recriada, redesenhada ou simulada — regra herdada de `E-Mapa-de-Screenshots.md`.
_Descartado:_ usar só telas sem produto (perderia a prova de revisão humana e de monitoramento);
recapturar em conta demo (travaria a entrega).

### D4 — Preço publicado: a tabela completa das duas Modalidades

Implantação R$ 3.000 · Sustentação de Infraestrutura R$ 600/mês (Modalidade 1) ou incorporada
(Modalidade 2) · Gestão 5% e 7% do faturamento bruto · Pulse só na Modalidade 2. Rodapé obrigatório:
24 meses, R$ 1,20 por consulta do Sonar, até 20 publicações e 10 análises inviáveis por mês.
Vocabulário travado: **"Sustentação de Infraestrutura"**, nunca "manutenção da plataforma";
**"Infraestrutura Mensal"**, nunca "mensalidade".
_Descartado:_ "a partir de R$ 3.000"; preço atrás de clique; sem preço (contraria H-Briefing §0.3).

### D5 — Artefato: HTML único e autocontido em `docs/brand/landing/index.html`

Sem build, sem framework, abre com duplo clique — mesma natureza dos decks em `apresentacao/`.
_Descartado:_ rota `/marketplace` no repo `lpdaludi`; rota na SPA do PubliAI; deploy já configurado.

### D6 — CTA: formulário dos 5 produtos + WhatsApp

Campos: nome, e-mail, empresa, WhatsApp, "vende hoje no ML?" (sim/não/já vendi), até 5 produtos
(EAN ou descrição, custo de compra, dimensões/peso) e campo livre. Posta em serviço externo de
formulário; botão de WhatsApp com mensagem pré-preenchida ao lado. Destino separado do formulário
de diagnóstico do site institucional (H-Briefing §5).
_Descartado:_ só WhatsApp; Edge Function no Supabase; Google Forms.

### D7 — Persona: empresa que já vende no Mercado Livre e quer escalar sem montar time interno

É quem consegue responder ao CTA com custo de compra na mão. Os 3 Ps ficam:
**Pain** — comprar estoque sem saber se o preço fecha depois de comissão e frete; descobrir a queda
do concorrente quando a venda já parou; não saber a sobra por unidade hoje; anúncio pausado por
estoque zerado sem ninguém perceber.
**Person** — a empresa acima.
**Promise** — a operação inteira conduzida, com a conta na mesma tela que a equipe da Daludi usa.
_Descartado:_ quem nunca entrou em marketplace; foco em falta de visibilidade; página ampla.

### D8 — Direção visual: aurora indigo→violeta + grid técnico + parallax, tema escuro apenas

Fundo preto com brilho `#5C5CEB`→`#9152E3` difuso em movimento lento, grid técnico sutil, capturas
entrando em camadas. Tipografia Geist. Reafirmada por Diego **depois** de confrontada com a
identidade real do site institucional (ver Consequências).
_Descartado:_ camadas de paisagem (metáfora emprestada); fundo reativo ao mouse (invisível no
celular); sóbrio sem efeito. Tema claro descartado: marca dark, capturas dark, página standalone.

### D9 — Marca no cabeçalho: PubliAI; a Daludi assina a operação

Esta página **é o site próprio do PubliAI** — decisão de Diego em 2026-09-04, e é o que justifica
D8: o design system da página é o do produto, de ponta a ponta. A marca no topo é o PubliAI, com os
ativos de `docs/brand/PubliAI-Brand/`.

A Daludi Innovit Consult aparece como **quem conduz a operação**: na seção de como funciona, na
tabela de Modalidades e no rodapé ("operação conduzida pela Daludi Innovit Consult"). O visitante
precisa terminar a página entendendo que contrata um **serviço**, não uma licença — D1 continua
valendo integralmente.
_Descartado:_ logo da Daludi no header; lockup duplo; omitir a Daludi (voltaria a soar como venda
de software, proibido pela decisão comercial de 30/08). Os ativos da marca Daludi em
`/Users/diego/Desktop/IA/LandingPage_Daludi/imagens_daludi/` ficam disponíveis para o rodapé.

### D10 — Scroll-lock: um pin só, no ciclo da operação

A seção do ciclo (Viabilidade → Preparação → Revisão humana → Publicação → Monitoramento →
Financeiro) prende o scroll e troca a captura a cada etapa. No celular degrada para lista vertical.
O resto da página usa reveal por scroll, parallax e barra de progresso — sem travar nada.
_Descartado:_ dois pins; nenhum pin; trilho horizontal.

### D11 — A landing anterior é substituída

A nova ocupa `docs/brand/landing/index.html`. A antiga fica no histórico do git.
_Descartado:_ manter as duas; arquivar cópia em `_obsoletos/`.

### D12 — Padrão de evidência herdado do material comercial

Vale integralmente na página o critério de aceite de `H-Briefing` §9 e as proibições de §10:
nenhum percentual sem denominador; só dois rótulos (**markup** = lucro ÷ custo e **margem s/ venda**
= lucro ÷ preço); todo número com janela e data; nenhuma promessa de lucro, margem, prazo, Buy Box
ou "X vezes mais rápido"; Shopee, Amazon, Magalu e Casas Bahia nunca como canais operacionais; o
bloco **"o que não prometemos"** visível na página, não escondido no rodapé.

## Consequências

**São dois sites, com duas identidades — e isso é deliberado.** `daludi.com.br` está no ar com
identidade **verde-água** (`#00A688`, `#00F5C4`, fundo `#0A1F1C`), constelação animada e logo
hexagonal em teal; vende diagnóstico de IA. Esta página é o **site do PubliAI**, indigo/violeta,
e vende a operação de marketplace. Quem chega de um ao outro percebe a troca de marca — é o preço
de o produto ter site próprio, e foi decidido assim depois de a diferença ser mostrada a Diego.
Consequência prática: os dois sites precisam se linkar explicitamente, ou o prospect que ouviu
falar da Daludi não encontra esta página.

**O formulário não herda a infraestrutura que já existe.** O repo `analistasistemas-bit/lpdaludi`
tem `backend/functions` com o formulário de diagnóstico e área administrativa. A landing standalone
usa serviço externo, o que significa nenhum funil medido no mesmo lugar dos outros leads.

**A oferta nasce órfã de navegação.** Sem item de menu, sem card em Soluções e sem card em Cases no
site institucional, a página depende de link direto (WhatsApp, e-mail, anúncio). O H-Briefing §1
previa os três pontos de entrada — nenhum deles existe neste formato.

## Pendências antes de publicar

| # | O que falta | De quem | Status |
|---|---|---|---|
| 1 | Endpoint do formulário | Diego | ✅ FormSubmit AJAX em `sac@daludi.com.br` (sem conta Formspree) |
| 2 | WhatsApp e mensagem pré-preenchida | Diego | ✅ `5581983426557` · "Olá! Vim pela página do PubliAI e quero enviar 5 produtos Curva A para análise." |
| 3 | E-mail de contato do rodapé (G-Pendencias P18) | Diego | ✅ `sac@daludi.com.br` |
| 4 | Domínio onde a página vai ao ar | Diego | ⏳ pendente — e a raiz `publiai.daludi.com.br` **já está ocupada pelo app PubliAI em produção** (SPA React, verificado em 05/09/2026), então a landing precisa de outro host ou de uma rota nesse mesmo domínio. Trava a `og:image`, a URL canônica e a ativação do formulário (linha 6) |
| 7 | **O formulário exige servidor web**: o FormSubmit recusa requisições sem `Origin`, então a página aberta por duplo clique mostra tudo mas não envia o formulário | — | registrado |
| 5 | Autorização das duas operações para uso público (H-Briefing §8.1) | Diego | ✅ confirmada na entrevista de 2026-09-04 |
| 6 | **Ativação do FormSubmit** | Diego | ⚠️ parcial. Diego ativou em 05/09/2026, mas **a ativação é por domínio de origem**, e a tela do FormSubmit registrou `https://publiai.daludi.com.br/` — não o host onde a landing vai ficar. Um envio de teste a partir de `localhost:8099` foi recusado com a mesma mensagem de "needs Activation" (medido em 05/09/2026). Consequência: **quando o domínio da linha 4 for decidido, a ativação terá de ser refeita a partir dele** — a menos que seja uma rota do próprio `publiai.daludi.com.br`, hipótese ainda não confirmada |
