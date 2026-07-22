# ADR-0087 — Detecção reativa de categorias que exigem item plano (family_name), sem lista mantida à mão

**Status:** Aceito
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

**Correção de premissa (achado da revisão adversarial, confirmado via docs oficiais do ML):** o ADR-0084
concluiu "não há sinal estático" comparando só `settings`/atributos de categoria
(`GET /categories/{id}`). Isso é verdade *nesse nível* — mas o Mercado Livre expõe, à parte, a tag
`user_product_seller` em `GET /users/{id}` para vendedores migrados ao modelo "Preço por
Variação"/User Products (`family_name` no lugar de `variations`), com rollout **gradual por conta e por
categoria dentro da mesma conta, e a ML pode migrar um item/categoria depois, fora do controle do
PubliAI** — o que explica por que o ADR-0084 viu a MESMA conta ML publicar `variations` normalmente em
várias categorias e falhar só em `MLB271227`. Essa tag não vira mecanismo nesta decisão (ver
"Alternativas consideradas"): não dá pra prever por conta sozinha qual categoria específica vai exigir
item plano, e qualquer estado que o PubliAI persistisse sobre "formato desta família" correria o risco
de ficar desatualizado se o ML migrar o item depois — melhor sempre confirmar contra a API no momento
em que importa (ver Decisão, item 6).

## Decisão

Substituir a lista mantida à mão por **detecção reativa pela própria resposta do ML, só no CREATE** —
o UPDATE já resolve isso corretamente hoje e não muda.

1. `formatoInicial = categoriaExigeFamilyName(categoria) ? 'plano' : 'variations'` — o `Set` do
   ADR-0084 continua sendo o atalho pras categorias já conhecidas (`MLB271227` publica direto no formato
   plano, **zero POST desperdiçado**, exatamente como hoje). Só categorias **fora** do Set começam a
   tentativa em `variations` — são essas que podem acionar o retry reativo abaixo.
2. Se o ML rejeitar com a **assinatura exata** do ADR-0084 — resposta HTTP `400` completa (não
   timeout/erro de rede), causas bloqueantes (`type !== 'warning'`) sendo **exatamente**
   `{code: 'body.required_fields', cause_id: 369}` **e** `{code: 'body.invalid_fields', cause_id: 374}`,
   sem nenhuma 3ª causa bloqueante, e as mensagens mencionando os termos esperados (`family_name`,
   `price`, `available_quantity`, `variations`) como camada extra de defesa contra reuso desses códigos
   em erros não relacionados — reconstrói o payload no **formato plano** (mesma lógica que
   `montarPayloadItem` já implementa em `ml/publicar.ts:132-160`) e tenta o `POST /items` **uma única vez
   a mais**. Um match parcial não aciona o retry: melhor devolver o erro original e claro do que gastar
   um POST a mais escondendo um problema real de dado.
3. `montarPayloadItem` ganha um parâmetro explícito `formato: 'variations' | 'plano'` (hoje o branch
   plano só é alcançável via `categoriaExigeFamilyName(categoria)` — o retry reativo precisa forçar esse
   ramo sem depender do Set, e não há GET prévio no CREATE pra consultar estado real). A checagem de
   categoria vira só o *seed inicial* de `formato`, não o único caminho.
4. `POST /items` rejeitado com 400 completo não cria recurso nenhum no ML (confirmado empiricamente no
   ADR-0084) — o retry é seguro para esse caso específico. Isso **não** é uma afirmação geral de
   idempotência do endpoint: timeout, conexão perdida após commit no ML, ou 5xx são resultado ambíguo e
   **não** entram nesse retry — só o 400 integralmente recebido com a assinatura exata aciona a
   reconstrução.
5. **Contrato do conector preservado: `criarAnuncio` nunca lança.** Hoje `montarPayloadItem` roda fora
   de qualquer `try/catch` em `mercado-livre.ts` e só o `criarItemML` está dentro de um `try`. As duas
   tentativas (1ª com `formatoInicial`, reconstrução + 2ª com `'plano'`) precisam ficar dentro de **um
   único `try/catch` externo comum** — se a 2ª tentativa falhar (novo erro do ML, ou `montarPayloadItem`
   lançando por múltiplas variações descobertas só agora reativamente), o `catch` final sempre devolve
   `{ok: false, erro: classificarErroCanal(e)}`, igual a qualquer outra falha de publicação. Nenhum
   caminho pode deixar uma exceção escapar do conector.
6. **UPDATE não muda.** `atualizarAnuncio` (`mercado-livre.ts`) já detecta item plano pelo `GET
   /items/{id}` ao vivo (`atual.variations.length === 0`) antes de montar o PUT — esse é o estado REAL no
   momento do UPDATE, a fonte de verdade correta (o Mercado Livre pode migrar um item pra User Products
   depois do CREATE, fora do nosso controle; qualquer flag que persistíssemos sobre "formato desta
   família" arriscaria ficar desatualizada e reintroduzir o no-op silencioso que o próprio ADR-0084 já
   corrigiu — ver Alternativas consideradas). O resultado do CREATE reativo (1ª ou 2ª tentativa) produz
   exatamente o mesmo formato de item que o caminho hardcoded de hoje produzia — o UPDATE já sabe lidar
   com isso, sem nenhuma mudança de código.

