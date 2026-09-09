# Kit vinculado: categoria própria, diferente da base

**Data:** 2026-09-09
**Status:** Aprovado (design) — plano de implementação a seguir
**Relacionado:** [ADR-0151](../../decisions/0151-kit-vinculado-a-partir-de-produto-existente.md) (kit vinculado — Decisão 4 revisada por este design), [ADR-0057](../../decisions/0057-categoria-selecao-livre-e-sugestao-concorrente.md) (seleção livre de categoria + sugestão do concorrente — mecanismo reaproveitado aqui), `criar-kit-vinculado/processar.ts`, `definir-categoria-familia/index.ts`, `_shared/categoria/atributos.ts`, `_shared/categoria/resolver-atributos-genericos.ts`, `src/components/kit/dialog-criar-kit.tsx`, `src/components/kit/preview-kit.tsx`

---

## Problema

Hoje o kit vinculado (ADR-0151) **sempre herda 100% da categoria do produto-base** —
`montarFamiliaKit` clona `categoria_ml_id`/`categoria_nome` da base sem nenhuma opção de troca, e
`criarKitsVinculados` resolve o schema/atributos usando `base.categoria_ml_id` diretamente
(`criar-kit-vinculado/processar.ts`). Não existe caminho, hoje, pra publicar um kit numa categoria
diferente da unidade avulsa.

## Caso real que motivou (Leite Ninho, 2026-09-08/09)

