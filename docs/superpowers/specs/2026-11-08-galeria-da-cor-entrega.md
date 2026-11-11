# Galeria da cor por IA: procedimento de entrega (Task 16, passos 2 e 3)

ADR-0201. Plano: `docs/superpowers/plans/2026-11-08-galeria-da-cor.md`. Este documento é o checklist do Diego.
**Estado: implementada, aguardando validação real. Nada foi aplicado em produção** (sem `db push`, sem deploy, sem
agendamento, sem escrita no ML). Marque cada item só depois de conferir o resultado.

Regras que valem em toda a entrega: CLI primeiro (`supabase`, `deno`), nunca `apply_migration`/painel para DDL (ADR-0043);
push na `main` não faz deploy de Edge Functions; deploy só depois do push; nunca imprimir nem commitar segredo.

## 0. Antes de tudo

- [ ] Revisão geral da branch concluída e `pnpm preflight` verde no HEAD que vai à `main`.
- [ ] `git fetch` e conferir que nenhuma migration nova da `main` tem timestamp **anterior** às da galeria (se tiver,
      `supabase db push --include-all` e validar com `npm run db:check`).
- [ ] Decisões do Diego ainda abertas, fora deste checklist: regra dos 30 dias da retenção (ver seção 8) e o portão da lupa (seção 7).

## 1. Migrations (ordem de timestamp)

Lista levantada com `ls supabase/migrations | grep -i galeria` mais a `20261111*` (conferir que são 10):

1. `20261109093335_galeria_da_cor.sql`: tabelas `galeria_*`, `ml_item_travas`, `ml_escritas_adiadas`, RPCs, `pg_cron` `galeria-relogio`, políticas de Storage.
2. `20261109122959_configuracoes_ai_model_galeria.sql`
3. `20261109144013_galeria_leitura_etiqueta.sql`
4. `20261109153037_galeria_aprovar_roteiro.sql`
5. `20261110171517_galeria_despacho.sql`
6. `20261110182442_galeria_concluir_geracao.sql`
7. `20261110214652_galeria_aprovar_imagem.sql`
8. `20261110231651_galeria_saga_aplicar.sql`
9. `20261111102539_galeria_referencia_detalhes.sql`
10. `20261111111558_galeria_retencao.sql`

Atenção: o padrão `2026110*galeria*` **não** pega as de `20261110*` e `20261111*`; use `grep -i galeria` ou conte 10.

- [ ] `supabase db push` (sem `--include-all` se não houver migration mais velha pendente).
- [ ] `npm run db:check` verde.
- [ ] Conferir o relógio no banco (a migration 1 agenda um job `pg_cron`):
      `select jobname, schedule, active from cron.job where jobname = 'galeria-relogio';` deve devolver 1 linha,
      `*/5 * * * *`, `active = true`. Duas linhas ou nenhuma = parar e investigar.

## 2. Segredo da geração

- [ ] `supabase secrets set HF_CREDENTIALS=...` (valor com o Diego; **nunca** colar o valor em chat, commit ou doc).
      Formato esperado: `ID:SECRET` (ver `supabase/functions/_shared/ai/higgsfield.ts`).
- [ ] `supabase secrets list` mostra o nome `HF_CREDENTIALS` (só o nome; o valor não aparece).
- [ ] Já existentes e necessários: `QSTASH_TOKEN`, chaves de assinatura do QStash, `OPENROUTER_API_KEY` (não alterar).

## 3. Funções a implantar

Levantamento feito no dia 11/11/2026 com `deno info --json supabase/functions/<funcao>/index.ts` em cada pasta que tem
`index.ts` (113 funções), marcando quem tem no grafo algum destes módulos: `_shared/ml/fotos.ts`,
`_shared/ml/atualizar-item.ts`, `_shared/ml/trava-item.ts`, `_shared/canais/mercado-livre.ts` ou qualquer arquivo de
`_shared/galeria/`. Comando equivalente por função: `deno info --json supabase/functions/<f>/index.ts | grep -E '_shared/(galeria/|ml/(fotos|atualizar-item|trava-item)\.ts|canais/mercado-livre\.ts)'`.
**Refazer a lista no dia do deploy** (a `main` anda).

