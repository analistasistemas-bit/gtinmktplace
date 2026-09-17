# ADR-0163 — Padrão único de sinal de espera para ação disparada pelo operador

**Status:** Aceito, com recorte de sobriedade em 2026-09-17
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
- **Ação destrutiva em modal (Grupo C):** só a barra, sem glow. Justificativa: glow é comemorativo
  por natureza — apagado-com-brilho contradiz §10 ("exclusão/destrutivas: nunca lúdicas — sem
  bounce, overshoot, comemoração").

**Não existe modo "fora de modal".** A primeira versão desta decisão previa um terceiro modo — só a
barra, em botão solto fora de qualquer diálogo — aplicado em 5 pontos (Task 9). O recorte de
2026-09-17 (ver seção abaixo) removeu esse modo inteiro: em 2 dos 5 pontos a barra ficava embaixo do
overlay de outro modal (morta) ou quebrava linha num `flex-wrap` (salto de layout), e nos outros 3 o
botão já tinha spinner ou texto de estado suficiente. O par glow+barra só existe dentro de
`DialogContent`/`AlertDialogContent`.

### Critério de aplicação (regra final, pós-recorte)

O par glow+barra só se aplica quando as **duas** condições valem ao mesmo tempo:

1. **A operação fala com Mercado Livre, storage, fila (QStash) ou IA, ou monta relatório
   paginado** — segundos reais de espera por resposta externa ou por paginação real de dados, não
   uma chamada local de UPDATE/DELETE simples.
2. **O modal permanece de pé durante a espera.**

Faltando qualquer uma, a ação usa spinner no ícone ou texto de estado no próprio botão
("Salvando…", "Excluindo…") — o que essas telas já tinham antes desta entrega.

### Grupo B — o modal segura aberto até a resposta

Os 6 `AlertDialog` de `Publicados` eram **não controlados**: o clique no botão de ação fechava o
modal na hora (comportamento padrão do `AlertDialogAction`/Radix), e o operador via a tabela sem
saber se algo estava correndo. A decisão foi tornar esses diálogos controlados (`open`/`onOpenChange`
em estado próprio), `preventDefault` no clique, e só fechar em `finally` — sucesso ou erro.

**Isto é mudança de comportamento em telas de produção, não só visual:** o clique em "Pausar",
"Migrar", "Remover do sistema", "Remover publicação incompleta" e "Refazer kit" deixa de fechar o
diálogo na hora — ele agora fica aberto, com o botão de confirmar e o "Cancelar" desabilitados, até
o Mercado Livre responder. Quem clica passa a esperar olhando para o modal em vez de já ver o
resultado ou continuar navegando. (O modal de saque de `DetalheFinanceiro` também virou controlado
nesta linha, mas saiu no segundo recorte abaixo — o saque é uma RPC local, ~100ms, sem fala com o
Mercado Livre, e não precisava do comportamento "segura aberto".)

### Critério do que conta como "destrutivo"

**O efeito real na listagem do Mercado Livre decide, não a palavra do botão.** Sob esse critério,
quatro ações de `Publicados.tsx` contam como destrutivas mesmo quando o rótulo não usa a palavra
"excluir": remover do sistema, remover publicação incompleta, migrar para preço por variação e
refazer kit. "Migrar" e "Refazer kit" entram porque as duas encerram um item no Mercado Livre de
forma irreversível — a migração fecha o anúncio original (ordens antigas ficam presas nele) e o
refazer encerra o kit vigente — ainda que nenhuma das duas diga "excluir" no texto do botão.
"Corrigir e republicar" e "Pausar/Reativar", por comparação, ficam de fora: não encerram nada em
definitivo. (`dialog-excluir-produto.tsx` também era destrutivo sob este critério, mas saiu no
recorte de sobriedade — é uma exclusão local de uma linha do catálogo, sem fala com o Mercado
Livre, e falha a condição 1 do critério de aplicação acima.)

As 3 confirmações de remoção de foto (`familia-expanded.tsx`) também usam `destrutivo`, mas por um
motivo mais simples — é remoção de um arquivo do storage — e não entram nessa lista de quatro porque
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

## Recorte de sobriedade (2026-09-17)

A entrega original chegou a 21 modais + 5 botões soltos (26 pontos). A revisão final (Fable)
reprovou por "enfeitado" e determinou a saída de 16, aplicando o critério de aplicação acima. Saíram:

- **9 modais de espera curta local** (Grupo 3 do escrutínio): `dialog-fiscal-produto`,
  `dialog-excluir-produto`, `org-billing`, `revenue-reconciliation`, `support-request-dialog`,
  `Organizacoes` (Nova empresa), `Usuarios` (convidar, notificações Telegram, editar menus). Nenhum
  fala com Mercado Livre/storage/fila/IA — são UPDATE/INSERT locais de um clique.
- **1 achado de código morto:** `SupportRequests.tsx` — o `AlertDialogAction` não fazia
  `preventDefault`, o Radix fechava o modal no clique, e `processando={saving}` nunca chegava a ser
  visto. A entrega original contou esse ponto como aplicado sem notar que era inerte.
- **1 classificação errada:** o modal "Preço de atacado no lote inteiro" em `Revisao.tsx` foi tratado
  como espera de laço (Grupo 2), mas `setAtacadoLote` é um único UPDATE
  (`src/lib/queries.ts:889`), não itera família por família.
- **5 botões fora de modal** (Grupo D, Task 9): `DetalheFinanceiro` (saque e Atualizar),
  `Revisao` (reenviar com erro), `Organizacoes` (cancelar solicitação), `dialog-criar-kit`
  (Reenviar). Dois causavam defeito visível — a barra do saque ficava atrás do overlay do próprio
  modal (morta) e a de `Revisao`/`DetalheFinanceiro` quebrava linha num `flex-wrap` (salto de
  layout) — e os cinco já tinham spinner no ícone ou texto de estado ("Cancelando…",
  "Atualizando…") suficiente. O modo "fora de modal" saiu do padrão inteiro, não só desses 5 pontos.

**Ficaram 20 pontos nesta primeira passada** (revisados no segundo recorte abaixo, que chega a 18):
`dialog-cadastro-produto`, `dialog-adicionar-variacao`, `dialog-criar-kit` (modal principal),
`DialogCriarKitVirtual`, `Revisao` (modal "Publicar no Mercado Livre"), os 6 `AlertDialog` de
`Publicados`, o modal de saque de `DetalheFinanceiro`, `dialog-entrada`, `dialog-ajuste`,
`pulse/dialog-adicionar`, `pulse/dialog-reprecificar`, `export/botao-exportar`, e as 3 confirmações
de foto em `familia-expanded.tsx`.

## Segundo recorte de sobriedade (2026-09-17, segunda passada)

A segunda revisão (Fable) encontrou mais 2 pontos fora do critério de aplicação, apesar de
aparentarem espera real:

- **Modal de saque (`DetalheFinanceiro.tsx`):** é uma RPC local
  (`registrar_saque_ml_vendas`, `src/lib/faturamento.ts:191`), não fala com o Mercado Livre. Resolve
  em ~100ms — o glow virava uma piscada. Revertido inteiro: o modal volta a fechar no clique
  (`processandoSaque`, `mutateAsync` e o `try`/`finally` da Task 7 saem, junto com o teste de
  timing). Deixa de fazer parte do Grupo B.
- **Reprecificar (`pulse/dialog-reprecificar.tsx`):** 2 `SELECT`s e um laço local de
  `updateVariacaoPreco`, zero Mercado Livre. Remove `processando`/`rotuloProcessando` do
  `DialogContent`; o botão já dizia "Gravando…".

O critério de aplicação (item 1, acima) ganhou uma cláusula que faltava: **"ou monta relatório
paginado"** — sem ela, `export/botao-exportar` (fetch paginado + montagem de arquivo, sem fala com
ML/storage/fila/IA) ficaria fora da própria regra que o mantém na lista.

