# PubliAI — Motion Design System Premium

**Versão definitiva — v5 | 17/07/2026**
Contrato técnico e operacional para implementar motion e microinterações no frontend do PubliAI.

> **INSTRUÇÃO INICIAL: execute somente a Fase 1 (Auditoria, seção 3) e pare no GATE 1. Nenhuma animação, dependência ou alteração de arquivo antes da aprovação explícita.**

---

## ÍNDICE RÁPIDO

| Preciso de... | Seção |
|---|---|
| Regras inegociáveis | 0 |
| O que auditar antes de tudo | 3 |
| Escolha de biblioteca | 4 |
| Arquitetura e tokens | 5–6 |
| Regras por componente | 7 |
| Entrada/saída/stagger/layout | 8 |
| Loading e progresso honesto | 9 |
| Feedback de sucesso/erro | 10 |
| Prioridades do PubliAI | 11 |
| Acessibilidade | 12 |
| Performance | 13 |
| Anti-patterns | 14 |
| Escopo e git | 15–16 |
| Fases e GATES | 17 |
| QA e relatório | 18–19 |
| Critérios de aceite | 20 |
| Primeira resposta esperada | 21 |

---

## 0. CONTRATO OPERACIONAL (releia antes de cada ação)

1. **Nunca** instale dependências, altere arquivos compartilhados ou avance de fase sem aprovação explícita no GATE. Ausência de resposta ≠ aprovação.
2. Motion só existe para: **feedback · mudança de estado · continuidade espacial · direcionamento de atenção · percepção de espera · confirmação**. Sem função → não anime.
3. Todo valor de motion vem da camada `motion/`. Zero valores arbitrários em componentes.
4. Priorize `transform` e `opacity`. `prefers-reduced-motion` em 100% das animações novas ou modificadas.
5. Animação nunca atrasa o início de uma operação e é sempre interrompível por nova ação do usuário.
6. **Nunca simule progresso**: cada etapa visual deve mapear estado real do backend (evento, job, resposta, stream, polling). Sem telemetria → estado indeterminado honesto + registrar necessidade de instrumentação.
7. Não altere: regras de negócio, estrutura de dados, contratos de API, integrações (Mercado Livre/Shopee), autenticação, permissões, precificação, margem, identidade visual, tipografia, textos de negócio, navegação, hierarquia de informação.
8. Git: sem merge, rebase, force push, reset destrutivo, push ou PR sem autorização. Nunca tocar em alterações de outros agentes/branches.
9. Cada fase que modifica arquivos termina com: verificação automatizada + relatório padronizado (seção 19) + commit isolado + parada no GATE.
10. O PubliAI é ferramenta operacional ("Marketplace Command Center"). Produtividade, previsibilidade e clareza > impacto visual.

---

## 1. CONTEXTO DO PRODUTO

O PubliAI é uma plataforma SaaS que transforma catálogos/planilhas em anúncios publicáveis em marketplaces. Estado atual: Mercado Livre em produção, Shopee em desenvolvimento. Fluxo: ingestão por planilha → validação e enriquecimento → revisão humana por exceção → análise de preço/margem → publicação → sincronização → acompanhamento operacional. Arquitetura preparada para multicanal.

Objetivo do motion: elevar percepção de **confiança, precisão, velocidade, controle, consistência e qualidade premium**.

Referências de nível de acabamento (não copiar literalmente): Linear, Stripe Dashboard, Apple, Notion Calendar, Revolut, Arc, Airbnb.

---

## 2. PRINCÍPIOS DE MOTION (as 6 funções)

1. **Feedback** — ação reconhecida (botão pressionado, item selecionado, salvo, publicado, copiado, sync iniciada).
2. **Mudança de estado** — pendente→aprovado, validando→validado, fila→processando, processando→publicado, recolhido→expandido, ativo→desativado.
3. **Continuidade espacial** — drawer, expansão de detalhes, modal originado de um botão, painel de validação, transição entre etapas.
4. **Hierarquia de atenção** — guiar o olhar sem distrair.
5. **Percepção de espera** — reduzir incerteza mostrando **informações verdadeiras**.
6. **Confirmação** — reforçar resultado de ação importante.

---

