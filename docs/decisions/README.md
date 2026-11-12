# ADRs — Architecture Decision Records

Esta pasta contém o registro de decisões arquiteturais do PubliAI. Cada ADR documenta **uma decisão**, o **contexto** em que foi tomada, **alternativas consideradas**, e **consequências** (positivas e negativas).

## Por que ADRs?

Decisões técnicas têm meia-vida curta na memória das pessoas. Em 6 meses, ninguém vai lembrar por que escolhemos QStash em vez de uma fila no Postgres — mas o ADR vai. Isso evita re-debate eterno e ajuda novos colaboradores (ou seu eu do futuro) a entender o "porquê".

## Formato

Cada ADR segue este formato compacto:

```markdown
# ADR-XXXX: Título curto e direto

**Status:** Aceito | Em proposta | Substituído por ADR-YYYY | Obsoleto
**Data:** YYYY-MM-DD
**Decisores:** quem decidiu

## Contexto
Qual problema/situação? Quais forças estão em jogo?

## Decisão
O que decidimos fazer? Em uma ou duas frases diretas.

## Alternativas consideradas
- Opção A: pros / cons / por que não escolhemos
- Opção B: pros / cons / por que não escolhemos

## Consequências
- Boas: ...
- Ruins / tradeoffs aceitos: ...
- Como reverter, se for o caso
```

## Quando criar um novo ADR?

- Quando você for tomar uma decisão **não-óbvia** que afeta arquitetura, stack, ou processo
- Quando você for **substituir** uma decisão anterior (criar novo ADR e marcar o antigo como "Substituído por")
- Quando alguém da equipe perguntar "por que fizemos isso?" e você não tiver onde apontar

## Numeração

ADRs são numerados sequencialmente (0001, 0002, ...) e **nunca são renumerados**. Mesmo que um ADR seja obsoletado, ele fica aqui — só muda o status.

> **Exceção única (2026-06-27):** houve uma *colisão* de numeração — dois ADRs com `0035` e dois com `0037` (erro de criação, não um ADR settled a renomear). Para restaurar a invariante "1 número → 1 ADR", os de menor impacto de referência foram renumerados: `0035-cor-no-titulo-mono-cor` → **0044** e `0037-vendas-catalogo-match-ean` → **0045**. Isso resolve a ambiguidade e **não** é precedente para renumerar ADRs válidos.

## Lista atual

Veja o [README principal](../README.md#onde-encontrar-o-quê) para a tabela completa dos ADRs vigentes.
- [ADR-0187](0187-ncm-validado-na-tabela-oficial.md) — NCM validado na tabela oficial (Siscomex).
- [ADR-0190](0190-notificacao-gerencial-de-venda-e-comandos-telegram.md) — Notificação gerencial de venda, resumo diário e comandos no Telegram (proposto).
- [ADR-0191](0191-produto-unico-pai-vazio.md) — Produto único na planilha: `PAI` vazio sem filhos vira anúncio de 1 SKU (emenda ADR-0013).
- [ADR-0192](0192-posvenda-ml-acoes.md) — Pós-venda do ML: ações de escrita (revisão, reclamação, mensagem), trava anti-duplicação e leitura sincronizada (proposto).
- [ADR-0194](0194-sugestoes-de-promocao.md) — Sugestões de promoção: duas faixas por vendas e visitas, por produto, ordem por Oportunidade, dispensa por 30 dias (aceito).
- [ADR-0195](0195-confirmacao-no-canal-e-divisao-por-estoque.md) — `publicado` exige escrita real, confirmação no canal e divisão de anúncio por estoque com aprovação do operador.
- [ADR-0196](0196-alterar-preco-em-publicados-com-oferta-e-atacado.md) — Alterar preço em Publicados: base muda sem sair da promoção se ficar acima da oferta; oferta e atacado na mesma tela (proposto).
- [ADR-0197](0197-tabela-oficial-cest.md) — Tabela oficial de CEST: quando o XML não traz CEST, a entrada por nota preenche o candidato único por NCM completo e mostra os demais para escolha; a declaração segue obrigatória sem candidato.
- [ADR-0198](0198-identidade-do-produto-no-titulo.md) — Identidade do produto no título: nome comercial em `modelo`, conector não é cor, produto simples sem cor, conferência na Revisão.
- [ADR-0199](0199-tirar-familia-da-revisao.md) — Tirar uma família da Revisão: edge `excluir-familia`, só não publicada em `pronto`/`erro`, recusa se for a única linha de um anúncio vivo no ML.
- [ADR-0193](0193-relatorio-mensal-do-cliente-e-fechamento-automatico.md) — Relatório mensal do cliente (PDF de prestação de contas), fechamento automático no dia 01 e Central premium (aceito).
- [ADR-0200](0200-kit-com-variacao.md) — Kit com variação: página única no ML, estoque separado e escrita de quantidade só com anúncio pausado (aceito, em implementação).
- [ADR-0202](0202-atributos-visuais-pela-foto.md) — Atributos visuais de roupa (Tipo de manga, caimento, gola, capuz) preenchidos pela foto, só closed-set, marcados "confira" na Revisão.
- [ADR-0203](0203-galeria-imagem-inteira-do-gerador.md) — Galeria da cor: imagem inteira do gerador, planejada por IA (plano com paleta e 7 imagens), conferência de texto por visão e aviso de imagens prontas; substitui roteiro editável, fatos em tela, texto em canvas e lupa do ADR-0201.
