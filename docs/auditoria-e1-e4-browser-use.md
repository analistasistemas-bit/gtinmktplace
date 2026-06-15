# Auditoria E1-E4 via browser-use

Data: 2026-06-14  
Escopo: validar pela UI o fluxo E1 ate E4, registrar achados e acompanhar as correcoes aplicadas.  
Ambiente: Vite local apontando para Supabase/producao.  
Conta usada: `analistasistemas@gmail.com`.

## Objetivo

Validar, pela interface real, se os epicos E1 ate E4 estao funcionais ponta a ponta:

- E1/E1b: abstracao de canal para publicacao, update e leitura de status.
- E2: espelho multicanal em `anuncios_externos`.
- E3: categoria generica via resolver em camadas e schema dinamico.
- E4: preenchimento de atributos por IA closed-set e publicacao de vertical nova.

Esta auditoria tambem registra os achados que precisam ser corrigidos e o estado da resolucao de cada um.

## Atualizacao das correcoes

Data: 2026-06-14  
Status geral: correcoes A1-A5 revalidadas por browser-use em producao/local, com ressalva de que a publicacao real que fechou A5 foi feita com a familia de fita. A furadeira validou E3/E4 ate Revisao (`MLB189007` + `VOLTAGE`), mas nao foi publicada nesta rodada porque caiu no erro de foto do ML antes da correcao final do retry.

Verificacao executada:

- `pnpm test` -> 91 arquivos, 630 testes passando.
- `pnpm exec eslint . --ignore-pattern '.claude/**' --ignore-pattern '.superpowers/**'` -> 0 erros; 7 avisos preexistentes de Fast Refresh.
- `pnpm build` -> TypeScript e build Vite concluindo com sucesso; aviso preexistente de chunk acima de 500 kB.

Arquivos alterados nas correcoes:

- `supabase/functions/_shared/categoria/resolver.ts`
- `supabase/functions/_shared/categoria/__tests__/resolver.test.ts`
- `src/lib/publicavel.ts`
- `tests/lib/publicavel.test.ts`
- `src/components/familia-row.tsx`
- `src/components/familia-expanded.tsx`
- `supabase/functions/_shared/ml/publicar.ts`
- `supabase/functions/_shared/ml/__tests__/publicar.test.ts`
- `supabase/functions/_shared/canais/mapeamento.ts`
- `supabase/functions/_shared/canais/__tests__/mapeamento.test.ts`
- `supabase/functions/_shared/publicacao/retry.ts`
- `supabase/functions/_shared/publicacao/__tests__/retry.test.ts`
- `supabase/functions/publish-familia-ml/index.ts`
- `supabase/functions/remover-publicado/index.ts`

## Reauditoria browser-use apos correcoes

Data: 2026-06-14  
Ambiente: Vite local (`127.0.0.1:5173`) + Edge Functions deployadas no Supabase.

Deploys executados para a reauditoria:

- `process-familia` apos reforco do resolver E3.
- `publish-familia-ml` apos ajuste do retry/limpeza de fotos em CREATE.
- `remover-publicado` apos ajuste para limpar tambem `anuncios_externos`.

### Rodada 1 da reauditoria

Lote: `#36`  
ID: `f2f4f002-0a4d-4f69-8621-07856aa44033`

Familias:

| Codigo pai | Resultado |
|---|---|
| `99142000` | Fita em `MLB255054`, override regex OK |
| `99143000` | Furadeira ainda caiu em `MLB11400` |

Resultado:

- A reauditoria reproduziu uma lacuna do primeiro fix de A1: a guarda semantica so corrigia quando o preditor trazia uma categoria de furadeira entre os candidatos.
- Foi aplicado reforco no resolver: para pista forte explicita de ferramenta, se o preditor so trouxer candidato incompatível, usa a categoria validada `MLB189007`.
- Teste novo adicionado em `resolver.test.ts`: caso em que o preditor so retorna `MLB11400`.

### Rodada 2 da reauditoria

Lote: `#37`  
ID: `5abad081-94a4-46b2-947c-19557922ea30`

Familias:

| Codigo pai | Produto | Resultado |
|---|---|---|
| `99144000` | Fita de cetim | Publicada com sucesso apos retry de foto |
| `99145000` | Furadeira 650W bivolt | Categoria e atributos E4 corretos; publicacao caiu em erro de foto antes do fix final |