## 3. FASE 1 — AUDITORIA OBRIGATÓRIA

Antes de alterar qualquer arquivo, analise o projeto e produza o relatório (formato da seção 19). Nada de dependências, animações ou alterações além do necessário para auditar.

### 3.1 Stack
Framework e versão · rotas · versão do React (se aplicável) · estratégia de renderização (SSR/CSR/SSG) · biblioteca de componentes · design system · ícones · sistema de estilos (Tailwind/CSS Modules/styled-components) · libs de animação instaladas · padrões atuais de transição · componentes compartilhados · estrutura de layout · acessibilidade atual · soluções de toast/modal/drawer/formulários/tabelas · virtualização · testes unit e E2E · ferramentas de performance.

### 3.2 Inventário de motion existente
CSS transitions/animations/keyframes · durações e easings em uso · springs · animações inline · classes utilitárias · loaders/skeletons/spinners · transições de página · usos de `transform` e `will-change` · uso atual de `prefers-reduced-motion`.
Valores legados fora do escopo aprovado: **apenas inventariar, não migrar automaticamente**.

### 3.3 Baseline funcional
Executar suíte de testes existente; registrar: aprovados, falhas preexistentes, erros/warnings de console preexistentes. Não atribuir ao motion problemas que já existiam. Não instalar ferramentas ausentes.

### 3.4 Baseline de performance
Quando as ferramentas permitirem: bundle e chunks · Core Web Vitals/CLS · long tasks · tempo de renderização das telas prioritárias · hydration · listas grandes · CPU modesta. **Não criar métricas falsas** — se não puder medir com segurança, declare no relatório.

### 3.5 Mapeamento de risco
Arquivos compartilhados de alto impacto · componentes usados em muitas telas · branches/PRs paralelas e outros agentes · regressão em tabelas/formulários · hydration · bundle · perda de foco/scroll · re-animação em re-render · estados visuais divergindo do backend real.

### 3.6 Saída da Fase 1
Diagnóstico · inventário resumido · biblioteca recomendada + justificativa · impacto estimado no bundle · telas e componentes prioritários · arquitetura proposta · riscos · plano por fases · perguntas objetivas para o GATE 1. **Depois, PARE.**

**GATE 1 aprova:** biblioteca, impacto no bundle, arquitetura, escopo do piloto, arquivos compartilhados a alterar, plano de fases.

---

## 4. ESCOLHA TÉCNICA

Ordem de prioridade:
1. reutilizar solução já instalada, se adequada;
2. CSS transitions/animations para microinterações simples;
3. biblioteca apenas com benefício técnico claro.

**React/Next.js** sem solução adequada → avaliar **Motion** (ex-Framer Motion). Antes de instalar, reportar: versão, tamanho, impacto no bundle, compatibilidade com React/SSR, hydration, lazy loading, onde CSS bastaria vs onde a lib se justifica.

**Vanilla JS** → CSS primeiro; GSAP só para sequências complexas inviáveis em CSS.

**Restrições:** uma única responsável por propriedade animada — nunca CSS transition + biblioteca na mesma propriedade do mesmo elemento; não usar biblioteca para hover/focus/active simples; não instalar QA/animação/observabilidade sem aprovação.

---

## 5. ARQUITETURA DA CAMADA `motion/`

```
motion/
├── tokens.ts          # durações, distâncias, stagger, conversão de unidades
├── easings.ts         # curvas nomeadas por função (array + derivação CSS)
├── springs.ts         # configs nomeadas por contexto
├── transitions.ts     # transições compostas reutilizáveis
├── variants.ts        # variantes (Framer Motion)
├── reduced-motion.ts  # hook/util de prefers-reduced-motion
├── css-variables.ts   # geração/derivação das CSS vars
├── index.ts
└── primitives/        # MotionPage, MotionList, MotionDialog, MotionDrawer,
                       # MotionCollapse, MotionFeedback, MotionToast
```

Adaptar ao stack real. Não criar arquivos/primitivas/abstrações sem uso concreto.

**Fonte única de verdade:** durações, distâncias, easing, springs, stagger, delays, limites e reduced-motion vêm de um só lugar. TypeScript e CSS devem **derivar da mesma fonte** (nunca duas listas manuais). Na auditoria, proponha qual é a fonte primária e como os demais formatos são gerados.

