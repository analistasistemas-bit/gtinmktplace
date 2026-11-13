# Badges de kit e filtro por kits em Publicados — design

**Data:** 2026-11-13 · **Tamanho:** mudança pequena (só tela e leitura; sem migration, sem edge function)

## Intenção

Hoje, para saber se um produto tem kit feito pelo PubliAI, o operador precisa expandir a linha em
Publicados. O objetivo é ver isso com a linha fechada, por badge colorida por tipo de kit, com o
detalhe no hover, e poder filtrar a lista por kits.

## Objetivos

- Badge por tipo de kit na linha fechada: vinculado (ADR-0151), com variação (ADR-0200), virtual (ADR-0154).
- Hover mostra o tipo e quais kits são.
- Filtro "Kits" que traz o produto-base e os anúncios dos próprios kits (decisão do Diego, 13/11).

## Fora do escopo

- Qualquer escrita no ML ou mudança de regra de kit.
- Mudar os blocos "Kits vinculados" e "Kits com variação" da linha expandida (continuam como estão).
- Badge de kit em outras telas (Estoque, Revisão).

## O que faria isto falhar mesmo funcionando

- Deixar a tela mais lenta (uma consulta por linha).
- Badge que parece status (verde/amarelo/vermelho) e confunde com Ativo/Moderado.
- Quebrar links antigos com o filtro "Com kit de variação" na URL.

## Abordagens consideradas

1. **Badges na coluna do produto, na mesma linha do chip do canal (escolhida).** É a coluna de
   identidade, fica fixa no celular, aparece com a linha fechada e não cria coluna nova. A linha de
   Kit Virtual já usa uma pill nesse mesmo lugar.
2. **Coluna nova "Kits".** A tabela já tem mais de dez colunas; em notebook empurra a rolagem
   horizontal e a coluna fica vazia na maioria das linhas.
3. **Ícones junto das ações, à direita.** Mistura indicador com botão e fica longe do nome do produto.

Escolha: 1 (decisão do agente; o Diego delegou o posicionamento à skill de UI/UX).

## Desenho

### Badges

Posição: depois do chip do canal, na mesma linha, com quebra automática (`flex flex-wrap gap-1`).

```
v  Lápis de Cor Jumbo Hexagonal C/12 Cores Sortido
   02905205
   (ML Mercado Livre) [▣ Tem kit vinculado]
   [▣ Tem kit com variação] [▣ Compõe kit virtual]
```

| Tipo | Cor | Rótulo no produto-base | Rótulo no anúncio do kit |
|---|---|---|---|
| Kit vinculado | teal | `Tem kit vinculado` | `Kit ×N` |
| Kit com variação | violeta | `Tem kit com variação` | `Kit com variação` |
| Kit virtual | azul (`info`, já usado hoje) | `Compõe kit virtual` | `Kit Virtual` (como hoje, acima do título) |

- Produto-base: pill com fundo translúcido (cor a 10%) e ícone de kit. Uma pill por tipo, não por kit.
- Anúncio do próprio kit: mesma cor, fundo cheio, para diferenciar "tem kit" de "é kit".
- Cores fora da família de status (verde, amarelo, vermelho) de propósito.
- Contraste: `chart-3` como texto sobre o próprio fundo a 10% dá cerca de 2,2:1 no tema claro (medido
  pelo Codex nos tokens de `src/index.css`). Definir par fundo/texto por tema com no mínimo 4,5:1; os
  tokens `chart-*` servem de matiz, não de cor de texto.
- Estado dentro da pill, um só ícone, nesta prioridade: falha (alerta) > em montagem (giratório) > normal.
- O que acende, por tipo:
  - Vinculado: `FamiliaStatus` não tem "encerrado" (`src/lib/tipos-dominio.ts:33`). Acende enquanto a
    família do kit existir; `erro` = falha, `publicando` = montagem, `pronto` sem `ml_item_id` =
    "aguardando publicação" (repouso, sem giratório), `publicado` = normal. Havendo mais de uma família
    para a mesma base e multiplicador, vale a de `criadoEm` mais recente.
  - Com variação: `kits_variacao.status` encerrado não acende. Kit sem linha própria em Publicados
    ainda acende a base.
  - Virtual: só kits `publicado` (é o que `fetchPublicados` já lê). Componente com `codigo_pai` nulo é ignorado.
