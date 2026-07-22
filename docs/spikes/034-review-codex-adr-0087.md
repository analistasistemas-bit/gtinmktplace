# Spike 034 — Revisão adversarial (Codex) do ADR-0087

Transcrição da revisão adversarial de plano (Claude ↔ Codex, 5 rodadas, `codex-review`) do
[ADR-0087](../decisions/0087-family-name-deteccao-reativa.md) antes da implementação.
MAX_ROUNDS=5. Aprovado na rodada 5.

# Plan Review Log: ADR-0087 — detecção reativa de categoria que exige item plano (family_name)
Alvo: docs/decisions/0087-family-name-deteccao-reativa.md (commit 7432eca, worktree-adr-family-name-reativo). MAX_ROUNDS=5.

## Round 1 — Codex

Pontos principais:
1. Premissa "comportamento por categoria" contestada — existe tag `user_product_seller`
   (GET /users/{id}) que sinaliza rollout do modelo "Preço por Variação"/User Products por
   vendedor; cache global só-por-categoria pode estar errado.
2. Solução não escala além de monovariação (aceito como escopo conhecido, igual ADR-0084).
3. `montarPayloadItem` só entra no ramo plano via `categoriaExigeFamilyName` — retry reativo
   não tem como forçar esse ramo sem um parâmetro explícito.
4. "cause_id 369+374" não é assinatura suficientemente exata (369 aparece em outros erros).
5. Causa bloqueante adicional junto dos 2 códigos pode gerar retry inválido.
6. 400 sem corpo != idempotência geral (timeout/5xx ambíguo pode ter criado o item).
7. Publicação concorrente da mesma família pode duplicar (pré-existente ao pipeline, não
   introduzido por este ADR).
8. Falha local pós-sucesso remoto (não persistir ml_item_id) — mesma classe de risco já
   presente em `criarAnuncio` hoje, não é regressão desta ADR.
9. "seed/cache opcional" indefinido — precisa decisão explícita pro v1.
10. `family_name` = titulo_ml sem validar `max_title_length` do domínio — herdado do
    ADR-0084 (já existe no branch plano hoje), não é novo nesta ADR.
11. Anexar `cause` bruto a um Error genérico é contrato informal.
12. Falta observabilidade específica do fallback.
13. UPDATE inferindo "item plano" só por `variations.length === 0` é frágil (ADR-0084,
    herdado — mas esta ADR aumenta o número de categorias que passam por esse caminho).
14. Validação só via reprocessar lote real é insuficiente — faltam testes unitários.
15. Alternativa não avaliada: checar tag do seller (`user_product_seller`) preventivamente.

VERDICT: REVISE

### Claude's response

Pesquisei os pontos 1 e 15 (WebSearch em developers.mercadolivre.com.br) antes de aceitar —
**confirmados**: existe mesmo a tag `user_product_seller` exposta em `GET /users/{id}`,
parte do rollout oficial "Preço por Variação"/User Products, migração gradual por conta E
por categoria dentro da conta (ex.: autopeças/ferramentas migradas automaticamente,
resto do catálogo do mesmo vendedor intacto) — bate com o que o ADR-0084 já tinha observado
empiricamente (mesma conta, categorias diferentes, comportamento diferente).

Isso é uma correção real de premissa, não just uma preferência de estilo — incorporado:
adiciona a checagem da tag como um gate barato (contas sem a tag pulam toda a complexidade,
comportamento idêntico a hoje) + mantém o retry reativo por categoria pra contas COM a tag
(porque a migração é parcial mesmo dentro de uma conta taggeada).

Aceitos e incorporados: #3 (parâmetro explícito `formato` em vez de gate só por categoria),
#4+#5 (assinatura exata: status 400 + os 2 códigos + nenhuma outra causa bloqueante), #6
(retry só em 400 completo, não em erro de rede/timeout ambíguo), #9 (v1: Set permanece
imutável, sem cache — decisão explícita, não indefinição), #11 (anexar `cause` tipado ao
erro, seguindo o padrão já usado por `status`/`retentavel`), #12 (log estruturado), #13
(persistir o formato real usado em vez de inferir por `variations.length`), #14 (lista de
testes unitários antes do teste real controlado), #1/#15 (tag do seller).