---

## 6. TOKENS DE REFERÊNCIA (ajustar só com justificativa documentada)

### 6.1 Durações
```ts
export const durationMs = {
  instant: 100,  // 80–120ms: toggles, checkbox
  micro: 150,    // 120–180ms: hover, focus, active
  state: 190,    // 160–220ms: mudança de estado
  enter: 260,    // 220–300ms: entrada de componentes
  overlay: 300,  // 240–340ms: modal, drawer
  page: 320,     // 240–360ms: transição de página
} as const;
```
Máximo de 400ms em interações funcionais, exceto: progresso contínuo, skeleton, estado indeterminado, demonstração aprovada.

### 6.2 Distâncias e stagger
```ts
export const distance = { enterY: 8, cardLift: 2, pressScale: 0.98 } as const;
export const staggerMs = { item: 40, initialDelay: 50 } as const;
```

### 6.3 Conversão de unidades (libs usam segundos, CSS usa ms)
```ts
export const seconds = (ms: number): number => ms / 1000;
```
Nunca duplicar `260` e `0.26` manualmente em arquivos diferentes.

### 6.4 Easings
```ts
export const easing = {
  enter:      [0.16, 1, 0.3, 1],    // entradas
  exit:       [0.4, 0, 1, 1],       // saídas: mais rápidas e discretas que entradas
  reversible: [0.45, 0, 0.55, 1],   // accordion, toggle, seleção, bidirecional
  success:    [0.34, 1.3, 0.64, 1], // confirmação com leve overshoot
} as const;

export const easingCss = Object.fromEntries(
  Object.entries(easing).map(([k, v]) => [k, `cubic-bezier(${v.join(', ')})`])
) as Record<keyof typeof easing, string>;
```
`easing.success` **nunca** em: tabelas, formulários densos, erros, exclusões, alertas, operações destrutivas. `linear` permitido só para progresso contínuo real. Nunca uma única curva na aplicação inteira; nunca bounce/elastic em interface operacional.

### 6.5 Springs
```ts
export const spring = {
  toast:  { stiffness: 300, damping: 25 },
  dialog: { stiffness: 260, damping: 28 },
  subtle: { stiffness: 400, damping: 35 },
} as const;
```
Springs apenas para: entrada de toast, confirmação curta, drawer, feedback controlado. Nunca em: texto de tabela, erros persistentes, campos de formulário, filtros de alta frequência, grandes blocos. Não usar o mesmo spring em tudo.

### 6.6 Variante de referência (sem valores mágicos)
```ts
import { distance, durationMs, seconds, staggerMs } from './tokens';
import { easing } from './easings';

export const listVariants = {
  container: {
    animate: {
      transition: {
        staggerChildren: seconds(staggerMs.item),
        delayChildren: seconds(staggerMs.initialDelay),
      },
    },
  },
  item: {
    initial: { opacity: 0, y: distance.enterY },
    animate: {
      opacity: 1, y: 0,
      transition: { duration: seconds(durationMs.enter), ease: easing.enter },
    },
  },
};
```

### 6.7 CSS variables (derivadas dos tokens, nunca mantidas à mão)
```css
:root {
  --motion-duration-instant: 100ms;
  --motion-duration-micro: 150ms;
  --motion-duration-state: 190ms;
  --motion-duration-enter: 260ms;
  --motion-duration-overlay: 300ms;
  --motion-duration-page: 320ms;
  --motion-distance-enter-y: 8px;
  --motion-distance-card-lift: 2px;
  --motion-easing-enter: cubic-bezier(0.16, 1, 0.3, 1);
  --motion-easing-exit: cubic-bezier(0.4, 0, 1, 1);
  --motion-easing-reversible: cubic-bezier(0.45, 0, 0.55, 1);
  --motion-easing-success: cubic-bezier(0.34, 1.3, 0.64, 1);
}
```

---

## 7. MICROINTERAÇÕES POR COMPONENTE

