# ADR-0163 — Padrão único de sinal de espera para ação disparada pelo operador

**Status:** Aceito
**Decisor:** Diego, 2026-09-17
**Relacionado:** ADR-0079 (fonte única de tokens de motion), `docs/motion/contrato-motion-v5.md` §9 e §10

## Contexto

O app tinha, espalhado por 21 modais, 6 confirmações de `Publicados`, o modal de saque de
`DetalheFinanceiro` e 3 confirmações de remoção de foto, N variações caseiras do mesmo sinal —
"está processando" — cada uma resolvida à mão (texto do botão trocando, `disabled` isolado, spinner
inline) sem um componente ou uma regra comuns. A reclamação que originou o trabalho foi concreta: "o
botão virava 'Criando…' e nada mais se mexia, parecia travado" — o sinal existia, mas era fraco e
inconsistente entre telas.

O `contrato-motion-v5.md` §9 já trazia a regra "nunca um padrão universal de carregamento" — mas essa
regra fala de **carregamento de conteúdo** (skeleton, etapas reais de um fluxo), não do problema aqui:
o operador clicou em algo e precisa saber que o clique surtiu efeito enquanto a resposta não chega.
São problemas parecidos na superfície e diferentes na causa, e por isso pedem soluções diferentes —
ver a emenda ao §9 abaixo.

## Decisão

### O padrão

Um único componente, `ProgressoIndeterminado` (`src/components/ui/progresso-indeterminado.tsx`),
consumido por `DialogContent`/`AlertDialogContent` via as props `processando`/`rotuloProcessando`/
`destrutivo`, com dois modos:

- **Ação normal em modal (Grupo A/B):** glow no container do diálogo + barra indeterminada no topo.
  O glow é o sinal primário (inequívoco mesmo com a barra pouco visível em tema escuro); a barra
  carrega o `role="progressbar"`/`aria-label` para leitor de tela.
- **Ação destrutiva em modal (Grupo C) e ação disparada fora de modal (Grupo D):** só a barra, sem
  glow. Justificativa dupla: (a) glow é comemorativo por natureza — apagado-com-brilho contradiz
  §10 ("exclusão/destrutivas: nunca lúdicas — sem bounce, overshoot, comemoração"); (b) fora de
  modal o glow é efeito de container de diálogo — num botão de toolbar avulso ele fica deslocado,
  sem uma superfície que o justifique.

### Grupo B — o modal segura aberto até a resposta

Os 6 `AlertDialog` de `Publicados` e o modal de saque de `DetalheFinanceiro` eram **não controlados**:
o clique no botão de ação fechava o modal na hora (comportamento padrão do
`AlertDialogAction`/Radix), e o operador via a tabela sem saber se algo estava correndo. A decisão
foi tornar esses diálogos controlados (`open`/`onOpenChange` em estado próprio), `preventDefault` no
clique, e só fechar em `finally` — sucesso ou erro.

**Isto é mudança de comportamento em telas de produção, não só visual:** o clique em "Pausar",
"Migrar", "Remover do sistema", "Remover publicação incompleta", "Refazer kit" e "Registrar/Desfazer
saque" deixa de fechar o diálogo na hora — ele agora fica aberto, com o botão de confirmar e o
"Cancelar" desabilitados, até o Mercado Livre (ou a RPC) responder. Quem clica passa a esperar
olhando para o modal em vez de já ver o resultado ou continuar navegando.

### Critério do que conta como "destrutivo"

**O efeito real na listagem do Mercado Livre decide, não a palavra do botão.** Sob esse critério,
cinco ações contam como destrutivas mesmo quando o rótulo não usa a palavra "excluir": excluir
produto, remover do sistema, remover publicação incompleta, migrar para preço por variação e refazer
kit. "Migrar" e "Refazer kit" entram porque as duas encerram um item no Mercado Livre de forma
irreversível — a migração fecha o anúncio original (ordens antigas ficam presas nele) e o refazer
encerra o kit vigente — ainda que nenhuma das duas diga "excluir" no texto do botão. "Corrigir e
republicar", por comparação, fica de fora: pausa e reenvia, não encerra nada em definitivo.

As 3 confirmações de remoção de foto (`familia-expanded.tsx`) também usam `destrutivo`, mas por um
motivo mais simples — é remoção de um arquivo do storage — e não entram nessa lista de cinco porque
o efeito não é sobre a listagem publicada no Mercado Livre.

### `onOpenChange` não é guardado

A primeira versão do plano guardava o fechamento em voo (`if (!pendente) setAberto(o)`), para impedir
que ESC ou clique fora fechassem o modal durante a chamada. Foi retirada: `chamarEdge` (o cliente das
Edge Functions) não tem timeout, e uma requisição pendurada deixaria o operador **preso sob o
overlay**, sem ESC, sem clique fora e com o "Cancelar" desabilitado — pior do que deixar fechar cedo.
Fechar o modal não cancela a mutation em voo: a linha da tabela continua com o próprio estado de
pendência e o toast de resultado chega do mesmo jeito, mesmo com o modal já fechado. O "Cancelar"
desabilitado permanece como sinal visual de que a ação está correndo, mesmo sem travar o fechamento.

### Alternativa descartada

Sinalizar a espera **na linha da tabela** (ex.: um `StatusInline` ou badge na linha de `Publicados`),
em vez de no próprio modal. Descartada porque manteria 7 telas com um padrão de sinalização só seu,
divergente do que os outros 18+ modais do app usam — exatamente a fragmentação que motivou este
trabalho. O modal já é a superfície que o operador está olhando no momento do clique; sinalizar nele
é mais direto do que mandar o olhar de volta para uma linha que pode nem estar visível atrás do
próprio modal.

## Consequências

- Um único componente e um único par de props cobre 21 modais + 6 confirmações de `Publicados` + o
  saque + 3 remoções de foto + 5 pontos fora de modal (Task 9) — 2 pontos fora de modal
  (`Publicados.tsx` e `familia-expanded.tsx`) ficaram de fora desta entrega por restrição de escopo,
  registrados como pendência conhecida.
- Mudança de comportamento perceptível em produção: os 6 modais de `Publicados` e o de saque não
  fecham mais no clique — fecham só depois da resposta.
- Nenhum payload, parâmetro ou condição de disparo de mutation mudou — a mudança é só de quando o
  modal fecha e o que ele mostra enquanto isso não acontece.

## Como reverter

Remover as props `processando`/`rotuloProcessando`/`destrutivo` dos call sites e voltar os 6 modais
de `Publicados` + o de saque a `AlertDialog`/`Dialog` não controlados (tirar `open`/`onOpenChange`,
`preventDefault` e o `finally`). O componente `ProgressoIndeterminado` pode ficar dormente sem uso.
