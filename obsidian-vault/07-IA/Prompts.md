---
tags: [ia, prompts]
atualizado: 2026-07-01
---

# Prompts de IA no produto

Prompts usados pelo backend para gerar conteúdo — não confundir com prompts de desenvolvimento
(Claude Code). Ver [[IA]], [[Processamento IA]].

## Copywriter (`_shared/ai/copywriter-prompt.ts`)

`SYSTEM` — instrui o modelo a atuar como copywriter de e-commerce para o Mercado Livre Brasil,
para **qualquer tipo de produto** (não hardcoded para aviamentos — adapta vocabulário ao produto
real informado no input). Gera título e descrição para um anúncio agrupado com várias
variações de cor.

`montarUserPrompt(input: InputCopy)` — monta o prompt de usuário com os dados concretos da
família (nome, atributos, cores, etc.).

## Categoria — desempate por LLM (`_shared/categoria/*`, `_shared/ai/categoria-llm*.ts`)

`montarPromptDesempate` — usado só quando override/preditor não resolvem a categoria; o LLM
escolhe entre candidatos já filtrados, nunca decide livremente.

## Atributos obrigatórios (`_shared/ai/atributos-llm*.ts`)

`montarPromptAtributos` — instrui o modelo a preencher atributos **closed-set**: a IA só pode
escolher um `value_id` de uma lista permitida vinda do schema do Mercado Livre, nunca texto
livre. Ver [[IA]] (por que closed-set).

## Vision (`_shared/ai/vision.ts`)

Usado como camada 2 (fallback) da resolução de cor, quando o dicionário de texto não resolve.
Ver [[Processamento IA]].

## Título de grade (ADR-0184, 2026-10-18)

O bloco `TÍTULO EM GRADE` do `SYSTEM` pede 3 slots novos: `publico`, `caracteristica` e
`caracteristica2`. O guard `titulo-grade.ts` então valida o público pelo gênero cadastrado,
ancora característica e material na fonte e remove os proibidos.

Na grade, o T6 se inverte: o título usa o espaço até perto de 60 caracteres, mas só com palavras
da fonte.

## Copy de grade (ADR-0183, 2026-10-17)

Família em grade usa o bloco `PRODUTO EM GRADE` do `SYSTEM` (`_shared/ai/copywriter-prompt.ts`),
que segue o guia "Descrição que facilita a compra".

- **O código insere:** o guia 📏 e a pergunta de tamanho.
- **O código remove:** 🎯, 📦 e qualquer bullet com medida.

A descrição nunca cita centímetros: as medidas de cada peça estão nas fotos.

## Princípio comum

Todos os prompts de produção são desenhados para **restringir** a liberdade do modelo (closed-
set, candidatos pré-filtrados, fallback determinístico) — a IA nunca decide sozinha um dado
crítico do anúncio sem grade de validação.