**Mantido do ADR-0084, sem mudança de comportamento observável:** famílias com **mais de 1 variação**
continuam sem fallback silencioso quando essa assinatura aparece — `montarPayloadItem` continua
lançando internamente (mesmo `throw` de hoje), só que agora sempre capturado pelo `try/catch` único do
item 5 e traduzido em `ResultadoCanal` de falha (nunca escapa do conector). Esse caso segue fora de
escopo (exigiria N itens por família compartilhando `family_name`, redesenho maior).

**Fora de escopo, riscos pré-existentes (não introduzidos por este ADR):** publicação concorrente da
mesma família (duas execuções simultâneas podem ambas criar item — já é verdade hoje, com ou sem retry,
não há lock) e falha ao persistir `ml_item_id` localmente após sucesso remoto (também já é risco de
qualquer `criarItemML` bem-sucedido hoje, independente deste ADR). Este ADR troca *onde* o formato do
payload é decidido no CREATE, não redesenha idempotência/concorrência do pipeline de publicação inteiro.

## Alternativas consideradas

- **Detecção estática só via metadata de categoria (`GET /categories/{id}`):** descartada — o ADR-0084
  já provou que não há diferença de config nesse nível entre categorias que falham e que funcionam.
- **Gate preventivo por tag da conta (`user_product_seller`, `GET /users/{id}`), pulando a tentativa
  `variations` quando ausente:** avaliada e **descartada como mecanismo**. A tag confirma que a conta
  *pode* ter categorias no modelo novo, mas não diz quais — o retry reativo só é acionado quando o ML
  rejeita de verdade, então contas/categorias que nunca precisam de item plano **já não pagam custo
  extra hoje**, com ou sem checar a tag antes. Mantida só como contexto explicativo.
- **Persistir o formato usado no CREATE (`familias.formato_publicacao_ml`) e usá-lo no UPDATE em vez do
  `GET` ao vivo:** avaliada e **descartada** — o formato persistido descreveria como o item foi *criado*,
  não seu estado *atual*; o ML pode migrar um item legado pra User Products depois, e nesse caso o campo
  persistido ficaria desatualizado e faria o UPDATE ignorar o `GET` real, reintroduzindo exatamente o
  no-op silencioso que o ADR-0084 corrigiu. O `GET` ao vivo já é a fonte de verdade correta e já funciona
  — não precisa de um 2º sinal que pode divergir dele.
- **Manter e só ampliar `CATEGORIAS_QUE_EXIGEM_FAMILY_NAME` manualmente a cada categoria nova:**
  descartada — é o status quo que gerou o lote #37; não escala com catálogo genérico.
- **Detectar por heurística de nome de produto (ex.: regex de "kit"/"agulha"):** descartada — o
  comportamento é do Mercado Livre por conta+categoria, não do nome do produto; heurística de texto
  erraria categorias novas do mesmo jeito que o Set atual erra.

## Consequências

- **Boas:** qualquer categoria nova do ML com esse comportamento publica de primeira via retry
  automático, sem PR/deploy/ADR por categoria. `CATEGORIAS_QUE_EXIGEM_FAMILY_NAME` deixa de ser ponto
  único de manutenção manual. UPDATE permanece intocado e correto (nenhuma mudança de risco ali).
- **Ruins / tradeoffs aceitos:** toda categoria nova que exige item plano paga 1 `POST` rejeitado a mais
  antes do retry — sem efeito colateral (não cria recurso), só custo de 1 chamada, e só nessa categoria
  específica. **v1 decide explicitamente não persistir nenhum cache/flag de formato** — cada CREATE numa
  categoria ainda não conhecida paga esse custo, aceitável porque o volume de publicação é baixo e sempre
  revisado por humano. Se incomodar, incremento 2 (fora deste ADR, só pro CREATE): tabela **global** (não
  org-scoped, ver ADR-0086) chaveada por **seller/conexão + categoria** (não só categoria — o
  comportamento depende de conta+categoria, ver Contexto), usada como seed de `formato` pra pular a 1ª
  tentativa — nunca usada no UPDATE, que continua 100% do `GET` ao vivo.
- `family_name` recebido de `titulo_ml` sem validar `max_title_length` do domínio: caveat **herdado** do
  branch plano já implementado no ADR-0084 (`montarPayloadItem`), não introduzido aqui.
- **Como reverter:** remover o retry reativo de `canais/mercado-livre.ts` (`criarAnuncio`), o detector de
  assinatura em `ml/erro-ml.ts`, o parâmetro `formato` de `montarPayloadItem`, e manter só o `Set`
  hardcoded do ADR-0084.

### Implementação prevista (para quando for codificada)