### 3a. Núcleo: 31 funções (os 4 módulos acima + `_shared/galeria/`)

`acompanhar-migracao-pxv atualizar-status-publicado criar-kit-variacao criar-kit-virtual encerrar-kit-virtual galeria-aplicar galeria-aplicar-worker galeria-aprovar galeria-despachante galeria-fatos galeria-gerar galeria-imagens galeria-roteiro galeria-worker kit-reposicao kit-transferencia metricas-vendas migrar-preco-por-variacao monitorar-moderados operacoes-massa process-familia publicar-anuncio publicar-familias publicar-split-ml publish-familia-ml reconciliar-convergencia-up remover-publicado sincronizar-estoque status-publicados subir-foto-kit-virtual update-familia-ml`

Mais **`galeria-retencao`** (nova; só importa `_shared/` comuns, por isso não aparece no levantamento acima): **32 no total**.

### 3b. Recomendado: 80 funções (todos os `_shared/` alterados pela branch)

A branch também alterou `_shared/queue.ts`, `_shared/canais/contrato.ts` e `_shared/ai/higgsfield.ts` (além dos quatro
módulos e de `_shared/galeria/`). Levantamento com os mesmos comandos e esses três módulos como sementes extras: **80 funções**
(a lista do núcleo, mais as 49 abaixo). Os arquivos alterados saíram de
`git diff --name-only origin/main...HEAD -- supabase/functions | grep '/_shared/'`.

`adicionar-variacoes-familia ads-campanhas ads-metricas ajustar-estoque analisar-viabilidade atributos-familia atualizar-fiscal-familia atualizar-marca-familia backfill-faturamento cadastrar-produto calcular-tarifa-ml coletar-ads-ml coletar-trafego-ml confirmar-publicacao-ml criar-kit-vinculado definir-categoria-familia desfazer-nota-compra entrada-estoque extensao fechar-mes-plataforma galeria-retencao gerar-foto-kit gerar-texto-kit gerenciar-kit-variacao importar-nota-compra ingest-lote inventario materializar-metricas ml-webhook notificar-carrinho notificar-liberacao posvenda-acao pulse-coletar reconciliar-estoque reconciliar-faturamento renovar-tokens-ml reprocessar-familia resumo-diario retentar-catalogo sincronizar-fiscal-ml sincronizar-marca-ml sincronizar-promocoes sync-devolucao sync-mensagem sync-pergunta sync-venda tabela-frete-ml telegram-bot vincular-catalogo`

Decisão: as 49 extras só carregam diferenças pequenas de `queue.ts` (11 linhas), `contrato.ts` (6 linhas) e
`higgsfield.ts` (arquivo novo de uso da galeria). Implantar o núcleo (32) é o mínimo para a galeria funcionar; implantar as
80 evita deixar funções com `_shared` defasado, regra do projeto ("deploy nunca defasado"). **Recomendado: as 80.**

### 3c. Ordem

1. Migrations (seção 1) e segredo (seção 2).
2. Escritores primeiro: `update-familia-ml`, `publicar-split-ml`, `remover-publicado` (pedem a trava `ml_travar_itens` da migration 1).
3. `galeria-fatos galeria-roteiro galeria-gerar galeria-imagens galeria-aprovar galeria-aplicar galeria-despachante galeria-worker galeria-aplicar-worker galeria-retencao`.
4. O restante da lista (núcleo e, se escolhido, as 80).
5. Comando: `supabase functions deploy <f1> <f2> ...` (CLI completa; o `verify_jwt` de cada função vem de `supabase/config.toml`:
   `true` em `galeria-fatos/roteiro/gerar/imagens/aprovar/aplicar`, `false` em `galeria-despachante/worker/aplicar-worker/retencao`).

