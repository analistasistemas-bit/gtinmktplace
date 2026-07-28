# Republicação correta de tamanhos em User Products

## Objetivo

Publicar `TAM 01`, `TAM 02` e `TAM 03` como produtos distintos da mesma família, com seletor visível de tamanho no Mercado Livre, e recuperar o anúncio incorreto sem apagar os dados importados.

## Publicação

- Valores iniciados por `TAM` ou `TAMANHO` serão enviados como atributo personalizado `Tamanho`.
- Cores continuam usando `COLOR`.
- Em User Products, cada SKU permanece um item plano; o atributo diferente faz o Mercado Livre criar três User Products agrupados na mesma família.
- O `family_name` continua genérico e não inclui o tamanho.

## Recuperação

- Uma nova ação “Corrigir e republicar” pausa todos os itens-filhos do agrupamento atual.
- Depois de confirmar a pausa, preserva família, variações e imagens.
- Remove somente vínculos externos e campos de publicação, devolvendo a família ao estado de Revisão como `CREATE`.
- Nenhum dado local é limpo se algum item remoto não confirmar a pausa.

## Interface

- A Revisão usa “Variações pendentes” quando os valores não representam cores.
- Publicados identifica famílias User Products e mostra os SKUs/valores que compõem a publicação.

## Validação

- Teste vermelho/verde do payload plano com `TAM 01`.
- Teste vermelho/verde da recuperação preservando a família e limpando somente vínculos ML.
- Teste vermelho/verde da apresentação dos itens User Products.
- Validação manual após o deploy: três tamanhos disponíveis no anúncio republicado.