Evidencias E3/E4 da furadeira:

- UI mostrou `Categoria -> De Mao -> MLB189007`.
- Banco confirmou `tipo_origem=ia`.
- Banco confirmou `atributos_ml` com `BRAND`, `MODEL` e `VOLTAGE`.
- `atributos_faltantes=[]`.
- A familia ficou selecionavel na Revisao, sem bloqueio indevido por `sem cor`.

Evidencias E1/E2/A4/A5 da publicacao:

- Publicacao disparada pela UI: selecionar familia -> modal -> confirmar publicacao -> Relatorio.
- Primeiro erro de foto deixou de prender a familia em `publicando`; status virou `erro` com mensagem operacional.
- Apos ajuste final, o worker limpou caches de foto efemeros e o retry via QStash criou o item real:
  - `ml_item_id=MLB6967261422`
  - `ml_variation_id=196516870226`
  - `ml_permalink=http://produto.mercadolivre.com.br/MLB-6967261422-fita-cetim-progresso-n1-10mt-ideal-para-artesanato-_JM`
- `anuncios_externos` recebeu o espelho:
  - `codigo_pai=99144000`
  - `canal=mercado_livre`
  - `item_externo_id=MLB6967261422`
  - `variacoes_externas.99144001.variation_id=196516870226`

Cleanup da reauditoria:

- Item `MLB6967261422` retirado do estado ativo via one-off temporaria autenticada; ML retornou `status=inactive`, `sub_status=["waiting_for_patch"]`.
- One-off `oneoff-encerrar-item-ml` removida do Supabase e do workspace.
- `remover-publicado` removeu a familia publicada e storage.
- `excluir-lote` removeu os lotes `#36` e `#37` restantes.
- Residuo inicial em `anuncios_externos` foi removido e a edge `remover-publicado` foi corrigida para limpar o espelho automaticamente nas proximas execucoes.
- Confirmado ao final: sem familias, lotes ou espelhos restantes para `99142000`, `99143000`, `99144000`, `99145000`.

## Evidencias coletadas

### Baseline antes do teste

Consulta inicial para o usuario `5b415a5a-daa6-45c8-9597-5360259668a5`:

| Metrica | Valor |
|---|---:|
| Lotes | 9 |
| Familias | 22 |
| Variacoes | 418 |
| Espelhos ML em `anuncios_externos` | 21 |
| Familias em `processando`/`publicando`/`erro` | 0 |

### Fluxo executado via UI

1. Login pela tela inicial com a conta real.
2. Upload de planilha `.xlsx` e duas imagens em `Novo lote`.
3. Processamento do lote pela UI.
4. Abertura da Revisao do lote criado.
5. Inspecao de categoria, selo de IA, preco, concorrencia e pendencias.
6. Edicao de foto e cor de uma variacao.
7. Selecao de uma familia publicavel.
8. Abertura do modal de publicacao.
9. Confirmacao de publicacao.
10. Acompanhamento do Relatorio.
11. Cleanup completo de storage e banco.

### Lote temporario criado

Lote: `#35`  
ID: `ccf9c335-dc53-4ae5-8b48-f4879ef32741`

Familias:

| Codigo pai | Produto | Objetivo do teste |
|---|---|---|
| `90010000` | Fita de cetim | Validar caminho deterministico/override de aviamento |
| `90020000` | Furadeira 650W bivolt | Validar categoria generica + atributos E4 |

Arquivos temporarios usados:

- `audit_e1e4.xlsx`
- `CAPA_90010000.jpg`
- `CAPA_90020000.jpg`

## Resultado por epico na rodada original

Os resultados abaixo descrevem a execucao browser-use feita antes das correcoes locais. O status atualizado de resolucao esta na secao "Achados e resolucoes".

### E1/E1b - Camada de canal e publicacao

Status: parcialmente funcional, com falha operacional no worker.

Evidencias:

- A UI abriu o modal de publicacao corretamente.
- A selecao de familia publicavel funcionou.
- `publicar-familias` retornou `200`.
- O Relatorio mostrou `1 familia(s) enfileirada(s) para publicacao`.
- O worker `publish-familia-ml` retornou `500` apos a confirmacao.
- A variacao recebeu `ml_picture_id`, mas a familia ficou presa em `publicando`, sem `ml_item_id`.

Conclusao:

O acionamento UI -> edge -> fila funciona. A conclusao do CREATE no ML ainda falha em uma condicao real de foto/retry.

### E2 - `anuncios_externos`

Status: baseline consistente; caminho novo nao chegou a criar espelho porque a publicacao falhou antes de `ml_item_id`.

Evidencias:

- Antes do teste: `anuncios_externos_ml=21`.
- Depois do cleanup: `anuncios_externos_ml=21`.
- Nenhum espelho de auditoria ficou residual.

Conclusao:

O E2 nao apresentou regressao no estado existente. A auditoria nao conseguiu validar novo dual-write porque o E1/publicacao falhou antes da criacao do item.

### E3 - Categoria generica e schema dinamico

Status: override de aviamento OK; categoria generica com falso positivo relevante.

Evidencias:

Fita:

- `tipo_aviamento=fita`
- `tipo_origem=regex`
- `categoria_ml_id=MLB255054`
- `categoria_nome=Fita de Cetim`
- `atributos_faltantes=[]`

Furadeira:

- `tipo_aviamento=outro`
- `tipo_origem=preditor`
- `categoria_ml_id=MLB11400`
- `categoria_nome=Adaptadores e Gateways`
- UI exibiu selo `Sugerida por IA - confira`

Conclusao:

O override deterministico continua correto. O caminho generico aceitou uma categoria errada para uma furadeira, provavelmente influenciado pelo prefixo de auditoria e/ou pelo GTIN usado. Isso impacta diretamente E4, concorrencia, preco e publicabilidade.

### E4 - Atributos IA closed-set e publicacao de vertical nova

Status: nao validado com sucesso nesta auditoria; bloqueado por erro de categoria E3.

Evidencias:

- A furadeira caiu em `MLB11400`, categoria que nao exige `VOLTAGE`.
- `atributos_faltantes=[]`, mas por causa da categoria errada.
- `atributos_ml` ficou apenas com `BRAND` e `MODEL`.
- A UI mostrou preco e concorrencia incoerentes para o produto.

Conclusao:

O E4 nao teve oportunidade correta de preencher `VOLTAGE`, porque a entrada chegou com categoria errada. O problema primario e E3; E4 deve ser revalidado apos corrigir o resolver de categoria.

## Achados e resolucoes

### A1 - Furadeira classificada como categoria errada

Severidade: alta  
Area: E3/E4  
Status: corrigido e revalidado por browser-use

Sintoma:

Produto `AUDITORIA E1E4 FURADEIRA 650W BIVOLT` foi classificado como:

- `MLB11400`
- `Adaptadores e Gateways`

Esperado:

- Categoria de furadeiras, conforme validacoes anteriores com `MLB189007` (`De Mao`) ou categoria equivalente de furadeiras.

Impacto:

- E4 nao preenche `VOLTAGE`.
- `atributos_faltantes=[]` vira falso positivo, porque o schema lido e da categoria errada.
- Analise de concorrencia e preco ficam distorcidas.
- Produto de vertical nova pode parecer publicavel sem estar semanticamente correto.

Evidencia UI:

- Card da Revisao exibiu `Categoria -> Adaptadores e Gateways -> MLB11400`.
- Selo `Sugerida por IA - confira` apareceu.
- Analise marcou concorrencia/preco incompatíveis com furadeira.

Resolucao aplicada:

1. Foi adicionado teste de regressao com o titulo auditado e candidatos onde o top-1 errado e `MLB11400`.
2. O resolver ganhou uma guarda semantica conservadora para pistas fortes de ferramentas (`furadeira`, `parafusadeira`, `martelete`) quando a categoria correta esta entre os candidatos.
3. A reauditoria mostrou que isso ainda era insuficiente quando o preditor so trazia candidato incompatível; foi adicionado fallback validado para `MLB189007` nesse caso explicito.
4. Aviamentos continuam protegidos pelo override deterministico antes dessa etapa.

Evidencia de verificacao:

- `supabase/functions/_shared/categoria/__tests__/resolver.test.ts`
- `pnpm test` -> 630 testes passando.
- Browser-use rodada 2: furadeira `99145000` exibiu `De Mao / MLB189007`.

Resolvido em producao quando:

- Furadeira 650W bivolt cai em categoria de furadeiras.
- `VOLTAGE` aparece como atributo alvo.
- E4 preenche `VOLTAGE` com valor closed-set.
- UI mostra selo de IA com categoria correta.

