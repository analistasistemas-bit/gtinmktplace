# Briefings de Design e Marketing — PubliAI

> Conjunto de instruções prontas para colar no agente de IA de design.
> Cada bloco é independente e copiável. **Importante:** a marca/paleta do PubliAI
> JÁ existe (design system em produção). O agente de design NÃO deve inventar
> cores ou fontes novas — deve criar tudo EM CIMA do nosso design system.

**Última atualização:** 2026-06-27

## Como usar

1. **Sempre cole o "BLOCO MARCA" (abaixo) junto com qualquer briefing visual.** Ele
   carrega a paleta, a tipografia e os princípios que o agente deve obedecer.
2. Rode **0 → 1** e **aprove a logo** antes de seguir. Os blocos 2–11 dependem da logo fechada.
3. Cada briefing pede ao agente para **apresentar opções e recomendar uma** — decida rápido.
4. O briefing **#12** é tarefa de código (nossa, não do agente de design): integrar a
   nova logo ao app e ao design system depois de aprovada.

---

## 🎨 BLOCO MARCA — cole isto junto com TODO briefing visual

```
IDENTIDADE VISUAL OFICIAL DO PUBLIAI (obrigatório seguir — não inventar cores/fontes).

O PubliAI já tem um design system em produção. Use EXATAMENTE estes valores. A fonte da
verdade é OKLCH; o HEX (≈) é a conversão para ferramentas que não aceitam OKLCH.

CORES DE MARCA
- Primária (indigo):     #5A5CE2   oklch(0.55 0.20 277)   ← cor principal da marca
- Primária no escuro:    #737CF7   oklch(0.64 0.18 277)
- Violeta de apoio:      #9152E3   oklch(0.585 0.21 300)  ← segundo hue da marca
- GRADIENTE DE MARCA (assinatura): linear-gradient(135deg, #5C5CEB → #9152E3)
  (indigo→violeta, 135°. É a marca registrada visual; use em hero, logo, CTAs premium.)

NEUTROS
- Fundo claro:  #FBFCFF   | Texto sobre claro:  #161822
- Fundo escuro: #08090E   | Texto sobre escuro: #F1F1F5
- Card escuro:  #23252D

CORES DE ESTADO (semânticas — só para status, não decoração)
- Sucesso: #007C32  | Atenção: #9F5900  | Info: #0070B0  | Erro: #D20322

PALETA DE DADOS / GRÁFICOS
- #5A5CE2 · #9051E1 · #08B6AF · #E8A127 · #E74368

TIPOGRAFIA
- Fonte única: "Geist" (Geist Variable). Google Fonts / fontsource. Sem serifa.
- Títulos: peso 600, letter-spacing levemente negativo (-0.01 a -0.02em).
- Texto: peso 400-500.

PRINCÍPIOS VISUAIS
- Tema base do produto é DARK (fundo #08090E/#23252D). Existe light mode.
  Sempre que possível, entregue a peça em versão dark E light.
- Cantos arredondados (raio base ~10px; cards ~14-18px).
- Profundidade por elevação suave + glow indigo em destaques (não sombras pesadas).
- Estética: inteligente, confiável, ágil, profissional, moderna, "premium tech".
- EVITAR: azul-genérico-de-SaaS, infantil/fofo, clichês de IA (robô, cérebro,
  lâmpada, chip na cabeça), excesso de gradiente colorido fora o gradiente de marca.
```

---

## 0. BRIEF DE DIREÇÃO DE MARCA (rode primeiro — alinha o resto)

