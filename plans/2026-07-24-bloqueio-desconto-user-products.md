# Bloqueio de desconto visual em User Products

## Design aprovado

O sistema manterá o desconto visual legado somente em anúncios que aceitam
`original_price`. Para categorias Mercado Livre no formato `user_products`, a
interface impedirá novas ativações e explicará a incompatibilidade. O backend
repetirá a validação no limite de confiança.

Quando uma categoria ainda desconhecida revelar o formato User Products pela
rejeição exata do primeiro `POST /items`, a publicação com desconto será
interrompida antes do retry em formato plano, o formato será salvo no cache
`ml_formato_publicacao` e a família ficará em erro com instrução para desmarcar
o desconto. Depois de desmarcado, o fluxo plano existente continuará intacto.

O controle continuará permitindo desmarcar uma configuração incompatível já
salva. A ação em lote recusará a ativação se o lote contiver ao menos uma
família User Products. Não será criada promoção `PRICE_DISCOUNT`, não haverá
renovação e nenhum preço ao vivo será alterado automaticamente.

## Critérios de conclusão

- Uma categoria conhecida como `user_products` não aceita ativação individual,
  por faixa de preço nem em lote.
- A interface mostra uma explicação curta e específica da incompatibilidade.
- Uma configuração já ativa pode ser desmarcada.
- A descoberta reativa de User Products com desconto não cria silenciosamente
  um item plano sem desconto.
- A descoberta é persistida em `ml_formato_publicacao`.
- User Products sem desconto e anúncios Legacy com desconto preservam o
  comportamento atual.
- Os testes direcionados de backend e frontend passam.

## Restrições globais

- Correctness.
- Smallest scope.
- Smallest working diff.
- Lowest context usage.
- Lowest maintenance cost.
- Fix root cause, not symptoms.
- No speculative abstractions, dependencies, unrelated refactors or formatting.
- Preserve validation, error handling, security, accessibility and data
  integrity.
- Use `rtk` as prefix for every shell command.
- Development happens on an isolated branch or worktree, never directly on
  `main`.
- Every behavioral change starts with a failing test and ends with the smallest
  validation that proves it.

## Estrutura de arquivos

### Tarefa 1 — proteção e descoberta no backend

- Modify `supabase/functions/_shared/canais/contrato.ts`
  - Adicionar `DESCONTO_INCOMPATIVEL` à taxonomia `ErroCanalCodigo`.
- Modify `supabase/functions/_shared/canais/mercado-livre.ts`
  - Recusar `AnuncioCanonico` com `desconto` quando a categoria já exige item
    plano.
  - Na descoberta reativa por `precisaItemPlano`, retornar o mesmo erro antes
    de reconstruir/publicar o item plano quando `a.desconto` estiver ativo.
  - Preservar o retry plano atual quando não houver desconto.
- Modify `supabase/functions/publish-familia-ml/processar.ts`
  - Ao receber `DESCONTO_INCOMPATIVEL`, salvar `user_products` por
    `confirmarFormatoPublicacao(formatoRepo, conexao.id, categoria)`.
  - Marcar a família como `erro`, usando a mensagem operacional do conector, e
    finalizar a reavaliação do lote.
- Modify `supabase/functions/_shared/canais/__tests__/mercado-livre.test.ts`
  - Reproduzir categoria plana conhecida com desconto e provar que nenhum POST
    de criação é realizado.
  - Reproduzir rejeição reativa 369+374 com desconto e provar que não ocorre o
    segundo POST plano.
  - Provar que o mesmo erro reativo sem desconto ainda executa o retry plano.
- Modify `supabase/functions/publish-familia-ml/__tests__/processar.test.ts`
  - Fazer o conector retornar `DESCONTO_INCOMPATIVEL`.
  - Provar persistência do cache `user_products`, status `erro`, mensagem
    operacional e ausência de retry.

Interface produzida:

```ts
type ErroCanalCodigo =
  | /* códigos existentes */
  | 'DESCONTO_INCOMPATIVEL';
```

Comando de verificação:

```bash
rtk pnpm vitest run \
  supabase/functions/_shared/canais/__tests__/mercado-livre.test.ts \
  supabase/functions/publish-familia-ml/__tests__/processar.test.ts
```

Saída esperada: processo com código zero e todos os testes desses dois arquivos
aprovados.

Estado committável: o backend nunca publica um item plano silenciosamente sem o
desconto solicitado e registra a descoberta para consumidores posteriores.

### Tarefa 2 — compatibilidade na leitura e bloqueios da interface

- Modify `src/lib/tipos-dominio.ts`
  - Adicionar em `Familia`:

