# Plano — Galeria de fotos das peças no anúncio do kit com variação

- **Data:** 2026-11-12. **Branch:** `worktree-kit-galeria-pecas`. **ADR:** adendo no ADR-0200 (antes do código).
- **Pedido do Diego:** no anúncio do kit, foto 1 = foto do kit; as seguintes vêm intercaladas das galerias das peças da combinação. Kit Preto + Caqui: foto 2 = imagem 2 do Preto, foto 3 = imagem 3 do Caqui, foto 4 = imagem 4 do Preto, foto 5 = imagem 5 do Caqui…

## Fatos medidos (12/11, só leitura; nada escrito em anúncio)

Zaven, produto 00000140 (org `b95a1c97`), 9 itens UP planos (Preto/Azul Claro/Caqui × P/M/G), todos `active`, sem `sub_status`:

1. Cada item tem 9 fotos. Os 3 tamanhos de uma cor têm as mesmas 9 imagens na mesma ordem: `hash` de `GET /pictures/{id}` igual em todas as posições; o **id** só coincide nas posições 2 e 3 (nas demais o id muda por tamanho, o hash não). Entre cores todos os hashes diferem. ⇒ uma peça (um tamanho) por cor basta; dedup tem de ser por **hash**, não por id.
2. Limite de fotos: `MLB188064.settings.max_pictures_per_item = 12` (`..._var = 10`). `POST /items/validate` com 13 fotos → `item.pictures.max: cannot exceeds 12`.
3. `POST /items/validate` (nada criado) com fotos de **outros anúncios publicados** (foto 1 do Preto + 8 do Caqui; 12 fotos Preto+Caqui; cruzando 3 cores): **nenhum erro de foto**. Id falso → `picture_not_found` (o validador checa foto). Isso **não** é o CREATE real: a prova final é o 1º CREATE em produção, por isso há rebaixamento (abaixo).
4. A família do kit zera capas (`processar.ts:307`); o payload do CREATE hoje só aceita foto da variação + `capa2` + `capa3` (`_shared/ml/publicar.ts` `montarPayloadItem`).

## Regra da galeria (função pura)

`montarGaleriaKit({ fotoKit, cores: [{cor, fotos:[{id, hash}]}], limite })` → ids de fotos de peças.

- Fila: slot k = 0,1,2…; cor = `cores[k % n]` (na ordem do rótulo da combinação); imagem = a de índice k+1 da peça (2ª, 3ª, 4ª… — a 1ª da peça, a capa, fica de fora).
- Peça sem a imagem do slot: **o slot é pulado** (a cor seguinte mantém a sua posição na intercalação).
- Dedup por `hash` contra o que já entrou (e contra a foto do kit, se o hash for conhecido). Sem `hash` legível → a foto não entra.
- Total (foto do kit + galeria) ≤ `limite` (lido da categoria, `settings.max_pictures_per_item`; falha de leitura → galeria recusada, nunca presume 12).
- 9 fotos por peça, 2 cores → 8 fotos de galeria (9 no total); 3 cores idem.

## Arquitetura

**Fonte da verdade = ML.** Nada é copiado para o storage; o banco guarda só a lista de `picture_id`.

1. **Migration** `variacoes.galeria_ml_picture_ids text[] not null default '{}'` (RLS da tabela já cobre; conferir triggers `kit_variacao_*` que olham `variacoes`; atualizar `database.types.ts`). Timestamp conferido contra `origin/main` antes do merge.
2. **Edge nova `fotos-pecas-kit`** (só leitura, `verify_jwt=true`, módulo `kit_variacao`, token da org). Entrada: base + combinações (rótulo → cores, tamanhos). Por cor, a peça usada é a do **primeiro tamanho** (ordem de código) da combinação que tenha item vivo. Lê `/items/bulk` (lotes ≤ 20 ids únicos, `multiget.ts`) com `id,status,sub_status,pictures`, `GET /pictures/{id}` para o hash (limite de concorrência), `GET /categories/{id}` para o limite. Devolve por combinação: fotos propostas na ordem (id, `secure_url`, cor e posição de origem) e, por cor, `indisponivel: motivo`. Anúncio da peça `under_review`/`forbidden`/`waiting_for_patch`, não-`active`/`paused` ou leitura falha ⇒ **essa cor sai da galeria** com o motivo (não presume limpo). Nenhuma escrita, nenhum custo de IA/Apify.
3. **Criar kit (`criar-kit-variacao`)**: o pedido ganha `galeria: Record<rotulo, string[]>` (ids de origem já editados pelo operador; ausente/vazio = "só a foto do kit"). A edge **não confia no cliente**: recalcula o conjunto permitido (mesma leitura/regra do item 2) e só aceita ids que pertencem a peças daquela combinação, limpos e dentro do limite; o que não confere é descartado e o resultado devolve `aviso` (o kit nunca é recusado por causa da galeria). Grava `galeria_ml_picture_ids` nas variações da combinação (os tamanhos compartilham a lista, como o app já faz com capa2/capa3). O `pedidoHash` inclui `galeria` ordenada por rótulo ⇒ o mesmo pedido não muda de fotos. Retomada (`parcial`): variações já gravadas não são reescritas.
4. **CREATE (saga, `kit-transferencia.prepararItem`)**: `montar-canonico` passa a levar `galeria_ml_picture_ids` até `montarPayloadItem`, que acrescenta os ids depois da foto da variação, sem repetição e até o limite. Mudança aditiva (campo opcional): os demais fluxos não mudam. **Rebaixamento:** se o `POST /items` voltar 4xx com causa em `item.pictures.*`, a mesma closure refaz **uma** vez o POST só com a foto do kit (4xx = nada criado, não quebra a idempotência da saga) e grava aviso; nunca deixa o kit sem oferta nem trava a montagem depois que as peças foram reduzidas.
5. **Gerenciar kit** (`adicionarAoKit`): tamanho novo de combinação publicada copia a galeria da variação irmã; combinação nova recebe `galeria` do pedido pela mesma regra e validação do item 3. `pedido_hash` da adição inclui a galeria.
6. **UI (etapa 2 do Criar kit e Gerenciar)**: chama `fotos-pecas-kit` ao entrar na etapa 2 e ao mudar combinações; abaixo da foto do kit mostra a prévia (miniaturas numeradas 2…N, com a cor de origem), botão remover por foto e chave "Só a foto do kit". Padrão: intercalado ligado. Falha da leitura ⇒ aviso "fotos das peças indisponíveis", segue só com a foto do kit, não bloqueia. Visual herdado de `simulador-kit.tsx`/`referencia-avulso.tsx` (modo sistema, skill frontend-design-fable5). A galeria só vai ao ML depois de o operador passar pela etapa 2/3.