- `ml/criar-item.ts` (`criarItemML`): anexar as causas brutas do ML ao erro lançado como propriedade
  tipada `mlCauses?: Array<{code: string; cause_id?: number; message: string; type?: string}>` — **não**
  `cause` (colide com `Error.cause` nativo, ES2022, semântica diferente). Mesmo padrão leve já usado por
  `status`/`retentavel` (não introduzir uma classe de erro nova só para isso).
- `ml/erro-ml.ts`: novo detector, ex. `precisaItemPlano(status, mlCauses)` — casa `status === 400` **e**
  as causas bloqueantes serem exatamente `{code: 'body.required_fields', cause_id: 369}` +
  `{code: 'body.invalid_fields', cause_id: 374}`, nada a mais, **e** as mensagens contendo os termos
  esperados (`family_name`/`price`/`available_quantity` na 1ª, `variations` na 2ª) como defesa extra
  contra reuso desses códigos em erros não relacionados (mesmo cuidado de `ehErroRetentavel`, que já casa
  por padrão específico em vez de status HTTP cru).
- `ml/publicar.ts` (`montarPayloadItem`): novo parâmetro `formato?: 'variations' | 'plano'` — quando
  informado, força o ramo correspondente; sem ele, mantém `categoriaExigeFamilyName` como seed.
- `canais/mercado-livre.ts` (`criarAnuncio`): passa a envolver **as duas tentativas num único
  `try/catch`** (hoje `montarPayloadItem` roda fora do `try`, só `criarItemML` está dentro). Fluxo:
  `formatoInicial = categoriaExigeFamilyName(categoria) ? 'plano' : 'variations'` → monta payload → 1ª
  chamada a `criarItemML`; se falhar e `precisaItemPlano(e)` e a família tiver exatamente 1 variação,
  reconstrói com `formato: 'plano'` e tenta `criarItemML` mais uma vez; **qualquer** falha que sobrar (1ª
  tentativa sem a assinatura, 2ª tentativa que também falha, ou `montarPayloadItem` lançando por >1
  variação na reconstrução) cai no mesmo `catch` final e devolve `{ok: false, erro:
  classificarErroCanal(e)}` — nunca deixa uma exceção escapar do conector. **`atualizarAnuncio` não é
  tocado.**

## Validação

**Implementado e testado (TDD, 2026-07-22):** `precisaItemPlano` (`erro-ml.ts`), `mlCauses` anexado ao
erro (`criar-item.ts`), parâmetro `formato` em `montarPayloadItem` (`publicar.ts`) e o retry reativo em
`criarAnuncio` (`mercado-livre.ts`). Revisão adversarial do Codex (`/codex:adversarial-review`) achou
uma falha real: `TERMOS_369` usava alternação (`family_name|price|available_quantity`), então uma causa
369 mencionando só 1 dos 3 termos já casava — corrigido para exigir os 3 termos juntos
(`TERMOS_369.every(...)`), com 8 testes novos cobrindo cada termo isolado e cada combinação incompleta (achado completo do Codex). 1743 testes
verdes (suíte inteira), lint e `deno check` limpos.

**Pendente:** deploy CLI das functions afetadas e reprocessamento real do lote #37 (KIT AGULHA CROCHÊ,
PAI `02638290`) para confirmar publicação via retry reativo em produção, **sem** editar
`CATEGORIAS_QUE_EXIGEM_FAMILY_NAME`. Testes cobertos antes da implementação:

- Testes do detector: assinatura exata (369+374, só essas duas, `status=400`, mensagens com os termos
  esperados) → aciona; `369` sozinho (outro erro de catálogo) → não aciona; 369+374 + causa bloqueante
  adicional → não aciona; causas em `warning` não contam; 369+374 com mensagens que não mencionam os
  termos esperados (código reaproveitado por coincidência) → não aciona.
- Testes de orquestração (fetch mockado em `criarAnuncio`, sempre afirmando que o retorno é
  `ResultadoCanal` — a promessa de "nunca lança" do conector é parte do que se testa): categoria no Set
  → `formatoInicial='plano'` direto, nenhum POST em `variations`; categoria fora do Set, 1º POST
  rejeitado com assinatura exata → 2º POST com payload plano → sucesso; 1º POST rejeitado sem a
  assinatura exata → nenhum 2º POST, `{ok:false}` com o erro original; 1º rejeitado com assinatura, 2º
  também falha → `{ok:false}` com o erro do 2º, sem 3ª tentativa; família com >1 variação + assinatura →
  `montarPayloadItem` lança internamente na reconstrução, mas `criarAnuncio` captura e devolve
  `{ok:false}` (nunca escapa como exceção), sem 2º POST de fato enviado.
- Teste do parâmetro `formato` de `montarPayloadItem` isoladamente (plano vs variations, mesma entrada).

Critério de aceite end-to-end: reprocessar o lote #37 (KIT AGULHA CROCHÊ, PAI `02638290`) e confirmar
publicação via retry reativo, **sem** editar `CATEGORIAS_QUE_EXIGEM_FAMILY_NAME`.