Rejeitados com razão:
- #7 (lock/idempotência contra publicação concorrente da mesma família): risco pré-existente
  de todo `criarAnuncio` (existe com ou sem retry — 1 POST já cria o recurso hoje sem lock
  nenhum); fora de escopo desta ADR, que troca só ONDE o payload plano é decidido, não
  redesenha concorrência do pipeline inteiro. Não incorporado — sinalizado como risco
  conhecido e pré-existente.
- #8 (falha local pós-sucesso remoto): mesma classe de risco já presente em qualquer
  `criarItemML` bem-sucedido hoje (retry ou não); não é introduzido por este ADR. Não
  incorporado, mesma razão do #7.
- #10 (limite de tamanho de `family_name`): código do branch plano é o mesmo já implementado
  no ADR-0084 (`montarPayloadItem`), não é novo aqui. Fora de escopo desta ADR — se for um
  bug real, é do ADR-0084. Mencionado como caveat herdado, não resolvido aqui.
- #11 parcial: rejeitada a sugestão de criar uma classe `MLItemError` nova — o projeto já usa
  o padrão leve de anexar propriedades ao `Error` (`status`, `retentavel`); manter
  consistência (Simplicidade/CLAUDE.md) anexando `cause` do mesmo jeito, não introduzir
  hierarquia de classes para 1 campo a mais.
- #2 (escala além de monovariação): mantido fora de escopo, igual ADR-0084 — redesenho de
  N-itens-por-família é maior, ADR futuro se/quando um caso real de >1 variação aparecer
  numa categoria com essa exigência.

## Round 2 — Codex

Pontos principais (todos sobre viabilidade de implementação, não mais sobre a premissa
conceitual — Codex reconheceu "a decisão conceitual agora é defensável"):
1. `criarAnuncio`/conector não recebe `familia_id` nem tem como persistir o formato usado.
2. Persistir só em `familias` conflita com a separação multicanal (`anuncios_externos` seria
   o lugar correto por canal).
3. Caminho de UPDATE (`AtualizacaoCanonica`) não carrega o formato — `atualizarAnuncio`
   continuaria preso ao heurístico `variations.length === 0`.
4. Falta estratégia de backfill/migração pros 2 anúncios planos já existentes (ADR-0084).
5. Gate por conta não define de onde vem o `{user_id}` (`ContextoCanal` só tem `getToken()`).
6. Falha ao consultar a tag do vendedor não tem semântica definida (fail-open vs fail-closed).
7. Cache "por conexão ML/org" subespecificado (TTL, invalidação, localização).
8. Assinatura ainda não é "exata" o bastante — só checa cause_id, não os `code` string.
9. Testes não cobrem o novo gate nem a 2ª chamada (orquestração, não só unidades isoladas).
10. Log estruturado com `familia_id` não cabe no conector atual.

VERDICT: REVISE

### Claude's response

Verifiquei cada claim de arquitetura direto no código antes de aceitar (não tomei a palavra
do Codex): `contrato.ts` confirma `RefAnuncio`/`AnuncioCanonico`/`AtualizacaoCanonica`/
`ContextoCanal` exatamente como descrito — sem campo de formato, sem identidade de conta.
Mas achei um erro de contexto no próprio Codex: ele leu a arquitetura genérica multicanal
(`publicar-anuncio/processar.ts`, E6/ADR-0061 — usada só por canais FUTUROS, o comentário no
topo do arquivo diz literalmente "o ML segue nos workers dedicados, intocado"). O ML de
verdade roda em `publish-familia-ml/index.ts` / `update-familia-ml/index.ts`, que já
persistem `ml_item_id`/status direto em `familias` (fonte de verdade — confirmado no
`atacado_status`/`ml_item_id` ali, e no comentário da própria migration de
`anuncios_externos`: "as colunas ml_*/catalog_* em familias/variacoes seguem como fonte de
verdade; esta tabela é o espelho"). Ou seja, persistir o formato em `familias` (não em
`anuncios_externos`) é consistente com o padrão já estabelecido pro ML, não uma violação da
separação multicanal — corrigi a referência de arquivo no ADR, mantive `familias` como
destino.