### Botões
- **hover:** fundo/borda/sombra discretos, elevação mínima quando apropriado;
- **active:** scale ≈ `distance.pressScale`, feedback imediato, nada atrasa a ação;
- **loading:** preservar largura (sem layout shift), rótulo acessível, impedir clique duplicado quando a regra exigir, operação inicia sem esperar animação;
- **disabled:** transição curta, diferença visual clara e acessível, não depender só de opacity;
- sem movimento lúdico em ações destrutivas.

### Inputs
Pode animar: borda, focus ring, label, ícone, mensagem auxiliar, validação. **Nunca** scale no campo inteiro. Erros: espaço reservado quando viável ou expansão suave; sem deslocamento abrupto; `aria-describedby` e anúncio acessível quando apropriado.

### Cards clicáveis
Elevação até `distance.cardLift`, borda, sombra discreta, fundo. Cards não interativos não se movem.

### Tabelas
Linhas: só fundo, seleção, borda, indicação de estado. **Nunca:** scale em linhas, stagger em conjuntos grandes, movimento de colunas, transições que prejudiquem leitura, animação durante scroll virtualizado.

### Ícones
Animar só quando representa: expandir, recolher, sincronizar, atualizar, concluir, copiar, processar, alternar. Decorativos não animam.

### Hover (regra transversal)
Hover não pode conter informação ou funcionalidade exclusiva. Aplicar apenas em dispositivos compatíveis:
```css
@media (hover: hover) and (pointer: fine) { /* interações de hover */ }
```
Teclado e toque com feedback equivalente.

---

## 8. ENTRADA, SAÍDA, STAGGER E LAYOUT

### 8.1 Entrada
`opacity 0→1` + `translateY(≤ distance.enterY)`, `durationMs.enter`, `easing.enter`. Animar **apenas no mount real** ou transição contextual relevante — nunca a cada re-render, mudança de estado, filtro, paginação ou em componentes já visíveis.

### 8.2 Saída
Exit animation quando preserva contexto: modal, drawer, toast, accordion, painel expansível, card/item removido por ação explícita, etapa de onboarding.
Exit **não** obrigatório em: busca em tempo real, filtros de alta frequência, tabelas extensas, paginação, atualização em lote, virtualizados, dados auto-atualizados.

### 8.3 Stagger
Reservado a pequenas coleções na primeira apresentação: 30–50ms, máximo 6–10 elementos (seguintes entram juntos), duração total limitada, nunca em tabelas extensas ou virtualizadas, nunca repetido a cada atualização. Não usar para "aparentar sofisticação" em áreas densas.

### 8.4 Layout transitions
Mudança de tamanho/posição → layout animation ou FLIP. Preservar foco, scroll e posição. Prioridades: expansão de detalhes de anúncio, painéis de validação e de erro, expansão de variações, drawers, accordions, etapas de revisão, blocos condicionais de formulário. **Corrija a causa estrutural de CLS antes — nunca mascarar com animação.**

---

## 9. LOADING E PROCESSAMENTO

Nunca um padrão universal de carregamento.

- **Estrutura conhecida:** skeleton (shimmer moderado, dimensões próximas ao conteúdo final, sem CLS).
- **Ações <1s:** spinner dentro do botão. Nunca como estado principal de operação longa.
- **Processamento de planilha** — etapas reais quando disponíveis: recebendo arquivo → interpretando colunas → validando campos → processando produtos → preparando revisão → concluído / concluído parcialmente / erro recuperável / erro definitivo.
- **Publicação em marketplace** — estados reais: preparando dados → na fila → enviando → aguardando resposta → confirmando → publicado / publicação parcial / bloqueado / erro recuperável / erro definitivo.
- **Background:** feedback persistente que permite continuar trabalhando (central de tarefas, toast persistente, indicador no cabeçalho, status do lote, histórico).

**Proibição de progresso falso (regra 6 do contrato):** nunca simular percentual com timer, avançar etapas via `setTimeout` sem evento real, indicar conclusão antes da resposta, ou mostrar progresso determinístico para operação indeterminada.

---

## 10. FEEDBACK DE AÇÃO

Padrões consistentes para: salvar, publicar, sincronizar, importar, excluir, copiar, concluir, corrigir, aprovar, bloquear, falhar.

