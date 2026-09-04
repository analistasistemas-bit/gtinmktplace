# Plano de implementação — Landing premium do PubliAI (ADR-0152)

Arquivo-alvo: `docs/brand/landing/index.html` (substitui o atual, D11).
Base: ADR-0152, `apresentacao/H-Briefing-Site-Acelerador.md`, `apresentacao/C-Mapa-dos-Slides.md`,
`apresentacao/E-Mapa-de-Screenshots.md`, `apresentacao/src/deck.css`, `apresentacao/src/principal.html`.

> A pasta `apresentacao/` é gitignored — leia pelo caminho absoluto
> `/Users/diego/Desktop/IA/Anuncios MktPlace/apresentacao/...`

## 0. Decisões do arquiteto (não reabrir)

| # | Conflito | Decisão | Por quê |
|---|---|---|---|
| A1 | Hero: briefing ("por quem mostra a conta") × deck ("por especialistas") | **Briefing** | Escrito para web; amarra com a captura do Dashboard logo abaixo |
| A2 | Ciclo: briefing (Viabilidade→Preparação→Revisão humana→Publicação→Monitoramento→Financeiro) × deck slide 06 | **Briefing** | D10 já fixa esses seis nomes |
| A3 | §6 "tema claro e escuro" × D8 "escuro apenas" | **D8**; aceite vira "abre bem no escuro + celular" | ADR é posterior ao briefing |
| A4 | §9 "menu, sitemap, cards linkam" | **Não aplicável**; substituído por link explícito para `daludi.com.br` no rodapé | Página standalone, sem site-mãe |
| A5 | §6 WebP | **PNG redimensionado** (`sips -Z 1600`) | `sips` não exporta WebP e não há build; o critério é Lighthouse ≥ 90 |
| A6 | "Recompra de 16,8%" | **Omitir** | Denominador não documentado; D12 proíbe % sem denominador |
| A7 | Imagens/fonte: embutir × `assets/` | **`assets/` ao lado** | Base64 mata `loading="lazy"`, cache e LCP; duplo clique funciona igual |
| A8 | Tabela comparativa (slide 17) × cards `.plan` (slide 16) | **Cards `.plan`** + chips "incluído nas duas" | Resolve nativamente "tabela larga no celular" |
| A9 | CTA pill claro (referência) × `.btn.primary` gradiente (deck) | **Pill claro** `#F1F1F5` como primário; gradiente só em tag/selo | Pedido visual explícito |
| A10 | "Assinatura por pessoa" (slide 13) | **Nunca usar a palavra "assinatura"** | O grep de licenciamento precisa dar zero |
| A11 | `alertas.png` | **Não usar** | Nome de produto no texto do alerta; Radar + Sonar bastam |

## 1. Arquitetura

### 1.1 Assets (copiar antes de referenciar)

Origem `/Users/diego/Desktop/IA/Anuncios MktPlace/apresentacao/` → destino `docs/brand/landing/assets/`.

Estado após a **verificação visual de cada captura, uma a uma** (2026-09-04). O relatório do agente
que aplicou as tarjas não bastou: três problemas só apareceram na conferência do arquiteto.

| Arquivo | Veredito | Observação |
|---|---|---|
| `dashboard.png` | ✅ usar | Só KPIs; a faixa "Precisa de atenção" traz uma contagem, não títulos |
| `viabilidade.png` | ✅ usar | "Produto avulso" — simulação genérica |
| `revisao-analise.png` | ✅ usar (2×) | Sem título e **sem foto**; substitui a `revisao-completa` |
| `financeiro.png` | ✅ usar | Só KPIs financeiros |
| `sonar-veredito.png` | ✅ usar | Consulta genérica, sem produto do cliente |
| `publicados-saude.png` | ✅ usar | 5 títulos tarjados em "Top produtos"; valores legíveis |
| `radar.png` | ✅ usar | 3 títulos **e 3 EANs** tarjados — o EAN identifica o produto melhor que o título |
| `revisao-completa.png` | ❌ **descartada** | Exibe a **foto do produto** do cliente |
| `telegram.png` | ❌ **descartada** | Expõe o ID do anúncio (`MLB-…`), um EAN e a URL de um pedido real |
| `daludi-logo.png` | ✅ usar | Rodapé |
| `vendor/geist-latin.woff2`, `vendor/geist-latinext.woff2` | → `assets/fonts/` | |