### A2 - Produto unitario fica bloqueado por `sem cor`

Severidade: media/alta  
Area: UI Revisao / publicabilidade  
Status: corrigido e revalidado por browser-use

Sintoma:

Familias com uma unica variacao entraram com `cor=null` e ficaram bloqueadas:

- `sem cor`
- checkbox de familia desabilitado
- `Selecionar todos` desabilitado ate preencher manualmente a cor

Impacto:

- Produtos unitarios sem cor natural exigem edicao manual desnecessaria.
- Publicacao de vertical nova e produtos sem variacao real fica bloqueada por uma regra pensada para aviamentos coloridos.
- Pode mascarar sucesso de E3/E4 porque o operador nao consegue publicar sem preencher uma cor artificial.

Evidencia UI:

- Fita e furadeira apareceram com `cores -> sem cor`.
- As duas familias estavam com checkbox desabilitado inicialmente.
- A fita so ficou selecionavel depois de preencher `Azul` manualmente.

Resolucao aplicada:

1. Foi criada a regra `familiaExigeCor`: CREATE generico (`tipoAviamento=outro`) com uma unica variacao nao bloqueia por cor.
2. Aviamentos e familias com multiplas variacoes continuam exigindo cor.
3. A UI de Revisao passou a usar a mesma regra em `familia-row` e `familia-expanded`, evitando badge/bloqueio indevido.
4. O payload ML para variacao unica sem cor agora envia `COLOR=Único`, valor controlado, em vez de `COLOR` vazio.
5. Foram adicionados testes para produto generico unitario, aviamento unitario e payload ML.

Evidencia de verificacao:

- `tests/lib/publicavel.test.ts`
- `supabase/functions/_shared/ml/__tests__/publicar.test.ts`
- `pnpm test` -> 630 testes passando.
- Browser-use rodada 2: furadeira `99145000` ficou selecionavel na Revisao sem bloqueio por `sem cor`.

Resolvido em producao quando:

- Produto unitario sem cor natural fica publicavel quando foto, preco, estoque, GTIN/atributos e categoria estao OK.
- A UI nao exibe `sem cor` como bloqueio indevido.
- Aviamentos com cor obrigatoria continuam bloqueando quando cor falta.

### A3 - Campo de cor nao salva na primeira interacao simples

Severidade: media  
Area: UI Revisao / autosave  
Status: corrigido em codigo; nao revalidado manualmente nesta rodada browser-use

Sintoma:

Ao preencher a cor via campo de input, a primeira tentativa nao persistiu no banco. A cor so salvou apos interacao mais fiel:

- clicar no campo
- selecionar/apagar
- digitar
- sair com `Tab`/blur

Impacto:

- Operador pode acreditar que corrigiu a pendencia, mas a familia continua bloqueada.
- Risco de comportamento inconsistente entre automacao, teclado e mouse.

Evidencia:

- A foto da variacao salvou.
- Banco ainda mostrou `cor=null`.
- Depois de `blur`, a UI passou a exibir `Incluir cor Azul na publicacao` e a familia ficou selecionavel.

Resolucao aplicada:

1. O campo de cor agora dispara autosave com debounce apos a digitacao.
2. O `blur` continua funcionando como flush imediato e cancela o timer pendente.
3. O cleanup do componente limpa timers pendentes para evitar salvamento atrasado apos desmontagem.

Evidencia de verificacao:

- `src/components/familia-expanded.tsx`
- `pnpm exec eslint . --ignore-pattern '.claude/**' --ignore-pattern '.superpowers/**'` -> sem erros.
- `pnpm build` -> sucesso.

Resolvido em producao quando:

- Digitar cor e sair do campo sempre persiste.
- O banco reflete a cor sem exigir sequencia especifica de teclado.

### A4 - Publicacao fica presa em `publicando` apos `publish-familia-ml` 500

Severidade: alta  
Area: E1/publicacao worker/QStash  
Status: corrigido e revalidado por browser-use

Sintoma:

Depois de confirmar a publicacao pela UI:

- `publicar-familias` retornou `200`.
- `publish-familia-ml` retornou `500`.
- Familia ficou em `publicando`.
- `ml_picture_id` foi preenchido.
- `ml_item_id` ficou `null`.
- `anuncios_externos` nao recebeu espelho novo.