```
[COLE O BLOCO MARCA ACIMA ANTES DESTE TEXTO]

Você é um diretor de marca sênior. A identidade visual base do PubliAI já existe
(ver BLOCO MARCA). Seu trabalho NÃO é redesenhar a paleta — é definir a DIREÇÃO DE
APLICAÇÃO dessa identidade em marketing, e produzir o sistema visual que faltava.

CONTEXTO DO PRODUTO
PubliAI é um SaaS que automatiza a criação e publicação de anúncios em marketplaces
usando IA. O vendedor sobe uma planilha de produtos + fotos, e a IA gera títulos,
descrições, atributos, preços e publica nos marketplaces — com revisão humana.
Hoje opera Mercado Livre; a visão é ser a camada de automação integrada aos MAIORES
marketplaces do Brasil (Mercado Livre, Shopee, Amazon BR, Magalu, Shein), multicanal.

PÚBLICO-ALVO
Vendedores e lojistas de marketplace (do seller individual à operação média), gestores
de e-commerce. Práticos, querem escala e menos trabalho manual. Não são designers.

POSICIONAMENTO
"Da planilha ao anúncio publicado, sem trabalho manual." Automação confiável, IA que
entende o domínio de marketplace, escala multicanal, controle humano no final.

ENTREGÁVEIS DESTE BRIEF
1. 2-3 territórios de DIREÇÃO VISUAL (estilo de aplicação), todos usando a paleta e a
   tipografia do BLOCO MARCA — variando composição, uso do gradiente, fotografia vs.
   ilustração vs. UI-shots, densidade. Para cada um: conceito, mood e justificativa.
2. Definição de uso de imagem (foto de produto real? mockups de UI? ilustração? abstrato?).
3. Estilo de iconografia e de ilustração compatível com o produto.
4. Tom de voz e 5-8 frases-chave de marketing (headlines reutilizáveis).
5. 1 moodboard descritivo por território.

Apresente os territórios lado a lado e RECOMENDE um, com motivo. Tudo será reutilizado
pelos próximos briefings.
```

---

## 1. LOGO (a prioridade — substitui a provisória)

```
[COLE O BLOCO MARCA ACIMA ANTES DESTE TEXTO]

Crie a identidade de logo definitiva do PubliAI (substitui uma logo provisória).
Use a paleta e a tipografia do BLOCO MARCA — a logo DEVE viver no universo indigo→violeta
e combinar com o produto já existente. O gradiente de marca (#5C5CEB→#9152E3) é candidato
natural para o símbolo.

REQUISITOS
- Nome a exibir: "PubliAI" (avaliar destaque sutil no "AI", já que IA é o coração do
  produto — sem virar clichê).
- Entregar 3 conceitos distintos. Para cada um: símbolo + logotipo.
- Cada conceito deve funcionar como: (a) lockup horizontal, (b) versão empilhada,
  (c) símbolo isolado (para favicon/app icon).
- Legível e reconhecível a 16px (favicon) E em outdoor.
- Versões: full color (sobre fundo escuro #08090E E sobre fundo claro #FBFCFF),
  monocromática branca (knockout) e monocromática preta.
- Conceito visual: comunicar "automação + publicação + marketplace + IA". Ideias a
  explorar (não obrigatórias): movimento/fluxo (planilha→anúncio), multicanal (vários
  destinos), inteligência. EVITE: robôs, cérebros, lâmpadas, carrinho genérico, chip na cabeça.
- A fonte do logotipo deve ser Geist ou harmonizar com ela.

ENTREGÁVEIS
- Os 3 conceitos com justificativa de cada.
- Recomendação de 1, explicando por quê.
- Para o recomendado: SVG vetorial, malha de construção, área de respiro mínima,
  tamanho mínimo, e o teste de favicon (símbolo a 16/32/48px).
- Especificação de cores exatas (HEX/OKLCH) de cada versão, derivadas do BLOCO MARCA.

RECOMENDE um conceito ao final, não apenas apresente opções.
```

---

## 2. MANUAL DE MARCA / BRAND GUIDELINES

```
[COLE O BLOCO MARCA + a logo aprovada]

Monte o manual de marca (brand book) em formato apresentável (PDF/slides), consolidando
o design system já existente + a nova logo. Inclua:
- Conceito e posicionamento (resumo).
- Logo: versões, usos corretos e PROIBIDOS (do/don't), área de respiro, tamanho mínimo,
  uso sobre fotos e fundos claro/escuro.
- Paleta completa (HEX/OKLCH) do BLOCO MARCA, light e dark, proporções de uso e
  combinações de contraste aprovadas (acessibilidade AA).
- Tipografia (Geist): pesos, hierarquia (display/h1/h2/h3/caption), exemplos.
- Gradiente de marca: onde usar e onde NÃO usar.
- Iconografia e estilo de ilustração.
- Tom de voz e exemplos de copy.
- Aplicações exemplo (cartão, e-mail, post, tela do app).
Saída: documento coeso e bonito, pronto para guiar terceiros.
```

---

## 3. FAVICON, APP ICON E ÍCONES DE PLATAFORMA

