# Plan Review Log: ADR-0088 — Publicação em User Products com N itens técnicos por família

Started 2026-07-22. MAX_ROUNDS=5. PLAN_FILE=docs/decisions/0088-publicacao-user-products-multi-item.md.

## Round 1 — Codex

VERDICT: REVISE

Verificação das 5 correções da ADR:
1. Deploy via `deno info`: correta como princípio, incompleta como procedimento — falta script versionado reproduzível.
2. Os 4 consumidores de escopo: parcialmente errado — `status-publicados` já inclui `anuncios_externos.item_externo_id` (ADR-0048), fato omitido; `atualizar-status-publicado` não monta escopo de família, é comando de item único.
3. Retry de 1 cor mantido: correta, confirmou os 3 callers reais incluindo `publicar-anuncio/processar.ts:148`.
4. Constraint org-scoped: correta, confirmou `anuncios_externos_org_canal_pai_particao_key`.
5. Semântica de `ml_item_id`: enumerada mas não totalmente compatível — não representa status agregado de N filhos que podem divergir.

Problemas arquiteturais novos apontados: janela de idempotência (crash entre POST e persistência do `item_externo_id` cria item órfão); reserva de linha não é exclusão mútua real (concorrência entre workers); chave de idempotência usa `variacao_id` (que muda a cada re-ingest) em vez de `sku` — bug real de identidade; RLS de `anuncios_externos` alegada como org-scoped seria "factualmente falsa"; faltam FKs/NOT NULL/checks na tabela filha; `atualizar-status-publicado` seria um IDOR operacional; ativação de N itens não é atômica e falta estado `compensacao_pendente`; falta matriz de estados remotos inesperados (item apagado, family_id errado, 404); cache sem política de invalidação; risco de duas partições de preço colidirem no mesmo `family_name`/UPP; `remover-publicado` não trata os itens filhos remotos; o plano `docs/superpowers/plans/2026-07-22-publicacao-legacy-user-products.md` citado não existia neste worktree (não commitado).

### Claude's response

Verifiquei cada alegação contra o código antes de decidir (skill exige checar, não confiar):

**Aceitas e incorporadas na revisão:**
- Deploy: vai exigir script/comando reproduzível, não só "recalcular" em prosa.
- Correção do framing dos 4 index.ts: `status-publicados` já une `anuncios_externos.item_externo_id` (só falta unir os itens filhos, não é gap do zero); `atualizar-status-publicado` é comando de item único, não monta escopo — removido dessa lista, mas mantido como consumidor que a saga chama por item ao pausar/ativar.
- Semântica de `ml_item_id`: ADR vai declarar explicitamente que é um "representante" best-effort (válido no momento em que `status='publicado'`, quando a saga já garante todos ativos); status agregado real depende de ler `anuncios_externos_itens`.
- Janela de idempotência (crash entre POST e persist): real. Fix: antes do POST, buscar por `seller_custom_field=sku` pra detectar item órfão de uma tentativa anterior antes de criar um novo.
- Chave de idempotência errada (`variacao_id` muda no re-ingest): real e específico do domínio. Fix: ancorar a linha filha por `(anuncio_externo_id, sku)`, não por `variacao_id` — consistente com como a partição já ancora por sku (ADR-0048).
- Faltam constraints na tabela filha: aceito, vai listar FK/NOT NULL/checks/unicidade de `user_product_id`.
- Ativação não-atômica / falta estado intermediário: aceito, adicionar `compensacao_pendente` (ou equivalente) e reconciliador que converge.
- Falta matriz de estados remotos inesperados: aceito como regra de segurança — estado inesperado marca `erro` e exige intervenção manual, nunca retry automático indefinido.
- Cache sem invalidação: aceito parcialmente — cache é só um hint de seed pro CREATE (pior caso = 1 POST extra), mas vai declarar que falha de validação não relacionada à assinatura conhecida não deve reforçar o cache cegamente.
- Colisão de `family_name` entre partições de preço diferentes: aceito — `family_name` passa a incluir um identificador de partição explícito.
- `remover-publicado` não trata itens filhos: aceito — vai exigir pausar todos os filhos (mesma semântica do item único hoje) antes de desvincular localmente, nunca deletar no ML.
- Plano `2026-07-22-publicacao-legacy-user-products.md` ausente no worktree: **corrigido diretamente** (copiei o arquivo do checkout principal pro worktree) em vez de reescrever a ADR pra depender menos dele.