## Fora de escopo / decisões

- Sem upload nem download de foto (reuso de id). Se o 1º CREATE real recusar, abre-se tarefa para o plano B (baixar `D_NQ_NP_<id>-F.jpg` e subir por `/pictures/items/upload`, contrato do ensaio (e)).
- Sem uso do planejador `planejarFotosItem` (é de troca em anúncio existente, com retrato/desfazer). O kit é item novo; reaproveita-se `multiget.ts`, `CorpoFotosML` não é necessário. Nenhum PUT em anúncio existente. A Zaven não é republicada.
- Galeria de peça por **combinação** (peça do 1º tamanho), não por SKU×tamanho: medido que os tamanhos têm as mesmas imagens.

## Testes (TDD, primeiro vermelho)

Função pura (`galeria-pecas.test.ts`): 2 cores; 3 cores; peça com menos fotos pula o slot sem quebrar a intercalação; limite (9→limite menor corta no fim); sem repetição por hash; imagem 1 da peça fora; sem hash ⇒ fora; limite ilegível ⇒ recusa.
Leitura (`fotos-pecas-kit`): item moderado ⇒ cor sai; leitura de moderação/status falhou ⇒ cor sai (não presume limpo); só ids de peças da combinação; falha total ⇒ `indisponivel` sem lançar.
Criar: operador removeu foto / desligou galeria ⇒ pedido enviado reflete; id de fora da combinação é descartado com aviso; hash estável com a mesma galeria e diferente com outra; galeria nunca recusa o kit; retomada não regrava.
Payload: `montarPayloadItem` com galeria (ordem, dedup, limite); sem galeria ⇒ payload idêntico ao de hoje (regressão nos outros fluxos).
Saga/CREATE: 4xx `item.pictures.*` ⇒ 2º POST só com foto 1 + aviso; 2º POST também falha ⇒ comportamento atual (recusa definitiva); 5xx/timeout ⇒ não refaz (incerto).
UI: prévia numerada, remover, "só a foto do kit", leitura falha ⇒ aviso e criação só com foto do kit.
Dado real: `scripts/medir-galeria-pecas.ts` (só leitura) rodando a função sobre a 00000140 da Zaven (Preto+Caqui, Preto+Azul Claro, as 3 cores) e imprimindo a galeria resultante.

## Entrega e deploy

- `pnpm preflight`; `deno check`/`deno lint` com `--config supabase/functions/deno.json`.
- Mudança em `_shared/` ⇒ `deno info --json` de todas as edges que importam `ml/publicar.ts`, `anuncios/montar-canonico.ts`, `user-products/publicar-familia-up.ts` e o módulo novo; redeploy de todas + conferir versão. Edges certas: `criar-kit-variacao`, `kit-transferencia`, `gerenciar-kit-variacao`, `fotos-pecas-kit` (nova) e as que a análise listar. Ordem: migration → edges → front (merge).
- Docs: adendo ADR-0200, `docs/TASKS.md`, `docs/reference/edge-functions.md`, `docs/reference/modelo-de-dados.md`, vault se houver impacto de fluxo.
- Revisão do diff e pré-merge: Grok 4.7 high (rodada única). Parar na branch; merge/deploy só com "atualizar".

## Roteamento (CLAUDE.md)

