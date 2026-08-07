# Paginação e filtros da lista de movimentos de estoque

**Data:** 2026-08-07
**Origem:** incidente do mesmo dia — a aba Movimentos do protetor solar (`00000004`) mostrava só
vendas. Causa imediata: a lista buscava os 20 movimentos mais recentes e as duas entradas estavam nas
posições 37 e 56. O fix daquele momento subiu a página para 100 e acrescentou "Carregar mais", o que
resolve 56 movimentos e não resolve 956: empilhar linhas não é navegar por um ledger.

## Problema

O ledger cresce para sempre. Um produto vendendo 15 unidades/dia acumula ~5.000 movimentos por ano.
A lista atual só sabe fazer uma coisa — mostrar os N mais recentes — e as três perguntas que o
operador faz de fato exigem recorte, não rolagem:

1. **Conferir as entradas** — quanto entrou, quando, com que custo.
2. **Auditar o saldo** — seguir a conta e achar onde o número desandou.
3. **Investigar um caso** — uma venda de um dia, um estorno, um SKU que não bateu.

Nenhuma delas é respondida por "os 100 mais recentes".

## Decisões

| # | Decisão | Por quê |
|---|---------|---------|
| **D-1** | **Paginação server-side** com `.range()` + `count: 'exact'`, uma query por página. | O ledger não cabe no cliente. `count` exato é barato no volume real (milhares por produto) e é o que permite exibir o total. |
| **D-2** | **O total é sempre visível** (`1-20 de 956 movimentos`). | É a trava contra o defeito de origem. Uma lista cortada em silêncio parece o histórico inteiro; o total denuncia o corte sem o operador precisar rolar. |
| **D-3** | **Default: tudo, sem filtro de data.** Página 1 = mais recentes. | Um default de "30 dias" recriaria o bug — a entrada inicial de um produto parado há dois meses sumiria de novo, e a aba abriria vazia. O período é filtro opcional, nunca pré-aplicado. |
| **D-4** | **Filtros: tipo, período, SKU** — combináveis; qualquer mudança volta para a página 1. | Foram os três recortes que o operador pediu. Manter a página ao trocar de filtro mostraria "página 3 de 1" e uma lista vazia. |
| **D-5** | **Os 7 motivos viram 3 grupos** na UI (Entradas / Vendas / Estornos). | `venda_sku_nao_encontrado` e `venda_cancelada_antes` são variações de venda para quem audita. Sete chips seriam ruído; o motivo exato continua escrito em cada linha. |
| **D-6** | **Inline no card**, não em página nova nem drawer. | O painel já existe e serve tanto o Estoque quanto o expandir do Publicados. Uma rota nova tiraria o operador da tela onde ele estava e duplicaria navegação por nada. |
| **D-7** | **Estado em `useState` local**, não na URL. | O painel vive dentro de uma linha expansível, e o Publicados já usa a URL para os filtros dele. Dois donos do mesmo `searchParams` brigariam. |
| **D-8** | **Ordem alternável pela coluna Data**, default mais recente primeiro. | Auditar um saldo é seguir a conta de cima para baixo; sem inverter, o começo do histórico fica na última página. |
| **D-9** | **Sem migration.** | `estoque_movimentos_org_pai_idx (org_id, codigo_pai, criado_em DESC)` e `estoque_movimentos_org_codigo_idx (org_id, codigo, criado_em DESC)` já existem e servem paginação, filtro por SKU e as duas ordens. |

### Grupos de motivo (D-5)

| Chip | Motivos do ledger |
|---|---|
| Entradas | `entrada` |
| Vendas | `venda`, `venda_sku_nao_encontrado`, `venda_cancelada_antes` |
| Estornos | `estorno_venda`, `estorno_sku_nao_encontrado`, `cancelamento_sem_baixa` |

`Todos` não manda filtro de motivo — é ausência de recorte, não a união dos três grupos. A distinção
importa se um motivo novo for adicionado ao ledger: em `Todos` ele aparece; nos grupos, não, até ser
classificado aqui.

## Arquitetura

```
src/lib/movimentos-estoque.ts          leitura + filtros + total (o mapa grupo→motivos vive aqui)
src/components/estoque/filtros-movimentos.tsx   barra de filtros (arquivo novo)
src/components/movimentos-estoque.tsx  orquestra estado, compõe filtros + lista + <Pagination>
```