Impacto:

- O operador ve a familia presa em publicando.
- O sistema nao cria item ML nem registra erro final no banco rapidamente.
- E2 nao consegue espelhar porque nao ha item criado.
- O retry pode depender de re-enfileiramento manual.

Evidencia:

Banco durante a falha:

- `status=publicando`
- `ml_item_id=null`
- `ml_picture_id=818492-MLB113257128239_062026`
- `qstash_message_id=msg_7YoJx...`

Logs:

- `POST /functions/v1/publicar-familias -> 200`
- `POST /functions/v1/publish-familia-ml -> 500`

Resolucao aplicada:

1. O classificador de canal agora identifica erro nativo `retentavel=true` como codigo `FOTO`.
2. Foi isolada a decisao de retry em `_shared/publicacao/retry.ts`.
3. Erro de foto limpa caches efemeros (`ml_picture_id` e capas) para que o retry suba fotos frescas.
4. O QStash retenta erro de foto de forma limitada; ao esgotar, o worker grava `status=erro` com mensagem operacional clara.
5. Erros 5xx/429 continuam retornando 500 para o QStash retentar.

Evidencia de verificacao:

- `supabase/functions/_shared/publicacao/__tests__/retry.test.ts`
- `supabase/functions/_shared/canais/__tests__/mapeamento.test.ts`
- `pnpm test` -> 630 testes passando.
- Browser-use rodada 2: erro de foto nao ficou preso em `publicando`; apos ajuste final, retry da fita publicou `MLB6967261422`.

Resolvido em producao quando:

- Confirmar publicacao pela UI cria `ml_item_id` ou grava erro recuperavel claro.
- Familia nao fica indefinidamente em `publicando`.
- `anuncios_externos` recebe o espelho quando o item e criado.

### A5 - `anuncios_externos` nao foi revalidado em novo CREATE por causa da falha anterior

Severidade: media  
Area: E2  
Status: corrigido e revalidado por browser-use

Sintoma:

O E2 permaneceu consistente no baseline, mas a auditoria nao criou novo item ML; portanto nao houve novo dual-write para validar.

Impacto:

- Nao ha evidencia nova desta auditoria de que CREATE atual ainda grava `anuncios_externos`.
- Existe evidencia historica e baseline, mas nao uma prova nova no fluxo UI desta rodada.

Resolucao aplicada:

1. Edge Functions alteradas foram deployadas.
2. Publicacao UI de familia segura (`99144000`) criou item real `MLB6967261422`.
3. Confirmado:
   - familia `status=publicado`
   - `ml_item_id=MLB6967261422`
   - linha em `anuncios_externos`
   - `variacoes_externas.99144001.variation_id=196516870226`
   - cleanup do item de teste no ML e no banco

Resolvido:

- Novo CREATE via UI gera espelho em `anuncios_externos` e cleanup volta ao baseline.

Observacao:

- A publicacao real que fechou A5 foi a familia de fita, nao a furadeira. A furadeira validou E3/E4 ate Revisao.

### A6 - `remover-publicado` deixava espelho órfao em `anuncios_externos`

Severidade: media  
Area: E2 / cleanup operacional  
Status: corrigido e deployado

Sintoma:

Durante o cleanup da reauditoria, `remover-publicado` removeu a familia publicada e recontou o lote, mas deixou a linha:

- `codigo_pai=99144000`
- `item_externo_id=MLB6967261422`
- tabela `anuncios_externos`

Impacto:

- Baseline de `anuncios_externos` fica inflado apos remover publicacoes de teste.
- Proximas auditorias podem interpretar espelho órfao como anuncio ainda valido.
- O contrato E2 fica incompleto no caminho de remocao operacional.

Resolucao aplicada:

1. O residuo da auditoria foi removido diretamente via sessao autenticada.
2. `remover-publicado` passou a deletar tambem `anuncios_externos` por `user_id`, `canal=mercado_livre` e `codigo_pai`.
3. Edge `remover-publicado` redeployada.

Evidencia de verificacao:

- `pnpm test supabase/functions/_shared/lote/__tests__/exclusao.test.ts supabase/functions/_shared/anuncios/__tests__/espelhar.test.ts supabase/functions/_shared/publicacao/__tests__/retry.test.ts supabase/functions/_shared/categoria/__tests__/resolver.test.ts tests/lib/publicavel.test.ts` -> 71 testes passando.
- Cleanup final confirmou `familias=[]`, `lotes=[]`, `espelhos=[]` para os codigos de auditoria.