Opus (loop principal): plano, adendo ADR, `montarPayloadItem`/CREATE com rebaixamento e saga (publicação em marketplace), migration, hash do pedido. Sonnet (subagentes): função pura + testes, edge de leitura, UI, docs. Haiku: nada factual; só renomear/listar call sites se preciso.

## Riscos

1. O ML recusar id reaproveitado só no CREATE real ⇒ rebaixamento + aviso; plano B registrado.
2. Peça modificada/moderada entre a confirmação e o CREATE (10–15 min de saga) ⇒ mesmo rebaixamento.
3. Foto de peça que deixa de existir no ML ⇒ idem; a lista no banco é referência, não cópia.
4. Latência da leitura (≤ ~30 GETs de hash por combinação): concorrência limitada e cache por `picture_id` dentro da chamada.

## Ajustes após a revisão de plano (Fable 5.2, 12/11) — valem sobre o texto acima

Veredito: aprovado com ajustes. Todos incorporados:

- **B1 (moderação entre o cadastro e o CREATE).** A coluna passa a guardar a origem: `galeria_ml_fotos jsonb not null default '[]'` com `[{id, item}]` (id muda por tamanho, então o item de origem acompanha). Dentro de `prepararItem`, antes de montar o payload, o worker faz um `/items/bulk` (`id,status,sub_status,pictures`) dos itens de origem; só entra o id ainda presente em `pictures` de item limpo. Leitura falhou ou item moderado ⇒ CREATE só com a foto do kit + aviso. Vale também para a cópia da irmã (tamanho novo).
- **B2 (retomada).** `parcial()` e `lerKit` passam a ler a coluna; combinação que já tem irmã gravada **reusa a lista dela**. Todos os tamanhos de uma combinação gravam sempre a mesma lista.
- **I1 (rebaixamento).** **Sem 2º POST.** Em 4xx com galeria no payload: zerar a coluna da variação, avisar por `notificarCategoria` com chave (o `alerta` da transferência é sobrescrito) e relançar o 4xx; o reagendamento normal da saga recria só com a foto do kit. A causa é reconhecida por `item.pictures.*` **e** `picture_not_found`.
- **I2 (regra literal × família publicada pelo app).** O item plano publicado pelo app sai como `[capa, capa2, capa3, foto da cor]`; numa família assim a imagem 5 do Caqui nunca entra. `scripts/medir-galeria-pecas.ts` mede também uma família publicada pelo app, e o resultado vai ao Diego antes de fechar a regra. A Zaven (9 fotos distintas por cor) bate com o pedido.
- **I3 (cliente só remove).** O servidor recalcula a proposta; grava `proposta.filter(id ∈ pedido)`, na ordem da proposta. Reordenar ou mandar a imagem 1 da peça é descartado. Na edge nova os `item_externo_id` saem de `anuncios_externos_itens` da org, nunca do corpo; mesmo gate de admin de `criar-kit-variacao/index.ts`.
- **I4 (hash).** `galeria` só entra no JSON canônico quando não vazia; teste com hash fixo do pedido atual (sem galeria) para provar que não muda.
- **I5 (raio em `_shared`).** **Nada em `montar-canonico`, `publicar.ts`, `contrato.ts` nem `publicar-familia-up`.** O worker (`prepararItem`) acrescenta `{id}` ao `payload.pictures` já montado (sem repetição). O módulo novo vive em `_shared/kit-variacao/` e só `kit-transferencia`, `criar-kit-variacao` e a edge nova o importam. A publicação comum da família do kit (`publish-familia-ml`) não leva galeria.
- **Dedup só por id** (uma peça por cor; capas comuns têm o mesmo id). Cortados: GET de hash, "sem hash ⇒ fora" e o Risco 4. O limite é aplicado na gravação, nunca em `montarPayloadItem`.
- **Fim da fila.** k vai até esgotar as fotos de todas as cores ou atingir `limite - 1`; slot pulado não renumera a cor dos seguintes (a intercalação segue `k % n`), mas as posições finais ficam contíguas.
- **`STRIP_VARIACAO_KIT`** inclui a coluna nova e `montarVariacaoKitVariacao` a define explicitamente.
- **Deploy:** `adicionarAoKit` é servido por `criar-kit-variacao`. Edges: `criar-kit-variacao`, `kit-transferencia`, `fotos-pecas-kit` (nova); `deno info` confirma que nenhuma outra importa os módulos tocados.
- **Testes a mais:** retomada com leitura diferente ⇒ irmãs com a mesma lista; moderação entre criar e CREATE; moderação na cópia da irmã; SQL de `kit_variacao_gravar_variacoes` e `kit_variacao_adicionar` gravando o jsonb; hash fixo; cliente reordenando/mandando a imagem 1; closure do CREATE extraída para módulo testável (hoje vive em `kit-transferencia/index.ts` sem `__tests__`).
- **Verificar na implementação:** se algum fluxo cria nova versão da família do kit copiando colunas explícitas (a lista se perderia; `kitDoSku` lê a família mais recente).