A escrita continua fora daqui: toda mudança de saldo passa por RPC via edge com `service_role`
(ADR-0094, D-15), e a escrita direta em `variacoes.estoque` é bloqueada por trigger (D-20). Este
caminho é só leitura.

### Contrato da busca

```ts
export interface FiltroMovimentos {
  grupos?: GrupoMotivo[];      // vazio/ausente = todos
  periodo?: Janela | null;     // null = todo o período (default)
  codigo?: string | null;      // SKU da variação; null = todas
  ordem?: 'recentes' | 'antigos';
}

export interface PaginaMovimentos {
  itens: MovimentoEstoque[];
  total: number;
}

fetchMovimentosEstoque(
  codigoPai: string,
  pagina: number,
  tamanho: number,
  filtro?: FiltroMovimentos,
): Promise<PaginaMovimentos>
```

`pagina` é 1-based (como `paginar()` no resto do app). O offset é `(pagina - 1) * tamanho`.

O `count` vem no mesmo round-trip (`select(..., { count: 'exact' })`), então a lista nunca fica com
total defasado em relação às linhas que está mostrando.

### Estado do componente

```ts
const [pagina, setPagina] = useState(1);
const [tamanho, setTamanho] = useState(20);
const [grupos, setGrupos] = useState<GrupoMotivo[]>([]);   // [] = Todos
const [periodo, setPeriodo] = useState<Periodo | null>(null);
const [codigo, setCodigo] = useState<string | null>(null);
const [ordem, setOrdem] = useState<'recentes' | 'antigos'>('recentes');
```

Query key: `QK.movimentosEstoquePagina(codigoPai, pagina, tamanho, filtro)`. O prefixo
`QK.movimentosEstoque(codigoPai)` continua existindo e continua alcançando todas as páginas — é por
ele que o `dialog-entrada` invalida a lista depois de registrar uma entrada.

### Reuso

- `<Pagination>` (`src/components/ui/pagination.tsx`) — já tem janela de páginas com elipse e
  seletor de tamanho. Passa `rotuloItem="movimento"`.
- `<SeletorPeriodo>` (`src/components/ui/seletor-periodo.tsx`) — o componente aceita `Periodo`; a
  opção "Todo o período" (nosso `null`) é acrescentada no wrapper de filtros, não dentro dele.
- `resolverJanela()` (`src/lib/metricas.ts`) — converte `Periodo` em `{ desde, ate }` ISO.

### Erros e bordas

| Situação | Comportamento |
|---|---|
| Filtro deixa 0 resultados | "Nenhum movimento com esses filtros." + ação para limpar. Distinto de "produto sem movimento". |
| `pagina` maior que o total após um filtro | Não acontece: toda mudança de filtro reseta para 1 (D-4). |
| Falha na busca | Mensagem atual, preservada. |
| Produto com 1 variação | O filtro de SKU não é renderizado. |
| Total ≤ tamanho da página | O `<Pagination>` não aparece; o total continua escrito. |

## Testes

Unidade (`src/lib/`):
- cada grupo mapeia para os motivos certos; `Todos` não manda filtro de motivo
- offset e range corretos para `(pagina, tamanho)`
- período e SKU entram na query só quando presentes

Componente (`tests/components/movimentos-estoque.test.tsx`):
- o total aparece no rodapé
- filtrar por Entradas mostra as entradas de um produto com centenas de vendas — o caso do incidente
- mudar qualquer filtro volta para a página 1
- inverter a ordem refaz a busca com `ordem: 'antigos'`
- filtro sem resultado mostra o vazio próprio, não o de "produto sem movimento"
- SKU só aparece com mais de uma variação
- a invalidação pela chave-prefixo recarrega a lista (regressão do `dialog-entrada`)

Visual: validar no app rodando — filtros, troca de página e o total, com dado real do protetor solar.

## O que sai

O botão **Carregar mais** e o aviso "Mostrando os N mais recentes" (commits `b1570ec0`/`e07a2141`)
são substituídos pela paginação — acumular páginas numa lista só é o problema que esta spec resolve.
O `PASSO = 100` some; o tamanho passa a ser escolha do operador (default 20).

## Fora do escopo

Busca por documento/pedido, exportar CSV, estado na URL. Nenhum foi pedido; entram depois se o uso
mostrar necessidade.