Originais sem tarja **nunca** entram no repo. Os PNGs só foram adicionados ao git depois da
verificação — antes disso ficaram untracked de propósito, porque original no histórico é irreversível.

**Substituição do bloco de notificações (antes `telegram.png`):** três cartões em HTML/CSS com
marcador semântico de cor, rotulados de forma visível como "Exemplos ilustrativos — não são capturas
de tela". Precedente: o slide 13 do deck já usa cartões ilustrativos rotulados. Textos em §2, seção 05.

### 1.2 Ordem das seções

```
00 barra de progresso + header sticky
01 Hero              — promessa + Dashboard em moldura gigante
02 Problema          — 4 dores do lojista (D7)
03 Como funciona     — ciclo de 6 etapas, PIN único (D10), 6 capturas
04 Quem faz o quê    — Daludi × Você
05 Torre de controle — "delega a execução, não a visibilidade" + Telegram
06 Inteligência      — tabs Radar/Sonar (o que a Modalidade 2 acrescenta)
07 Prova             — duas operações, números com denominador/janela/data (D2)
08 Não prometemos    — logo após a prova; é o que a torna crível
09 Como começamos    — Implantação + Calibração, regra dos 5
10 Modalidades       — preço completo (D4), só depois de valor construído
11 CTA               — formulário 5 produtos + WhatsApp (D6)
12 FAQ               — <details> nativo + FAQPage
13 Rodapé            — PubliAI + "operação conduzida pela Daludi" + link daludi.com.br
```

### 1.3 CSS (um `<style>`, nesta ordem)

1. `@font-face` Geist (2 arquivos locais, `font-weight:300 700`, `font-display:swap`) + `preload` do latin.
2. `:root` — copiar verbatim os tokens de `deck.css` linhas 6–34; acrescentar
   `--maxw:1180px`, escala `--s1:8px … --s8:128px`, e fluido:
   `--h1:clamp(40px,7.2vw,88px); --h2:clamp(30px,4.6vw,56px); --lead:clamp(16px,1.6vw,19px)`.
3. Reset + `body` (font-family e `font-feature-settings` do deck; `overflow-x:hidden`).
4. Camadas fixas: `.bg` (aurora: 2 `<i>` com `radial-gradient` animados por `transform`;
   grade técnica = `.slide::before` do deck adaptado para `position:fixed`) e `.progress`.
5. Header.
6. Utilitários do deck adaptados para fluido: `.wrap`, `.pill` (`.chip.brand` + `.dot`), `.grad`,
   `.btn` (`.light` / `.ghost`), `.card` / `.card.brand` / `.card.flat`, `.chip`,
   `.shot` + `.bar` + `.u` (moldura de navegador — copiar integral), `.note` / `.note.brandy`,
   `.plan` / `.plan.rec` / `.tag` / `.prow`, `.col.daludi` / `.col.cliente`, `.phase`, `.big`, `.tiny`.
7. Seções.
8. Estados de animação (`.rv`, `.rv.in`, `.w`, `.shot.hero`).
9. `@media (max-width:900px)` e `(max-width:600px)`.
10. `@media (prefers-reduced-motion:reduce)` — por último, vence tudo.

### 1.4 JS (um `<script>` no fim do `<body>`, IIFE, ~150 linhas)

```
CONFIG = {
  formEndpoint:  'https://formsubmit.co/ajax/sac@daludi.com.br',
  whatsappNumber:'5581983426557',
  whatsappMessage:'Olá! Vim pela página do PubliAI e quero enviar 5 produtos Curva A para análise.',
  contactEmail:  'sac@daludi.com.br'
}
html.no-js → html.js
progressAndHeader()   // 1 listener scroll passive + rAF
reveal()              // IntersectionObserver
splitWords('#hero h1')
parallaxHero()        // mesmo rAF do scroll
pinCycle()            // IO em 6 sentinelas
tabs('#inteligencia')
form('#cta form')
```

## 2. Seção a seção

Copy entre aspas é literal (de `principal.html` / briefing).

### 00 Header + progresso
- Logo: `<svg><use href="#sym">` + wordmark `Publi<em>AI</em>` (símbolo já inline na landing antiga).
- Nav: Como funciona · Prova · Modalidades · FAQ · **[Enviar 5 produtos]** (pill claro).
  Abaixo de 820px: só logo + CTA, sem hambúrguer.
