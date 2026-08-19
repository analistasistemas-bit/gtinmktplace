# ADR-0126 — Calculadora Mercado Livre premium, API-first e sem persistência

- **Status:** aceito
- **Data:** 2026-08-19
- **Relacionados:** ADR-0014/0015 (Viabilidade), ADR-0050 (frete), ADR-0055 (imposto), ADR-0056 (credencial da operação)

## Contexto

A Viabilidade calculava concorrência de itens, mas não oferecia uma simulação financeira livre
para comparar anúncio Clássico e Premium antes do cadastro. A referência analisada reunia os
campos necessários, porém escondia três riscos: categoria ausente muda a comissão; frete não
calculado pode parecer zero; e resultados manuais podem ser confundidos com valores oficiais.

## Decisão

Adicionar uma modalidade **Calculadora ML** dentro de `/viabilidade`, com um motor financeiro puro
e independente da interface. Ela calcula as duas modalidades simultaneamente, custo total, lucro,
margem, peso cúbico, sensibilidades e preço necessário para uma margem-alvo.

A integração é **API-first com fallback explícito**:

1. categoria é opcional, mas sua ausência mantém um aviso visível e impede o selo oficial;
2. `buscar-categorias-ml` consulta o preditor usando a conexão da organização, somente com access
   token ainda válido, sem refresh ou escrita;
3. `calcular-tarifa-ml` fornece comissão e frete oficiais quando os dados são suficientes;
4. resultados são rotulados como `official`, `partial` ou `estimated`; frete desconhecido fica
   desconhecido e zero requer confirmação do operador;
5. selecionar produto cadastrado apenas preenche uma variação representativa e todos os campos
   continuam editáveis.

Simulações permanecem em memória. Não há tabela, mutation, telemetria de conteúdo ou alteração de
produto/estoque. A busca de categoria retorna no máximo oito sugestões e falha de modo degradado,
permitindo digitação manual.

## Consequências

- O operador distingue dado oficial de hipótese e consegue comparar modalidades sem planilha.
- A funcionalidade continua útil quando categoria, token ou API não estão disponíveis, com menor
  grau de confiança declarado na própria tela.
- Token vencido não é renovado pela busca opcional; a sessão precisa usar outro fluxo oficial de
  conexão antes de recuperar sugestões.
- A escolha automática de variação prioriza `skuUnico` e depois a primeira variação com dados
  úteis; outros cenários exigem ajuste manual.
- Não persistir simulações reduz superfície de dados e escopo multi-tenant, mas não oferece
  histórico nesta entrega.