**Rejeitadas, com evidência:**
- "RLS de `anuncios_externos` copiada seria factualmente falsa": **rejeitado**. Verifiquei `supabase/migrations/20260705165828_e7_rls_org.sql` — essa migration (E7, Fase 4) já substitui as policies antigas (`select own`/`select membro`) por `select org`/`insert org`/`update org`/`delete org` com `org_id = current_org_id()` para `anuncios_externos` (junto com `lotes`, `familias`, `variacoes`), via loop `foreach t in array [...]`. O Codex não achou essa migration porque seu grep por `anuncios_externos.*policy` não bate com o SQL gerado via `format('...', t, t)` (nome da tabela é variável, não literal na mesma linha). A tabela **já é org-scoped hoje** — a instrução original da ADR ("copiar a política org-scoped de `anuncios_externos`") está correta.
- `atualizar-status-publicado` como "IDOR operacional": **aceito parcialmente, framing corrigido**. A chamada usa o token OAuth da própria conexão ML da org — a autorização real de posse do item é feita pelo próprio Mercado Livre (o token de uma org não consegue agir sobre um item de outro seller). Não é uma falha de isolamento entre orgs do PubliAI. Vou incluir a verificação (checar que o `ml_item_id` pertence a um registro local conhecido da org) como guarda de correção — evita editar um item não rastreado pelo PubliAI por engano — não como fix de segurança crítico.
- Concorrência entre workers (reserva de linha não é lock real): **aceito como risco documentado, não como bloqueio de implementação**. É o mesmo risco pré-existente que o ADR-0087 já registrou como "fora de escopo" para o pipeline inteiro (não introduzido por este ADR). Vou ajustar a linguagem da ADR pra não supervender "saga idempotente" como sinônimo de "concorrente-segura" — idempotente aqui significa seguro para retry sequencial após falha, não para duas execuções simultâneas da mesma partição.

## Round 2 — Codex

VERDICT: REVISE

Confirmou as duas rejeições da rodada 1 (RLS já org-scoped; guarda de `atualizar-status-publicado` é correção de negócio, não fronteira de segurança primária — token OAuth do ML já garante isso). Ainda achou:

1. `remover-publicado` **não** pausa o item remoto hoje (só apaga `familias`/`anuncios_externos`/storage, zero chamada ao conector/ML) — a ADR afirma incorretamente que estende "a mesma semântica de hoje".
2. "Preservar linha filha como tombstone" contradiz `anuncio_externo_id ... on delete cascade` + `variacao_id NOT NULL` — apagar a raiz apaga os filhos, e apagar família/variação quebraria a FK.
3. Dois reconciliadores incompatíveis sob o mesmo nome: o de backfill promete zero POST/PUT, mas o texto da saga fala em "o reconciliador" convergindo `compensacao_pendente`, que exige PUT.
4. Adoção por `seller_custom_field=SKU` não está suficientemente específica: sem escopo de busca (seller+categoria+family_name da partição+janela), pode adotar item errado (histórico, outra partição, duplicata).
5. Mesmo com a busca pré-POST, consistência eventual do ML pode ainda gerar POST duplicado — o critério de aceite "retry não emite POST adicional" promete uma garantia que a busca não entrega.
6. Cache: "seed a partir do resultado de um CREATE" não deixa claro que só a assinatura 369+374 confirmada deve gravar `user_products` — um CREATE plano bem-sucedido por outro motivo não prova que o formato era obrigatório.
7. `variacao_id NOT NULL` conflita com re-ingest (variação muda a cada lote; família/variação antiga pode ser apagada).
8. Falta uma regra de agregação de estado (como `familias.status`/`anuncios_externos.status` derivam de N filhos com estados mistos).
9. Texto residual: §5 ainda diz "quatro `index.ts`" (corrigido em §2 pra três) e "1 `ml_item_id` por partição" (só a partição 0 tem `ml_item_id`; outras vivem em `anuncios_externos`).
10. Alegou que o plano `docs/superpowers/plans/2026-07-22-publicacao-legacy-user-products.md` "continua ausente".

### Claude's response

Verifiquei cada ponto contra o código real antes de decidir.