```
[COLE O BLOCO MARCA + o símbolo da logo aprovada]

A partir do símbolo da logo PubliAI, gere o pacote de ícones do produto, nas cores da marca:
- Favicon (16, 32, 48px) e favicon.svg.
- App icon (PWA/maskable): 192, 512px, com safe-area de máscara.
- Apple touch icon 180px.
- Versão monocromática para barra/notificação.
Garanta legibilidade do símbolo nos tamanhos mínimos; ajuste o desenho se a versão
completa não ler bem a 16px. Entregue cada arquivo e um preview sobre fundo claro (#FBFCFF)
e escuro (#08090E).
```

---

## 4. SISTEMA DE ÍCONES DO PRODUTO (UI)

```
[COLE O BLOCO MARCA]

O app usa ícones Lucide (traço fino, 24px). Crie ícones CUSTOM apenas onde o domínio
não tem equivalente no Lucide, mantendo o MESMO peso de traço, grid 24px e cantos.
Conceitos do domínio a cobrir:
lote, família, variação/SKU, anúncio, marketplace, publicar, atualizar, fila/processando,
IA/gerar, foto/imagem, estoque, preço, faturamento, devolução, perguntas, conector de canal.
Entregue SVGs em grid consistente (24px), traço alinhável ao Lucide, e um preview do set
em dark e light.
```

---

## 5. LANDING PAGE / SITE (hero + seções)

```
[COLE O BLOCO MARCA + a logo aprovada]

Projete a landing page de conversão do PubliAI, aplicando a marca. Tema base DARK (#08090E),
com versão light. Público: vendedores de marketplace.

ESTRUTURA
- Hero: headline forte (benefício "da planilha ao anúncio publicado"), subheadline, CTA
  primário (botão indigo #5A5CE2 ou com gradiente de marca), e um mockup do dashboard.
- Logos/prova social dos marketplaces suportados (ML, Shopee, etc.).
- "Como funciona" em 3-4 passos (upload → IA gera → revisão → publica multicanal).
- Features-chave em cards (IA de copy, multicanal, revisão humana, faturamento).
- Diferencial multicanal (grade/mapa dos marketplaces).
- Prova social / depoimentos (placeholder).
- Pricing (placeholder de planos).
- CTA final + footer.

ENTREGÁVEIS
- Wireframe + layout high-fidelity (desktop e mobile), dark e light.
- Copy de cada seção (headline, subs, CTAs, microcopy).
- Especificação de componentes reutilizáveis, alinhados ao nosso design system.
Mostre o hero em 2 variações e recomende uma.
```

---

## 6. MOCKUPS DE PRODUTO (screenshots de marketing)

```
[COLE O BLOCO MARCA + a logo aprovada]

Crie mockups do dashboard PubliAI para site, ads e apresentações. As telas devem PARECER
o produto real: tema dark (#08090E/#23252D), acentos indigo #5A5CE2, fonte Geist, cantos
arredondados. Cenas:
- Importação de planilha + preview de famílias/variações.
- IA gerando título/descrição de um anúncio.
- Painel multicanal com status de publicação por marketplace.
- Visão de faturamento/vendas (gráficos com a paleta de dados do BLOCO MARCA).
Entregue em molduras de browser/dispositivo, fundo de cena com gradiente de marca suave,
versões desktop e mobile. Use dados plausíveis de aviamentos/produtos (não inventar marcas reais).
```

---

## 7. ADS / CRIATIVOS DE PUBLICIDADE (performance)

```
[COLE O BLOCO MARCA + a logo aprovada]

Crie um kit de criativos de anúncio pago do PubliAI, com a marca aplicada.
Formatos:
- Meta (Feed 1:1 1080x1080, Stories/Reels 9:16 1080x1920).
- Google Display (300x250, 728x90, 160x600, 320x50).
- LinkedIn (1200x627).
Cada criativo: paleta e fonte do BLOCO MARCA, headline curta orientada a benefício, CTA claro,
e variações de ângulo: (a) economia de tempo, (b) escala multicanal, (c) IA que escreve o
anúncio, (d) "pare de cadastrar produto manualmente".
Entregue 3 conceitos visuais por formato-chave + variações de copy, e recomende o de melhor
desempenho esperado. Inclua estáticos + roteiro curto para o vídeo (Reels/Stories).
```

---

## 8. KIT DE REDES SOCIAIS (orgânico)

