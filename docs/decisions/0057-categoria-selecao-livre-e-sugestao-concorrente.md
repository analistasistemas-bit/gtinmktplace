# ADR-0057 — Categoria de seleção livre (busca no preditor) + sugestão não-vinculante do concorrente

**Status:** Aceito
**Data:** 2026-07-03
**Decisores:** Diego
**Relaciona:** estende [ADR-0022](0022-categoria-cola-e-seletor-manual.md) (seletor manual — pendência nunca fechada),
[ADR-0026](0026-generalizacao-categorizacao-atributos-por-ia.md) (E3 — schema dinâmico/preditor),
[ADR-0051](0051-tipo-aviamento-derivado-da-categoria-do-preditor.md) (limite conhecido: "operador ainda não tem
seletor de categoria livre"), [ADR-0054](0054-categoria-titulo-tipo-produto-generico.md) (Fase 2 adiada: por que
a categoria do concorrente não pode ser aplicada automaticamente)

## Contexto

Investigação do caso real "BAINHA INSTANTÂNEA 4MT UND" (lote 51, mesma família do lote 50 do ADR-0054):
confirmado no banco que a família fica com `categoria_ml_id=null`, `tipo_aviamento='outro'`, `tipo_origem='manual'`
— o resolver automático está correto (nunca aceita "Outros" sozinho, ADR-0054), mas o escape hatch manual
(`CardCategoria` + `definir-categoria-familia`) só oferece 4 tipos fixos (`linha/fita/botao/cola`,
`CATEGORIAS_MANUAIS`). "Bainha" não é nenhum dos 4 — a família fica travada para sempre.

Essa lacuna está documentada desde o ADR-0022 (11/06) como pendência e nunca foi fechada: cada ADR seguinte
(0026, 0051, 0054) melhorou o resolver *automático* e deixou o escape *manual* intacto — o gargalo real sempre
foi o seletor manual.

Erro relatado em paralelo: a categoria do concorrente (já extraída em `_shared/concorrencia/parse.ts` como
`ofertas.category_id`) nunca chega ao operador — é descartada após o cálculo de preço. O ADR-0054 (Fase 2) já
testou aplicar essa categoria automaticamente **para esse mesmo produto** e o resultado foi uma categoria absurda
("Brinquedos de Pegadinhas", colisão de GTIN/catálogo entre concorrentes) — por isso nunca pode ser aplicada sem
confirmação humana.

## Decisão

1. **Busca livre substitui o seletor de 4 tipos.** `CardCategoria` ganha um campo de busca que chama
   `buscarCategoriaPreditor` (já existe, cacheado 30d no Redis) via uma nova ação `buscar-categoria` no edge
   function `atributos-familia` (já existente — reaproveita autenticação/RLS, não cria function nova). O operador
   digita, vê candidatos reais do ML e escolhe.
2. **`definir-categoria-familia` generaliza o contrato.** Passa a aceitar `{familia_id, categoria_ml_id,
   categoria_nome}` em vez de `{familia_id, tipo}`. Internamente resolve `tipoParaCategoria(categoria_ml_id)`
   (lookup reverso já existente): se a categoria escolhida bater num dos 4 tipos conhecidos, usa o caminho
   curado (`montarAtributosML`, zero mudança de comportamento); senão usa a nova função compartilhada
   `resolverAtributosGenericos` (extraída do branch genérico do `process-familia`, mesmo fluxo schema→IA→
   faltantes que já roda automaticamente hoje via preditor). **Decisão:** não manter o input `{tipo}` antigo —
   a busca livre já cobre linha/fita/botão/cola (aparecem nos resultados da própria busca) e o app tem
   frontend+backend num único deploy, sem consumidor externo do contrato antigo.
3. **Sugestão do concorrente, nunca automática.** Nova coluna `familias.concorrencia_categoria_id` persiste o
   `category_id` já obtido (hoje descartado) em `process-familia`. Na busca, se a família tiver essa coluna
   preenchida, o backend resolve o nome real da categoria (`GET /categories/{id}`, nova função
   `buscarNomeCategoria`, cacheada) e devolve como **sugestão destacada** — um card clicável junto aos
   resultados, nunca aplicado sem o operador clicar.
4. **Extração de `resolverAtributosGenericos`** evita duplicar a lógica de schema/atributos entre o fluxo
   automático (`process-familia`) e o manual (`definir-categoria-familia`) — mesmo princípio já usado no
   projeto (`definir-categoria-familia` já reusa `montarAtributosML` do `_shared` para não duplicar no
   frontend). Injeta `lerSchema`/`llm` como deps (mesmo padrão de `resolver.ts`), testável sem rede.

## Consequências

**Boas:**
- Fecha a classe de bug para **qualquer** produto fora dos 4 aviamentos conhecidos (não só bainha) — a busca
  aceita qualquer categoria real do ML, não uma lista fechada.
- Zero tabela nova além de 1 coluna aditiva; zero dependência nova.
- Sinal do concorrente deixa de ser jogado fora — vira ajuda visível, sem repetir o erro do ADR-0054 (nunca
  aceito às cegas).

**Tradeoffs aceitos:**
- Quebra de contrato do `definir-categoria-familia` (`{tipo}` → `{categoria_ml_id, categoria_nome}`) — aceitável
  por ser deploy único, sem consumidor externo.
- 1 chamada de rede a mais por busca (`domain_discovery` com a query do operador) — mesma característica das
  chamadas já existentes (cacheada, barata).
- Categorias genuinamente sem opção específica no ML (ex.: "Outros") continuam exigindo confirmação humana — não
  é regressão, é o comportamento correto já estabelecido no ADR-0054.

## Como reverter

`resolverAtributosGenericos` é só extração (mesmo comportamento do branch antigo do `process-familia` — reverter
= inline de volta). `definir-categoria-familia` e o front não têm caminho de rollback automático por não haver
consumidor do contrato antigo; reverter = checkout do commit anterior nos 2 arquivos.