**Aceitas e incorporadas na próxima revisão:**
- (1) `remover-publicado` real (lido o arquivo inteiro): confirmado, não há nenhuma chamada a conector/ML — só `delete` em `familias`/`anuncios_externos` + storage. A ADR vai declarar isso como **comportamento novo**, não extensão do que já existe, e escopar explicitamente: só se aplica a famílias UP (Legacy continua com o delete direto de hoje, fora de escopo deste ADR).
- (2) Contradição cascade/tombstone: real. Fix: "tombstone"/histórico passa a viver **no lado do ML** (item pausado, nunca deletado no Mercado Livre) — não como linha preservada no banco. A saga passa a **pausar todos os filhos remotamente primeiro**, e só then o delete local em cascata roda normalmente (igual ao Legacy hoje) — sem precisar de soft-delete nem exceção à FK cascade.
- (3) Dois reconciliadores: real, vou nomear e separar — "Reconciliador de backfill" (só leitura, admin-triggered, importa itens planos pré-existentes) vs. "Reconciliador de convergência" (mutável, faz PUT pra convergir `compensacao_pendente`, com gatilho e política de retry próprios).
- (4) Escopo de busca do `seller_custom_field`: aceito, vou especificar critério de adoção inequívoco (seller+categoria+`family_name` exato da partição+janela de tempo recente) e declarar que resultado ambíguo (>1 match) vira erro manual, nunca adoção do primeiro.
- (5) Eventual consistency: aceito, suavizar o critério de aceite de "retry não emite POST adicional" pra "retry não duplica quando a busca confirma o item; ausência momentânea é tratada por retry com backoff/reconciliador, não por garantia absoluta".
- (6) Cache: aceito, vou explicitar que só grava `user_products` quando a assinatura reativa exata (369+374, mesmo predicado do ADR-0087) foi observada — nunca por inferência de um CREATE plano bem-sucedido por outro motivo.
- (7) `variacao_id NOT NULL`: aceito, vira nulável com `on delete set null` — é ponteiro de rastreabilidade "melhor esforço", não identidade de ancoragem (que já é `(anuncio_externo_id, sku)` desde a rodada 1).
- (8) Falta regra de agregação: aceito, adicionar regra simples de redução (todos ativos → ativo; algum erro → erro; algum compensacao_pendente → compensacao_pendente; todos pausados → pausado).
- (9) Texto residual: aceito, corrigir "quatro" → "três" em §5 e precisar que só a partição 0 tem `ml_item_id`; partições >0 vivem em `anuncios_externos.item_externo_id` (com filhos UP na tabela nova).

**Rejeitada, com evidência:**
- (10) Plano ausente: **rejeitado**. `ls -la` confirma `docs/superpowers/plans/2026-07-22-publicacao-legacy-user-products.md` presente no worktree (27.9K, copiado do checkout principal antes da rodada 1). O Codex resumiu a mesma sessão (thread) da rodada 1 e não re-leu o arquivo — repetiu o achado sem verificar de novo.

### ADR revisada para a rodada 2 (2026-07-22)

`docs/decisions/0088-publicacao-user-products-multi-item.md` reescrita incorporando todas as correções aceitas acima: §1 ganhou script `deno info --json` reproduzível; framing dos consumidores de escopo corrigido (3 `index.ts`, `status-publicados` já une `item_externo_id`, `atualizar-status-publicado` como comando de item único + guarda de correção); `ml_item_id` declarado representante best-effort; saga com janela de idempotência por `seller_custom_field`, ancoragem por `(anuncio_externo_id, sku)`, estado `compensacao_pendente` e regra de estado remoto inesperado → `erro`; tabela filha com constraints explícitas; cache como hint de seed; `family_name` com identificador de partição; `remover-publicado` pausando todos os filhos; terminologia "idempotente = retry sequencial, não concorrência-segura". RLS mantida como "copiar a política org-scoped" (rejeição confirmada). Pronta para nova rodada do Codex.

## Round 3 — Codex

VERDICT: REVISE

As 9 correções da rodada 2 estão refletidas corretamente, e o plano citado agora existe (confirmou). Ainda achou:

1. Regra de agregação não cobre estados mistos (`[ativo,pausado]`, `[criado,pausado]`, qualquer filho `pendente/criado` sem erro não produz estado nenhum).
2. Reconciliador de convergência não sabe o resultado desejado (ativar ou pausar) após um restart — falta persistir a intenção antes das mutações.
3. Reconciliador de convergência não resolve o órfão sem `item_externo_id` (criado no ML, crash antes de persistir) — ele só opera sobre filhos com `compensacao_pendente`, que já têm ID; o órfão sem ID é um caso diferente e não especificado.
4. Cache continua contraditório: "pula a 1ª tentativa `variations`" e "custa 1 POST desperdiçado" não podem ser ambos verdade ao mesmo tempo; falta TTL/revalidação pra categoria que mudar de comportamento depois.
5. Remoção UP não define atomicidade em falha parcial (pausa 3 de 4 filhos, o 4º falha — deletar local mesmo assim deixa item ativo órfão).
6. O reconciliador de convergência (mutável) não aparece na seção "Implementação prevista" (só o de backfill, read-only).
7. FK composta `(anuncio_externo_id, org_id) → anuncios_externos(id, org_id)` está subespecificada — `CHECK` não pode consultar outra tabela no Postgres; falta `unique(id, org_id)` no pai.
8. Busca por órfão via `seller_custom_field` depende de uma capacidade da API do ML não demonstrada/citada (endpoint, parâmetros, paginação).