```
[COLE O BLOCO MARCA + a logo aprovada]

Monte o kit de identidade para redes sociais do PubliAI, com a marca aplicada:
- Foto de perfil (a partir do símbolo) e capas/banners para Instagram, LinkedIn, Facebook,
  YouTube e X — nos tamanhos corretos de cada plataforma.
- Sistema de templates de post (carrossel, post único, story): grid editorial, estilo de
  título (Geist), uso do gradiente de marca, espaço para texto.
- 6 posts de exemplo preenchidos (dicas para sellers, feature highlight, antes/depois,
  novo marketplace integrado).
Tudo coerente com o BLOCO MARCA. Entregue templates editáveis + exemplos prontos.
```

---

## 9. PITCH DECK / APRESENTAÇÃO INSTITUCIONAL

```
[COLE O BLOCO MARCA + a logo aprovada]

Crie um deck do PubliAI (comercial/investidor/parcerias), aplicando a marca. Tema dark.
Estrutura (~12-15 slides): problema, solução, como funciona, produto (screenshots),
diferencial multicanal + IA, mercado (marketplaces BR), modelo de negócio (SaaS/billing),
tração/roadmap, time, CTA. Use a tipografia (Geist) e a paleta do BLOCO MARCA; gráficos com
a paleta de dados; gradiente de marca em capas/destaques. Entregue um slide-mestre
reutilizável (capa, seção, conteúdo, dados) + o deck preenchido com placeholders claros.
```

---

## 10. E-MAIL MARKETING / TEMPLATES TRANSACIONAIS

```
[COLE O BLOCO MARCA + a logo aprovada]

Projete o sistema de e-mail do PubliAI, com a marca aplicada:
- Template-base responsivo (header com logo, corpo, CTA indigo #5A5CE2, footer com social/links legais).
- Variações: boas-vindas/onboarding, anúncio publicado com sucesso, alerta de anúncio
  moderado/pausado, resumo semanal de vendas, novidade de produto/novo marketplace.
- Tom de voz da marca. Como e-mail tem suporte irregular a dark mode, projete primário em
  light com a paleta da marca e teste o fallback.
Entregue o HTML/estrutura dos templates + o copy de cada um.
```

---

## 11. OG IMAGES / SOCIAL CARDS (compartilhamento)

```
[COLE O BLOCO MARCA + a logo aprovada]

Crie o sistema de imagens de compartilhamento (Open Graph / Twitter Card) do PubliAI:
- Template 1200x630 com logo, headline curta, gradiente de marca e fonte Geist.
- Variações por tipo de página (home, pricing, blog/post, feature).
- Um padrão dinâmico (área de título variável) para gerar cards por página.
Coerente com o BLOCO MARCA. Entregue templates + 3 exemplos preenchidos.
```

---

## 12. INTEGRAR A NOVA LOGO AO DESIGN SYSTEM (tarefa de código — NÃO é para o agente de design)

> Este passo é executado no repositório depois que a logo for aprovada. Não envie ao
> agente de IA de design; é checklist de implementação.

```
Depois da logo aprovada:
1. Substituir a logo/símbolo no app (componente de logo, sidebar, tela de login).
2. Trocar favicon/app icon (public/) pelos arquivos do briefing #3 + atualizar manifest/index.html.
3. Conferir se a paleta da logo bate com os tokens em src/index.css. Se a logo introduzir
   algum ajuste de hue, atualizar os tokens OKLCH (--primary, --brand-gradient, etc.) e a
   rota /#/style-guide — NUNCA hardcode de cor fora dos tokens.
4. Atualizar docs/design-system/README.md se algum token mudar.
5. Adicionar story da logo no Storybook (Design System/Marca) e rodar `pnpm build-storybook`.
6. Validar visualmente dark + light antes do merge.
```

---

## Anexo — Storybook (catálogo vivo do design system)

O projeto agora tem **Storybook** configurado (faltava). É o catálogo navegável dos tokens
e componentes, com toggle dark/light que espelha o app.

- Rodar local: `pnpm storybook` (abre em http://localhost:6006)
- Build estático: `pnpm build-storybook` (saída em `storybook-static/`, fora do git)
- Stories incluídas: `Design System/Cores`, `Design System/Tipografia`, e UI
  (`Button`, `Badge`, `StatusPill`, `KpiCard`, `Card`, `Input`).
- Config em `.storybook/`. Novas stories: criar `*.stories.tsx` em `src/`.
- Cobertura inicial é representativa, não exaustiva — os demais componentes de
  `src/components/ui/` ainda não têm story (adicionar conforme necessidade).
