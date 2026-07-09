---
tags: [modulo, ia]
atualizado: 2026-07-01
---

# IA

IA aplicada ao pipeline via **OpenRouter** (gateway compatível com SDK OpenAI). Ver
[[Processamento IA]] (fluxo), `_shared/ai/*`.

## Onde a IA é usada

| Uso | Módulo | Observação |
|---|---|---|
| Copywriting (título/descrição) | `_shared/ai/copywriter.ts` | Regerável sem republicar (`regenerar-copy-familia`) |
| Vision — cor por foto | `_shared/ai/vision.ts` | Fallback da camada 1 (dicionário de texto) |
| Categoria (desempate) | `_shared/ai/categoria-llm*.ts` | LLM só desempata quando preditor/override não resolvem |
| Atributos obrigatórios (closed-set + numérico + texto-livre) | `_shared/ai/atributos-llm*.ts` | closed-set: escolhe `value_id` da lista; numérico e texto-livre: só aceitos se o valor (número ou palavras) constar no nome/descrição da fonte (ADR-0052 + adendo 2026-07-09 do ADR-0049, nunca inventa) |
| Título/metragem/cor no título | `_shared/ai/titulo.ts` | Ajuda a montar título dentro do limite do ML |
| Sugestão de resposta a pergunta | `sugerir-resposta-pergunta` | Sugere, **não envia** ao ML — resposta final é do operador |

## Fallback de atributos (Camada 2B, ADR-0052)

Quando a IA não resolve um obrigatório, ele fica em `familias.atributos_faltantes` e o operador
completa **inline na Revisão** (card de categoria): edge `atributos-familia` lista os faltantes com
schema e salva validando server-side. A publicação fica travada até resolver; a edição manual
(`atributos_editados_pelo_operador`) sobrevive ao reprocesso. Ver [[Processamento IA]].

## Custo

`familias.tokens_input`/`tokens_output` e `custo_centavos` registram o custo de **tokens de IA**
por família — não confundir com o custo real do produto (`variacoes.custo`). Ver [[Glossário]].

## Cache

Resolução de cor usa cache Redis (`cache:cor:*`, TTL 90d) para evitar rechamar IA para o mesmo
código já resolvido. Ver [[Backend]].

## Modelos

Configurados via secrets `OPENROUTER_API_KEY` + `AI_MODEL_*` (não versionados no código).
