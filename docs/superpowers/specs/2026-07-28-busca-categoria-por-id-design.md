# Busca de categoria do Mercado Livre por ID

## Objetivo

Permitir que o operador informe um ID de categoria no formato `MLB` seguido de números no seletor da Revisão, por exemplo `MLB270264`, e receba a categoria oficial como opção selecionável.

## Design

- A busca textual existente continua usando `domain_discovery`.
- Uma consulta que corresponda a `^MLB\d+$`, sem diferenciar maiúsculas de minúsculas, usa `GET /categories/{ID}`.
- A resposta direta é normalizada para o mesmo `CategoriaCandidata` usado pela interface.
- Categoria inexistente, resposta inválida ou falha de rede retorna uma lista vazia; a interface não oferece um ID não validado.
- Nenhuma mudança visual é necessária: o resultado oficial aparece na lista atual e só é aplicado quando o operador clica.

## Validação

- Teste unitário cobre normalização do ID e o resultado oficial `MLB270264 / Outros`.
- Teste unitário garante que texto comum não aciona a consulta direta.
- A suíte existente de descoberta de categorias e o TypeScript devem continuar passando.

