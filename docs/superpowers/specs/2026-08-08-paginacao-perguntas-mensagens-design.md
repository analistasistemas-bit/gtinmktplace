# Paginação e organização de Perguntas e Mensagens (Faturamento)

**Data:** 2026-08-08
**Origem:** pedido do Diego — as abas Perguntas e Mensagens de Faturamento despejam a lista inteira
numa página só, sem divisão, ao contrário do padrão já resolvido em
[Movimentos de estoque](2026-08-07-paginacao-movimentos-estoque-design.md). Este spec estende o
mesmo padrão (filtro + `<Pagination>`) às duas abas.

## Problema

- `AbaPerguntas`: `buscarPerguntas()` busca a tabela `ml_perguntas` inteira, sem `limit`. Cresce sem
  teto.
- `AbaMensagens`: `buscarConversas()` já tem um teto de 1000 mensagens (comentário no código: "paginação
  real se a aba crescer"), mas depois de agrupar por `pack_id` renderiza todas as conversas resultantes
  de uma vez.
- Nenhuma das duas tem rodapé de página, contagem de total ou filtro — é uma lista solta com `space-y-3`,
  sem o wrapper visual (cabeçalho + filtro + lista + rodapé) que a aba de estoque já usa.
- A ordenação atual ("pendente primeiro") só funciona porque a lista inteira está na tela. Com
  paginação, um item pendente pode cair numa página que o operador nunca abre.

## Decisões

| # | Decisão | Por quê |
|---|---------|---------|
| **D-1** | **Perguntas: paginação server-side**, mesmo padrão de `fetchMovimentosEstoque` (`.range()` + `count: 'exact'`). | `ml_perguntas` é tabela plana — o mesmo padrão se aplica sem mudança de forma. |
| **D-2** | **Mensagens: paginação client-side** sobre o array já agrupado por `buscarConversas()`. | Conversa é um agrupamento por `pack_id` feito em código, não uma linha de tabela. Paginar isso no banco exigiria uma view/RPC nova (migration + ADR) — fora de proporção para resolver "lista sem divisão". Registrado como débito abaixo. |
| **D-3** | **Abas de status substituem a ordenação implícita.** Perguntas: Pendentes / Respondidas / Todas. Mensagens: Aguardando / Todas. Pendentes/Aguardando é o default de cada aba. | Resolve o problema de origem (pendente sumindo em página 3) tornando o recorte explícito, igual ao filtro por grupo do estoque (D-5 daquele spec). |
| **D-4** | **Pendentes = `status === 'UNANSWERED'`** (perguntas) / **Aguardando = `aguardando === true`** (mensagens) — mesma regra que já existe hoje, só movida para filtro de query em vez de sort. | Zero mudança de comportamento para quem só olha a aba padrão. |
| **D-5** | **Trocar de aba de status ou de página reseta para página 1.** | Mesma razão do D-4 do spec de estoque: manter página 3 com 2 resultados mostra vazio falso. |
| **D-6** | **Exportar (Perguntas) continua puxando a lista inteira**, não só a página visível — via `buscarPerguntas()` existente, filtrada no cliente pela aba de status ativa antes de montar o relatório. | O botão já existia com essa semântica ("exportar os dados da tela"); truncar para 20 linhas seria regressão silenciosa. Mensagens não tem exportação hoje — fora de escopo. |
| **D-7** | **Mesmo wrapper visual do estoque**: card (`rounded-lg border bg-card p-3`) com cabeçalho, filtro de status, lista, rodapé `<Pagination>` — em vez do `space-y-3` solto atual. | É literalmente o pedido: "onde era pra ter divisão de página, assim como temos na movimentação de estoque". |
| **D-8** | **Estado em `useState` local**, não na URL. | Mesma razão do D-7 do spec de estoque — evita disputa de `searchParams` com o deep-link `?aba=` da própria página Faturamento. |
| **D-9** | **Sem migration.** `ml_perguntas` já tem índice por `(org_id/user_id, criada_em)` suficiente para `.range()` + filtro de status; confirmar no plano de implementação, mas nenhuma coluna/índice novo é esperado. | Igual ao D-9 do spec de estoque: a paginação server-side de Perguntas é leitura pura sobre dado que já existe. |

### Débito técnico registrado (D-2)

Mensagens paginado no cliente escala até o teto atual de 1000 mensagens (~algumas centenas de
conversas, dependendo do tamanho médio da conversa). Se isso um dia não bastar, o upgrade é uma view
agregada por `pack_id` (última mensagem, flag `aguardando`) + `fetchConversasPagina()` espelhando
`fetchPerguntasPagina` — mesma forma do D-1, exige migration e possivelmente ADR por ser mudança
estrutural (regra do CLAUDE.md do projeto). Não implementar agora — não foi pedido e o volume atual
não justifica.

## Arquitetura

```
src/lib/perguntas.ts              + fetchPerguntasPagina(pagina, tamanho, filtro) — busca paginada
src/lib/mensagens.ts              inalterado — buscarConversas() continua buscando tudo
src/lib/queries.ts                + QK.perguntasPagina(pagina, tamanho, filtro)
src/components/faturamento/aba-perguntas.tsx   passa a orquestrar estado + filtro de status + <Pagination>
src/components/faturamento/aba-mensagens.tsx   idem, com paginação client-side
```

`CardPergunta` e `CardConversa` não mudam — a mudança é só em como a lista ao redor deles é buscada,
filtrada e cortada em páginas.

### Contrato da busca (Perguntas)

```ts
export interface FiltroPerguntas {
  status?: 'pendentes' | 'respondidas' | null;   // null/ausente = todas
}

export interface PaginaPerguntas {
  itens: Pergunta[];
  total: number;
}

fetchPerguntasPagina(
  pagina: number,
  tamanho: number,
  filtro?: FiltroPerguntas,
): Promise<PaginaPerguntas>
```

Mesma resolução de nome do comprador que `buscarPerguntas()` já faz hoje (`nomesPorComprador`), aplicada
só aos itens da página — não à tabela inteira.

`pagina` é 1-based, offset `(pagina - 1) * tamanho`, `count: 'exact'` no mesmo round-trip — igual ao
padrão de estoque.

### Estado dos componentes

```ts
// AbaPerguntas
const [pagina, setPagina] = useState(1);
const [tamanho, setTamanho] = useState(20);
const [statusFiltro, setStatusFiltro] = useState<'pendentes' | 'respondidas' | 'todas'>('pendentes');

// AbaMensagens
const [pagina, setPagina] = useState(1);
const [tamanho, setTamanho] = useState(20);
const [statusFiltro, setStatusFiltro] = useState<'aguardando' | 'todas'>('aguardando');
```

Trocar `statusFiltro` ou `tamanho` reseta `pagina` para 1 (D-5).

Mensagens: `conversas` vem inteiro de `useListaMensagens()` como hoje; o componente filtra
(`aguardando` ou todas) e depois faz `.slice((pagina-1)*tamanho, pagina*tamanho)` sobre o array
filtrado — sem nova query.

### Reuso

- `<Pagination>` (`src/components/ui/pagination.tsx`) — mesmo componente do estoque, `rotuloItem="pergunta"` / `"conversa"`.
- `<Tabs>`/`<TabsList>`/`<TabsTrigger>` (`src/components/ui/tabs.tsx`) — já usado na página Faturamento
  para as 5 abas principais; reusado aqui, aninhado, para as abas de status. É outra instância de
  estado React — não há conflito com a `Tabs` externa.
- Badge de contagem nas abas de status: mesmo padrão visual do badge que já existe em
  `TabsTrigger` de "Perguntas"/"Mensagens" na página pai (bolha vermelha com número).

### Erros e bordas

| Situação | Comportamento |
|---|---|
| Aba "Pendentes"/"Aguardando" sem nenhum item | Empty state próprio: "Nenhuma pergunta pendente." / "Nenhuma conversa aguardando resposta." — distinto do empty state genérico "Nenhuma pergunta"/"Nenhuma mensagem" (mostrado só quando a lista toda, sem filtro, está vazia). |
| Responder uma pergunta/mensagem enquanto na aba "Pendentes"/"Aguardando" | Invalidação de query já existente some o item da lista (ele deixa de casar com o filtro); se a página ficar vazia e não for a 1ª, mesma regra do estoque — mas como o item some por invalidação (não por navegação), não precisamos resetar página automaticamente; se a página ficar vazia mostramos o empty state da aba mesmo com `pagina > 1` (evita um efeito colateral de resetar página durante o clique do usuário). |
| Falha na busca | Mensagem atual, preservada. |
| Total ≤ tamanho da página | `<Pagination>` não aparece; comportamento do componente já é esse. |

## Testes

Unidade (`src/lib/perguntas.ts`):
- offset e range corretos para `(pagina, tamanho)`
- filtro `pendentes` manda `status=UNANSWERED`; `respondidas` manda `status<>UNANSWERED` (ou equivalente); `todas`/ausente não filtra
- nomes de comprador resolvidos só para os itens da página

Componente (`aba-perguntas.tsx`, `aba-mensagens.tsx`):
- total aparece no rodapé de paginação
- trocar de aba de status volta para a página 1
- trocar tamanho de página volta para a página 1
- aba "Pendentes"/"Aguardando" mostra só os itens que casam
- exportar (Perguntas) inclui itens fora da página atual (usa a busca completa, não a paginada)
- empty state da aba de status é diferente do empty state genérico

Visual: validar no app rodando — abas de status, troca de página, wrapper visual igual ao de
Movimentos de estoque.

## O que sai

O `space-y-3` solto atual (lista sem cabeçalho, sem filtro, sem rodapé) é substituído pelo wrapper
com cabeçalho + abas de status + lista + `<Pagination>`.

## Fora do escopo

Busca por texto/cliente/pedido, paginação server-side de Mensagens (view/RPC nova — ver débito
técnico D-2), estado na URL, exportação de Mensagens. Nenhum foi pedido; entram depois se o uso
mostrar necessidade.
