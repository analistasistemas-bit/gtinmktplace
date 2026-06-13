# ADR-0026: Generalização da categorização e atributos por IA (taxonomia canônica + híbrido)

**Status:** Proposto (stub — detalhar no início dos épicos E3/E4)
**Data:** 2026-06-13
**Decisores:** Diego
**Relaciona:** [evolução SaaS multicanal](../superpowers/specs/2026-06-13-evolucao-saas-multicanal-design.md) (E3/E4); estende ADR-0009/0022 (categoria determinística)

## Contexto

A categorização atual é determinística por nicho (regex `linha|fita|botão|cola` → categoria MLB fixa +
atributos hard-coded). Funciona porque o domínio é fechado (aviamentos). Para vender "qualquer produto de
qualquer segmento" é preciso generalizar sem perder a precisão atual e sem alucinar atributos.

## Decisão (direção) — arquitetura híbrida em 4 camadas

1. **Taxonomia canônica** interna como pivô (base: Shopify Standard Product Taxonomy, aberta) +
   `mapping_categoria_canal` por marketplace (resolve o problema N×M).
2. **Resolução de categoria:** (a) override determinístico por vertical (regex atual vira registro
   plugável); (b) preditor nativo do canal (ML `domain_discovery`, 400 req/min); (c) LLM texto+Vision como
   desempate em baixa confiança.
3. **Schema de atributos dinâmico:** ler `/categories/{id}/attributes` (ML) / Product Type Definitions
   (Amazon) por categoria, cacheado — não hard-coded por tipo.
4. **Preenchimento + validação:** LLM extrai valores escolhendo **dentro da lista permitida** (closed-set);
   validação contra os `required` + correção fuzzy (padrão Shopify, <2%); defaults seguros (ex.:
   `IS_DOUBLE_FACE='Não'`). Overrides por vertical preservados → aviamentos sem regressão.

Revisão humana obrigatória continua sendo o gate final; `tipo_origem` ('regex'|'ia'|'manual') + confiança
registrados; correções do operador vão para fila humana (não auto-treino).

## Questões em aberto

- Qual taxonomia canônica adotar (Shopify vs Google Product Category vs GS1 GPC).
- Idioma/endpoint do preditor ML (global-selling exige título em inglês — validar com token real).
- Custo/latência de IA por item — orçar cache e quando acionar Vision.

## Consequências

- Aceita qualquer produto; custo de IA sobe (mitigado por overrides + cache). Overrides viram dívida se
  IDs do canal mudarem (tratar como cache verificável, não verdade eterna).
