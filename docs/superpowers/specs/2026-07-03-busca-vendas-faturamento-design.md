# Busca na aba Vendas do Faturamento

**Data:** 2026-07-03
**Status:** aprovado

## Problema

A aba Vendas do menu Faturamento não tem campo de busca. Para achar um pedido
específico (por cliente, produto ou valor) o operador precisa rolar/ordenar a
tabela manualmente.

## Escopo

- Só a aba **Vendas** (`src/components/faturamento/aba-vendas.tsx`). Devoluções,
  Perguntas e Geografia ficam de fora (decisão do usuário — Geografia é um
  agregado por UF/cidade, não uma lista de linhas pesquisável).
- Busca **client-side** sobre os pedidos já carregados (mesmo padrão do campo
  de busca de `src/pages/Publicados.tsx`), sem nova query ao Supabase.
- Não sincroniza com a URL (diferente de Publicados). Estado local, como o
  filtro de status de envio (`filtroEnvio`) que já existe na mesma tela.

## Campos pesquisados

Um único `Input` de texto livre casa (case-insensitive, `includes`) contra:

- Nome do comprador (`nomeExibicaoComprador`)
- Título e código de cada item do pedido (`itens[].titulo`, `itens[].codigo`)
- Número do pedido (`orderIds`, `chave`)
- Valor bruto e líquido do pedido, no mesmo formato exibido na tela
  (`fmtBRLSemSimbolo`, ex. "1.234,50") — não o `String(number)` cru, que o
  operador nunca vê na UI

## UI

- `Input` na barra de filtros existente (linha dos botões de período/origem),
  mesmo estilo (`h-7`, `text-xs`) para não destoar dos botões ao lado.
- O filtro de busca entra no mesmo pipeline que já existe:
  `pedidos` → filtro de busca → filtro de status de envio (`filtroEnvio`) →
  ordenação (`sort`). Os dois filtros combinam com AND.

## Estado vazio

Hoje a tabela só distingue "sem vendas no período" (mostra CTA de
Sincronizar). Quando a busca/filtro não encontra nada mas existem vendas no
período, mostrar uma mensagem diferente: "Nenhum pedido encontrado para essa
busca/filtro." — sem o CTA de sincronizar, que não faz sentido aqui.

## Fora de escopo

- Busca global entre abas.
- Busca em Devoluções, Perguntas, Geografia.
- Sincronização com URL/query string.
- Debounce (lista já está em memória, filtro é síncrono e barato).