## Cleanup executado

### Storage removido

Foram removidos do bucket `imagens`:

- `5b415a5a-daa6-45c8-9597-5360259668a5/ccf9c335-dc53-4ae5-8b48-f4879ef32741/CAPA_90010000.jpg`
- `5b415a5a-daa6-45c8-9597-5360259668a5/ccf9c335-dc53-4ae5-8b48-f4879ef32741/CAPA_90020000.jpg`
- `5b415a5a-daa6-45c8-9597-5360259668a5/90010001.jpeg`

### Banco removido

Foram removidos:

- linha do lote `ccf9c335-dc53-4ae5-8b48-f4879ef32741`
- familias `90010000` e `90020000`
- variacoes associadas
- qualquer espelho de auditoria em `anuncios_externos`

### Baseline depois do cleanup

| Metrica | Valor |
|---|---:|
| Lotes | 9 |
| Familias | 22 |
| Variacoes | 418 |
| Espelhos ML em `anuncios_externos` | 21 |
| Familias em `processando`/`publicando`/`erro` | 0 |
| Lote de auditoria restante | 0 |
| Familias de auditoria restantes | 0 |

## Estado final apos reauditoria

- A1: resolvido; furadeira caiu em `MLB189007`.
- A2: resolvido; furadeira unitária ficou selecionavel sem bloqueio indevido por cor.
- A3: corrigido em codigo e build; nao foi reexecutado manualmente no browser-use desta rodada.
- A4: resolvido; erro de foto nao prende mais em `publicando` e retry com limpeza de cache permitiu publicacao real.
- A5: resolvido; CREATE via UI gerou espelho em `anuncios_externos`.
- A6: resolvido; cleanup de publicado agora remove tambem o espelho.

## Checklist de reauditoria executado

- Criar lote pela UI com uma familia de aviamento e uma de vertical nova.
- Confirmar que aviamento continua em categoria override correta.
- Confirmar que furadeira cai em categoria de furadeiras.
- Confirmar que E4 preenche atributo closed-set obrigatorio (`VOLTAGE`).
- Confirmar que produto unitario sem cor indevida fica publicavel.
- Publicar pela UI.
- Confirmar `ml_item_id`, `ml_variation_id`, `ml_picture_id` e `anuncios_externos`.
- Fechar/remover item de teste no ML.
- Limpar lote/storage/banco.
- Confirmar baseline restaurado para os codigos de auditoria.

Residual:

- A publicacao real da vertical nova (furadeira) nao foi concluida nesta rodada porque o lote foi limpo apos a publicacao segura da fita. A parte E4 critica foi validada no banco/UI: categoria `MLB189007`, atributo `VOLTAGE` closed-set e publicabilidade pela Revisao.

## Revisão pós-auditoria (2026-06-15)

Revisão independente das correções A1–A6 (testes, build, deploy x código, análise crítica).

- **Verificação:** 630 testes ok, `tsc` e `eslint` limpos. Deploys conferidos contra o código final: `process-familia`, `publish-familia-ml` e `remover-publicado` em dia.
- **A1 refatorado.** O fallback hard-coded `MLB189007` foi removido por ser band-aid que contraria a resolução genérica do ADR-0026, não escala por vertical e não valida a categoria em runtime. Novo contrato: a pista forte só corrige o top-1 quando há candidato compatível na lista do preditor; sem candidato compatível, o resolver devolve `manual` (categoria indefinida) e o operador escolhe na Revisão (`definir-categoria-familia`) — em vez de auto-atribuir categoria errada ou inventar uma fixa. Teste `(j)` reescrito; `process-familia` redeployado (v41).
- **Item residual `MLB6967261422`.** Confirmado no ML como `status=closed` (encerrado, não vendável) — estado terminal, sem ação pendente.
- **A2/A4/A6** mantidos como estão (sólidos). **A3** segue pendente de reconfirmação manual no browser.
- **Pendência E4 (decisão 2026-06-15):** não publicar furadeira sintética só para fechar o E2E. O publish real de vertical nova será validado quando uma furadeira real entrar num lote de produção normal. Registrado em `project-status.md`.
