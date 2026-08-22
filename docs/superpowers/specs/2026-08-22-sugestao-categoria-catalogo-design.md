# Sugestão de categoria pela ficha de catálogo (pré-publicação)

**Data:** 2026-08-22
**Status:** Aprovado (design)
**Relacionado:** [ADR-0021](../../decisions/0021-vinculacao-automatica-ao-catalogo-ml.md) (trava `fichaEquivalente`, opt-in),
[ADR-0036](../../decisions/0036-alerta-catalogo-no-match.md) (alerta Telegram `ficha_divergente`),
[ADR-0057](../../decisions/0057-categoria-selecao-livre-e-sugestao-concorrente.md) (padrão de sugestão não-vinculante que este design estende),
[ADR-0054](../../decisions/0054-categoria-titulo-tipo-produto-generico.md) (Fase 2 rejeitada: por que a categoria do concorrente/catálogo nunca pode ser aplicada sozinha),
`_shared/ml/catalogo.ts`, `process-familia/index.ts`, `card-categoria.tsx`, `vincular-catalogo/index.ts`

---

## Problema

A categoria de um anúncio é decidida em `process-familia` (`resolverCategoria`, `_shared/categoria/resolver.ts`)
sem olhar o catálogo do Mercado Livre. O catálogo só entra em cena depois de publicado, no worker
`vincular-catalogo`, que grava `catalog_status='ficha_divergente'` quando a ficha do GTIN vive num
domínio diferente do domínio da categoria escolhida — nesse ponto o anúncio já nasceu na categoria
errada, e trocar a categoria de um item **já ativo** é proibido no projeto (risco de re-moderação;
ver "O que NÃO muda").

## Caso real que motivou (lote 21, 2026-08-22)

Família Eucerin Aquaphor 55ml (GTIN `4005800223136`) foi publicada na categoria "Bebês > Higiene e
Cuidados com o Bebê > Cremes, Pomadas e Óleos" (`MLB277750`, domínio `MLB-BABY_CREAMS_AND_OINTMENTS`).
O GTIN só tem **uma** ficha em todo o catálogo do ML — `MLB19462147`, domínio
`MLB-BODY_SKIN_CARE_PRODUCTS` (7 vendedores competindo, R$77–144). O preditor de categoria
(`domain_discovery`) nem cogitou o domínio corporal para esse produto. Resultado: `ficha_divergente`,
sem competir no catálogo, só descoberto pelo Diego depois de publicado — precisou de uma
republicação manual (pausar → trocar categoria no banco → republicar) para corrigir.

## Decisão

Estender o padrão já em produção do ADR-0057 (sugestão do concorrente: coluna persistida + card
clicável não-vinculante em `CardCategoria`) para uma segunda fonte de sugestão: a categoria cujo
domínio bate com a ficha de catálogo real do GTIN, quando ela diverge da categoria escolhida.
**Nunca aplicada automaticamente** — mesmo racional do ADR-0054 Fase 2 (aplicar categoria de
terceiro sem confirmação humana já produziu categorização errada por colisão de GTIN/ficha).

### Componentes

**1. `process-familia` — nova etapa best-effort, após `resolverCategoria` decidir a categoria (por
volta de `index.ts:505`, mesmo bloco que já persiste `concorrencia_categoria_id`):**

- Só roda se a variação principal tiver GTIN válido (mesmo guard de `gtinAusente` já usado por
  `buscarProdutoCatalogoPorGtin`).
- Busca a ficha via `buscarProdutoCatalogoPorGtin` (`_shared/ml/catalogo.ts:276`, já existe, usada
  hoje só pelo `vincular-catalogo`).
- Filtra pela trava anti-kit já existente `fichaEquivalente` (`catalogo.ts:154`) — só considera ficha
  aprovada (kit/metragem divergente continua sem gerar sugestão nenhuma, igual hoje).