Ao tentar fechar #5/#6/#7 (de onde vem o user_id, semântica de fail-open, TTL de cache),
percebi que o gate por conta como MECANISMO OPERACIONAL não se sustenta: ele só economizaria
o POST malsucedido se déssemos pra pular a 1ª tentativa (`variations`) — mas o retry reativo
só dispara quando o ML REJEITA de verdade, então contas/categorias que nunca precisam de item
plano NUNCA pagam custo extra, com ou sem checar a tag antes. A tag não sabe QUAL categoria
precisa, só que a CONTA pode ter alguma — não dá pra pular a tentativa por categoria com essa
informação. **Removido o gate por conta como mecanismo do v1** — simplificação, não
complexidade adicional: elimina de uma vez #5/#6/#7 (não há mais fail-open, TTL ou user_id
pra especificar) sem perder nada de correção. A tag/achado do `user_product_seller` fica só
como CONTEXTO explicativo (corrige a premissa do ADR-0084) — não como parte da decisão.

Aceitos e incorporados: #1+#3 (novo campo `formatoPublicacao` em `RefAnuncio`, novo campo
opcional em `AtualizacaoCanonica`, plumbing correto via os workers reais — não o E6
genérico), #4 (sem backfill dedicado — o heurístico antigo (`variations.length === 0`)
continua sendo o fallback quando a coluna nova é `null`, cobre os 2 registros do ADR-0084
sem migração de dados), #8 (assinatura casa `status===400` + os 2 `code` exatos + os 2
`cause_id` + zero causa bloqueante adicional, não só os IDs), #9 (lista de testes de
orquestração, não só do detector isolado), #10 (resolvido pela correção de #2 — o worker
real já tem `familia` em escopo, não precisa de novo campo no contrato pra logar).

Rejeitado: gate por conta como mecanismo (ver acima — removido, não é uma rejeição sem ação,
é uma simplificação que fecha #5/#6/#7 de uma vez).

## Round 3 — Codex

Bloqueante:
1. `formatoPublicacaoConhecido` persistido descreve como o item foi CRIADO, não seu estado
   ATUAL — o ML pode migrar um item legado pra User Products depois (fora do controle do
   PubliAI). Se isso acontecer, o campo persistido (`'variations'`) ficaria desatualizado e
   faria o UPDATE ignorar o GET real (`variations: []`), ressuscitando o no-op silencioso que
   o próprio ADR-0084 corrigiu. Fix sugerido: GET ao vivo é autoridade; persistido é só
   expectativa; reconciliar ou falhar alto na divergência, nunca forçar UPDATE contra a
   estrutura observada.
2. `cause` como nome de propriedade colide com `Error.cause` nativo (ES2022, semântica
   diferente). Fix: renomear pra `mlCauses`.

Não-bloqueante:
3. Incremento 2 (cache futuro) proposto chaveado só por categoria, mas o próprio Contexto diz
   que o comportamento depende de conta+categoria — inconsistente.
4. "Assinatura exata" poderia também checar o conteúdo das mensagens (menção a family_name/
   price/available_quantity/variations), não só code+cause_id.

VERDICT: REVISE

### Claude's response

Ponto 1 é o mais importante do loop inteiro — reexaminei a própria lógica que criei na rodada
2 e percebi que ela era desnecessária, não só arriscada. O heurístico ao vivo
(`atual.variations.length === 0` no GET pré-PUT) já é a fonte de verdade correta e já está
validado end-to-end pelo ADR-0084 (2 rodadas de simulação real, ida e volta de preço/estoque).
Ele não é "frágil" — ele é o estado real no momento do UPDATE, que é exatamente o que importa
pra montar o PUT certo. O campo persistido que eu adicionei na rodada 2 não substituía
corretamente esse GET (o UPDATE sempre faz o GET de qualquer jeito, pra reenviar todas as
variações) — ele só criava um 2º sinal que podia divergir do 1º e, se eu confiasse nele
por engano, reintroduzia exatamente o bug que o ADR-0084 já fechou.

**Removido `AtualizacaoCanonica.formatoPublicacaoConhecido`, `RefAnuncio.formatoPublicacao`,
`familias.formato_publicacao_ml` e todo o plumbing em `publish-familia-ml/index.ts`/
`update-familia-ml/index.ts` do escopo do v1** — não por render-se ao "não implementável",
mas porque o ponto 1 do Codex expôs que a persistência não tinha função nenhuma que o GET ao
vivo já não cumprisse melhor: CREATE não precisa saber formato anterior (não existe estado
prévio), UPDATE já deriva corretamente do GET ao vivo. Isso simplifica o ADR de volta ao
essencial: só o retry reativo no CREATE (que precisa do parâmetro `formato` em
`montarPayloadItem` porque ali não há GET prévio pra consultar) — UPDATE fica **intocado**,
sem nenhuma mudança, porque o código do ADR-0084 já está certo.

Aceito e incorporado: #2 (`cause` → `mlCauses`, evita colisão com `Error.cause` nativo — bom
achado, eu não tinha notado), #3 (incremento 2 futuro, se vier a existir, chaveado por
seller/conexão+categoria, não só categoria), #4 (detector também confere trecho da mensagem
como camada extra de defesa, barato de adicionar).

