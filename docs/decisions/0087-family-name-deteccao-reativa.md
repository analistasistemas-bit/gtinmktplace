# ADR-0087 — Detecção reativa de categorias que exigem item plano (family_name), sem lista mantida à mão

**Status:** Em proposta
**Data:** 2026-07-22
**Decisores:** Diego
**Relaciona:** estende [ADR-0084](0084-family-name-categoria-zipper.md) (item plano/family_name p/
MLB271227); mesma base de [ADR-0003](0003-variacoes-agrupadas-por-pai.md) (variações agrupadas por PAI).

## Contexto

Lote #37: "KIT AGULHA CROCHÊ BAR-03-VR C VAR NYBC" (PAI `02638290`, 1 cor) falhou no `POST /items`
com a **mesma assinatura** já documentada no ADR-0084 (lote #36, categoria Zíperes `MLB271227`):

```json
{
  "cause": [
    {"code": "body.required_fields", "cause_id": 369,
     "message": "The body does not contains some or none of the following properties [family_name, price, available_quantity]"},
    {"code": "body.invalid_fields", "cause_id": 374,
     "message": "The field variations is invalid with family name"}
  ]
}
```

O ADR-0084 resolveu isso adicionando a categoria a um `Set` mantido à mão
(`CATEGORIAS_QUE_EXIGEM_FAMILY_NAME`, `categoria/atributos.ts:89`, hoje só `{MLB271227}`), checado em
`montarPayloadItem` (`ml/publicar.ts:125`) antes de montar o payload. "Kit agulha" cai numa categoria
do ML diferente de `MLB271227` (aviamento fora dos 5 tipos com regex — agulha não está em
`detectar.ts`), então `categoriaExigeFamilyName` retorna `false`, o payload é montado com `variations`
clássico, e o ML rejeita com o mesmo 400.

**Por que isso não escala:** PubliAI está indo em direção a catálogo de qualquer segmento (armarinho
hoje cobre só linha/fita/botao/cola/cursor por regex; épico E5/Shopee amplia o catálogo ainda mais).
Toda categoria nova do ML com esse comportamento vira, hoje, o mesmo ciclo: lote reprovado em produção
→ investigação → ADR → editar código → deploy — sempre depois do incidente, nunca antes.

**Detecção estática não é possível — já investigado:** o ADR-0084 comparou `settings` e tags de
atributo (`GET /categories/{id}`, `/categories/{id}/attributes`) entre `MLB271227` (exige item plano) e
categorias já em produção que aceitam `variations` normalmente — são **idênticos**. Não existe campo
público do ML que preveja esse comportamento por categoria antes de tentar publicar.

## Decisão

Substituir a lista mantida à mão por **detecção reativa pela própria resposta do ML**, em vez de tentar
prever a categoria de antemão:

1. Na primeira tentativa de `CREATE`, monta o payload padrão (`variations`), como hoje.
2. Se o ML rejeitar com a assinatura exata do ADR-0084 (`cause_id 369` + `374`, não um 400 genérico),
   reconstrói o payload no **formato plano** — a mesma lógica que `montarPayloadItem` já implementa
   (`ml/publicar.ts:132-160`), hoje presa atrás do `if (categoriaExigeFamilyName(...))` — e tenta o
   `POST /items` **uma única vez a mais**.
3. Um `POST /items` rejeitado (400) não cria recurso nenhum no ML (confirmado empiricamente no
   ADR-0084) — o retry é seguro, sem risco de duplicar anúncio.

**Mantido do ADR-0084, sem mudança:** famílias com **mais de 1 variação** continuam falhando alto
(`throw`, sem retry, sem fallback silencioso) quando essa assinatura aparece — esse caso segue fora de
escopo (exigiria N itens por família compartilhando `family_name`, redesenho maior).

## Alternativas consideradas

- **Detecção estática via metadata de categoria (`GET /categories/{id}`):** descartada — o ADR-0084 já
  provou que não existe diferença de config entre categorias que falham e que funcionam.
- **Manter e só ampliar `CATEGORIAS_QUE_EXIGEM_FAMILY_NAME` manualmente a cada categoria nova:**
  descartada — é o status quo que gerou o lote #37; não escala com catálogo genérico.
- **Detectar por heurística de nome de produto (ex.: regex de "kit"/"agulha"):** descartada — o
  comportamento é do Mercado Livre por `category_id`, não do nome do produto; heurística de texto erraria
  categorias novas do mesmo jeito que o Set atual erra.

## Consequências

- **Boas:** qualquer categoria nova do ML com esse comportamento publica de primeira via retry
  automático — sem precisar de PR/deploy/ADR por categoria. `CATEGORIAS_QUE_EXIGEM_FAMILY_NAME` deixa de
  ser ponto único de manutenção manual.
- **Ruins / tradeoffs aceitos:** toda categoria nova com esse comportamento paga 1 `POST` rejeitado a
  mais antes do retry — sem efeito colateral (não cria recurso), só custo de 1 chamada. Sem cache
  persistido (v1), a mesma categoria paga esse custo **em toda publicação futura**, não só na primeira —
  aceitável porque o volume de publicação é baixo e sempre revisado por humano. Se isso incomodar,
  incremento 2 resolve sem precisar de outro ADR: persistir a categoria aprendida numa tabela
  **global** (comportamento de payload é do Mercado Livre, igual pra qualquer vendedor — não usar o
  padrão org-scoped do ADR-0086) e pular direto pro payload plano nas próximas publicações da mesma
  categoria.
- **Como reverter:** remover o retry reativo de `canais/mercado-livre.ts` (`criarAnuncio`), o detector de
  assinatura em `ml/erro-ml.ts`, e manter só o `Set` hardcoded do ADR-0084 (comportamento anterior a este
  ADR).

### Implementação prevista (para quando for codificada)

- `ml/criar-item.ts` (`criarItemML`): anexar o `cause` bruto do ML ao erro lançado — hoje só loga
  (`console.error`, linha 19) e descarta; mesmo padrão de `status`/`retentavel` já anexados ao erro.
- `ml/erro-ml.ts`: novo detector, ex. `precisaItemPlano(json)` — casa especificamente `cause_id 369` +
  `374`, não um 400 genérico (mesmo cuidado de `ehErroRetentavel`, que já casa por padrão específico em
  vez de status HTTP cru).
- `canais/mercado-livre.ts` (`criarAnuncio`, hoje linhas 62-76): no `catch`, se `precisaItemPlano(e)` e a
  família tiver exatamente 1 variação, reconstrói o payload plano e chama `criarItemML` mais uma vez
  antes de propagar o erro.
- `categoria/atributos.ts`: `CATEGORIAS_QUE_EXIGEM_FAMILY_NAME` deixa de ser o único gate — vira
  seed/cache opcional (categorias já confirmadas pulam direto pro payload plano, sem gastar o `POST`
  rejeitado a cada publicação).

## Validação (pendente)

Ainda não implementado. Critério de aceite quando implementado: reprocessar o lote #37 (KIT AGULHA
CROCHÊ, PAI `02638290`) e confirmar publicação via retry reativo, **sem** editar
`CATEGORIAS_QUE_EXIGEM_FAMILY_NAME`.