- Resolve o `domainId` da categoria que o resolver acabou de escolher. **Novo helper** (não existe
  hoje): `buscarDominioCategoria(token, categoriaMlId)` — `GET /categories/{id}`, contrato exato do
  campo de domínio a confirmar com token real na implementação (o precedente pós-publicação usa
  `buscarEsperadoDoItem`, que lê `domain_id` do **item já publicado**; aqui não há item ainda, então
  a leitura tem que ser pela **categoria**, caminho ainda não percorrido no código).
- Se `ficha.domainId` (já vem no retorno de `buscarProdutoCatalogoPorGtin`) for diferente do domínio
  da categoria escolhida: resolve a categoria real correspondente ao domínio da ficha. **Novo
  helper**: `buscarCategoriaFicha(token, fichaId)` — usa os itens que já competem na ficha
  (`GET /products/{fichaId}/items`, mesmo endpoint que a investigação do lote 21 usou manualmente
  para achar `MLB1262`) e `buscarNomeCategoria` (`domain-discovery.ts:89`, já existe) para o nome.
- Persiste em 2 colunas novas de `familias` (nullable, mesmo padrão de `concorrencia_categoria_id`):
  `catalogo_categoria_sugerida_id`, `catalogo_categoria_sugerida_nome`.
- Qualquer falha (rede, ficha não encontrada, domínio ausente) → não persiste nada, não lança, não
  afeta o resto do processamento. Mesmo tratamento best-effort do bloco de concorrência hoje.

**2. `card-categoria.tsx` (`BuscaCategoria`) — generaliza o card de sugestão único** (hoje só lê
`familia.concorrenciaCategoriaId`, linhas 18-75) para aceitar mais de uma fonte: continua carregando
a sugestão do concorrente do jeito que já é (via `buscar-categoria` em `atributos-familia`), e o
mesmo payload passa a incluir `sugestaoCatalogo` quando `catalogo_categoria_sugerida_id` estiver
preenchido — resolvido pelo backend com `buscarNomeCategoria` (mesmo padrão do bloco de
`sugestaoConcorrente` em `atributos-familia/index.ts:52-60`). Rótulo do card diferencia a origem:
"Sugestão (concorrente)" existente vs. novo "Sugestão (catálogo): N vendedores competindo". Clicar
chama o mesmo `escolher()`/`definirCategoriaLivre` já existente (`definir-categoria-familia`,
zero mudança de contrato).

**3. `vincular-catalogo` — alerta Telegram enriquecido.** Quando grava `ficha_divergente` e a família
tiver `catalogo_categoria_sugerida_id` preenchido (calculado antes, no `process-familia`, então já
disponível sem chamada nova), `montarMensagemCatalogoNoMatch` (`_shared/notificacoes/telegram.ts:46`)
ganha uma linha citando a categoria sugerida. `CatalogoNoMatchAlerta`/`ItemAlerta` ganha campo
opcional `categoriaSugerida?: { id: string; nome: string } | null`; call site em
`vincular-catalogo/index.ts:131` passa `familia.catalogo_categoria_sugerida_nome` quando presente.

### O que fica igual

- `resolverCategoria` não muda — a categoria continua decidida do jeito que é hoje; a sugestão é
  só informativa, calculada depois.
- A trava `fichaEquivalente` e o comportamento de opt-in pós-publicação (`vincular-catalogo`) não
  mudam — a sugestão não interfere no fluxo de vinculação automática.
- `definir-categoria-familia` não muda de contrato — a sugestão só alimenta o mesmo fluxo de escolha
  livre que o concorrente já usa.

## Abordagens descartadas

**Decidir a categoria automaticamente pela ficha (sem card).** Alimentar o candidato de catálogo
direto no desempate do `resolverCategoria`. Rejeitado: o ADR-0054 Fase 2 já tentou aplicar a
categoria do concorrente automaticamente e produziu uma categoria absurda por colisão de GTIN
("Brinquedos de Pegadinhas"). "Tem ficha" não é "categoria certa" — o Aquaphor do lote 21 é vendido
majoritariamente para bebês na prática do Diego mesmo a única ficha do GTIN sendo do domínio
corporal; trocar de categoria pra competir no catálogo é decisão comercial (alcance de busca vs.
buy box), não algo que o sistema deve resolver sozinho.

