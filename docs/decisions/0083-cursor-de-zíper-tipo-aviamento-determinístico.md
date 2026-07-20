# ADR-0083 — "Cursor" (deslizador de zíper) como 5º tipo de aviamento determinístico

**Status:** Aceito
**Data:** 2026-07-20
**Decisores:** Diego
**Relaciona:** estende [ADR-0009](0009-campos-payload-ml-e-categoria-deterministica.md) (override regex por
tipo de aviamento), [ADR-0051](0051-tipo-aviamento-derivado-da-categoria-do-preditor.md) (mesma classe de
bug: tipo↔categoria descasados), [ADR-0054](0054-categoria-titulo-tipo-produto-generico.md) (desempate por
IA sempre que sobra ≥1 candidato específico)

## Contexto

Lote #36: 4 famílias de "cursor" (deslizador de zíper, sem trava). Nenhuma bate no dicionário regex de
`detectar.ts` (só cobre `linha/fita/botao/cola`), então todas caem no preditor nativo do ML.

Investigação (chamadas reais à API do ML + cache Redis de produção, não hipotética):

- O preditor (`domain_discovery`) devolveu, para as 4 famílias, **um único candidato específico**:
  `MLB271227` — "Zíperes". Confirmado correto e sem ambiguidade nos 4 casos.
- 2 famílias (`CURSOR N.3 ...`) publicaram com a categoria certa (`origem: preditor`).
- 2 famílias (`CURSOR N.5 ...`) caíram em `MLB1371` "Outros" (`origem: generico`).

A diferença não está no preditor (candidato idêntico e correto nos 4 casos) — está na camada de desempate
por IA (`categoria-llm.ts`, ADR-0054), que roda mesmo com um único candidato específico (desenho proposital
pra rejeitar falso-amigos, ex.: "bainha instantânea" → só achava "Bainhas para Facas", errado). Para as 2
famílias N.5, a IA abstraiu (`category_id: null`) um candidato que era o correto — falso-negativo do modelo,
não o cenário que o ADR-0054 endereça (candidato genuinamente errado). Risco aceito e conhecido do desenho:
cada chamada de IA tem taxa de erro não-zero, mesmo em casos fáceis.

"Cursor" (deslizador de zíper) é produto recorrente do catálogo (as 4 famílias do lote inteiro), com
categoria-folha do ML inequívoca e única (`MLB271227`) — exatamente o perfil que já motivou os overrides
existentes (`linha/fita/botao/cola`, ADR-0009): tipo bem definido, sem ambiguidade de categoria, alto volume.

## Decisão

1. **`cursor`/`cursores` entram como 5º `TipoAviamento`** em `detectar.ts`, com override regex direto —
   bypassa preditor + IA de desempate por completo para esse tipo (mesmo padrão de `linha/fita/botao/cola`).
2. **Categoria-folha:** `MLB271227` — "Zíperes" (validado via API real, 2026-07-20).
3. **Obrigatórios curados:** `BRAND` + `MODEL` — validado via API real (`GET /categories/MLB271227/attributes`),
   idêntico ao branch já existente pra `linha`/`cola` em `montarAtributosML`/`OBRIGATORIOS`.
4. **`MLB271227` entra em `CATEGORIAS_COM_EMPTY_GTIN_REASON`** — validado via API real que a categoria expõe
   o atributo (mesmo padrão de `linha/fita/cola`).
5. **Espelhado no front** (`tipos-dominio.ts`, `categoria.ts` (`CATEGORIAS_MANUAIS`), `publicados.ts`
   (`NOME_TIPO`)) — mesmo contrato de tipo compartilhado nominalmente entre back/front (não é import
   compartilhado; os dois lados têm sua própria cópia do union type e precisam ficar em sincronia manual,
   como já é o caso pros 4 tipos existentes).

## Consequências

**Boas:**
- Cursor de zíper nunca mais depende do desempate por IA — elimina a classe de falso-negativo pra esse tipo.
- Segue o padrão já estabelecido (ADR-0009/0051), sem introduzir mecanismo novo.

**Tradeoffs aceitos:**
- Mais um tipo pra manter em sincronia manual entre `detectar.ts`/`atributos.ts` (backend) e
  `tipos-dominio.ts`/`categoria.ts`/`publicados.ts` (frontend) — mesmo custo de manutenção que os 4 tipos
  existentes já têm.
- Não resolve o problema geral do ADR-0054 (IA de desempate pode abstrair errado com 1 candidato) — só fecha
  a exposição pra este tipo específico, como os overrides anteriores fizeram pros deles.

## Como reverter

Remover `cursor` de `REGRAS` (`detectar.ts`), `ROTULO_POR_TIPO`/`CATEGORIA_POR_TIPO`/`OBRIGATORIOS`/
`montarAtributosML` (`atributos.ts`), `CATEGORIAS_COM_EMPTY_GTIN_REASON`, e os espelhos do front. Sem override,
"cursor" volta a cair no preditor + desempate por IA (comportamento anterior).
