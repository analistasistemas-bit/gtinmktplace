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
   (ML Mercado Livre) [▣ Vinculado] [▣ Variação] [▣ Virtual]
```

| Tipo | Cor | Rótulo no produto-base | Rótulo no anúncio do kit |
|---|---|---|---|
| Kit vinculado | teal (`chart-3`) | `Vinculado` | `Kit ×N` |
| Kit com variação | violeta (`chart-2`) | `Variação` | `Kit variação` |
| Kit virtual | azul (`info`, já usado hoje) | `Virtual` (produto é componente) | `Kit Virtual` (como hoje) |

- Produto-base: pill com fundo translúcido (cor a 10%) e ícone de kit. Uma pill por tipo, não por kit.
- Anúncio do próprio kit: mesma cor, fundo cheio, para diferenciar "tem kit" de "é kit".
- Cores fora da família de status (verde, amarelo, vermelho) de propósito.
- Kit em montagem: ícone giratório dentro da pill. Kit com falha: ícone de alerta. Kit encerrado não acende.
- Hover (e foco por teclado): texto com o tipo e a lista. Exemplos:
  - "Kit vinculado: Kit 4 (ativo), Kit 6 (processando)"
  - "Kit com variação: Kit 3 · 00000250"
  - "Componente do kit virtual: <título do kit>"
  - No anúncio do kit: "Este anúncio é um kit vinculado de 02905205"
- Usar o `Tooltip` de `src/components/ui/` se existir; senão `title` + `aria-label`. Nunca só cor:
  o rótulo de texto fica sempre visível.

### Filtro

Um `Select` de `src/components/ui/select.tsx`, rótulo "Kits", ao lado do filtro "Tipo". Substitui o
botão "Com kit de variação".

Opções: Todos · Com qualquer kit · Kit vinculado · Kit com variação · Kit virtual · Sem kit.

- Cada opção de tipo traz o produto-base e o anúncio do kit.
- "Kit com variação" só aparece com o módulo `kit_variacao` ligado.
- Estado na URL como os outros filtros; o parâmetro antigo de `somenteComKitVariacao` continua
  sendo aceito e equivale a "Kit com variação".
- Aparece em "Filtros ativos" com botão de remover.

### Dados

- **Vinculado:** uma consulta única para a tela (todas as famílias com `kit_multiplicador` não nulo
  da org), agrupada por `kit_base_codigo_pai`. A leitura por linha expandida continua existindo.
- **Com variação:** já carregado por `useKitsVariacao`.
- **Virtual:** `fetchPublicados` já lê `kits_virtuais_componentes(codigo_pai)`; expor os códigos dos
  componentes no item do kit, sem consulta nova.
- Uma função pura em `src/lib/publicados.ts` monta, por `codigoPai`, quais tipos de kit o item tem
  ou é. Badge e filtro leem dessa mesma função.

## Fica com quem constrói

- Assinatura exata da função pura e do parâmetro de URL.
- Quais status de família contam como "encerrado" no kit vinculado (conferir no código antes).
- Componente próprio (`badge-kit.tsx`) ou dentro de `Publicados.tsx`.

## Testes

- Unitário da função pura: base com cada tipo, anúncio que é kit, componente de kit virtual, sem kit.
- Unitário do filtro: as seis opções, mais o parâmetro antigo.
- Componente: pill certa por tipo e texto do hover.
- Fim de branch: validação visual em sessão isolada com print real.