"Leite Em Pó Ninho Zero Lactose Sachê 700g" está publicado em **Alimentos e Bebidas > Mercearia >
Infusões > Leite em Pó**. O "Kit 2 Unidades" do mesmo produto herdou essa categoria — e, ao
publicar, o Mercado Livre exigiu logística "Self service" (Mercado Envios Flex), incompatível com
a conta do Diego (confirmado pelo suporte do ML: "esse anúncio está exigindo um tipo de logística
diferente da que hoje está ativa na sua conta"). Concorrentes com o mesmo tipo de kit multi-unidade
publicam em **Bebês > Alimentos para Bebês > Leite Infantil**, categoria onde a logística bate com
contas padrão. A categoria certa pro KIT diverge da categoria certa pra UNIDADE — algo que o
desenho atual do ADR-0151 não permite expressar.

## Decisão

**Categoria do kit fica opcionalmente diferente da base, escolhida no momento da criação,
compartilhada entre todos os tamanhos daquela submissão, sem persistir como sugestão futura.**

### 1. UI — `dialog-criar-kit.tsx`

Um botão **"Trocar categoria"**, um só por submissão (não por tamanho de kit — confirmado com
Diego: quando vários tamanhos são criados juntos, todos vão pra mesma categoria escolhida). Por
padrão fica fechado — sem clicar, nada muda, o kit continua herdando a categoria da base
(comportamento atual, intocado). Ao clicar, abre um campo de busca que reaproveita
`buscarCategoriaML(familiaId, query)` (`src/lib/queries.ts:545`, já usado em `card-categoria.tsx`
pra troca de categoria de produtos normais) — passando o `familiaBaseId` no lugar do (inexistente
até aqui) id do kit, já que a action `buscar-categoria` só usa `familia_id` pra resolver o token de
conexão ML da org e, opcionalmente, uma sugestão de concorrente (`atributos-familia/index.ts:40-63`)
— nenhuma das duas depende de a família ser o kit em si. Ao escolher uma categoria, mostra um chip
"Categoria: <nome>" com "×" que volta ao padrão herdado. Estado local ao diálogo, nunca persistido
— reabrir o diálogo mais tarde volta a sugerir a categoria da base (decisão explícita do Diego:
mais simples, sem estado extra pra manter certo).

`KitPreviewValue`/fluxo de submissão não muda por tamanho — a categoria escolhida vai junto no
payload geral da submissão (`CriarKitInput`, ver abaixo), não dentro de cada `KitSolicitado`.

### 2. Contrato — `CriarKitInput` (`criar-kit-vinculado/processar.ts`)

```ts
export interface CriarKitInput {
  familiaBaseId: string;
  kits: KitSolicitado[];
  categoriaOverride?: { id: string; nome: string } | null; // novo, opcional
}
```

`null`/ausente → comportamento atual (100% herdado da base), sem nenhuma mudança de caminho.

### 3. Backend — `criarKitsVinculados`

Ponto de mudança único, em `criar-kit-vinculado/processar.ts` (por volta de onde hoje faz
`schema = await deps.lerSchema(token, base.categoria_ml_id)` seguido de
`aplicarKitNosAtributos(schema, base.atributos_ml, kit.multiplicador, pesoBase)`):

- **Sem override:** caminho idêntico ao de hoje — schema da categoria da base, atributos clonados
  de `base.atributos_ml`.
- **Com override:** troca a FONTE do schema e dos atributos-base, mas **não muda a lógica de kit
  em si**:
  1. `schema = await deps.lerSchema(token, categoriaOverride.id)` — schema da categoria NOVA, não
     da base.
  2. Atributos-base resolvidos do zero pra essa categoria nova, reaproveitando **exatamente** o
     branch que `definir-categoria-familia/index.ts:71-95` já usa quando um operador troca a
     categoria de um produto normal: `tipoParaCategoria(categoriaOverride.id)` decide entre o
     caminho curado (`montarAtributosML`, sem chamada de rede, pra linha/fita/botão/cola) ou o
     genérico com IA (`resolverAtributosGenericos`, que já lê o próprio schema e desempata
     atributos por LLM quando precisa). Usa `base.nome_pai`/`descricao_pai`/`fornecedor` como
     entrada (o produto que está sendo empacotado continua sendo o mesmo; só a categoria mudou).
  3. `aplicarKitNosAtributos(schema, atributosResolvidos, kit.multiplicador, pesoBase)` — **sem
     alteração** nessa função: a trava "recusa alto se a categoria não oferece Kit" e o guard
     "nunca inventa NET_WEIGHT" continuam valendo, agora testados contra a categoria nova.
  4. `montarFamiliaKit` grava `categoria_ml_id`/`categoria_nome` = valores do override (em vez de
     clonar da base).

**Erro:** categoria nova sem `SALE_FORMAT=Kit` → mesmo erro 400 (`categoria_sem_kit`) de hoje, sem
mudança de mensagem — o operador vê o mesmo aviso e escolhe outra categoria ou remove o override.
Falha ao resolver atributos genéricos (schema/IA) → **hard-block, não o comportamento de um
produto normal**: `atributosFaltantesGenerico` roda sobre os `faltantes` que
`resolverAtributosGenericos` devolveu (schema da categoria nova, `SALE_FORMAT` excluído — é
forçado por `aplicarKitNosAtributos` um passo depois) ANTES de criar qualquer linha; se listar
algo, a criação do kit é recusada com 400 (`motivo: 'atributos_faltantes'`), nenhuma família nasce.
Um produto normal segue pra Revisão com `atributos_faltantes` sinalizado e sem bloquear a
criação — mas o kit nunca passa por Revisão (D-3/D-4, ADR-0151: o preview do diálogo de criação É
a revisão), então esperar até lá pra pegar o faltante não existe; falha aqui, na criação, ou nunca
mais.

### 4. Dados

Nenhuma migration. `familias.categoria_ml_id`/`categoria_nome` (colunas já existentes) recebem o
valor do override em vez do clone da base. `kit_base_codigo_pai` continua apontando pra base sem
mudança — kit e base em categorias diferentes passa a ser um estado válido, não uma divergência a
alertar.

## Abordagens consideradas

1. **Esta (recomendada).** Reaproveita busca de categoria e resolução de atributos já existentes;
   zero mudança no caminho padrão; sem UI/estado novos além do necessário.
2. **Diálogo próprio de categoria com preview de atributos antes de confirmar.** Rejeitada: kit
   não passa por Revisão de propósito (D-2/D-4, ADR-0151 — "o preview do diálogo É a revisão");
   uma segunda etapa de revisão só pra este caso quebraria essa consistência sem ganho real.
3. **Resolver a categoria num "rascunho" de produto antes de criar o kit.** Rejeitada: indireção
   sem benefício sobre reaproveitar a resolução direto no fluxo de criação do kit.

## Fora de escopo (explicitamente, por pedido do Diego)

- Lembrar/sugerir a última categoria usada num produto-base pra próxima criação de kit — sempre
  volta a sugerir a categoria da base.
- Categoria diferente por tamanho de kit dentro da mesma submissão — uma categoria só, compartilhada.
- Qualquer mudança de categoria em kit **já publicado** (isso é sempre remover+recriar, padrão já
  estabelecido — trocar categoria de anúncio ativo é proibido, ver "O que nunca fazer" no
  CLAUDE.md do projeto e o incidente de re-moderação do Aquaphor, 2026-08-06).
- Generalizar pra outros produtos/famílias fora de kit vinculado — motivação é só este caso real
  agora; se aparecer outro caso, reavaliar então.

## Testes

- `criarKitsVinculados`: categoria override presente → schema/atributos resolvidos pra categoria
  NOVA (não a da base); categoria nova sem "Kit" → recusa alto igual hoje; categoria nova sem
  `NET_WEIGHT` no schema resolvido → não inventa o atributo (mesma trava, agora exercida também
  pelo caminho com override).
- Frontend (`dialog-criar-kit.test.tsx`): botão "Trocar categoria" abre a busca; selecionar uma
  categoria inclui `categoriaOverride` no payload de submissão; "×" remove o override do estado.