- Sticky, `backdrop-filter:blur(12px)`, fundo `rgba(8,9,14,.6)`; classe `.scrolled` após 8px.
- Progresso: `fixed;top:0;height:2px;background:var(--grad);transform-origin:left;transform:scaleX(0)`.

### 01 Hero
- Pill: `● Operação no Mercado Livre · conduzida pela Daludi Innovit Consult`
- H1 (palavra a palavra): "Sua operação de marketplace, conduzida por quem
  `<span class=grad>`mostra a conta.`</span>`"
- Sub: "Viabilidade antes de comprar estoque, preço acompanhado todo dia e o líquido de cada
  venda — na mesma tela que a nossa equipe usa."
- CTAs: **[Enviar 5 produtos para análise]** (→ `#cta`) · [Ver as modalidades] (ghost).
- `.tiny`: "Você contrata a operação, não um software: o PubliAI é a plataforma com que a equipe
  da Daludi conduz o canal — e a sua janela sobre ele."
- Captura `dashboard.png` em `.shot.hero` (max 1100px), barra `publiai · dashboard · mês atual`,
  `loading="eager" fetchpriority="high"`. Legenda: "Tela real do PubliAI · Dashboard de uma
  operação ativa no Mercado Livre."
- Animação: reveal + palavra a palavra no H1; moldura `scale(.96)→1` + parallax (0.12×scroll até 80px).
- Mobile: H1 40px, CTAs empilhados 100%, moldura sem parallax.

### 02 Problema
- Pill "O ponto de partida" · H2 "O canal digital não se desenvolve sozinho —
  `<grad>`ele é operado.`</grad>`"
- 4 `.card` (grid 2×2, stagger 80ms), literais do briefing bloco 2:
  "Comprar estoque sem saber se o preço fecha depois da comissão e do frete." /
  "Descobrir que o concorrente baixou o preço quando a venda já parou." /
  "Não saber quanto sobra por unidade no preço que está praticando **hoje**." /
  "Anúncio pausado por estoque zerado — e ninguém percebeu."
- Abaixo: nuvem dos 20 chips do slide 02 + "Não é uma lista de tarefas. São **competências
  diferentes**, que precisam conversar entre si e acontecer **todo mês**, não uma vez."

### 03 Como funciona — PIN (D10)
- Pill "Como funciona" · H2 "Uma operação que roda em ciclo — `<grad>`não em projeto.`</grad>`"
- Lead: "A Daludi Innovit Consult conduz cada etapa; o PubliAI registra e mostra. Nada vai ao ar
  sem uma pessoa conferir — nem sugestão de IA, nem reprecificação automática."
- Desktop: `section#ciclo{height:600vh}` › `.pin{position:sticky;top:0;height:100svh;
  display:grid;grid-template-columns:.9fr 1.3fr}`. Esquerda: lista de 6 passos (o ativo ganha `.on`).
  Direita: 6 `.shot` em `position:absolute` com crossfade. 6 sentinelas `div.s` de 100vh fora do
  sticky; IO `rootMargin:'-50% 0px -50% 0px'` define o índice ativo.

| # | Etapa | Descrição | Captura · barra | Legenda |
|---|---|---|---|---|
| 1 | Viabilidade | "Comissão, frete e imposto saem do preço antes de qualquer promessa de margem — com as taxas oficiais consultadas na API do Mercado Livre. Decisão antes do estoque, não depois." | `viabilidade.png` · `publiai · viabilidade · calculadora mercado livre` | "Simulação demonstrativa com produto genérico; as taxas de comissão e frete são reais." |
| 2 | Preparação | "Título, descrição, atributos, fotos e ficha técnica — com a estratégia de preço explicada e o piso que não pode ser rompido." | `revisao-analise.png` · `publiai · revisão · análise para publicação` | — |
| 3 | Revisão humana | "Nenhuma publicação é confirmada sem uma pessoa aprovar. A IA propõe; a equipe decide." | `revisao-analise.png` · `publiai · revisão · você recebe por venda` | — |
| 4 | Publicação | "Anúncio no ar, com a saúde acompanhada: ativos, com problema, pausados e encalhados." | `publicados-saude.png` (tarja) · `publiai · publicados · 30 dias` | idem |
| 5 | Monitoramento | "Seu preço, o menor preço relevante, sua posição e quantas ofertas disputam a mesma página — todo dia. Movimento de concorrente vira tarefa para a equipe, nunca reprecificação automática." | `radar.png` (tarja) · `publiai · pulse · radar` | idem |
| 6 | Financeiro | "Líquido das vendas, comissão e frete separados, estornos — e o que está liberado, a liberar e já sacado. Não é estimativa de margem: é o que a conta conectada mostra." | `financeiro.png` · `publiai · financeiro · 30 dias` | — |