### Claude's response

Pesquisei a API real do Mercado Livre antes de decidir o ponto 8 (WebSearch, developers.mercadolivre.com.br): `GET /users/{user_id}/items/search?sku=<seller_custom_field>` é um endpoint documentado e real — o parâmetro `sku` filtra exatamente por `seller_custom_field`, combinável com `category_id`. Isso resolve a dúvida de viabilidade — o mecanismo é real, só precisava ser citado com precisão.

**Todas as 8 aceitas:**
1. Regra de agregação vira função total: `erro` (qualquer filho) → `erro`; senão `compensacao_pendente` (qualquer filho) → `compensacao_pendente`; senão qualquer `pendente`/`criado` → `publicando`; senão mistura `ativo`+`pausado` (todos terminais) → `parcial`; todos `ativo` → `ativo`; todos `pausado` → `pausado`. Só `ativo` libera `familias.status='publicado'`.
2. Persistir `estado_desejado` (`ativando`|`pausando`) na raiz **antes** de disparar as mutações; o reconciliador de convergência só converge pra esse alvo, nunca infere.
3. Separar o caso do órfão sem ID: **não** é responsabilidade do reconciliador de convergência (que só opera sobre filhos com ID em `compensacao_pendente`). Vira um estado próprio, `criacao_incerta` (setado **antes** do POST, não depois), resolvido pela **própria saga na sua próxima execução** (retry natural via QStash, ou "Reenviar" manual já existente na UI) fazendo a busca por `sku` **antes** de tentar criar de novo — não pelo reconciliador de status.
4. Cache: corrigir a frase — "custa 1 POST desperdiçado" só se aplica no **cache miss** (1ª vez que a categoria aparece, ainda tenta `variations` primeiro); em **cache hit** a tentativa é corretamente pulada, sem custo nenhum. Sem TTL — mesmo precedente do ADR-0087 (cache permanente pro caso de 1 cor, já aprovado; risco de deriva de categoria é aceito, não uma lacuna nova deste ADR).
5. Remoção UP vira mini-saga simétrica à criação: pausar cada filho e confirmar por GET; se todos confirmados, deletar local; se algum falhar, persistir `remocao_pendente` e preservar todas as linhas (nunca deletar parcialmente) até retry/reconciliação.
6. Adicionar o reconciliador de convergência à "Implementação prevista" como componente próprio (entrypoint, autenticação, agendamento, critérios de aceite para os 3 desfechos: convergiu ativo, convergiu pausado, esgotou tentativas).
7. FK composta: decidir por `unique (id, org_id)` em `anuncios_externos` + FK composta real `(anuncio_externo_id, org_id) references anuncios_externos(id, org_id)` no filho — descartar a opção "trigger/check" (CHECK não consulta outra tabela no Postgres).
8. Especificar o endpoint real confirmado: `GET /users/{seller_id}/items/search?sku=<sku>&category_id=<categoria>` (ML, verificado via WebSearch) — paginação e filtro de recência (por `date_created`/janela) tratados client-side sobre o resultado; >1 match ambíguo → erro manual (já decidido na rodada 2).

### ADR revisada para a rodada 3 (2026-07-22)

`docs/decisions/0088-publicacao-user-products-multi-item.md` reescrita com as 9 correções aceitas da rodada 2: `remover-publicado` declarado **comportamento novo** (não estende semântica — hoje não chama o ML), escopado só a famílias UP (Legacy fora de escopo); "tombstone" movido para o lado do ML (pausar filhos → delete local em cascata), sem exceção à FK; dois reconciliadores separados e nomeados (**backfill** só-GET × **convergência** mutável/PUT); adoção por `seller_custom_field` escopada (seller+categoria+`family_name`+janela; >1 match → erro manual); critério de aceite de POST suavizado para consistência eventual; cache só grava com a assinatura reativa exata 369+374; `variacao_id` nulável `on delete set null`; regra de agregação de estado dos N filhos adicionada; texto residual §5 ("três" `index.ts`; só a partição 0 em `familias.ml_item_id`). RLS, guarda de `atualizar-status-publicado` e existência do plano **não** re-arbitradas (confirmadas corretas na rodada 2). Pronta para a rodada 3 do Codex.