- [ ] Conferir a versão ativa pós-deploy de cada função (`supabase functions list`) e a prova por hash
      (`supabase functions download <f>` e comparar com o fonte), como nos deploys anteriores.
- [ ] Front: merge na `main` e deploy do app só **depois** das edges (a UI chama `galeria-*`).

## 4. Agendamentos do QStash

Só depois do deploy de `galeria-despachante` e `galeria-retencao` (antes, o QStash chamaria função inexistente).

- [ ] `QSTASH_TOKEN=... SUPABASE_URL=https://<ref>.supabase.co deno run --allow-net --allow-env scripts/qstash-agendar-galeria.ts`
      (idempotente, `scheduleId` fixo): cria `galeria-despachante` (`* * * * *`) e `galeria-retencao` (`0 7 * * *`, 04:00 BRT).
- [ ] Conferir os dois schedules no QStash (cron, destino, ativo) e uma execução do despachante nos logs da função (200).
- [ ] Nunca rodar o script em teste.

## 5. CORS e PUT duplo do Storage

Seguir o procedimento já escrito em `docs/superpowers/specs/2026-11-08-galeria-da-cor-cors-storage.md` (origem
`https://publiai.daludi.com.br`):

- [ ] GET da cena por URL assinada com `access-control-allow-origin`, sem erro de CORS nem `SecurityError` no console.
- [ ] Aprovar: preflight `OPTIONS` 200 com `x-upsert` liberado, `PUT` 200, resposta `{ status: 'aprovada' }`.
- [ ] **PUT duplo:** repetir o `PUT` na mesma URL assinada com outros bytes: tem de voltar 4xx (`The resource already exists`); baixar o
      `final_path` e conferir que o `sha256` continua o aprovado (a edge reconfere o sha).
- [ ] Par de `curl` com `-H "Origin: ..."` e URL assinada real. Só se faltar o cabeçalho, ajustar CORS do projeto (painel/chamado) e registrar no spec de CORS com data.

## 6. Medição de CPU da `galeria-aprovar`

- [ ] Aprovar uma imagem real (JPEG 1200×1540) e ler a CPU da execução nos logs da função: **meta <= 800 ms**. Referência local: 143 ms no
      vitest, 45–85 ms por arquivo em Deno. Acima de 800 ms: não prosseguir para a validação real; abrir tarefa de otimização.

## 7. Portão da lupa (decisão do Diego)

As missões com lupa (geral 3 e 7, Moda 5 e 7) estão travadas por `MISSOES_LUPA_PENDENTE` em
`supabase/functions/_shared/galeria/regras.ts`. Com a constante preenchida, `galeria-gerar` e `galeria-aprovar` recusam
essas missões (`lupa_pendente`), o front desabilita o checkbox e nenhuma lupa é gerada, composta ou cobrada.

- [ ] Migration `20261111102539` aplicada e `galeria-fatos`, `galeria-gerar`, `galeria-aprovar`, `galeria-imagens` implantadas e conferidas.
- [ ] Script descartável **só de leitura (GET, sem escrita)**, conforme `lupa-report.md` (pasta `.superpowers/sdd/2026-11-08-galeria-da-cor/`): lê **10 referências reais** da AVIL (variadas, com peças pequenas e Moda),
      roda a leitura de `_shared/galeria/detalhes.ts` e gera uma página local com cada referência, as caixas desenhadas e as lupas compostas por `recortesLupa`.
- [ ] Critério (aceite do Diego): **>= 7 de 10 com lupa disponível e nenhuma lupa disponível mostrando fundo** (parede, mesa, mão).
      `sem_detalhe` não conta como acerto.
- [ ] Aprovado: esvaziar `MISSOES_LUPA_PENDENTE` (`{ geral: [], moda: [] }`) **somente após o aceite do Diego**, em **commit próprio**, e redeployar as edges que importam `_shared/galeria/` (as da lista 3a) e o front.
- [ ] Reprovado: a constante fica e a galeria sai sem lupas.
- [ ] Trocar o modelo de visão ou a versão do prompt (`lupa-v1`) relê tudo e exige novo portão.