- Mobile (<900px) e `html.no-js`: `height:auto`, `.pin{position:static;display:block}`,
  sentinelas `display:none`, passos e capturas empilhados.
- Reduced-motion: sticky mantido, crossfade instantâneo.

### 04 Quem faz o quê
- Pill "Divisão de responsabilidades" · H2 "A Daludi assume a complexidade digital. Você mantém
  sua operação física e fiscal."
- `.col.daludi` (8 itens do slide 05) · `.col.cliente` (5 itens + "Também com você: o investimento
  financeiro em mídia…"). `.note.brandy` de Publicidade, literal.

### 05 Torre de controle
- Pill "A tecnologia por trás da operação" · H2 "Você delega a execução.
  `<grad>`Não delega a visibilidade.`</grad>`"
- Lead: "O PubliAI é a plataforma proprietária com que a equipe da Daludi opera o seu canal — e é
  também a **sua janela sobre essa operação**: o mesmo dado, ao mesmo tempo, para quem executa e
  para quem contratou."
- 4 `.card.flat` literais: Operação registrada / Números na origem / Incerteza sinalizada / Acesso próprio.
- Direita: H3 "Você não precisa abrir o sistema para saber o que aconteceu." + **três cartões em
  HTML/CSS** (sem captura), cada um com marcador semântico de cor, sob o rótulo visível
  **"Exemplos ilustrativos — não são capturas de tela"**:
  - **Estoque** (âmbar): "Estoque zerado — anúncio pausado no Mercado Livre. Repor o estoque reativa
    o anúncio automaticamente."
  - **Moderação** (vermelho): "Anúncio com restrição de moderação — a equipe é avisada antes de a
    venda parar."
  - **Pulse** (indigo): "6 atualizações de mercado, nenhuma exige decisão."

  Depois: chips das 9 categorias + "O mesmo aviso chega no Telegram e no sino dentro do PubliAI;
  cada pessoa escolhe as categorias que recebe."

### 06 Inteligência — tabs
- Pill "Pulse · incluído na Modalidade 2" · H2 "Como acompanho a disputa e encontro novas
  oportunidades?"
- `role=tablist`, 2 tabs: **Radar · o que você já vende** (`radar.png`) / **Sonar · o que você ainda
  não vende** (`sonar-veredito.png`), parágrafos literais do slide 12.
- `.note` "O que a inteligência faz — e o que ela não faz" (literal, inclui "não promete posição de
  Buy Box").
- "Na Modalidade 1 a equipe da Daludi usa essa camada por você; na Modalidade 2 você também acessa."

### 07 Prova (D2)
- Pill "Duas operações reais" · H2 "Números lidos no painel em 02/09/2026." · Sub: "São operações
  reais, não projeções — e não são promessa de resultado para o seu caso."
- **Operação A · três meses**: `.big` R$ 115.995,60 · "faturamento bruto · 04/06 a 02/09/2026" ·
  1.724 pedidos · 2.777 unidades · "Primeiro anúncio publicado em 04/06/2026" · "junho (a partir de
  04/06) R$ 2.621,90 → julho R$ 36.504,43 → agosto R$ 71.429,40" · "Markup (lucro ÷ custo): +37% no
  primeiro mês · +39% em agosto — crescer não custou margem."
- **Operação B · primeiro mês**: R$ 35.029,99 · "faturamento bruto · 30 dias até 02/09/2026" ·
  519 pedidos · 584 unidades · "ticket médio R$ 67,50 (faturamento ÷ pedidos)" · "10 anúncios ativos
  — R$ 3.503 por anúncio no ar (faturamento ÷ anúncios ativos)" · "Primeiro anúncio publicado em
  02/08/2026" · "Markup (lucro ÷ custo): +19% no período."
- `.tiny`: "Nenhum cliente é nomeado. Categorias, custos e concorrência diferentes das suas."
- Sem count-up.

### 08 O que não prometemos
`.note` ampliada (âmbar, borda esquerda 3px), H2 "Não projetamos o seu faturamento.", texto literal
do briefing bloco 5. Seção própria, sempre visível, não colapsável.

### 09 Como começamos
Pill "O primeiro passo" · H2 "Implantação + Calibração inicial da operação" · `.phase` Fase 1
(4 itens) e `.phase.hot` Fase 2 (4 itens), literais do slide 14 · cards "A regra dos 5 produtos
Curva A" e "Nosso compromisso" · `.note.brandy` "concluídas em até **20 dias corridos**" ·
`.note` "Condição de reembolso".

### 10 Modalidades (D4)
- Pill "Qual é a sua situação hoje?" · H2 "Duas modalidades — a mesma operação conduzida pela
  Daludi, `<grad>`dois níveis de participação sua.`</grad>`"
- `.plan.rec` (tag "Recomendado sem equipe interna") e `.plan`, linhas literais do slide 16, rótulo
  **"Sustentação de Infraestrutura"**. Terceiro card "Como escolher".
- `.card.brand` "Incluído nas duas modalidades" (10 chips do slide 17) · `.card.flat` "O que não
  está incluído".
- `.tiny` obrigatório: "Percentuais sobre o **faturamento bruto** gerado nos marketplaces
  administrados · prazo contratual de 24 meses nas duas modalidades · consultas do Sonar na
  Modalidade 2 a R$ 1,20 por consulta de produto · capacidade de até 20 novos produtos publicados
  por mês, mais até 10 análises de produtos inviáveis, que não consomem o limite."

### 11 CTA — formulário (D6)
- Pill "Próximo passo" · H2 "Selecione 5 produtos Curva A. `<grad>`Nós dizemos se vale operar — e
  por quanto.`</grad>`" · lead literal do slide 18.
- `<form method="POST">`: nome, e-mail, empresa, WhatsApp (todos `required`); `<select>` "Vende hoje
  no Mercado Livre?" (sim / não / já vendi); 5 `<fieldset>` de produto (EAN ou descrição · custo de
  compra · dimensões/peso aproximados) — o 1º aberto e `required`, 2–5 dentro de `<details>`;
  `<textarea>` "O que você mais quer descobrir?"; honeypot oculto.