**Ficam 18 pontos:** `dialog-cadastro-produto`, `dialog-adicionar-variacao`, `dialog-criar-kit`
(modal principal), `DialogCriarKitVirtual`, `Revisao` (modal "Publicar no Mercado Livre"), os 6
`AlertDialog` de `Publicados`, `dialog-entrada`, `dialog-ajuste`, `pulse/dialog-adicionar`,
`export/botao-exportar`, e as 3 confirmações de foto em `familia-expanded.tsx`.

O Grupo B (modal que segura aberto até a resposta) fica com **6 modais**, todos em
`Publicados.tsx`.

## Consequências

- Um único componente e um único par de props cobre 18 pontos (lista acima) — sem modo "fora de
  modal". `ProgressoIndeterminado` só é renderizado dentro de `DialogContent`/`AlertDialogContent`.
- Mudança de comportamento perceptível em produção: os 6 modais de `Publicados` não fecham mais no
  clique — fecham só depois da resposta. O modal de saque de `DetalheFinanceiro` voltou ao
  comportamento original (fecha no clique) no segundo recorte.
- Nenhum payload, parâmetro ou condição de disparo de mutation mudou — a mudança é só de quando o
  modal fecha e o que ele mostra enquanto isso não acontece.
- Follow-up fora desta entrega: "Regenerar descrição" (IA, 5-15s) passaria no critério de aplicação
  mas hoje só mostra o texto "Gerando…" sem ícone girando — fix de uma linha, não faz parte deste ADR.

## Como reverter

Remover as props `processando`/`rotuloProcessando`/`destrutivo` dos call sites e voltar os 6 modais
de `Publicados` a `AlertDialog` não controlados (tirar `open`/`onOpenChange`, `preventDefault` e o
`finally`). O componente `ProgressoIndeterminado` pode ficar dormente sem uso.