## 8. Fora deste checklist: regra dos 30 dias da retenção

O plano previa apagar cenas com mais de 30 dias. **Não foi implementada**: apagaria cena ainda citada em `cena_path`, e
`galeria_confirmar_exibicao` exige `cena_path`. A edge `galeria-retencao` só apaga o que nenhuma linha cita (cena órfã de posse perdida e final
não citado, com mais de 1 dia) e nunca apaga `referencias/`, arquivo citado nem imagem aprovada (mesmo `desatualizada` ou de volta a `gerada`).
Esperar decisão do Diego antes de qualquer regra de idade sobre arquivos citados.

- [ ] Primeira execução da retenção: conferir nos logs que o lote foi lido, nada citado foi apagado e uma 2ª execução não apaga mais nada.

## 9. Pendências do ledger a fechar na entrega

- [ ] **Qwen:** medir a saída do Qwen com referência sem marca (hoje `resolverModeloGaleria` devolve o padrão, Nano Banana, para modelo sem referência confirmada). Fazer 1 imagem por modelo e registrar campo de referência e de proporção da Higgsfield.
- [ ] **CPU** da `galeria-aprovar` (seção 6).
- [ ] **PUT duplo e CORS** (seção 5).
- [ ] **`cron.job`** `galeria-relogio` (seção 1).
- [ ] **Missão 6** (reserva do topo em 73% da imagem): validar com cena real (minor deferido da Task 11).
- [ ] Conferir fotos depois de uma sincronização de marca (`sincronizar-marca-ml`) em anúncio com galeria aplicada: o PUT de BRAND é inferido, não medido, e pode reagrupar família UP.
- [ ] Minor deferido da Task 9: `worker-estado.ts` solta o lease em 4xx da consulta HF (404 fica `gerando` até expirar em 60 min). Observar.

## 10. Validação real (escrita no ML, com o Diego presente)

Anúncios de teste da AVIL: Legacy `MLB7168683146`; UP `MLB7245326808` e `MLB7245326842`. Só o fluxo do app; nenhuma edição direta no ML.

Para cada um:

- [ ] Registrar antes: preço, estoque, fotos de cada cor e a ordem das fotos (o app guarda o retrato, mas anote).
- [ ] Gerar (pedido pequeno) → exibir → aprovar → aplicar. **Cobrança: 1 por imagem exibida, nenhuma por recorte** (conferir `platform_image_deliveries`).
- [ ] Conferir no ML e na API: fotos novas na cor certa, **preço e estoque iguais ao antes**, **demais cores intactas**, **ordem** das fotos como no manifesto.
- [ ] Conferir `galeria_imagem_itens`, `galeria_aplicacao_itens` e que as travas (`ml_item_travas`) foram soltas ao fim (sem linha `galeria` nem `quarentena` sobrando).
- [ ] Reverter pelo app → conferir que fotos, preço, estoque e ordem voltaram ao retrato.
- [ ] Uma alteração de preço/estoque durante uma aplicação deve ser adiada e depois executada (`ml_escritas_adiadas` esvazia).
- [ ] Remover/republicar com aplicação em curso é recusado com `item_ocupado` (nada apagado).

Se qualquer item falhar: não ligar o módulo para outras orgs, registrar o desvio e abrir tarefa.

## 11. Fechamento

- [ ] Atualizar `docs/project-status.md`, `docs/TASKS.md` e `obsidian-vault/06-Roadmap/Sprint Atual.md` de "aguardando validação real" para "no ar" **somente** depois da seção 10.
- [ ] ADR-0201: passar o status de "proposto" para "aceito" e acrescentar o índice em `obsidian-vault/04-Decisões/Índice de ADRs.md` (a ADR ainda não consta lá).
- [ ] Pós-merge: deletar a branch, remover a worktree e `git pull --ff-only` no checkout principal.