- Microcopy literal do §5. Sucesso próprio: "Recebemos seus produtos. A leitura do seu caso chega
  por e-mail ou WhatsApp." Evento `window.dataLayer?.push({event:'lead_marketplace_5produtos'})`.
- Botão WhatsApp `https://wa.me/${number}?text=${encodeURIComponent(message)}`.
- **Envio (FormSubmit em modo AJAX)**: `fetch(CONFIG.formEndpoint, {method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'}, body: JSON.stringify(dados)})`.
  Campos de controle do FormSubmit no corpo: `_subject: 'Novos 5 produtos para análise — landing PubliAI'`,
  `_captcha: 'false'`, `_template: 'table'`. O visitante NÃO sai da página; sucesso e erro são
  renderizados inline.
- **Fallback obrigatório**: se o `fetch` falhar (offline, CORS ao abrir por `file://`, FormSubmit
  fora do ar), NÃO perder o lead — montar o texto dos 5 produtos e abrir
  `wa.me/5581983426557` com tudo pré-preenchido, avisando o visitante do que aconteceu.
- **Ativação**: o FormSubmit exige que o primeiro envio seja confirmado por um link enviado a
  `sac@daludi.com.br`. Antes disso nada é entregue — testar e avisar Diego.
- Nunca inventar dado de contato. Se algum campo de `CONFIG` estiver vazio, o elemento
  correspondente é ocultado, não preenchido com placeholder.

### 12 FAQ
7 `<details>` nativos (§3.2 bloco 8) + JSON-LD `FAQPage` com texto idêntico:
1. "No Mercado Livre. Outros canais estão no roadmap do PubliAI e não são objeto desta oferta."
   (**sem nomear** Shopee/Amazon/Magalu/Casas Bahia)
2. "Não. A calibração começa com 5 produtos Curva A; a capacidade incluída é de até 20 novos
   produtos publicados por mês."
3. "A equipe da Daludi prepara, revisa e publica. Nenhuma publicação é confirmada sem uma pessoa
   aprovar."
4. "Não. A inteligência sinaliza o movimento; a mudança de preço volta para revisão humana antes de
   ir ao marketplace."
5. "A análise diz isso com clareza — concluir que não vale operar também é resultado. Análises
   inviáveis não consomem o limite (até 10 por mês). Por envolver trabalho executado, implantação e
   calibração não são reembolsáveis nessa hipótese."