- Um anúncio pode ser kit e também ter ou compor outro kit: as duas pills aparecem.
- `Kit ×N` usa o multiplicador vindo do índice da consulta de vinculados (não existe em `PublicadoItem`).
- Hover (e foco por teclado): texto com o tipo e a lista. Exemplos:
  - "Kit vinculado: Kit 4 (ativo), Kit 6 (processando)"
  - "Kit com variação: Kit 3 · 00000250"
  - "Componente do kit virtual: <título do kit>"
  - No anúncio do kit: "Este anúncio é um kit vinculado de 02905205"
- Usar o `Tooltip` de `src/components/ui/tooltip.tsx` com gatilho focável (`button`), porque o
  `StatusPill` é um `span` sem foco. No toque, o detalhe continua disponível na linha expandida.
  Nunca só cor: o rótulo de texto fica sempre visível.

### Filtro

Um `Select` de `src/components/ui/select.tsx`, rótulo "Kits", ao lado do filtro "Tipo". Substitui o
botão "Com kit de variação".

Opções: Todos · Com qualquer kit · Kit vinculado · Kit com variação · Kit virtual · Sem kit.

- Cada opção de tipo traz o produto-base e o anúncio do kit.
- "Kit com variação" só aparece com o módulo `kit_variacao` ligado.
- Estado na URL como os outros filtros. O parâmetro antigo é `?comkit=1`
  (`src/lib/publicados-url.ts:56`): continua aceito e equivale a "Kit com variação"; se vier junto
  do parâmetro novo, o novo vence.
- Aparece em "Filtros ativos" com botão de remover (`ChaveFiltro` em
  `src/components/filtros-ativos.tsx:10` ganha a chave de kits).
- O filtro é aplicado antes da paginação, como os demais (`Publicados.tsx:1569`).
- "Sem kit" não pode confundir ausência com leitura que falhou: enquanto os kits carregam ou se a
  leitura falhar, o filtro de kits não esconde linhas e a tela avisa "Não foi possível ler os kits".
  Tipo de módulo desligado é tratado como inexistente.

### Dados

- **Vinculado:** uma consulta única para a tela (todas as famílias com `kit_multiplicador` não nulo
  da org, mesmo select de `fetchKitsDosProdutos`), agrupada por `kit_base_codigo_pai`. A leitura por linha expandida continua existindo.
- **Com variação:** já carregado por `useKitsVariacao`.
- **Virtual:** `fetchPublicados` já lê `kits_virtuais_componentes(codigo_pai)`; expor os códigos dos
  componentes no item do kit, sem consulta nova.
- Uma função pura em `src/lib/publicados.ts` monta, por `codigoPai`, quais tipos de kit o item tem
  ou é. Badge e filtro leem dessa mesma função.

## Revisão externa

Codex `gpt-6.1-sol` (effort high, somente leitura), 13/11: aprovar com ajustes. Os cinco ajustes
(alias `comkit`, regra de "encerrado", multiplicador e deduplicação, "Sem kit" × falha de leitura,
contraste e foco) foram conferidos no código e incorporados acima, junto com os rótulos mais explícitos.

## Ajustes feitos na execução (13/11)

- **Parâmetro da URL:** a tela já usava `?kit=<id>` como link do aviso de transferência travada. O
  filtro de kits ficou só em `comkit=<valor>` (`qualquer`, `vinculado`, `variacao`, `virtual`, `sem`);
  `comkit=1` antigo equivale a `variacao`. Não existe parâmetro novo separado.
- **Texto do hover no componente de kit virtual:** "Compõe o kit virtual: <título>".
- **Leitura dos kits vinculados:** paginada (`buscarTodasPaginas`), porque a tabela guarda histórico e
  o PostgREST corta em 1.000 linhas sem erro.
- **Cor do teal no tema claro:** `teal-800` (o `teal-700` media 4,47:1 sobre fundo `muted`).
- **Módulos ainda carregando:** tratado como leitura em andamento (índice indefinido, nada escondido).
- **Nome acessível da badge:** só o rótulo visível; o detalhe chega pelo tooltip.

## Fica com quem constrói

- Assinatura exata da função pura e do parâmetro de URL.
- Componente próprio (`badge-kit.tsx`) ou dentro de `Publicados.tsx`.

## Testes

- Unitário da função pura: base com cada tipo, anúncio que é kit, componente de kit virtual, sem kit.
- Unitário do filtro: as seis opções, mais o parâmetro antigo.
- Componente: pill certa por tipo e texto do hover.
- Fim de branch: validação visual em sessão isolada com print real.