- **Sucesso:** transição discreta, ícone de confirmação, mudança de estado, spring controlada, mensagem contextual.
- **Erro:** cor + ícone + mensagem clara + entrada suave + foco quando apropriado + semântica acessível.
- **Shake:** só quando ação direta do usuário falha imediatamente, extremamente sutil, uma única vez, sem comprometer leitura. **Nunca** em erros automáticos, tabelas extensas, alertas persistentes, erros em lote ou mensagens sem interação direta.
- **Exclusão/destrutivas:** nunca lúdicas — sem bounce, overshoot, comemoração ou delay desnecessário.

---

## 11. PRIORIDADES ESPECÍFICAS DO PUBLIAI

**P1 — Importação e processamento da planilha:** upload, parsing, detecção de colunas, validação, enriquecimento, criação de produtos, conclusão parcial, erros recuperáveis, transição para revisão. Usuário entende o estado sem spinner genérico.

**P2 — Revisão antes da publicação** (superfície prioritária de confiança): entrada dos resultados, expansão de detalhes, comparação de dados, alertas de margem, status de validação, aprovação, bloqueio, seleção em massa, correção de campos, confirmação de publicação, transições pendente↔aprovado↔bloqueado. Motion nunca prejudica comparação, leitura ou produtividade.

**P3 — Publicação e sincronização:** na fila, processando, publicado, sincronizado, publicação parcial, bloqueado, erro recuperável, erro definitivo.

**P4 — Erros de domínio:** `custo_centavos` (inteiro em centavos), `variacoes.custo` (decimal em reais), preço mínimo, margem, preço de venda, obrigatórios, incompatibilidades do marketplace, variações inválidas, divergência de estoque, catálogo incompleto. Tratamento: mensagem contextual + ícone + cor + entrada suave + indicação precisa do campo + orientação de correção. **Não alterar regras de domínio.**

---

## 12. ACESSIBILIDADE

**Com `prefers-reduced-motion` ativo:** remover deslocamentos, parallax, stagger e shake; reduzir/remover springs; mudança instantânea ou crossfade curto; **preservar todos os feedbacks funcionais** (loading, sucesso, erro).

**Semântica:** processamento/sucesso/erro com `aria-live` (polite/assertive conforme contexto), `role="status"`/`role="alert"`, `aria-busy`, `aria-describedby`, foco programático só quando necessário. Animação visual não substitui anúncio para tecnologia assistiva.

**Motion nunca pode:** remover ou deslocar foco inesperadamente, alterar ordem de navegação, bloquear teclado, atrasar leitores de tela, depender exclusivamente de cor ou movimento, impedir uso por toque, esconder funcionalidade em hover.

---

## 13. PERFORMANCE

- **Priorizar:** `transform`, `opacity`. **Moderação:** background-color, border-color, box-shadow, filtros. **Evitar quando transform resolve:** width, height, top, left, right, bottom, reflow frequente.
- **`will-change`:** nunca global, permanente ou em grandes listas — só com benefício medido.
- **Verificar:** FPS, long tasks, layout thrashing, CLS, custo de renderização, hydration, bundle, memória, listas grandes, tabelas virtualizadas, dispositivos modestos.
- **Testar:** CPU throttling, rede lenta, listas extensas, processamento simultâneo, abertura/fechamento repetido de overlays, navegação rápida, ações repetidas, reduced-motion ativo.
- **Não declarar 60 FPS sem medição.**

---

## 14. ANTI-PATTERNS PROIBIDOS

Fade-in de página inteira em toda navegação · todos os elementos com o mesmo delay/curva · bounce/elastic funcional · interação >400ms · hover scale >1.03 · scale em inputs ou linhas de tabela · stagger em tabelas extensas ou virtualizadas · spinner fullscreen quando há etapas reais · progresso falso por timer · re-animação a cada re-render · parallax decorativo em tela operacional · animação contínua sem função · shimmer excessivo · shake em erro persistente · transição que atrasa chamada de API ou bloqueia nova ação · CSS + biblioteca na mesma propriedade · valores mágicos em componentes · `will-change` permanente · animação mascarando lentidão ou CLS · refatoração alheia ao escopo · redesign não solicitado · alteração de texto de negócio sem aprovação · mudança de layout desnecessária · instalação automática de ferramentas.