## Round 4 — Codex

Duas ambiguidades de fluxo de controle (arquitetura considerada "essencialmente correta"):
1. `ChannelConnector.criarAnuncio` promete nunca lançar (sempre devolve `ResultadoCanal`) —
   mas o retry, se colocado dentro do `catch` atual de `mercado-livre.ts`, e a 2ª tentativa
   falhar (`criarItemML` lança de novo, ou `montarPayloadItem` lança pro caso >1 variação
   descoberto só agora reativamente), esse lançamento escapa do `catch` externo e quebra o
   contrato do conector.
2. "1ª tentativa sempre variations" contradiz manter o Set como seed: pra `MLB271227` (já
   conhecida), o comportamento de hoje já começa direto no plano — forçar `variations`
   primeiro introduziria uma rejeição desnecessária e regrediria o ADR-0084.

VERDICT: REVISE

### Claude's response

Ambos corretos e verificados no código: `mercado-livre.ts` hoje chama `montarPayloadItem`
FORA do try/catch (linha 53) e só entra no try no `criarItemML` (linha 62) — um retry
colocado dentro do bloco `catch` atual, reconstruindo com `montarPayloadItem(...,
{formato:'plano'})` e chamando `criarItemML` de novo, teria QUALQUER falha (throw de
multi-variação ou 2º erro do ML) escapando do conector sem virar `ResultadoCanal`. Corrigido:
especificado 1 único try/catch externo envolvendo as duas tentativas, com 1 catch final que
sempre devolve `{ok:false, erro: classificarErroCanal(e)}` — nunca deixa escapar.

`formatoInicial` agora explícito: `categoriaExigeFamilyName(categoria) ? 'plano' :
'variations'` — Set continua sendo o atalho pra categorias já conhecidas (zero POST
desperdiçado nelas, comportamento idêntico ao ADR-0084 hoje); só categorias FORA do Set
começam em `variations` e podem acionar o retry reativo.

Teste de multi-variação corrigido: espera `ResultadoCanal` de falha (via
`classificarErroCanal`), não um `throw` escapando do conector — o `throw` interno de
`montarPayloadItem` continua existindo (mesmo comportamento LOUD do ADR-0084), só que agora
capturado corretamente pelo try/catch único.

## Round 5 — Codex

VERDICT: APPROVED — "categorias conhecidas continuam no caminho plano direto; categorias
novas usam fallback estritamente delimitado; detector é conservador; nenhuma exceção escapa
do contrato do conector; UPDATE permanece baseado no estado ao vivo; riscos preexistentes e
multi-variação estão corretamente delimitados; testes cobrem caminhos de sucesso, falha,
retry único e contrato de erro."

## Resultado

Aprovado após 5 rodadas (teto MAX_ROUNDS atingido no momento da aprovação). ADR-0087 pronto
pra implementação.
