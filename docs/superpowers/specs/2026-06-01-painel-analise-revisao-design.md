# Painel de Análise no topo do anúncio (tela de Revisão) — Design

**Data:** 2026-06-01
**Autor:** Diego (brainstorming) + agente
**Status:** Aprovado (design)
**Relacionado:** consome dados de [ADR-0008](../../decisions/0008-estrategia-de-preco-condicional.md) (estratégia de preço), [ADR-0014](../../decisions/0014-busca-de-concorrencia.md) (concorrência) e [ADR-0009](../../decisions/0009-campos-payload-ml-e-categoria-deterministica.md) (categoria/atributos)

## Problema

Na tela de Revisão, as informações de **estratégia de preço, concorrência e categoria** ficam
no **final** do painel expandido — espremidas na coluna esquerda, abaixo de título/descrição,
como texto corrido. Quem revisa precisa rolar até o fim e ler linha a linha para avaliar a
família. Diego pediu que essas informações apareçam **no topo**, de forma **mais visual**, ao
lado da foto-capa (área hoje vazia à direita no topo do expandido).

## Objetivo

Criar um **Painel de Análise** visual no topo do painel expandido, à direita da foto-capa, que
permita ao operador bater o olho e decidir sobre a família sem rolar nem decifrar texto corrido.

## Componente novo: `PainelAnalise`

Arquivo: `src/components/painel-analise.tsx`. Props: `{ familia: Familia }`. Puro de
apresentação — lê apenas campos já presentes no tipo `Familia` (sem novas queries).

Renderiza um card "Análise para publicação" com 4 elementos, cada um com ícone + cor semântica:

| Elemento | Ícone (lucide) | Conteúdo | Cor |
|---|---|---|---|
| **Estratégia** | `Coins` | badge `PRÓPRIO`/`COMPETITIVO` + `estrategiaMotivo` | PRÓPRIO=azul, COMPETITIVO=âmbar |
| **Categoria** | `Tag` | nome amigável + `categoriaMlId`; se indefinida → "Categoria indefinida — escolha antes de publicar" | definida=neutro, indefinida=vermelho |
| **Concorrência** | `Store` | badge da classe + `N vendedores` + `menor preço R$ X`; classe `sem`→"sem concorrência"; origem `titulo`→sufixo "baixa confiança (sem EAN)" | sem=cinza, moderada=azul, alta=âmbar |
| **Alerta preço perigoso** | `AlertTriangle` | faixa só quando `precoAbaixo20pc` | vermelho |

Helper interno `nomeCategoriaAmigavel(tipo)`:
- `linha` → "Fios e Cadarços"
- `fita` → "Fita de Cetim"
- `botao` → "Botões"
- `outro`/null → "—"

### Cores semânticas (Tailwind, classes do tema)

- Azul: `bg-blue-50 text-blue-700 border-blue-200` (PRÓPRIO, concorrência moderada)
- Âmbar: `bg-amber-50 text-amber-700 border-amber-200` (COMPETITIVO, concorrência alta)
- Cinza/neutro: `bg-muted text-muted-foreground` (sem concorrência, categoria neutra)
- Vermelho: `text-destructive` + `border-destructive/30 bg-destructive/5` (alerta/indefinida)

## Mudanças em `familia-expanded.tsx`

1. Reestruturar o bloco do topo: hoje é `[foto-capa + botões]` com `border-b`. Passa a ser um
   flex `[foto-capa + botões]  [PainelAnalise (flex-1)]` lado a lado, mantendo o `border-b`.
2. **Remover** o bloco de texto de estratégia/concorrência/categoria que hoje fica no final da
   coluna esquerda (foi adicionado nos blocos de preço e categoria).
3. **Remover** o alerta de preço perigoso solto do topo (linhas com `precoAbaixo20pc`) — passa a
   viver dentro do `PainelAnalise`.
4. Layout responsivo: em telas estreitas, foto e painel empilham (flex-col em `sm:`, flex-row
   acima). Mantém o resto (grid título/variações) intacto.

## Dados consumidos (já existentes no tipo `Familia`)

`estrategiaPreco`, `estrategiaMotivo`, `concorrencia`, `concorrenciaVendedores`,
`concorrenciaPrecoMin`, `tipoAviamento`, `categoriaMlId`, `precoAbaixo20pc`. Nenhum campo novo
no schema, adapter ou backend. É mudança puramente de frontend/apresentação.

## Testes

Teste de componente (`tests/components/painel-analise.test.tsx`) cobrindo:
- Estratégia PRÓPRIO e COMPETITIVO (badge correto)
- Concorrência `sem` (mostra "sem concorrência") e `alta` (mostra vendedores + menor preço)
- Categoria definida (nome amigável + id) e indefinida (alerta vermelho)
- Alerta de preço perigoso aparece só quando `precoAbaixo20pc`

## Fora de escopo

- Cabeçalho colapsado (`FamiliaRow`): mantido como está (CREATE + preço + ícone de alerta).
  Diego optou por concentrar a análise no painel expandido.
- Escolha manual de categoria quando indefinida (dropdown): fica para o bloco de publicação/M5;
  aqui apenas sinalizamos.
- Nenhuma mudança em backend, schema ou edge functions.