**Só mexer no alerta pós-publicação, sem card pré-publicação.** Mais barato, mas não resolve o
problema de raiz: o operador só saberia depois de já ter publicado errado, tendo que republicar como
aconteceu no lote 21. Descartado — perde o ponto principal do pedido.

**Bloquear publicação até o operador confirmar/dispensar a divergência.** Mais forte que um card
informativo. Descartado nesta rodada (decisão do Diego): mantém o padrão não-vinculante do
ADR-0057, sem fricção nova no fluxo de publicar.

## Dados / migration

Migration aditiva em `familias` (via `supabase migration new`, ADR-0043):

```sql
alter table familias
  add column catalogo_categoria_sugerida_id text,
  add column catalogo_categoria_sugerida_nome text;
```

Sem alteração em `variacoes`, sem novo enum, sem novo status. Mesmo padrão de baixo risco do
`concorrencia_categoria_id` (ADR-0057) — nenhuma coluna passa a ser obrigatória, nenhum fluxo
existente lê/escreve menos do que já lê/escreve.

## Testes

Funções puras novas (vitest, padrão de `catalogo.ts`/`resolver.ts`):

- `sugerirCategoriaPorFicha` (nome provisório — a função que decide "gera sugestão ou não" a partir
  de `AtributosFicha` + domínio da categoria escolhida + resultado de `fichaEquivalente`): domínio
  igual → sem sugestão; ficha reprovada pela trava anti-kit → sem sugestão; domínio diferente e ficha
  aprovada → sugestão; ausência de GTIN ou falha de rede → sem sugestão, sem exceção propagada.
- `montarMensagemCatalogoNoMatch` com e sem `categoriaSugerida` — texto muda só quando presente.
- Frontend: `BuscaCategoria` renderiza os dois cards (concorrente + catálogo) quando ambos vêm
  preenchidos, sem um esconder o outro; clique em cada um chama `definirCategoriaLivre` com o
  `categoriaId`/`categoriaNome` correto da fonte clicada.

## Faseamento

Fase única — o volume de código é pequeno (2 helpers novos, 1 coluna dupla, 1 card generalizado, 1
linha a mais no alerta) e as três partes (process-familia, card, alerta) só fazem sentido juntas.
Deploy: `process-familia`, `atributos-familia`, `vincular-catalogo` (as três funções que tocam as
colunas/leem o schema novo).

## Consequências

**Boas:**
- Fecha a classe de problema para qualquer produto com ficha de catálogo em domínio diferente da
  categoria escolhida, não só o Aquaphor — sem esperar o operador notar via Telegram e pedir
  investigação de novo.
- Reaproveita quase toda a infraestrutura do ADR-0057 (trava, contrato de sugestão, componente de
  card, fluxo de aplicar) — pouco código genuinamente novo.
- Alerta pós-publicação fica mais acionável (já vem com a categoria alternativa), reduzindo
  investigação manual no caso residual em que a divergência só é percebida depois.

**Tradeoffs aceitos:**
- +1 a 2 chamadas ao ML por família processada com GTIN válido (busca de ficha + resolução de
  domínio/categoria) — mesma característica das chamadas já aceitas pelo ADR-0057 (cacheável,
  barata, best-effort).
- Contrato exato de `GET /categories/{id}` (campo de domínio) e de `GET /products/{id}/items`
  (campo de categoria) precisa ser confirmado com token real na implementação — não foi validado
  ao vivo neste design, só descrito pelo padrão já usado em `buscarEsperadoDoItem`/investigação
  manual do lote 21.
- Categoria "com ficha" continua podendo ser semanticamente pior que a categoria escolhida
  originalmente (ex.: Aquaphor em "Cuidado do Corpo" vs. "Bebês") — por isso a decisão final é
  sempre do operador, nunca automática.

## Como reverter

Reverte com checkout dos arquivos tocados (`process-familia/index.ts`, `card-categoria.tsx`,
`atributos-familia/index.ts`, `vincular-catalogo/index.ts`, `_shared/notificacoes/telegram.ts`) +
`down` da migration das 2 colunas (aditivas, sem dado derivado em outro lugar — dropar é seguro).