6. "Até 20 novos produtos publicados por mês, nas duas modalidades, mais até 10 análises de produtos
   inviáveis."
7. "Sim. Você tem acesso próprio ao PubliAI — o mesmo dado, ao mesmo tempo. Comissão, frete e
   liberação vêm da conta conectada ao Mercado Livre; estimativa aparece rotulada como estimativa."

### 13 Rodapé e `<head>`
- Logo PubliAI · "Operação conduzida pela **Daludi Innovit Consult**" + `daludi-logo.png` (28px) +
  link `https://daludi.com.br` · contato (de CONFIG; oculto se vazio) · nav de âncoras ·
  "© 2026 PubliAI · Daludi Innovit Consult".
- `<head>`: `<title>PubliAI — Operação de marketplace conduzida por quem mostra a conta</title>`,
  meta description = sub do hero, `og:title/og:description/og:type`, JSON-LD `Service`
  (provider = Daludi Innovit Consult, areaServed BR, offers = as duas modalidades), favicon existente.

## 3. Sistema de animação (lista fechada)

| # | Efeito | Técnica | Custo | reduced-motion | sem JS |
|---|---|---|---|---|---|
| A | Barra de progresso | 1 `scroll` passive → rAF → `transform:scaleX(p)` | compositor | mantém | oculta |
| B | Reveal por scroll | IO `threshold:.15` → `.in`; `opacity 0→1, translateY 24→0, blur 8→0`, 600ms, stagger `--i` | blur **só em texto/cards**; `.shot.rv` só opacity+translate | `.rv{opacity:1;transform:none;filter:none;transition:none}` | `.rv` só oculto sob `html.js` |
| C | Palavra a palavra | percorrer text nodes do H1 (preserva `<span class=grad>`), envolver palavras em `<span class=w style="--i:n">`; `transition-delay:calc(var(--i)*40ms)` | só no hero | sem delay | texto íntegro |
| D | Parallax do hero | mesmo rAF de A: `y=min(scrollY*.12,80)`; `translate3d(0,-y,0)`; entrada `scale(.96)→1` | 1 elemento, `will-change:transform` | estático | estático |
| E | Aurora | `.bg` fixed, 2 `<i>` `radial-gradient` (~60vw), keyframes translate/scale 28s e 36s; grade `::before` com `mask-image` | transform apenas; **sem `filter:blur`**; `contain:strict` | `animation:none` | CSS puro |
| F | Pin do ciclo | `position:sticky` + IO em 6 sentinelas | 0 scroll listener | crossfade 0ms | vira lista |
| G | Tabs | click + ArrowLeft/Right, `aria-selected`, `hidden` no painel inativo | — | instantâneo | `html.no-js .tabpanel{display:block}` |
| H | Header `.scrolled` | mesmo rAF de A | border-color | mantém | sem borda |
| I | Hover | CSS transition 180ms | transform/border | `transition:none` | — |

Descartado de propósito: count-up, fundo reativo ao mouse (D8), segundo pin, marquee, bibliotecas.

## 4. Tarefas ordenadas

Base: `docs/brand/landing/`.

**T0 — Assets.** Copiar a lista de §1.1 (originais dos tarjáveis para `/tmp/tarja/`). `sips -Z 1600`
em PNG com largura > 1600.
→ Verifica: `ls assets assets/fonts` bate; nenhum PNG > 1600px nem > 500 KB.

**T1 — Tarjas.** Abrir cada um dos 4 (+ conferir `revisao-analise.png`), localizar títulos de
produto, desenhar retângulos `#1C2030` com a palavra "produto". Re-abrir e confirmar que nada
sobrou. Salvar em `assets/`.
→ Verifica: re-leitura visual sem título legível; coordenadas no corpo do commit;
**Diego aprova os PNGs antes do merge**.

**T2 — Esqueleto.** `<head>`, `@font-face`, tokens, `.bg`, `.progress`, header, hero estático,
rodapé. Sem JS.
→ Verifica: `python3 -m http.server 8080`; fonte local 200, zero requests externos, zero erros de
console; visual OK em 1440 e 375.

**T3 — Seções 02–06 estáticas** com `width/height/alt/loading="lazy" decoding="async"`.
→ Verifica: `grep -c 'loading="lazy"'` = 8 (hero é eager); todas renderizam.