---

## 15. ESCOPO — EXCEÇÕES CONTROLADAS

(Restrições principais: regra 7 do contrato.)

Podem ser **propostos no relatório do GATE** (não implementar antes de aprovação quando forem mudança relevante): novos textos de status, processamento, acessibilidade, loading, sucesso e erro.

Ajustes mínimos de layout necessários para loading, validação, acessibilidade ou prevenção de CLS: permitidos, **sempre documentados**.

---

## 16. SEGURANÇA DE GIT E TRABALHO PARALELO

- Branch dedicada: `feat/motion-design-system`. Se já existir ou estiver em uso, reporte antes de agir.
- **Antes de cada fase, verificar:** branch atual, working tree, arquivos modificados, commits recentes, PRs paralelas visíveis, alterações de outros agentes, arquivos compartilhados a tocar.
- **Proibido sem aprovação** (regra 8 do contrato): merge, rebase, force push, reset destrutivo, cherry-pick, push, abrir/atualizar/fechar/mergear PR, alterar branch principal.
- **Nunca:** modificar commits de terceiros, remover mudanças de outro agente, descartar arquivos desconhecidos, `git checkout --`/`git restore` em arquivos de terceiros, `git clean` sem autorização, resolver conflito escolhendo um lado automaticamente.
- **Conflito potencial detectado:** pare → identifique → reporte arquivos → apresente alternativas → aguarde decisão.
- **Commits:** um commit isolado por fase que altera arquivos. Ex.: `feat(motion): fase 2 - fundação de tokens e primitivas` · `feat(motion): fase 3 - piloto no fluxo de revisão` · `test(motion): fase 4 - validação e cobertura e2e`. Fase 1 não exige commit se produzir apenas relatório. Sem commit vazio.

---

## 17. PLANO DE ENTREGA E GATES

**GATE = parada obrigatória. Reportar e aguardar aprovação explícita.**

| Fase | Entrega | GATE aprova |
|---|---|---|
| **1 — Auditoria** | Relatório da seção 3.6 | Biblioteca, arquitetura, escopo do piloto, arquivos compartilhados, plano |
| **2 — Fundação** | Tokens, easings, springs, integração CSS, reduced-motion, primitivas necessárias, documentação, unit tests aplicáveis. Não aplicar em telas. | Arquitetura implementada |
| **3 — Piloto** | UM fluxo (preferência: revisão; alternativa: importação), cobrindo entrada, loading, erro, sucesso, expansão e reduced-motion. QA com evidência temporal + comparação de performance. | **Qualidade visual e performance — aprovação humana** (testes automatizados não aprovam qualidade subjetiva de motion) |
| **4 — Validação** | Consistência, acessibilidade, performance, regressões, estados extremos, listas grandes, teclado, toque, reduced-motion, console, bundle | Liberação para expansão |
| **5 — Expansão** | Por lotes (abaixo), cada um com escopo, QA, relatório, commit/PR e aprovação próprios. Nunca mais de um domínio funcional por lote sem aprovação. | Por lote |

**Lotes da Fase 5:**
- **5A Globais:** navegação, modal, drawer, toast, tooltip, accordion, tabs, botões, inputs.
- **5B Importação e catálogo:** upload, parsing, validação, lotes, famílias, produtos, variações.
- **5C Revisão e validação:** revisão, alertas, margem, preço, pendências, aprovação, bloqueios.
- **5D Publicação e sincronização:** filas, publicação, sincronização, erros, status de marketplace.
- **5E Demais áreas:** financeiro, pós-venda, configurações, administrativas, secundárias.

---

## 18. QA E VERIFICAÇÃO

Usar prioritariamente o stack já instalado. **Não instalar automaticamente:** Playwright, TestSprite, gravadores, serviços externos, observabilidade, plugins de QA — se faltar ferramenta, reportar no GATE. **Nunca enviar a serviços externos:** dados de catálogo, screenshots com dados reais, credenciais, tokens, informações de clientes, conteúdo operacional, arquivos privados.