## Round 4 — Codex

VERDICT: REVISE

As correções de FK, remoção, agregação dos estados não-vazios, separação dos reconciliadores e busca por SKU estão bem encaminhadas. Ainda achou:

1. Reconciliador ainda viola `estado_desejado`: o passo 8 e a Implementação prevista ainda dizem "não deu pra ativar → pausar tudo", contradizendo "só converge pro alvo persistido" (que diria: `ativando` que esgota devia virar `erro`, não pausar).
2. Critério de aceite ainda atribui `criacao_incerta` ao reconciliador de convergência ("se persistir, pelo reconciliador"), contradizendo o corpo do texto que diz que ele nunca trata filhos sem `item_externo_id`.
3. Função de agregação não define o conjunto vazio: raiz criada antes dos filhos, "todos ativos" pode ser vacuosamente verdadeiro (`every([]) === true`) e liberar publicação prematura.
4. Falta persistir a cardinalidade esperada: "todos os filhos ativos" não detecta o worker ter reservado só 7 de 9 linhas — 7 ativos ficaria indistinguível de conclusão legítima.
5. Pesquisou mais a doc oficial e achou que só `sku` é confirmado como filtro server-side no endpoint privado; `category_id` combinado nesse mesmo endpoint não está demonstrado na página oficial — só validar categoria/family_name/seller/janela via GET dos IDs retornados.
6. Paginação "client-side" descrita vagamente — especificar `paging.total/offset`, limite 100, multiget; ambiguidade/truncamento deve bloquear adoção (nunca assumir).
7. `estado_desejado` não tem regra de limpeza — pode ficar preso de uma operação antiga e confundir reconciliação futura.

### Claude's response

Todos os 7 pontos são reais e aceitos sem ressalva — são refinamentos de correção direta, não decisões contestáveis:

1. Regra única: `ativando` que esgota tentativas de ativação vira `erro` (nunca pausa sozinho); só `pausando` converge pra pausado. Remove a contradição do passo 8/Implementação prevista.
2. Critério de aceite corrigido pra bater com o corpo: `criacao_incerta` é sempre resolvido por retry/backoff da própria saga; ao esgotar, vira `erro`/intervenção manual — nunca pelo reconciliador de convergência.
3. Agregação ganha a regra `zero filhos → publicando` (nunca `ativo` por vacuidade) como primeira regra da função total.
4. Persistir `itens_esperados` (contagem ou snapshot do conjunto de SKUs esperado) na raiz **antes** de iniciar a saga; agregação e reconciliação exigem **igualdade exata** de contagem antes de aceitar `ativo`.
5. Aceito — reduzir a confiança no endpoint: só `sku` é filtro server-side garantido; `category_id`/`family_name`/seller/janela de tempo são validados via GET/multiget dos IDs retornados, não assumidos como filtro combinado.
6. Especificar paginação real: `paging.total`/`offset`, limite 100, seguido de multiget dos IDs; resultado ambíguo ou truncado bloqueia adoção automática (vira erro manual).
7. `estado_desejado` limpo atomicamente ao atingir o estado terminal confirmado; só fica preenchido durante operação pendente/compensação em andamento.

### ADR revisada para a rodada 4 (2026-07-22)

`docs/decisions/0088-publicacao-user-products-multi-item.md` reescrita com as **8 correções aceitas da rodada 3**: (1) regra de agregação vira **função total** de 6 casos com `publicando`/`parcial`, só `ativo` libera `publicado`; (2) `estado_desejado` (`ativando`|`pausando`) persistido na raiz **antes** de qualquer PUT em lote, e o reconciliador de convergência converge só pra esse alvo; (3) órfão sem ID separado do `compensacao_pendente` como estado próprio `criacao_incerta` (setado **antes** do POST, resolvido pela própria saga na próxima execução via QStash/"Reenviar", não pelo reconciliador); (4) contradição do cache resolvida por hit (zero custo)/miss (1 POST), sem TTL (precedente ADR-0087); (5) remoção UP vira mini-saga simétrica (pausar + confirmar por GET; `remocao_pendente` preservando todas as linhas em falha parcial); (6) reconciliador de convergência adicionado à "Implementação prevista" com entrypoint/agendamento/3 desfechos; (7) FK composta concreta `unique (id, org_id)` no pai + `(anuncio_externo_id, org_id) references anuncios_externos(id, org_id)` na filha, opção trigger/CHECK removida; (8) endpoint real `GET /users/{seller_id}/items/search?sku=<seller_custom_field>&category_id=<categoria>` especificado (paginação/recência client-side, >1 match → erro manual). RLS, guarda de `atualizar-status-publicado` e existência do plano **não** re-tocadas. Pronta para a rodada 4 do Codex.