```ts
formatoPublicacaoMl: 'legacy' | 'user_products' | null;
```

- Modify `src/lib/queries.ts`
  - Consultar as linhas legíveis de `ml_formato_publicacao` com
    `formato = 'user_products'` junto das consultas auxiliares já paralelas de
    `fetchFamilias`.
  - Mapear categorias encontradas para a propriedade
    `formatoPublicacaoMl`; ausência de cache vira `null`.
- Modify `src/lib/desconto.ts`
  - Exportar o predicado puro:

```ts
export function podeAlterarDescontoVisual(
  formato: Familia['formatoPublicacaoMl'],
  atualmenteAtivo: boolean,
): boolean;
```

  - Retornar `true` para desativação de uma configuração já ativa e `false`
    somente para nova ativação em `user_products`.
- Modify `src/lib/__tests__/desconto.test.ts`
  - Cobrir Legacy, formato desconhecido, bloqueio de nova ativação User
    Products e permissão para desativar configuração User Products existente.
- Modify `src/components/familia-row.tsx`
  - Desabilitar apenas a tentativa de nova ativação incompatível.
  - Exibir texto acessível informando que o ML não permite desconto visual em
    User Products.
- Modify `src/components/config-grupos-preco.tsx`
  - Aplicar o mesmo predicado a cada controle de faixa, sem impedir a
    desativação de valores existentes.
- Modify `src/pages/Revisao.tsx`
  - Antes da mutação de ativação em lote, localizar famílias
    `user_products`, recusar toda a ação e mostrar quantidade e exemplo.
  - Preservar a desativação em lote.
- Create `src/lib/__tests__/queries.test.ts`
  - Chamar `familiaFromRow` com uma fixture mínima tipada por
    `Parameters<typeof familiaFromRow>[0]` e provar o mapeamento
    `user_products` e `null` da propriedade sintética da consulta.

Comandos de verificação:

```bash
rtk pnpm vitest run src/lib/__tests__/desconto.test.ts
rtk pnpm vitest run src/lib/__tests__/queries.test.ts
rtk pnpm tsc
```

Saída esperada: códigos zero; testes direcionados aprovados; nenhuma falha de
tipo nos consumidores de `Familia`.

Estado committável: todos os pontos de ativação visíveis compartilham a mesma
regra, explicam o bloqueio e ainda permitem desfazer configurações antigas.

### Tarefa 3 — reconhecer as categorias comprovadas na instalação atual

- Create
  `supabase/migrations/20260724150000_seed_user_products_desconto_incompativel.sql`
  - Inserir no cache, para cada conexão Mercado Livre existente, as categorias
    comprovadas `MLB270273` e `MLB271227` como `user_products`.
  - Usar `on conflict (connection_id, categoria_id) do update set
    formato = excluded.formato` para execução idempotente.
  - Não alterar `familias.exibir_com_desconto` nem preços publicados.
- Verify the migration with a transaction-local SQL check against a temporary
  fixture or the project database after applying migrations, asserting one row
  por conexão/categoria and no changes in `familias`.

Comando de verificação:

```bash
rtk supabase db lint
```

Saída esperada: código zero e nenhuma falha SQL nova.

Estado committável: o lote #39 e a categoria de zíper já conhecida recebem o
bloqueio imediatamente após a migração, sem depender de uma nova publicação
malsucedida.

## Dependências e responsáveis

1. Tarefa 1 — executor Terra backend; independente da Tarefa 2.
2. Tarefa 2 — executor Terra frontend; consome somente a tabela e os valores de
   formato já existentes, portanto pode rodar em paralelo com a Tarefa 1.
3. Tarefa 3 — executor Terra de dados; depende apenas do schema existente e
   pode rodar em paralelo, com escopo exclusivo na nova migração.
4. O orquestrador Sol integra os commits, executa as verificações combinadas e
   resolve qualquer inconsistência.

Nenhum executor pode criar descendentes, desfazer mudanças alheias ou editar
fora do escopo atribuído.

## Autorrevisão do plano

- Cobertura do design: todos os requisitos aprovados apontam para as Tarefas
  1–3; nenhuma lacuna encontrada.
- Placeholders: varredura realizada; não há seção ou decisão pendente.
- Consistência de tipos: `formatoPublicacaoMl` usa exatamente os valores da
  constraint existente; o novo código de erro é produzido pelo conector e
  consumido pelo worker.
- Escopo: nenhuma promoção real, scheduler, dependência, alteração de preço ou
  refatoração não solicitada foi incluída.
- Independência: os três escopos de escrita não se sobrepõem; a integração
  ocorre somente depois dos testes individuais.