### 18.1 Verificação obrigatória (fases de implementação)
Conforme disponibilidade: unit tests relevantes · smoke E2E · testes dos fluxos alterados · teclado · toque · reduced-motion · console errors · hydration · comparação de bundle · comparação de performance · listas grandes · interação repetida · navegação rápida · overlays repetidos.

### 18.2 QA visual de motion — evidência temporal
Screenshot **não** valida animação. Quando a ferramenta permitir, registrar vídeo curto, trace ou sequência de frames.
- Screenshots validam: estado inicial, estado final, layout, reduced-motion.
- Evidência temporal valida: easing, duração, interrupção, overshoot, reanimação indevida, estabilidade, resposta a interação rápida.

### 18.3 Regressões novas
1. interromper a fase; 2. identificar causa; 3. corrigir **apenas** alterações da própria branch; 4. nunca reverter mudanças de terceiros; 5. reexecutar testes; 6. se não for seguro corrigir, parar e reportar opções. Não reverter a fase inteira sem diagnóstico.

---

## 19. FORMATO DO RELATÓRIO POR FASE (usar exatamente esta estrutura)

```
# Relatório — Fase N
## 1. Resumo
## 2. Arquivos alterados
- caminho/do/arquivo  (ou: Nenhum arquivo alterado.)
## 3. Decisões tomadas
- decisão · justificativa · alternativa rejeitada
## 4. Valores e componentes reutilizados
- tokens e primitivas usados · confirmação de zero duplicação
## 5. Riscos encontrados
- risco · impacto · mitigação  (ou: Nenhum risco novo identificado.)
## 6. Impacto no bundle
- antes · depois · diferença · metodologia  (ou: medição indisponível + motivo)
## 7. Performance
- baseline · resultado · regressões · observações
## 8. Testes executados
- teste · comando · resultado
## 9. QA visual
- estados validados · reduced motion · evidência temporal · problemas
## 10. Erros preexistentes
- descrição · evidência · impacto
## 11. Pendências
- pendência · decisão necessária
## 12. Perguntas para o GATE
1. pergunta objetiva
## 13. Próximos passos propostos
- passo · escopo · arquivos esperados
```

Após o relatório: **pare e aguarde aprovação.**

---

## 20. CRITÉRIOS DE ACEITE FINAIS

- Sistema centralizado de motion; nenhum novo valor arbitrário fora da camada central; TS e CSS na mesma fonte de tokens.
- `prefers-reduced-motion` em todas as animações novas/modificadas; foco, teclado e toque funcionais; estados anunciados acessivelmente.
- Sem regressão funcional; sem layout shift indevido; animações interrompíveis; operações iniciam imediatamente.
- Progresso visual representa estados reais; loading honesto.
- Tabelas/listas grandes performáticas; virtualização preservada.
- Feedback de sucesso/erro consistente.
- Testes existentes passando (descontadas falhas preexistentes); interações críticas novas com cobertura; QA temporal anexado quando a ferramenta permitir.
- Bundle registrado; impactos documentados; camada `motion/` documentada (princípios, tokens, easings, springs, primitivas, exemplos de uso e de não uso, reduced-motion, integração CSS/componentes, regras de tabelas/loading/feedback, processo para nova animação, checklist de revisão — prática e curta o suficiente para consulta por agentes).
- Nenhum anti-pattern da seção 14; nenhuma regra de negócio alterada; nenhuma mudança de terceiros descartada; cada lote aprovado em seu GATE.

**Definições de escopo:** "100% das animações" = novas + modificadas + superfícies aprovadas nesta iniciativa (legadas fora do escopo: inventariar, não migrar). "Zero valores arbitrários" = nenhum valor novo fora da camada central (legados migram só dentro do escopo aprovado).

---

## 21. PRIMEIRA RESPOSTA ESPERADA DO AGENTE

Ao receber este prompt, responda inicialmente **apenas** com:

1. confirmação de entendimento;
2. plano curto da auditoria;
3. ferramentas já disponíveis que pretende utilizar;
4. confirmação de que não instalará dependências;
5. confirmação de que não alterará arquivos antes da auditoria;
6. início da Fase 1.

Depois: auditoria → relatório → **pare no GATE 1**. Nenhuma animação antes da aprovação explícita.

---

*Versão definitiva — v5 | 17/07/2026*
