# ADR-0052 — Camada 2: atributos IA-first (inferência de texto-livre do próprio produto) + fallback manual

**Data:** 2026-07-01
**Status:** aceito (design travado via grilling; implementação em fases nas branches do épico)
**Decisores:** Diego
**Relaciona:** estende [ADR-0026](0026-generalizacao-categorizacao-atributos-por-ia.md) (E4 — atributos por IA), revisa [ADR-0049](0049-atributos-opcionais-e-numericos-por-ia.md) (que excluía texto-livre por inteiro) e continua [ADR-0051](0051-tipo-aviamento-derivado-da-categoria-do-preditor.md) (robustez: nunca publicar sem validar)

## Contexto

Rumo a SaaS multiempresa, o objetivo é **publicar qualquer produto** com o mínimo de intervenção
humana. A ADR-0051 garantiu que nada publica errado (produto sem obrigatórios trava na revisão), mas
deixou uma lacuna de usabilidade: para produtos não-aviamento cujo obrigatório a IA não infere, o
operador não tem como resolver.

Diretriz do Diego (grilling 2026-07-01): **a IA deve resolver ao máximo; intervenção manual só em
último caso, quando a IA não conseguir de forma alguma.**

## Decisões

1. **A IA infere atributos de texto-livre obrigatórios A PARTIR do texto do produto.** Hoje a IA cobre
   closed-set e numéricos; texto-livre (`valueType='string'`) era 100% excluído (ADR-0049) por risco de
   invenção. Passa a ser incluído **só quando obrigatório** (`required`/`conditionalRequired`).
2. **Regra de ouro materializada como verificação:** um valor de texto-livre da IA só é aceito se
   constar (normalizado, sem acento/caixa) no **nome + descrição** da planilha. Assim "inferir do texto"
   deixa de ser promessa e vira invariante testável — a IA não pode inventar dado que não está na fonte.
   Se não constar, o atributo fica faltante (cai no fallback), nunca é chutado.
3. **Fallback = último caso, na própria Revisão.** Onde hoje o card de categoria mostra "Faltam: X"
   read-only, passa a ser **editável**, e o item fica **travado para publicar** enquanto houver
   obrigatório faltante. Sem tela nova, sem fila separada, sem notificação (podem vir depois).
4. **Fallback cobre só atributos** nesta fase. A categoria continua a que a IA (preditor) definiu;
   troca livre de categoria é fase posterior, só se surgir necessidade real.
5. **Edição manual sobrevive ao reprocessamento.** Nova flag `atributos_editados_pelo_operador` em
   `familias` + guarda em `process-familia` (espelha `titulo_editado_pelo_operador`): o reprocesso não
   sobrescreve atributos que o operador completou.

## Faseamento (2 planos independentes)

- **Plano A — Reforço da IA (backend puro).** Inferência de texto-livre obrigatório com a regra
  substring anti-invenção. Reduz travamentos sem tocar UI. `docs/superpowers/plans/2026-07-01-camada2a-ia-texto-livre.md`.
- **Plano B — Fallback manual (backend flag/edge + frontend editor).** Flag de atributos editados,
  edge function que expõe o schema da categoria, editor na Revisão, trava de publicação. Planejado
  após A ser validado (evita planejar UI sobre um backend que A pode mudar).

## Consequências

- Menos produtos travam sem violar "nunca inventar dado" — a regra vira código verificável.
- O ramo de aviamentos (determinístico) segue intocado; a inferência de texto-livre só age no caminho
  genérico e só em obrigatórios.
- Custo de IA: o prompt de atributos ganha mais alvos (texto-livre obrigatório) quando houver; zero
  chamada extra quando não houver alvo.
- Dívida multi-tenant registrada à parte: marca padrão `Avil` hard-coded (`atributos.ts`) → config por
  empresa quando houver multi-tenant real.