**T4 — Seções 07–12 estáticas** + JSON-LD Service e FAQPage.
→ Verifica: `grep -Eic 'garantid|risco zero|vezes mais|mais vendido|melhor plano|mensalidade|manuten|assinatura|licen[çc]|SaaS|Shopee|Amazon|Magalu|Casas Bahia|economia de' index.html` = **0**;
`grep -c 'Sustentação de Infraestrutura'` ≥ 2; todo `%` acompanhado de "markup (lucro ÷ custo)",
"faturamento bruto" ou "margem s/ venda".

**T5 — JS A/B/C/D/H.**
→ Verifica: com `prefers-reduced-motion: reduce` tudo visível sem transição; com JS desativado tudo
visível e H1 íntegro; sem long task > 50ms no scroll.

**T6 — Pin do ciclo (F).**
→ Verifica: em 1440px cada 100vh troca exatamente um passo e uma captura, 6 no total, sem pulo; em
375px é lista; com JS off é lista; `100svh` para o Safari iOS.

**T7 — Tabs (G) + formulário + FAQ.**
→ Verifica: Tab/Enter/setas nas tabs; `required` nativo barra submit vazio; CONFIG vazio mostra
"Contato em configuração"; com número de teste o submit abre `wa.me` com texto legível; `<details>`
funcionam sem JS.

**T8 — Qualidade.** Lighthouse mobile e desktop (`--only-categories=performance,accessibility`).
→ Verifica: ambos ≥ 90; screenshots reais em 360×800 e 1440×900 sem overflow horizontal.

**T9 — Docs e commit.** `obsidian-vault/03-Módulos/Landing Page.md`, ADR-0152 → "implementado",
`docs/brand/briefings-design.md` se citar a landing antiga.
→ Verifica: `pnpm lint` e `pnpm docs:links` passam.

## 5. Checklist de aceite

- [ ] Grep de expressões proibidas = 0 (inclui "assinatura", "licença", "SaaS", "mensalidade", "manutenção").
- [ ] Nenhum `%` sem denominador; só **markup (lucro ÷ custo)** e **margem s/ venda (lucro ÷ preço)**.
- [ ] Todo número de operação com janela e "lido em 02/09/2026" na mesma seção.
- [ ] Nenhum cliente nomeado; 4 capturas tarjadas + `revisao-analise.png` conferida; nenhum `alt` ou
      nome de arquivo com marca de cliente; PNGs aprovados por Diego.
- [ ] Shopee/Amazon/Magalu/Casas Bahia: 0 ocorrências.
- [ ] "Sustentação de Infraestrutura" e "Infraestrutura Mensal" corretos; Daludi no ciclo, nas
      Modalidades e no rodapé; header é PubliAI.
- [ ] "O que não prometemos" é seção própria entre Prova e Como começamos.
- [ ] Formulário com os campos de D6, `CONFIG.formEndpoint`, evento `lead_marketplace_5produtos`,
      sucesso próprio, WhatsApp ao lado.
- [ ] Tema escuro; 360px sem scroll horizontal; Lighthouse ≥ 90 perf e a11y (mobile e desktop).
- [ ] Um único pin; mobile vira lista; reduced-motion e sem JS mostram tudo.
- [ ] Zero requests externos; abre com duplo clique.
- [ ] Rodapé linka `daludi.com.br`.

## 6. Riscos

1. **Tarja incompleta** — maior risco de dano real. Gate humano em T1; original nunca no repo.
2. **Aurora derruba o Lighthouse mobile.** Sem `filter:blur`; só `transform`; `contain:strict`;
   se perf < 90, reduzir para 1 blob.
3. **Sticky de 600vh no iOS.** `100svh`; mobile já é lista — testar iPad landscape.
4. **Blur no reveal de capturas grandes.** Regra fixa: `.shot` sem `filter`.
5. **Split de palavras quebra o `<span class=grad>`.** Percorrer text nodes, nunca `innerHTML`.
6. **`revisao-analise.png` com título de produto** — conferir antes de assumir "sem tarja".
7. **Pendências de Diego** (endpoint, WhatsApp, e-mail, domínio, autorização). Estado "em
   configuração" honesto; `og:image` fica para quando houver domínio.
8. **Hero PNG grande estoura LCP.** `sips -Z 1600` + `fetchpriority="high"` + `preload` da fonte.
9. **Regressão de vocabulário** em edições futuras — o grep de T4 é a única trava.
10. **CI**: `pnpm docs:links` quebra com link para asset removido.