### ADR revisada para a rodada 5 (2026-07-22) — ÚLTIMA rodada (MAX_ROUNDS=5)

`docs/decisions/0088-publicacao-user-products-multi-item.md` revisada com as **7 correções aceitas da rodada 4** (todas sem ressalva): (1) `estado_desejado='ativando'` que esgota tentativas → **`erro`**, nunca "pausar tudo" — corrigido em TODOS os lugares (passo 8, passo 9, reconciliador de convergência, Consequências, Validação, Implementação prevista); só `pausando` converge pra pausado; (2) critério de aceite corrigido — `criacao_incerta` resolvido por retry/backoff da própria saga, nunca pelo reconciliador de convergência; (3) agregação ganha `zero filhos → publicando` como primeira regra (nunca `ativo` por vacuidade de `every([])`); (4) coluna `itens_esperados` na raiz, persistida antes de criar itens; agregação e reconciliador exigem **igualdade exata** de contagem de filhos `ativo` para aceitar `ativo`; (5) confiança no endpoint de busca reduzida — só `sku` é filtro server-side garantido; `category_id`/`family_name`/seller/janela validados via GET/multiget dos IDs retornados; (6) paginação real (`paging.total`/`offset`, limite 100, multiget); ambíguo/truncado bloqueia adoção → erro manual; (7) regra de limpeza de `estado_desejado` (setado `null` ao confirmar o estado terminal). Releitura final do documento inteiro sem contradição residual (distinção reforçada em todos os pontos: **pausar é ação de compensação segura; o estado terminal de uma ativação que não converge é `erro`, nunca `pausado`**). ADR pronta como versão final.

## Round 5 — Codex (veredito final: REVISE) + encerramento do loop

VERDICT: REVISE. A rodada 5 foi a **última do loop formal** — o skill `codex-review` sempre termina no teto `MAX_ROUNDS=5`, aprovado ou não, e aqui o teto foi atingido com veredito REVISE. Os 5 achados estavam todos concentrados no **mesmo problema**: a agregação de estado não lidava corretamente com UPDATE (adicionar/retirar cor de uma família já publicada). Em síntese: (1) cor retirada travava a partição em `parcial` pra sempre, porque a agregação contava todos os filhos, inclusive o pausado-por-retirada; (2) `itens_esperados` estava ambíguo ("inteiro OU snapshot") — um inteiro não detecta substituição de SKU nem distingue filho histórico; (3) a função de agregação não era total pro caso `filhos > esperados`; (4) o UPDATE não definia a ordem transacional de mudar a expectativa (add/remove cor); (5) o backfill não inicializava a expectativa.

**Decisão de Diego:** aplicar esse fix final **fora do loop formal** (sem mais rodadas de Codex) e **aceitar a ADR**. Correções aplicadas em `docs/decisions/0088-publicacao-user-products-multi-item.md` (2026-07-22): substituição de `itens_esperados` (inteiro) por **`skus_esperados`** — snapshot explícito do conjunto EXATO de SKUs esperados (`jsonb`/`text[]`); nova coluna **`retirado`** (boolean) na linha filha, marcando cor removida (pausada no ML, linha preservada como histórico, excluída da agregação); **invariante do conjunto** (SKUs dos filhos não-retirados `==` `skus_esperados`), com a agregação virando função total que exclui retirados e classifica excesso não-explicado como `erro`; **mini-saga de composição** no UPDATE (persistir novo snapshot + marcador transitório **`mudando_composicao`** antes de qualquer chamada remota; CREATE/pausa; confirmar por GET; só então ligar `retirado`/limpar o marcador — crash no meio é retomado pelo reconciliador de convergência, que ganhou um branch `mudando_composicao`); e o **backfill** passando a gravar `skus_esperados = {SKU}` junto da raiz + linha filha. Releitura completa do documento sem `itens_esperados` residual como inteiro solto. **Status da ADR: Aceito (2026-07-22).**

