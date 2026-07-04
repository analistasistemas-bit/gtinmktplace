# PubliAI — Tasks

> Checklist operacional. Atualize o status conforme as tarefas avançam. Para visão estratégica das fases, ver [ROADMAP.md](ROADMAP.md).

## Publicados — ocultar colunas Fornecedor/Tipo da tabela — 2026-07-04

- [x] **Colunas Fornecedor e Tipo removidas da tabela de Publicados** (pedido do Diego). Os filtros
  de Fornecedor e Tipo (dropdowns) já operavam sobre os dados independente da coluna aparecer na
  tabela — nenhuma mudança de lógica de filtro foi necessária, só remoção das duas colunas
  (`ThOrdenavel` + `TableCell`) e ajuste do `colSpan`. Validado no browser: colunas ausentes,
  filtros combinados (Fornecedor + Tipo) reduzindo a lista corretamente. Só frontend. Merge → main
  → deploy (commit `3d72b60`).

## Fix: genérico descartado quando a IA rejeita um falso-amigo + busca sempre disponível — 2026-07-04

- [x] **Achado ao vivo (mesmo dia do ADR-0058): a Bainha do lote 51 ainda travava**, mesmo com o
  fallback genérico novo. Causa raiz: o preditor do ML devolvia, na mesma busca, o genérico
  correto do segmento (`MLB1371` "Outros" — Artes e artesanatos) **e** um específico falso-amigo
  ("Bainhas para Facas", homônimo de bainha de tecido); a IA de desempate corretamente recusava o
  específico errado, mas o resolver então caía direto em `manual`, jogando fora o genérico certo
  que já estava na mesma lista. Fix: `resolverCategoria` resgata pro melhor genérico disponível em
  qualquer ponto que devolveria `manual` (não só quando não sobra específico nenhum) — nunca
  escolhe um específico errado, só evita descartar um genérico que o ML já tinha respondido.
- [x] **Segundo achado, ao vivo também**: o operador digitou literalmente "outros" no campo de
  busca livre pra tentar "forçar" o fallback — o ML devolveu buckets "Outros" de domínios de
  veículos náuticos (`MLB1905` e afins, coincidência textual). Como a categoria escolhida
  manualmente grava `tipo_origem='manual'` (não `'generico'`), o link de busca desaparecia
  completamente — o operador ficou sem nenhuma forma visível de corrigir. Fix: `CardCategoria`
  ganha um "Trocar categoria" sempre alcançável pra qualquer categoria já definida, não só a
  genérica automática, com `useEffect` garantindo abertura automática quando o card já montado
  vira genérico num refetch ao vivo (ex.: reprocessar com a tela aberta).
- Verificação: 22 testes novos/atualizados (resolver.test.ts + card-categoria.test.tsx), revisão
  adversarial (3 agentes independentes: lógica do resolver, estados da UI, cenário ponta a ponta)
  sem achados bloqueantes, 1169 testes verdes, build/lint limpos. `docs/decisions/0058-*.md`
  (adendo). Branch `fix-trocar-categoria-sempre-disponivel`.

## Categoria de seleção livre + "Outros" como fallback visível — 2026-07-04

- [x] **Famílias fora dos 4 aviamentos conhecidos (ex.: "BAINHA INSTANTÂNEA 4MT UND", lote 51)
  ficavam travadas para sempre** — o seletor manual só oferecia linha/fita/botão/cola. Causa
  raiz: pendência aberta desde o ADR-0022 (11/06), nunca fechada. ADR-0057: `CardCategoria` troca
  o seletor fixo por busca livre no `domain_discovery` do ML (reusa `buscarCategoriaPreditor` já
  existente); `definir-categoria-familia` generaliza o contrato para `{categoria_ml_id,
  categoria_nome}`; `resolverAtributosGenericos` extraído do `process-familia` p/ reuso sem
  duplicar lógica. Categoria do concorrente (já calculada, antes descartada) vira sugestão
  clicável não-vinculante — nunca aplicada sem clique explícito (trava de regressão pro
  incidente do ADR-0054).
- [x] **ADR-0058 (mesmo dia, a pedido do Diego):** quando o preditor só acha candidatos genéricos
  ("Outros"), a família deixa de travar em `manual` — aplica o genérico como fallback visível
  (`tipo_origem='generico'`, selo de aviso na Revisão) e a busca continua disponível pra trocar.
  Revisão humana antes de publicar continua obrigatória (regra inalterada); zero mudança no
  `process-familia` (branch já era baseado em `categoria_ml_id`/`tipo`, não em `origem`).
  Migrations aditivas (`concorrencia_categoria_id`, enum `tipo_origem` + `'generico'`), 1165
  testes verdes, edge functions (`process-familia`, `definir-categoria-familia`,
  `atributos-familia`) deployadas e versão conferida. Branch `fix-categoria-selecao-livre`.

## Campo de busca no Detalhe de vendas — 2026-07-03

- [x] **Detalhe de vendas (Publicados › `/publicados/vendas`) ganhou campo de busca** por
  título/código/EAN, mesmo padrão do `Input` usado em Publicados. Filtra as duas seções (Seus
  anúncios PubliAI / Fora do PubliAI); o subtotal do rodapé passa a refletir só as linhas
  filtradas (senão o número da seção inteira ficava enganoso ao lado de 1-2 linhas exibidas).
  Mensagem "Nenhum resultado para a busca." diferencia de "Sem vendas no período." quando o filtro
  não bate com nada. `DetalheVendas.tsx`. Frontend-only, sem ADR (não é decisão arquitetural).
  Verificação: 1160 testes verdes, lint limpo, validado no app real (browser-use).

## Fix markup por produto divergente (Detalhe de vendas × Detalhe do pedido) — 2026-07-03

- [x] **Mesmo produto mostrava markups diferentes nas duas telas** (ex.: cód. 03096963 → +843% no
  Detalhe de vendas vs +592% no Detalhe do pedido). Causa raiz: `montarDetalheVendas`
  (`detalhe-vendas.ts`) rateava o líquido **por linha de order_id**; num pack com um order_id por
  produto, o item leve/barato (fita) ficava com o líquido inteiro do seu order_id (quase sem frete,
  rateado por peso) e inflava o markup. Fix: poolar o líquido por **pack** (`pack_id ?? order_id`) e
  redistribuir por valor bruto com o mesmo `round2` por item do `agruparPorPedido` (menu Faturamento,
  fonte da verdade — ADR-0055). Agora o markup por produto bate 1:1 entre as telas. Teste de
  regressão em `tests/lib/detalhe-vendas.test.ts` trava a invariante. Verificação: 1158 testes
  verdes; lint do arquivo limpo.

## Fix overflow horizontal / responsividade — 2026-07-03

- [x] **Telas escapavam das margens (desktop 15" Windows) e panavam lateralmente (mobile)** —
  causa raiz no shell: a coluna de conteúdo (`flex flex-1 flex-col`) tinha `min-width:auto`
  implícito, então tabelas largas a expandiam além da viewport e o `main` (`overflow-auto`) panava
  a página inteira. Fix: `min-w-0` na coluna + `main` → `overflow-y-auto overflow-x-hidden`
  (`app-shell.tsx`); tabela crua da Viabilidade envolvida em `overflow-x-auto` + padding de página
  (`Viabilidade.tsx`); cards do `painel-analise` empilham `w-full` no mobile (piso de largura só a
  partir de `sm`). Verificação: `pnpm lint` + `pnpm build` verdes; medição headless logada = 0
  overflow em 22 medições (10 rotas × 1366/375, incluindo linha de Publicados expandida).

## Multi-tenant: operações do ML usam escopo/token da operação — 2026-07-03

- [x] **Publicados "Indisponível" para membros não-donos** — descompasso do ADR-0047 (lista
  compartilhada × enriquecimento/ações escopados ao chamador). Helper `_shared/ml/operacao.ts`
  `userIdCredencialOperacaoML` + 10 edge functions (`status-publicados`, `metricas-vendas`,
  `publicar-familias`, `remover-publicado`, `reprocessar-familia`, `regenerar-copy-familia`,
  `definir-categoria-familia`, `responder-pergunta`, `calcular-tarifa-ml`, `ingest-lote`) passam a
  usar escopo + token + gravação da operação; `ingest-lote` grava `familias/variacoes.user_id` =
  dono da conta ML (workers de publicação intocados) e casa anteriores por `codigo_pai` em toda a
  operação (evita duplicar anúncio). Deploy CLI 10/10; `deno check` + `pnpm lint` + 1156 testes
  verdes. [ADR-0056](decisions/0056-enriquecimento-ao-vivo-escopo-da-operacao.md).
- [ ] **Validação runtime pendente** — logar como Michael/Samuel e confirmar Publicados igual ao Diego.

## Imposto por origem (nacional/importado) — 2026-07-03

- [x] **Imposto sobre a venda entra no preço e no markup** — coluna opcional `ORIGEM`
  (`NACIONAL`/`IMPORTADO`) na planilha (linha PAI, default `nacional`) grava `familias.origem`
  (enum `origem_produto`, não confundir com `tipo_origem`). Duas alíquotas parametrizáveis em
  Configurações (`aliquota_nacional_pct` default 8%, `aliquota_importado_pct` default 16%,
  globais por usuário, sem override por família). Imposto = preço × alíquota, descontado do
  líquido junto com comissão e frete e somado ao gross-up do preço sugerido, reduzindo
  markup/lucro/"Vale a pena" em todas as telas (análise de publicação, viabilidade item-a-item,
  faturamento pós-venda). [ADR-0055](decisions/0055-imposto-por-origem-nacional-importado.md).

## Planos E7 + E6 + E6b — SaaS multi-empresa, multicanal e estoque único — 2026-07-02

- [x] **Planos de implementação escritos e aprovados como documento** — análise profunda do código (RLS/modelo de dados + camada de canais) e planos completos, com decisão de **ordem E7 → E6** (E7 primeiro: isolamento por org é o objetivo SaaS; E6 nasce tenant-aware; validação real do E6 com 2 canais depende do E5 Shopee). Planos: [E7 multi-tenancy](superpowers/plans/2026-07-02-e7-multi-tenancy-org-id.md) (7 fases expand→migrate→contract, suite executável de isolamento cross-tenant, `marketplace_connections` por org resolvendo a pendência do ADR-0047) · [E6 orquestração](superpowers/plans/2026-07-02-e6-orquestracao-multicanal.md) (worker genérico `publicar-anuncio`, estado por canal em `anuncios_externos`, caminho ML intocado).
- [x] **Decisão (Diego, 2026-07-02): próximo épico = E7** — ordem E7 → E6 aprovada; E5 (Shopee) fica para depois. Cada PONTO DE DEPLOY do plano E7 segue exigindo OK explícito.
- [x] **Épico novo E6b — Estoque único e sincronização cross-canal (2026-07-02)** — venda paga em qualquer canal → baixa atômica idempotente no estoque canônico (ledger `estoque_movimentos` + `baixar_estoque`) → push de valores absolutos aos demais canais (`sincronizar-estoque`, fila serial por org) → reconciliação diária. Registrado no doc mestre (seção E6b) e com plano completo: [E6b estoque único](superpowers/plans/2026-07-02-e6b-estoque-unico-cross-canal.md). Executa após E7+E6; validação plena (2 canais reais) depende do E5.
- [ ] **Execução do E7** — próximo passo (iniciar pela Task 1: ADR-0027).
- [ ] **Execução do E6** — após E7 concluído.
- [ ] **Execução do E6b** — após E6 concluído (pré-voo obrigatório na Task 2 do plano).

## Lote #49 — barbante recusado por atributo/tipo (ADR-0051) — 2026-07-01

- [x] **Barbante classificado como `outro` → sem BRAND/MODEL → ML recusa** — investigado com `systematic-debugging` nos dados de produção. 3 famílias de barbante do lote #49 com `tipo_aviamento='outro'`, `categoria_ml_id=MLB270273` (Fios e Cadarços = a categoria de `linha`), `atributos_ml=[]`, `atributos_faltantes=[]`; na mesma categoria há 13 publicadas como `linha` (0 erros). Duas causas: (1) `barbante` faltava na regex de `linha` (`detectar.ts`); (2) sem override, o preditor acerta a categoria mas devolvia `tipo:'outro'` fixo → `process-familia` seguia o ramo genérico (schema+IA) que, ao falhar, deixa atributos e faltantes vazios → o gate do publish não bloqueia. Fix: `barbante`/`barbantes` na regex + `tipoParaCategoria` (lookup reverso categoria→tipo) no `resolver` + `process-familia` usa o caminho determinístico para todo tipo conhecido (`categoriaParaTipo(tipo)!=null`, não só `origem==='regex'`). TDD: casos novos em `detectar`/`resolver`/`atributos`; 1074 testes + tsc + `deno check` + eslint verdes. [ADR-0051](decisions/0051-tipo-aviamento-derivado-da-categoria-do-preditor.md).
- [x] **Deploy + reprocessamento das 3 famílias do lote #49** — ✅ deployado e reprocessado em produção (validado 2026-07-02).
- [x] **Robustez SaaS — fim da falha silenciosa do ramo genérico** — para preparar publicação de **qualquer** produto (SaaS multiempresa): `process-familia` nunca mais publica sem validar. Se schema indisponível/vazio/sem token ou erro da IA, persiste `atributos_faltantes=[FALTANTE_ATRIBUTOS_NAO_VALIDADOS]` → gate trava na Revisão (não vai quebrado ao ML). `COLOR` entra em `FALTANTES_IGNORAR` (atributo de variação; evita falso-faltante em categorias que o exigem). Testes novos em `atributos-generico`; suíte + tsc + `deno check` verdes.
- [x] **Camada 2A — IA infere texto-livre obrigatório do texto do produto (ADR-0052)** — a IA passa a preencher atributos de texto-livre obrigatórios inferindo do nome/descrição, sem inventar: valor só é aceito se suas palavras aparecerem em sequência contígua na fonte (match por token + piso de comprimento — furos apontados em code-review). `AtributoAlvo` ganhou discriminador `tipo` (closed/numero/texto). Reduz produtos travados por atributo. TDD (1087 testes + tsc + deno check + smoke no runtime Deno verdes), code-review independente aplicado. `process-familia` v57 deployado (`verify_jwt=false`). Plano em `docs/superpowers/plans/2026-07-01-camada2a-ia-texto-livre.md`.
- [x] **Camada 2B — fallback: editor de atributos faltantes na Revisão (ADR-0052)** — quando a IA não resolve um obrigatório, o operador completa inline no card de categoria (Select p/ closed-set, Input p/ texto/numérico, auto-save com `StatusInline`); a publicação fica travada até resolver e a edição sobrevive ao reprocesso. Backend: migration `atributos_editados_pelo_operador` + guarda em `process-familia` (só preserva se a categoria não mudou); funções puras `faltantesEditaveis`/`validarValorAtributo` (validação server-side); edge function `atributos-familia` (lista faltantes-com-schema + salva/recalcula, `verify_jwt=true`). Front: tipos/query/hook + `editor-atributos-faltantes.tsx` + trava em `publicavel.ts` (CREATE e UPDATE). TDD (1103 testes + tsc + deno + build + eslint verdes); code-review independente (6 achados corrigidos: gate↔editor alinhados, try/catch, stale-query, categoria órfã); smoke visual (app sobe, login, Dashboard OK). Deploy: `atributos-familia` v1 + `process-familia` v58 (+3 por não-defasar). Plano em `docs/superpowers/plans/2026-07-01-camada2b-fallback-editor-atributos.md`.
- [ ] **Fase posterior:** troca livre de categoria (busca no catálogo ML) + remontagem de atributos; **dívida multi-tenant:** marca padrão `Avil` hard-coded em `atributos.ts` — trocar por config da empresa.

## Comprador real nas vendas — correção da regressão + anti-flakiness (2026-07-01)

- [x] **Coluna Comprador mostrando o nick em vez do nome real** — investigado com `systematic-debugging`: `GET /orders/{id}` mascara `buyer.first_name/last_name` por um tempo após a criação do pedido (não é bloqueio de permissão — hipótese de precisar do endpoint CDA descartada). Fix 1: `comprador_nome` volta a cair pro `receiver_name` do envio quando o buyer não vem (`supabase/functions/_shared/faturamento/io.ts`).
- [x] **Regressão descoberta em seguida: nome do destinatário aparecendo em vez do comprador** — o ML é **inconsistente** em retornar `buyer.first_name/last_name` (o mesmo pedido veio com o dado num sync e sem no seguinte, ~5min depois), e cada sync recalculava `comprador_nome` do zero — um sync sem o buyer apagava um nome real já capturado. Fix 2: nova função pura `escolherCompradorNome` (`_shared/faturamento/venda.ts`) prioriza nome real atual → nome já salvo (nunca regride) → nome do destinatário (só quando nunca teve nada melhor) → nick na UI. 4 testes novos (42 no total no módulo). `sync-venda` (v21), `backfill-faturamento` (v21), `reconciliar-faturamento` (v19) deployadas, `verify_jwt=false` preservado.
- [x] **Histórico corrigido** — os ~105 registros de `ml_vendas` (desde 2026-06-06) já foram populados por uma sincronização completa; 1 pedido com valor corrompido pela regressão (destinatário salvo como comprador) corrigido manualmente via SQL após confirmar o nome real no `raw.buyer` já capturado.
- [ ] **Limitação conhecida:** como `comprador_nome` não distingue a origem do dado (buyer real vs. destinatário), um valor gravado como fallback (destinatário) só é substituído pelo nome real se um sync futuro conseguir o buyer do ML — não há forma de forçar isso hoje.

## Atributos opcionais/numéricos por IA — nota de qualidade (ADR-0049) — 2026-06-29

- [x] **Anúncio preenche mais características (não só obrigatórias)** — anúncios de aviamentos saíam só com os obrigatórios (ex.: fita → `BRAND`+`RIBBON_TYPE`) → ML marca qualidade "ruim". O caminho regex do `process-familia` agora **enriquece** os obrigatórios curados com o schema da categoria: closed-set opcionais (ex.: *Formato da fita*) + numéricos (ex.: *Comprimento*/*Largura* extraídos da descrição), via IA validada contra o schema (nunca inventa); texto livre como `MODEL` fica de fora. `schema.ts` (`valueType`/`allowedUnits`), `atributos-llm-core.ts` (alvos closed-set opcionais + numéricos; ignora `COLOR`/`UNITS_PER_PACK`), `process-familia` (ramo regex). Filtro de tags exclui atributos de variação/ocultos/read-only/multivalor (achado do probe em MLB255054). TDD: 59 testes nos módulos + 1045 na suíte, typecheck/`deno check` verdes. **`process-familia` deployado (v50, `verify_jwt=false` preservado).** Validado manualmente em 2 anúncios reais (MLB7064230644, MLB4770357327): de 2 → 6 características, nota de qualidade subiu. [ADR-0049](decisions/0049-atributos-opcionais-e-numericos-por-ia.md).

## Mensagem automática ao comprador — 2026-06-29

- [x] **Mensagem de boas-vindas ao pagar** — `sync-venda` envia `POST /messages/packs/{packId}/sellers/{sellerId}/messages` na primeira transição `→ paid` (flag `novaPaga` já idempotente, sem coluna nova). Novo helper `_shared/ml/mensagem.ts`. Falha de mensagem é logada mas não trava o worker. `sync-venda` deployado (v17). Docs atualizadas (`edge-functions.md`).

## Split de produto em N anúncios ML (ADR-0048) — 2026-06-29

- [x] **Cor nova entra MARCADA por padrão no UPDATE (opt-out)** — antes, cor nova num UPDATE nascia desmarcada (opt-in, ADR-0016 adendo 2026-06-04); ao subir lote com muitas cores novas todas ficavam de fora sem aviso. Invertido: cor nova com **foto E estoque** entra marcada; senão dorme. Operador ainda pode desmarcar na Revisão. `ingest-lote` (1 linha) + adendo no ADR-0016. `ingest-lote` deployado.
- [x] **Limites do ML descobertos** — anúncio aceita no máx. **100 variações** E **99.999 de estoque somado**. 3 produtos com >100 cores (Fita Cetim N.1=137, N.2=132, Linha 1500m=120). Registrado em `reference_ml_limites_anuncio`.
- [x] **Split automático em N anúncios** — produto com >100 cores publica em N anúncios ("partições"). Worker isolado **`publicar-split-ml`** (caminho normal dos 73 produtos intocado); partição alfabética por cor com **ancoragem** (cor publicada não migra), título distinto por **IA** (fallback determinístico), **cap de estoque por teto** no conector ML (no-op nos anúncios atuais), espelho por partição. `anuncios_externos` ganhou `particao`+`titulo` (migration aplicada) e virou âncora do split. Roteamento em `publicar-familias` (>100 cores → split). Funções puras `particionar`/`caparEstoque`/`montarAncoragem` com TDD. [ADR-0048](decisions/0048-split-produto-n-anuncios-ml.md) · spec em `superpowers/specs/2026-06-29-split-anuncio-100-variacoes-design.md`.
- [x] **E2E validado em produção** — `02835002` (120 cores) publicado em 2 anúncios reais: `MLB6914358210` (100 cores) + `MLB4828349403` (18 cores, título IA distinto), 118 `variation_id` distintos (zero duplicação), cap aplicado (estoque real 155k → enviado ≤99.999). 1035 testes + deno check/lint/build verdes.
- [x] **UI mostra os N anúncios** — Relatório e Publicados liam só `familias.ml_item_id` (partição 0); agora juntam `anuncios_externos` e mostram um "ver anúncio" por partição; `status-publicados` busca status ao vivo de todas as partições. Validado com browser-use (2 links no Relatório; 2º anúncio "Ativo" na Publicados). Frontend no Render.
- [ ] **Follow-up:** catálogo (opt-in, `vincular-catalogo`) por-partição — hoje cobre só a partição 0; UI de "N anúncios por produto" agrupada (hoje listados como 2 linhas); aplicar split aos outros 2 produtos grandes quando reimportados.

## Multiusuário + permissão de menu (operação compartilhada, ADR-0047) — 2026-06-29

- [x] **Cadastro de usuários por convite + acesso por menu** — antecipa parte do `E7`. Tabela `public.profiles` (1:1 com `auth.users`: `is_admin`, `is_active`, `allowed_menus[]`) + helpers `is_admin()`/`is_membro_operacao()` (SECURITY DEFINER, `search_path=''`, `anon` revogado) + trigger `handle_new_user` + backfill (usuários existentes viram admin). **RLS migrada** de `user_id` para `is_membro_operacao()` (operação compartilhada) nas 12 tabelas de domínio + storage `imagens`; `user_id` vira `criado_por`. Edge function `usuarios` (admin-only, `service_role`): `invite`/`update_menus`/`set_active`/`set_admin`. Frontend: tela **Usuários** (tabela + convidar com **toggle Admin** que auto-marca/trava menus + editar/desativar/promover), `MenuGuard` de rota, `profile` no auth-store, `/sem-acesso`, `/definir-senha` (consome `token_hash` via `verifyOtp`), `/cadastro` público removido. 3 migrations aplicadas via `db push`, edge deployada, frontend no Render. Advisors limpos. Validado em produção com browser-use (login admin → menu → convite → toggle Admin). [ADR-0047](decisions/0047-operacao-compartilhada-rbac-menu.md) · plano em `superpowers/plans/2026-06-28-usuarios-menus-rbac.md`.
- [x] **E-mail transacional via Resend (SMTP próprio)** — saiu do serviço interno do Supabase (que só entrega à equipe do projeto) para **SMTP do Resend** (`smtp.resend.com`, remetente `publiai@daludi.com.br`, domínio `daludi.com.br` verificado) configurado no Supabase Auth via Management API + templates de Convite/Reset com `token_hash` + `site_url` de produção. Validado: e-mail de teste, recuperação e convite (michael) com `last_event: delivered` e link correto. Secrets `RESEND_API_KEY`/`RESEND_SENDER_EMAIL` no `.env.local` + secret `APP_URL` na edge. How-to em [operacoes-rotineiras.md](how-to/operacoes-rotineiras.md#e-mail-transacional-smtp-via-resend).
- [x] **Hotfixes do convite (2026-06-29)** — (1) a UI mostrava só "Edge Function returned a non-2xx" porque o `supabase.functions.invoke` não popula `data` em respostas não-2xx; `callUsuarios` passou a ler a mensagem real do corpo (`error.context.json()`). (2) E-mail já cadastrado retorna **409** com mensagem PT amigável. (3) **Causa raiz dos convites falhando: `rate_limit_email_sent` do Supabase Auth estava no default 2/hora** (não sobe ao ligar SMTP) — elevado para **50/hora** via Management API. Edge `usuarios` redeployada + front no Render; validado com browser-use (erro de duplicado aparece na tela).
- [ ] **Pendente (pré-E7):** resolver a conexão ML da operação (não do chamador) para membros publicarem; manter publicação restrita ao admin-dono até lá.

## Líquido econômico — fim do artefato cross-docking (ADR-0042) — 2026-06-25

- [x] **Líquido da venda = `bruto − comissão − frete real` (não o `net_received_amount` do MP)** — o net do Mercado Pago é **inconsistente**: em envio cross-docking (`shp_cross_docking`) ele desconta o frete CHEIO da etiqueta e ignora a comissão; em pack desconta a comissão e ignora o frete. Isso gerava **markup falso** (item vendido a ~3× o custo aparecia com −56%). Passa a computar de fontes autoritativas: `sale_fee` do pedido + `senders[].cost` do envio (`_shared/faturamento/venda.ts`). **Rateio de pack net-independente** (`ratearLiquidoPorFrete`, compartilhado por Faturamento e Financeiro): frete do envio uma vez, por peso. Faturamento e Financeiro batem por construção (fonte única `ml_vendas`). DB **reconciliado** (46 pedidos; líquido total do período R$ 602,93). [ADR-0042](decisions/0042-liquido-economico-cross-docking.md). **Deployado:** edges `ml-webhook` (v5), `sync-venda` (v10), `backfill-faturamento` (v12), `reconciliar-faturamento` (v9) — `verify_jwt=false` preservado — + front (Render, commit `6d3758d`). Validado com browser-use (item Rosa Amaranto: 2,36 / −56% → **7,63 / +43%**). 935 testes verdes.
- [x] **Removido o caminho morto do MP ao vivo** — `src/lib/financeiro.ts`, `src/hooks/useResumoFinanceiro.ts` e a fonte da edge `resumo-financeiro` (substituídos por `ml_vendas`/`resumo-vendas.ts` no ADR-0038; pendência herdada do ADR-0040). A edge nunca esteve deployada.

## Publicados — expandir item: análise + modo Clássico/Premium — 2026-06-24

- [x] **Cada anúncio publicado expande mostrando a "Análise para publicação"** (reuso do `PainelAnalise` da Revisão) recalculada pelo **preço atual no ML**, e indica se foi publicado em **Clássico** (`gold_special`) ou **Premium** (`gold_pro`). O `listing_type_id` vem **ao vivo** do ML via `status-publicados` (atributo extra em `lerStatus`, mapeado em `parseStatusML` → `StatusCanal.listingType`), **sem migração**. Front: linha de Publicados expansível (linha inteira clicável, lazy-load da família via `useFamilia`/`fetchFamiliaPublicada`), **selo Clássico/Premium no topo-direito da linha** e destaque "✓ publicado" no card "Você recebe por venda". 941 testes verdes, validado com browser-use. spec/plano em `superpowers/specs/2026-06-24-publicados-expandir-analise-design.md` + `superpowers/plans/2026-06-24-publicados-expandir-analise.md`. **`status-publicados` já deployada; demais edge functions do `_shared` deployadas preservando `verify_jwt`.**

## Módulo Financeiro impecável (ADR-0040) — 2026-06-23

- [x] **Menu Financeiro completo — caixa, lucro/margem, evolução, comparativo, período personalizado, CSV** — tela `/financeiro` e detalhe do líquido derivam tudo de `ml_vendas` (fonte única, ADR-0038). Novidades: **período personalizado** (intervalo de datas), **faixa de caixa** (já liberado vs a liberar, por `money_release_date` — NÃO é o "A receber" do MP, ver ADR-0031), **lucro líquido + margem%** com nota de cobertura, **breakdown de taxas** (comissão vs frete), **comparativo com período anterior** (seta ↑/↓), **gráfico de evolução** do líquido (recharts), e no detalhe: **export CSV**, **filtro liberado/a liberar** (rodapé filtro-aware) e **retido negativo como crédito**. Lógica pura em `lib/resumo-vendas.ts` (+ `lib/csv.ts`, `lib/metricas.ts`), TDD vitest. [ADR-0040](decisions/0040-financeiro-caixa-evolucao-notificacao.md) · spec [2026-06-23-financeiro-impecavel-design.md](superpowers/specs/2026-06-23-financeiro-impecavel-design.md). **✅ Validado e mergeado→deployado em produção (2026-07-02).**
- [x] **Notificação Telegram de liberação** — edge `notificar-liberacao` (pública/QStash, idempotente via coluna `ml_vendas.liberacao_notificada_em`): avisa quando o dinheiro das vendas é liberado HOJE em BRT no saldo Mercado Pago. Reusa a infra de Telegram. Migration `20260623160000_ml_vendas_liberacao_notificada.sql`.
  - **✅ CONCLUÍDO (2026-07-02):** migration aplicada, `notificar-liberacao` deployada (`--no-verify-jwt`), smoke test OK e **QStash schedule diário** ativo → `.../functions/v1/notificar-liberacao`.
  - [x] **Caminho morto do MP ao vivo removido** (2026-06-25, junto do ADR-0042): `lib/financeiro.ts`, `useResumoFinanceiro` e a fonte da edge `resumo-financeiro` — substituídos por `ml_vendas`/`useResumoVendas` no ADR-0038.

## Módulo Faturamento (ADR-0037) — 2026-06-22

- [x] **Menu Faturamento — vendas + devoluções + perguntas** — novo menu `/faturamento` com 3 abas: **Vendas** (pedido a pedido, KPIs só de pagos, árvore expansível com itens/comissão/frete/rastreio, filtros período/origem, botão Sincronizar), **Devoluções** (claims post-purchase: motivo/status/ações com prazo), **Perguntas** (responder pelo app + sugestão de IA via OpenRouter). Dados persistidos (`ml_vendas`/`ml_vendas_itens`/`ml_perguntas`/`ml_devolucoes`/`ml_webhook_eventos`, RLS por user) via **webhooks ML** (`ml-webhook`→QStash→`sync-venda`/`sync-pergunta`/`sync-devolucao`) + `backfill-faturamento` + `reconciliar-faturamento`. Alertas Telegram (nova venda/pergunta/devolução). [ADR-0037](decisions/0037-modulo-faturamento-webhooks-ml.md) · spec [2026-06-22-menu-faturamento-vendas-design.md](superpowers/specs/2026-06-22-menu-faturamento-vendas-design.md). Migrations + 8 edge functions deployadas; backfill validado (R$ 776,83 / 33 pedidos batem com a tela existente); validado end-to-end com browser-use (3 abas + IA). **✅ Mergeado→deployado em produção (2026-07-02).**
  - **✅ CONCLUÍDO (2026-07-02):** (1) DevCenter → URL de notificações = `.../functions/v1/ml-webhook` + tópicos `orders_v2`/`questions`/`claims`/`shipments` configurados; (2) QStash schedule (1h) ativo → `.../functions/v1/reconciliar-faturamento`.

**Última atualização:** 2026-06-21 — Repaginação visual premium + Tarefa 2/Onda 1 (workflow operacional) entregues e deployadas (ver bloco abaixo). **Iniciada a Evolução v2 — SaaS multicanal** (ver [seção dedicada](#-evolução-v2--saas-multicanal) abaixo + [documento mestre](superpowers/specs/2026-06-13-evolucao-saas-multicanal-design.md)).

**Design/UX 2026-06-21 (preparação para SaaS comercial — em produção, light+dark, TDD na lógica):**
- **Tarefa 1 — Repaginação visual premium (light-first):** sistema de tokens (gradiente de marca roxo→índigo, sombras recalibradas, elevação por cor no dark), regra híbrida vitrine/dados, hero cards e hover padronizado nos KPIs. Specs em `superpowers/specs/2026-06-20-repaginacao-visual-premium-design.md`.
- **Tarefa 1.5 — Refinamento pós-review (Codex):** hierarquia de elevação do Dashboard, borda tonal no dark, OAuth colapsado em "Detalhes técnicos" (Configurações), "Atualizado às HH:mm" no Financeiro, acento lateral por status na Revisão, dropzone expressiva na Viabilidade. Plano em `superpowers/plans/2026-06-21-refinamento-1-5-design.md`.
- **Tarefa 2 / Onda 1 — Workflow operacional contínuo (4 fatias, TDD):**
  1. **Jornada do lote** — stepper "você está aqui" (Progresso/Revisão/Relatório) + card "Continuar de onde parei" no Dashboard (`lib/jornada.ts`).
  2. **Painel "Precisa da sua atenção"** — pendências acionáveis no Dashboard (anúncios com problema, erros de publicação) (`lib/pendencias.ts`).
  3. **Revisão por exceção** — lista ordenada problemas-primeiro (erro→incompleta→aviso→ok→publicado), tabs/filtros intactos (`lib/revisao-ordem.ts`).
  4. **Pré-validação do upload** — valida as 14 colunas obrigatórias no cliente antes de enviar, feedback inline, bloqueia "Processar" se faltar coluna (`lib/validar-planilha.ts`).
  Specs em `superpowers/specs/2026-06-21-jornada-lote-design.md`, `…-dashboard-pendencias-design.md`, `…-revisao-excecao-prevalidacao-design.md`. 772 testes (21 novos), commits `efbbee5`→`022e84e`→`3ef0de9`, deploy live. **Sem tocar backend/lifecycle.**
- **Tarefa 2 / Onda 2 — Tirar atrito (2 fatias, TDD):**
  1. **Estado na URL + chips (Publicados)** — filtros/ordenação/página/tamanho passam a viver na URL (`lib/publicados-url.ts`), restaurados pelo back do navegador; chips de filtros ativos removíveis + "Limpar tudo" (`components/filtros-ativos.tsx`).
  2. **Quick wins** — paginação default 10 (era 5); estado vazio da Publicados com CTA "Novo lote".
  Spec `superpowers/specs/2026-06-21-onda2-atrito-design.md`. 780 testes (8 novos), validado em light+dark.
- **Tarefa 2 / Onda 3 — Navegação & orientação (2 fatias, TDD) — fecha a Tarefa 2:**
  1. **Breadcrumbs** nas telas profundas (Detalhe das vendas, Detalhe do líquido, Relatório) — componente acessível `components/ui/breadcrumbs.tsx`.
  2. **KPIs navegáveis (drill-down)** no Dashboard — `KpiCard` ganha prop `to`; "Anúncios publicados"→/publicados, "Ativos"→/publicados?status=ativo (usa o deep-link da Onda 2), "Com problema"→/publicados. Demais KPIs seguem informativos (sem redundância com pendências).
  Spec `superpowers/specs/2026-06-21-onda3-navegacao-design.md`. 783 testes (3 novos), validado em light+dark. **Tarefa 2 concluída.**
  **Backlog pós-Tarefa 2 (adiado com justificativa):** busca global (custo alto/valor baixo single-tenant), ações em massa na Revisão (mexe no gate "revisão humana antes de publicar" — exige decisão), a11y aprofundada (épico próprio), período sincronizado Publicados↔Financeiro, links cruzados, scroll restoration, aviso global do worker.
**📍 Passo atual:** Evolução v2 · Fase 0 · **E1 + E1b ✅ VALIDADOS EM PRODUÇÃO** (2026-06-14) — toda a camada de abstração de canais (CREATE + UPDATE + status) está atrás do `ChannelConnector`, mergeada, deployada e validada por bug bash real via automação de navegador (E1b: família de teste CREATE→UPDATE com reposição + cor nova + leitura de status ao vivo; anúncio `MLB6966427644` removido após). **Próximo épico: E2** (modelo de dados multicanal: `anuncios_externos` 1:N).

**Hotfix 2026-06-15:** tela `Publicados` corrigida para exibir `tipo_aviamento='cola'` como `Cola` e incluir esse valor no filtro de tipos. A causa era somente de renderização no frontend; banco já estava correto.

**Hotfix 2026-06-17 (ADR-0030 — reprocessamento de família em erro):** o lote #41 ficou em `erro` com a mensagem genérica `"The signal has been aborted"` — causa: a copy (IA/OpenRouter) excedeu o timeout de 30s no `process-familia`, e a única etapa de IA sem fallback derrubou a família. Entregue: (1) `gerarCopy` com 1 retry + erro **rotulado por etapa** (não mais o abort genérico); (2) nova edge function `reprocessar-familia` (reseta `erro→pendente` e re-enfileira via `enfileirarFamilia`, idempotente, por `familia_id` ou `lote_id`); (3) UI: status `erro` + `erro_mensagem` agora visíveis na linha da família, com botão **Reenviar** (por família) e **Reenviar N com erro** no header do lote. Ver [ADR-0030](decisions/0030-reprocessamento-de-familia-em-erro.md).

**Feature 2026-06-17 (Dashboard de KPIs em Publicados):** a tela `Publicados` ganhou um dashboard de vendas no topo (período selecionável 7/30/90d via `/orders` do ML): faturamento, unidades, pedidos, ticket médio, saúde dos anúncios, encalhados e top produtos. Tabela ganhou colunas **Unid. vendidas** e **Valor vendido**; **Fornecedor** passou a exibir a 1ª palavra (ex.: `DETALLIA`), com filtro pelo nome completo. Métrica abstraída no contrato de canal (`lerMetricasVendas`/`MetricasVendasCanal`) → multicanal-ready; nova edge function `metricas-vendas`. Validado em browser (login real, edge 200, fornecedor/colunas/seletor OK). Spec: [dashboard-kpis-publicados](superpowers/specs/2026-06-17-dashboard-kpis-publicados-design.md).

**Progresso desta sessão (terceira sessão, 2026-05-26 — fechamento do M0):**
- [x] Task 2 (Supabase URL/ANON_KEY) — captured via MCP
- [x] Task 3 (Upstash Redis + QStash) — pré-existente, captured via MCP
- [x] Task 8 (cliente Supabase) — commit `9a0eabc` — TDD limpo (RED→GREEN), `src/lib/supabase.ts` com fail-fast
- [x] Task 9 (Edge Function `hello`) — commit `9159e27` — deployada via MCP `deploy_edge_function` (sem CLI/Docker), curl confirmado HTTP 200
- [x] Task 10 (Render Static Site) — commits `bad04ca` → `4e1ad16` → `7d25229` — service `srv-d8at8arbc2fs73e5qcb0`, auto-deploy ativo, URL `https://ean2marketplace-frontend.onrender.com`
- *Desvio M0.1:* Render Static Site usa **HashRouter** em vez de BrowserRouter — rule `/* → /index.html` do Render retorna 200 com body vazio (bug; investigado a fundo, doc context7 confere sintaxe; HashRouter contorna sem depender da config do servidor)
- *Desvio M0.2:* Steps de Supabase CLI (`supabase init`/`link`/CLI install) pulados — MCP `deploy_edge_function` cobre o caso sem precisar de password do banco

**Progresso da sessão anterior (Plano 01 — Tasks 5/6/7):**
- [x] Task 5 (Tailwind 4 + shadcn) — commit `e103dc3` — *desvio:* preset Nova/`neutral` (4.8.0 mudou defaults)
- [x] Task 6 (Vitest + smoke) — commit `f77e24e` — *desvio:* vitest pinado em `^3` (4.x exige Vite 6)
- [x] Task 7 (React Router + TDD) — commit `04f6779` — react-router-dom v7

**Estado do sistema ao final desta sessão:**
1. Supabase: `gtin_mktplace_ia` / ref `txvncrgkoynoxwopfkbp` — ativo, com Edge Function `hello` deployada e responsiva
2. Frontend: deployado em `https://ean2marketplace-frontend.onrender.com` (HashRouter, refresh sempre funciona)
3. Repo GitHub: `analistasistemas-bit/gtinmktplace` — main pushed
4. Build OK: `pnpm build` (153 módulos, 21 kB CSS, 212 kB JS gzip 69 kB) | Test OK: `pnpm test` (4 passed)
5. Credenciais em `.env.local` (gitignored): Supabase URL+key, Upstash Redis+QStash tokens+signing keys, OpenRouter API key
6. **Ainda pendente para próximo bloco de trabalho:** (a) `supabase secrets set` para envs do backend antes do primeiro Edge Function que use IA/Redis; (b) trilho ML Developers — Diego precisa criar o app no portal ML

---

## Resumo de progresso

| Marco | Status |
|---|---|
| Pré-implementação (brainstorming + ADRs) | ✅ |
| M0 — Setup inicial | ✅ |
| M1 — UI mockup com dados fake | ✅ (pendente walkthrough Diego) |
| M2 — Backend core | ✅ |
| M3 — IA copywriting + Vision | ✅ |
| M3.1 — Foto-capa + polimento UX | ✅ |
| M4 — Integração Mercado Livre | ⬜ |
| M5 — Polimento e testes | ⬜ |
| M6 — Lançamento | ⬜ |
| Trilho paralelo: app ML Developers | ✅ (criada em 2026-05-27, certificação dispensada — uso interno) |
| 🚀 Evolução v2 — SaaS multicanal | 🟡 em andamento (Fase 0 / Épico E1) — ver [seção dedicada](#-evolução-v2--saas-multicanal) |

---

## Como usar este arquivo

- Cada tarefa tem **status** (símbolo) + **estimativa** + **dependências** (quando relevante)
- Marque ✅ assim que concluir; mantenha 🟡 enquanto trabalha em uma; ⏸️ quando bloqueado
- Quando bloqueado, comentar a linha abaixo com o motivo
- Não delete tarefas concluídas — servem de histórico

---

## Pré-implementação (esta semana)

### Brainstorming e planejamento

- [x] Levantamento de contexto (perfil do usuário, projeto, MCPs)
- [x] Reformulação em relação ao PDF original
- [x] Definição de arquitetura técnica
- [x] Definição do modelo de dados
- [x] Definição do pipeline detalhado
- [x] Definição de UX e telas
- [x] Definição de roadmap e marcos
- [x] Criação dos 8 ADRs iniciais
- [x] Criação do ROADMAP.md
- [x] Criação do TASKS.md
- [x] Escrita do design doc consolidado em `docs/superpowers/specs/2026-05-26-publiai-design.md` — existe e é referenciado no CLAUDE.md
- [x] Revisão crítica do design doc (Diego ou agente revisor) — feita; achados viraram os gaps §543+
- [x] Escrita do plano de implementação detalhado (`writing-plans`) — planos 01–06 em `docs/superpowers/plans/`

---

## 🏁 M0 — Setup inicial

### Contas e provisionamento

- [x] Criar repositório Git no GitHub (`gtinmktplace`) — *Diego criou; remote adicionado e pushed nesta sessão*
- [x] Inicializar projeto local (`git init`, README inicial) — *feito na sessão 1 (Plano 01 Task 1)*
- [x] Criar projeto Supabase (via supabase-mcp-server) — *Diego criou manualmente como `gtin_mktplace_ia` / ref `txvncrgkoynoxwopfkbp`*
- [x] Anotar URL e ANON_KEY do Supabase em `.env.local` — *capturado via MCP `get_project_url` + `get_publishable_keys` (publishable key, não legacy anon)*
- [x] Criar Render Static Site conectado ao repo — *service `srv-d8at8arbc2fs73e5qcb0` criado via MCP, auto-deploy ativo, URL pública responsiva*
- [x] Criar conta Upstash + QStash + Redis (via upstash MCP) — *Redis `mktplace-redis` (us-east-1 global, free) + QStash (eu-central-1, free) já provisionados*
- [x] Anotar tokens de QStash e Redis em `.env.local` — *gravado em `.env.local` (gitignored)*
- [x] (Substituída por ADR-0010) Criar conta OpenRouter + adicionar crédito mínimo — *Diego forneceu a key, gravada em `.env.local`*
- [x] Provisionar `OPENROUTER_API_KEY` + `UPSTASH_*` + `QSTASH_TOKEN` como Supabase secrets (`supabase secrets set ...`) — configurados no M2/M3 (edge functions de IA/Redis em produção)

### Trilho paralelo: Mercado Livre Developers ✅ (2026-05-27)

- [x] Acessar [Mercado Livre Developers](https://developers.mercadolibre.com.br/) — conta da Avil Têxtil já existia
- [x] Criar app "PubliAI" — Client ID `5907788004648058`, fluxos `Authorization Code` + `Refresh Token`
- [x] Configurar redirect URI — Supabase Edge Function (`ml-oauth-callback`) — ver [ADR-0011](decisions/0011-redirect-uri-via-edge-function.md)
- [x] `ML_CLIENT_ID` + `ML_CLIENT_SECRET` em `.env.local` (gitignored; serão movidos para Supabase Vault no M4)
- [⏭️] Submeter app para certificação — **dispensado**: uso interno, PubliAI publica nos anúncios da própria Daludi
- [⏭️] Aguardar aprovação — N/A (certificação dispensada)

### Setup do projeto frontend

- [x] Criar projeto Vite + React + TypeScript (`pnpm create vite`) — *Plano 01 Task 4 (sessão 1)*
- [x] Instalar Tailwind + setup conforme docs do Tailwind 4 — *commit `e103dc3`; Tailwind 4 CSS-only via `@import` + `@theme`*
- [x] Instalar shadcn/ui via CLI e inicializar — *commit `e103dc3`; preset Nova/neutral em vez de Slate (4.8 mudou default)*
- [x] Adicionar componentes shadcn iniciais (Button, Card, Badge, Dialog, Input, Sheet, Table) — adicionados sob demanda ao longo de M1–M3
- [x] Instalar TanStack Query, Zustand — `@tanstack/react-query` + `zustand` no `package.json`
- [x] Instalar Supabase JS client e configurar — *commit `9a0eabc`; TDD limpo (`src/lib/supabase.ts`)*
- [x] Criar estrutura de pastas: `src/components`, `src/lib`, `src/pages` — *`src/hooks` ainda não — criar no M1 quando precisar*
- [x] Verificar build local roda (`pnpm dev`) — *múltiplos builds OK na sessão; deploy Render confirma*

### Setup do projeto backend (Supabase)

- [ ] Instalar Supabase CLI localmente — *deferido; MCP `deploy_edge_function` cobre deploy sem CLI. Instalar se um dia precisar de dev local com Docker*
- [ ] `supabase init` + `supabase link` ao projeto remoto — *idem: deferido com MCP*
- [x] Criar pasta `supabase/functions` para Edge Functions — *criada no commit `9159e27`*
- [x] Criar Edge Function de teste `hello` para validar deploy — *commit `9159e27`, deployada via MCP, curl HTTP 200*

### Configuração geral

- [x] Adicionar `.env.example` + `.env.local` ao gitignore — *gitignore criado na sessão 1; `.env.local` verificado via `git check-ignore`*
- [x] Configurar Render para deploy automático ao push na main — *autoDeploy:yes via MCP; cada push em main triggera novo deploy em ~40s*
- [x] Validar que push gera deploy bem-sucedido — *commits `bad04ca`/`4e1ad16`/`7d25229` deployados live com sucesso*
- [x] Atualizar TASKS.md marcando M0 como completo — *esta atualização*

---

## 🏁 M1 — UI mockup com dados fake

### Layout e tema

- [x] Layout geral com sidebar + topbar + tema shadcn — *Nova/neutral mantido do M0; AppShell com Sidebar persistente + Topbar fina (commit `b9a6a97`)*
- [x] Criar mock data em `src/lib/mocks/` (lotes, famílias, variações realistas) — *types + 6 lotes + 50 famílias programáticas (commits `b4283a3` `79e6b53` `fa521d5`)*
- [x] Criar rota wrapper de autenticação simulada — *skipped no M1 conforme decisão UX: sidebar hardcoded `diego@empresa`*

### Tela Dashboard (lista de lotes)

- [x] Componente `LoteCard` (status, contadores, ações) — *commit `cc742f2`, TDD com destinoDoLote*
- [x] Lista de lotes consumindo mock — *useLotes hook (commit `25ab568`)*
- [x] Botão "Novo lote" navegando — *Plus icon + Link → /novo-lote*

### Tela Novo Lote (upload)

- [x] Componente `Dropzone` para planilha + imagens (react-dropzone) — *commit `a1b6ac2`, props reusáveis*
- [x] Validação de tipo de arquivo (`.xlsx` e `.jpg`/`.jpeg`/`.png`) — *via prop accept; CSV deferido pra M2 quando parse real entrar*
- [x] Preview de quantidade de arquivos — *"X arquivo(s) selecionado(s)" ou nome único*
- [x] Botão "Processar" navegando para tela de progresso — *navega para `/progresso/lote-novo-{timestamp}` (mock)*

### Tela Progresso

- [x] Layout de etapas com checkpoints visuais — *Stepper com aria-labels concluída/atual/pendente (commit `90db4d4`, TDD)*
- [x] Barra de progresso geral — *shadcn Progress*
- [x] Resumo do lote (mockado) — *38 famílias detectadas · 142 variações · 137 imagens matched · 5 órfãs (hardcoded)*
- [x] Simulação de progresso via timeout (avança a cada 2s) — *useEffect com setTimeout + cleanup*

### Tela Revisão em Lote (a mais complexa)

- [x] Componente `FamiliaRow` (substitui FamiliaCard original; design final é tabela densa) — *commit `8d1b9df`, TDD*
- [x] Cabeçalho da linha: badge CREATE/UPDATE, nome, thumbnail (cor), código PAI — *grid 6 cols, layout compacto*
- [x] Visualização da estratégia de preço (PRÓPRIO/COMPETITIVO com motivo) — *no FamiliaExpanded (commit `165a900`)*
- [x] Visualização de concorrência (sem/moderada/alta) — *no FamiliaExpanded*
- [x] Expansão accordion inline para mostrar variações — *FamiliaExpanded; múltiplas podem ficar abertas*
- [x] Edição inline de título, descrição, cor, preço (com `<Input>` controlado) — *state local no FamiliaExpanded; persistência só em M2*
- [x] Seleção em massa (checkbox por família) — *Set<id>, toggleSelecao imutável*
- [x] Ações em massa (Aprovar/Rejeitar selecionadas) — *footer sticky, commit `42b1414`, TDD; ambos limpam seleção em M1 (mock)*
- [x] Filtros chips (todos/CREATE/UPDATE/avisos) — *filtrarFamilias pura + 6 testes*
- [x] Busca por código ou nome — *case-insensitive em título, substring em PAI*
- [ ] Atalhos de teclado (J/K/A/R/Espaço) — *deferido para M5 (polimento)*
- [x] Footer com contadores e botões "Aprovar/Rejeitar selecionadas" — *sticky bottom, condicional em selecionadas.size > 0*

### Tela Relatório Final

- [x] Cards de resumo (publicadas, com erro, custo IA) — *3 cards grid, commit `ab85ba5`*
- [x] Lista de famílias com link clicável simulado — *href fixo `https://produto.mercadolivre.com.br/MLB-mockid`*
- [x] Botão "Editar e tentar de novo" para erros — *visual apenas no M1*
- [x] Botão "Exportar PDF" (placeholder, implementa em M5) — *Button disabled*

### Tela Configurações

- [x] Seção de conexão ML (estado mockado "Conectado") — *Badge verde + "como vendedor_mock" (commit `1aa0fd8`)*
- [x] Seção de estratégia de preço (radio buttons informacionais) — *RadioGroup default condicional, referencia ADR-0008*
- [x] Seção de categorias padrão — *MLB1132/1430/1429, referencia ADR-0009*

### Validação com Diego

- [x] Deploy de mockup em URL pública (Render) — *auto-deploy ativo desde M0; último deploy contém todas as 14 tasks*
- [ ] Walkthrough ao vivo: Diego percorre todas as telas — *aguardando Diego abrir a URL e validar*
- [ ] Lista de ajustes identificados na validação (acrescenta em TASKS) — *pós-walkthrough*

---

## 🏁 M2 — Backend core

### Status final (2026-05-27)

**M2 concluído** ✅ — pipeline técnico implementado em 1 sessão (16 tasks via Subagent-Driven Development) + bug bash com planilha real (290 variações da LINHA P/COST.XIK 120) realizado no mesmo dia. Pendências bloqueantes resolvidas (secrets configurados, usuário criado, validação ponta-a-ponta feita).

**Cobertura final:**
- Schema (4 tabelas + 7 enums + Vault standalone), auth, upload real para Storage privado, edge functions (ingest-lote completa + process-familia stub idempotente), TanStack Query com adapters DB→M1, Realtime via supabase channels + polling fallback
- **61 testes passando**, deploy automático Render (`ean2marketplace-frontend.onrender.com`), Edge Functions ACTIVE

**Bug bash do M2 — correções aplicadas no mesmo dia:**
- URL fix: sidebar Revisão apontava para `/revisao/lote-42` (uuid fake do M1) → agora vai para o lote mais recente via `RevisaoIndex`
- URL fix: docs/render.yaml diziam `publiai-frontend.onrender.com` mas o serviço Render se chama `ean2marketplace-frontend` desde a criação (Render não renomeia ao mudar yaml)
- Display: estoque "estq 92" → label "Estoque" + número formatado pt-BR (`1.400`)
- Display: imagens das variações + capa da família agora renderizadas via signed URLs (hook `useImageUrl`)
- Persistência: edição inline de título/descrição/preço agora grava no banco onBlur, com feedback visual `Salvando…` → `✓ Salvo` (antes era só estado React local)
- Busca: filtros agora encontram famílias também pelo código de qualquer variação filha
- Race condition: `useFamilias` aceita `refetchInterval`; Progresso poll 2.5s enquanto lote em trânsito (cobre gap se realtime perder evento)

**Desvios vs spec original (documentados nos commits):**
- pgsodium removido das migrations: extensão descontinuada pelo Supabase em 2024; supabase_vault 0.3.1 funciona standalone
- xlsx@^0.20 → ^0.18.5: SheetJS moveu versões novas só pro CDN próprio; npm registry só vai até 0.18.5 (mesma API)
- Migration `rls_initplan_fix` + `secure_trigger_and_indexes`: ajustes pós-review (auth.uid() wrap, revoke execute, drop índices redundantes)
- **TEMP: process-familia bypassando verificação de assinatura QStash** — o `Receiver.verify()` rejeitava com 401 (provavelmente chave de assinatura incorreta no Supabase Vault vs Upstash console). Restaurar em M3 quando as chaves forem reconfirmadas.

**Tarefas antecipadas do M3 (já implementadas no M2):**
- Edição inline persistindo no banco (M3 §300)
- Polling fallback no progresso (não estava no plano, ganho do bug bash)

**Tarefas adiadas pra M3 (decididas no bug bash):**
- Upload posterior de imagens em lote existente — drop zone + ícone por variação (ver §M3)

### Schema do banco

- [x] Criar migration inicial com enums (status, operacao, cor_origem, estrategia_preco) — `~2h`
- [x] Criar tabelas `lotes`, `familias`, `variacoes`, `ml_credentials` — `~3h`
- [x] Criar políticas RLS por user_id em todas as tabelas — `~2h`
- [x] Configurar Supabase Vault para tokens criptografados — `~1h`
- [x] Gerar tipos TypeScript do schema (`supabase gen types`) — `~30 min`
- [x] Validar políticas RLS com testes manuais — `~2h`

### Autenticação

- [x] Tela de Login (email/senha) com Supabase Auth — `~3h`
- [x] Tela de Cadastro (email/senha) — `~2h`
- [x] Tela de Reset de senha — `~2h`
- [x] Middleware de rota protegida — `~1h`
- [x] Hook `useAuth` com Zustand — `~1h`

### Storage

- [x] Criar bucket `imagens` privado no Supabase Storage — `~30 min`
- [x] Políticas RLS de Storage por user_id — `~1h`
- [x] Função helper para upload com retry — `~2h`
- [x] Função helper para gerar signed URL — `~30 min`

### Upload direto do frontend

- [x] Upload de planilha + imagens diretos pro Storage (chunks paralelos) — `~4h`
- [x] Barra de progresso real (não simulada) — `~2h`
- [x] Tratamento de erros de upload (rede, tamanho, tipo) — `~2h`

### Edge function `ingest-lote`

- [x] Setup base da edge function + tipos compartilhados — `~1h`
- [x] Parse de .xlsx usando SheetJS — `~2h`
- [x] Validação de colunas obrigatórias — `~2h`
- [x] Agrupamento por PAI (detecção do PAI=0) — `~2h`
- [x] Match de imagens por nome de arquivo (`00CODIGO.jpeg`) — `~2h`
- [x] Detecção de famílias já publicadas (query em `familias.ml_item_id`) — `~2h`
- [x] Persistência em `lotes` + `familias` + `variacoes` — `~3h`
- [x] Enfileiramento de jobs no QStash (via lib `lib/queue.ts`) — `~2h`
- [x] Retorno de `lote_id` para o frontend — `~30 min`
- [x] Tratamento de erros: planilha inválida, imagens órfãs, etc. — `~3h`

### Realtime no frontend

- [x] Hook `useLoteRealtime(loteId)` com Supabase channels — `~3h`
- [x] Atualização ao vivo da tela de Progresso — `~2h`
- [x] Reconexão automática se canal cai — `~1h`

### Bug bash do M2

- [x] Importar planilha real do Diego (LINHA P/COST.XIK 120 — 1 família, 290 variações, 2 imagens) — `~30 min`
- [x] Identificar edge cases e fixar — 7 correções aplicadas no mesmo dia (ver Status final acima)
- [x] Atualizar TASKS.md marcando M2 como completo

---

## 🏁 M3 — IA copywriting + Vision

### Status final (2026-05-28)

**M3 concluído** ✅ — pipeline IA implementado em 1 sessão (Plano 04, 20 tasks via Subagent-Driven Development) + bug bash colaborativo com 4 famílias reais no mesmo dia. Diego aprovou o output final: *"ficou ótimo agora"*.

**Cobertura final:**
- Edge functions deployadas via MCP: **process-familia v11** (pipeline real), **upload-imagens-lote v1**, **invalidar-cache-cor v1**
- Camada IA isolada: `_shared/ai/{client,modelos,tokens,vision,copywriter}.ts`
- Parser cor: `_shared/cor/{dicionario,extrair}.ts` com 42 cores PT-BR + word boundary unicode
- Cache Redis: `_shared/redis/{client,cache-cor}.ts` com TTL 90d + invalidação manual
- Pool concorrência: `_shared/concorrencia/pool.ts` (máx 5 chamadas Vision paralelas)
- Tela de Revisão consome dados reais; ganha BadgeCorOrigem + alerta sem cor + DropZoneImagensExistente + BotaoTrocarFoto
- **86 testes passando**, deploy automático Render confirmado

**Iteração do prompt (5 ajustes via bug bash):**
1. Título sem "Disponível em N cores"
2. Descrição sem preço por cor
3. Descrição sem código do produto
4. Lista de cores só com nomes ("- Preto" / "- Branco")
5. SEMPRE incluir seção "Aplicações" / "Para que serve"

**Vision endurecido:** cor muito escura → Preto; dúvida → Outra (operador valida manual)

**Restauração QStash:** signing keys rotacionadas via console Upstash + secrets atualizados no Supabase; smoke test via MCP confirma assinatura passa (401 → 400 por bug do MCP de teste, mas SDK do `ingest-lote` em produção funciona normal).

### Edge function `process-familia`

- [x] Esqueleto da edge function com idempotência (UPDATE atômico) — herdado do M2
- [x] Configurar QStash para chamar `process-familia` — herdado do M2
- [x] Validar idempotência com dispatch duplicado intencional — claim atômico via `UPDATE ... WHERE status='pendente'`

### OpenAI client + helpers

- [x] Setup do OpenAI SDK na edge function — `_shared/ai/client.ts` via OpenRouter
- [x] Error handling (rate limit, timeout, payload inválido) — try/catch + AbortSignal.timeout(30s)
- [x] Retry com backoff em erros transientes — delegado ao QStash (5xx retenta; 4xx persiste erro_mensagem)

### Atribuição de cor

- [x] Função `extrairCorDoTexto(texto)` com regex + dicionário PT-BR — 7 testes
- [x] Dicionário de cores comuns para aviamentos (42 canônicas + sinônimos) — 4 testes
- [x] Chamada de Vision para fallback — `_shared/ai/vision.ts` com prompt conservador
- [x] Prompt de Vision iterado e validado — endurecido após primeiro lote (Preto vs Azul Marinho)
- [x] Cache `cache:cor:{user_id}:{codigo}` no Upstash Redis (TTL 90d) — `_shared/redis/cache-cor.ts`
- [x] Salvar `cor_origem` (descricao/vision/manual) na variação — `OrigemCor` enum

### Geração de copy

- [x] Prompt base do copywriter de aviamentos — 6 regras inegociáveis
- [x] Validação com famílias reais — 4 famílias na sessão de bug bash
- [x] Iteração do prompt baseado em feedback do Diego — 2 ciclos (v9 → v10 → v11)
- [x] Função `gerarCopy(input)` retornando JSON estruturado — via `response_format: json_schema strict`
- [x] Parser do JSON com fallback de erro — try/catch dentro do adapter

### Tela de Revisão consome dados reais

- [x] Substituir mocks por hooks `useFamilias(loteId)` consumindo banco — `useFamilias` já existia desde M2; tipos/adapters estendidos com novos campos
- [x] Realtime update da tela conforme famílias ficam ready — herdado do M2
- [x] Edição inline persistindo no banco — para título, descrição, cor, preço com `*_editado_pelo_operador`
- [x] Flags `editado_pelo_operador` marcadas corretamente — flag de cor adicionada na migration 0007
- [x] Invalidação de cache Redis ao editar cor manualmente — `updateVariacaoCor` chama edge `invalidar-cache-cor`

### Upload posterior de imagens (decidido no bug bash M2)

- [x] Drop zone na Revisão para adicionar imagens em massa — `DropZoneImagensExistente` (component test)
- [x] Ícone de câmera por VariacaoCard — `BotaoTrocarFoto` (component test)
- [x] Edge function `upload-imagens-lote` — JWT auth, match por código com 8 dígitos, retorna `{ok, ja_tinha, sem_match, erros}`
- [x] Helper `src/lib/upload-imagens.ts` que chama a edge via fetch + invalida query TanStack

### Bug bash do M3

- [x] Lote real processado completamente — 4 famílias (linha + fitas + linha)
- [x] Diego revisou qualidade da IA e indicou ajustes — 5 ajustes aplicados via prompt iteration
- [x] Diego aprovou output final — "ficou ótimo agora"
- [x] Atualizar TASKS.md/ROADMAP.md marcando M3 como completo

---

## M3.1 — Foto-capa por família + polimento UX (2026-05-28)

### Foto-capa (Plano 05, 12 tasks subagent-driven)

- [x] Task 1 — Migration `capa_familia` + regeneração de tipos (commit `d57e10a`)
- [x] Task 2 — Expor `capaStoragePath` em Familia + mapper (`7f0344e`)
- [x] Task 3 — Helper TDD `classificarArquivo` (6 testes verdes, `fcb4cca`)
- [x] Task 4 — Edge function `upload-imagens-lote` v5 detecta prefixo CAPA_ (6 testes, `c69d926`)
- [x] Task 5 — Helpers cliente `subirCapaFamilia` / `removerCapaFamilia` (`3dfc479`)
- [x] Task 6 — Componente `<FotoCapaFamilia>` (3 testes, `6735f5b`)
- [x] Task 7 — Helper `urlCapaFamilia` (signedUrl, `48448a2`)
- [x] Task 8 — Card colapsado prioriza capa explícita (`5fe6183`)
- [x] Task 9 — Card expandido com Trocar/Remover (`47e1ddc`)
- [x] Task 10 — Contadores `capas_ok` no drop-zone (`b2be2d9`)
- [x] Task 11 — Smoke test manual aprovado por Diego
- [x] Task 12 — Docs finais (esta task)

### Ajustes adicionais do dia

- [x] Barra de progresso real no drop em lote (chunks de 5) — `de1f034`
- [x] Novo template de descrição com seções emoji — `b6fd20f` + process-familia v12
- [x] Botão "Regenerar descrição" por família — `f2340a5` + regenerar-copy-familia v1
- [x] Fix: regenerar atualiza state local imediato — `20c8fdf`
- [x] Badge cor_origem compacto (só ícone com tooltip) — `7b5d2ae` + `dcf23a1` + `7f40f87`
- [x] GTIN/EAN editável por variação — `8865dad`

**Status final do dia:** 101/101 testes passando, build verde, push concluído. Próximo marco: M4 (Integração Mercado Livre).

---

## 🏁 M4 — Integração Mercado Livre

### OAuth Mercado Livre ✅ (2026-05-29)

**Bloco OAuth concluído** via subagent-driven (spec + ADR-0012 + plano 15 tasks). Bug bash real aprovado: conectou como `AVILBV` (ml_user_id 1003820507), token gravado no Vault, scope com `write`/`publish-sync`/`offline_access`; disconnect limpa linha + segredos (0 órfãos). Ver [spec](superpowers/specs/2026-05-29-m4-oauth-ml-design.md) e [plano](superpowers/plans/2026-05-29-m4-oauth-ml.md).

- [x] Tela "Conectar Mercado Livre" em Configurações — seção real com badge/nickname + Conectar/Desconectar (`useMlConnection`)
- [x] Botão que abre URL de autorização (com state CSRF) — `ml-oauth-start` gera state no Redis (TTL 10min) + `montarAuthUrl`
- [⏭️] Página de callback (`/ml-callback`) — **dispensada**: callback é a Edge Function (ADR-0011), não rota do frontend
- [x] Edge function `ml-oauth-callback` (troca code por tokens) — deployada `verify_jwt:false`, redireciona com `?ml_conectado`/`?ml_erro`
- [x] Criptografia dos tokens via Supabase Vault — **reaproveitada do M2** (`upsert_ml_credentials`/`get_ml_tokens`); só faltou `delete_ml_credentials` (migration nova) p/ o disconnect
- [x] Helper de refresh proativo — `getValidAccessToken` (`_shared/ml/token.ts`) com lock distribuído Redis `SET NX` ([ADR-0012](decisions/0012-refresh-token-oauth-ml-com-lock-redis.md)); resolve gap §541
- [x] Validação manual do fluxo OAuth de ponta a ponta — bug bash 2026-05-29 (Diego)

**Desvios/achados do bug bash:**
- Bug corrigido: domínio de autorização do **Brasil é `auth.mercadolivre.com.br`** (com "v"), não `mercadolibre.com.br` — DNS NXDOMAIN no primeiro teste.
- Bug corrigido: banner "Conta conectada" ficava preso após disconnect (param `?ml_conectado` na URL) → agora gated no estado real.
- Sem testes unitários da orquestração (token.ts/edge functions): restrição do vitest (só funções puras importáveis) — `montarAuthUrl`/`precisaRenovar` testadas; resto validado no bug bash. 106/106 testes verdes.
- [x] **eslint instalado (2026-05-31)** — toolchain ESLint 9 flat config (`@eslint/js` + `typescript-eslint` + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh` + `globals`), config em `eslint.config.js`. `pnpm lint` passa (0 errors, 3 warnings benignos de `react-refresh` em arquivos shadcn ui + Revisao). `no-explicit-any` desligado só em `tests/**` (mocks do Supabase). Edge Functions (`supabase/functions`, Deno) ficam fora do lint do frontend.
- `getValidAccessToken` ainda **não tem consumidor** — será usado nos blocos de concorrência/publicação.

### Busca de concorrência

> **Plano:** [plano-07](superpowers/plans/2026-05-31-plan-07-busca-concorrencia.md) · **Spec/ADR:** [ADR-0014](decisions/0014-busca-de-concorrencia.md). Tasks 1–9 ✅ na `main` — **122 testes verdes**. Migration `add_concorrencia_familias` aplicada via MCP (2026-06-01); `process-familia` **v14** ACTIVE integra a busca. Falta só a Task 10 (bug bash com token ML real).

- [x] Função de busca por GTIN — `_shared/ml/concorrencia.ts` (`buscarConcorrencia`, ramo `gtin`) + `escolherIdentificador`/`gtinValido`
- [x] Função de busca por título (fallback) — mesmo `buscarConcorrencia`, ramo `titulo` (baixa confiança)
- [x] Classificação (sem/moderada/alta) — `_shared/concorrencia/classificar.ts`
- [x] Cache `cache:concorrencia:*` no Redis (TTL 6h) — `_shared/redis/cache-concorrencia.ts` (chave com hash do título)
- [x] **Migration** (2 enums + 4 colunas `concorrencia_*` em `familias`) + regenerar tipos — plano-07 Task 8 (MCP `apply_migration` `add_concorrencia_familias`; `database.types.ts` atualizado; build verde)
- [x] **Integração na edge function `process-familia` + deploy** — plano-07 Task 9 (busca 1×/família após a copy; `process-familia` v14 deployada via MCP)
- [x] **Bug bash** (lote real #5, 4 famílias) — plano-07 Task 10 ✅. **Achado:** `/sites/MLB/search` retorna 403 (descontinuado pelo ML). Corrigido para catálogo `/products/search` → `/products/{id}/items` (ver Adendo do [ADR-0014](decisions/0014-busca-de-concorrencia.md)). **Validação ponta a ponta (v15, token AVILBV):** FITA N.3 → 6 vend./R$12,62; LINHA XIK → 6/R$12,90; FITA N.9 → 9/R$17,99 (todas `origem=gtin`, classe alta); LINHA 1500MT (GTIN fora do catálogo ML) → `gtin`/0 vendedores, status `pronto` (resiliência OK). Ramo título não quantifica (catálogo textual = ~10k ruído) → `origem='titulo'`/PRÓPRIO seguro (sem família sem-GTIN no lote; lógica é retorno trivial). **Nota:** o MCP QStash não aciona o `process-familia` (conta divergente das signing keys); reprocessar exige lote novo pela UI (`ingest-lote` usa o SDK QStash real).

### Estratégia de preço condicional ✅ (2026-06-01)

> `process-familia` **v16** · função pura `calcularEstrategiaPreco` (TDD, 6 testes) · ADR-0008.

- [x] Função `calcularEstrategiaPreco(preco_planilha, concorrencia)` conforme ADR-0008 — `_shared/preco/calcular.ts` (TDD, 6 testes; cobre os 3 ramos + edge "já menor" + dado incompleto)
- [x] Persistência: `estrategia_preco`/`estrategia_motivo` na família + `preco_publicacao` por variação (preserva `preco_editado_pelo_operador`) — `process-familia` v16
- [x] Sinalização visual: badge PRÓPRIO/COMPETITIVO (já existia) + linha "publica: R$ X" no card + vendedores/menor preço no expandido + alerta de preço perigoso (gap §556, `precoAbaixo20pc` real no adapter)
- **Validação (projeção SQL com dados reais do lote #5):** Daludi vende 2–3× mais barato que o ML → todas as famílias caem em **PRÓPRIO ("já menor")**; o ramo COMPETITIVO raramente dispara na prática. Confirma o edge case central do ADR-0008. _Persistência v16 na UI fica visível no próximo lote subido (v16 só roda em lotes processados após o deploy)._

### Mapeamento de categorias e atributos ✅ (2026-06-01)

> `process-familia` **v17** · `_shared/categoria/{detectar,atributos}.ts` (TDD, 17 testes) · ADR-0009 + Adendo. **IDs do ADR estavam errados** (chutes) → reais validados via API ML.

- [x] Categoria ML para Linhas → **MLB270273** (Fios e Cadarços de Armarinho), não MLB1132
- [x] Categoria ML para Botões → **MLB270272**, não MLB1430
- [x] Categoria ML para Fitas → **MLB255054** (Fitas de Cetim), não MLB1429
- [x] Detecção de tipo (`detectarTipoAviamento`, regex PT-BR; camada IA fica como melhoria futura)
- [x] Atributos obrigatórios por categoria (mapa real da API: BRAND+MODEL / BRAND+RIBBON_TYPE / BRAND+MATERIAL)
- [x] Função `montarAtributosML(tipo, nome)` — BRAND fixo "Avil", MODEL=nome, RIBBON_TYPE/MATERIAL inferidos
- [x] Validação `atributosFaltantes` + badge "categoria indefinida" na revisão quando `tipo=outro`
- Persiste `tipo_aviamento`/`tipo_origem`/`categoria_ml_id`/`atributos_ml`. IDs corrigidos também na tela Configurações.

### Publicação CREATE

- [x] **Pré-publicação: implementar [ADR-0013](decisions/0013-edge-cases-da-planilha-no-ingest.md)** (edge cases da planilha, não-bloqueantes) ✅ 2026-06-03 — `agruparPorPai` retorna `{ grupos, anomalias }` com dedup por CODIGO (1ª vence) + coleta de órfãos/PAI-sem-filho (sem `throw`); `ingest-lote` aborta só se sobrar 0 família e persiste `anomalias` na coluna `lotes.anomalias_planilha` (jsonb, migration `add_anomalias_planilha_lotes`); `Progresso.tsx` mostra faixa âmbar dos descartados. TDD: `_shared/__tests__/parser.test.ts` (5) + `tests/lib/anomalias.test.ts` (5). 173 testes verdes. **Falta:** deploy do `ingest-lote` via MCP.
> **Implementado via [plano-10](superpowers/plans/2026-06-03-plan-10-publicacao-create.md)** (subagent-driven, spec `2026-06-03-m4-publicacao-create-design.md`). 14 tasks + correções pós-review. 190 testes verdes, build/lint verdes. **Falta só o bug bash com token real (Task 13 abaixo).**

- [x] **Seleção do que publicar (pedido do Diego)** ✅ 2026-06-03 — granularidade família + excluir cores; `familiaPublicavel` (TDD, 9 testes) bloqueia incompletas com motivo; selo na `FamiliaRow`, checkbox "incluir cor" no `FamiliaExpanded` (persiste `variacoes.excluida_da_publicacao`), filtro "🔒 Incompletas", footer "Publicar selecionadas" + modal de confirmação.
- [x] Edge function `publish-familia-ml` (worker) ✅ — deploy **v2** (correções de idempotência pós-review). Idempotente (`ml_item_id`), valida atributos server-side, sobe fotos, `POST /items`, persiste.
- [x] Edge function `publicar-familias` (disparo) ✅ — deploy v1. Claim atômico `status='publicando'` (filtra user_id/CREATE/pronto/`ml_item_id` null) + enfileira no QStash via `enfileirarPublicacao`.
- [x] Montar payload com variações nativas ✅ — `montarPayloadItem` (`_shared/ml/publicar.ts`, TDD 4 testes). _Defaults `listing_type_id`/`condition`/GTIN a confirmar no bug bash._
- [x] Upload das fotos para o ML ✅ — `subirFotoML` (`POST /pictures`); signed URL TTL 2h (gap §569); capa cacheada em `familias.capa_ml_picture_id` (idempotente em retries).
- [x] POST `/items` com tratamento de resposta ✅ — `criarItemML` (`_shared/ml/criar-item.ts`), propaga `status` HTTP.
- [x] Salvar `ml_item_id`, `ml_permalink`, `ml_variation_id`s ✅ — no worker; `ml_variation_id` casado por `seller_custom_field` com fallback por índice.
- [x] Tratamento de erros 4xx vs 5xx (retry vs fail) ✅ — 4xx/erro local → `status='erro'`; 5xx/429 → mantém `publicando` e relança p/ QStash retentar; transição do lote `publicando→concluido/revisao` ao fim.

### Publicação UPDATE

- [ ] Montar payload de atualização (variações com estoque/preço novos) — `~3h`
- [ ] PUT `/items/{ml_item_id}` — `~2h`
- [ ] Verificar se UPDATE detecta variações novas ou removidas — `~2h`
- [ ] Atualizar `publicado_em` no banco — `~30 min`

### Tela de Relatório Final

- [x] Consumir dados reais (sucesso/erro por família) ✅ 2026-06-03 — `Relatorio.tsx` via `useFamilias`/`useLote`/`useLoteRealtime` + polling enquanto `lote.status='publicando'`
- [x] Links clicáveis para anúncios publicados ✅ — `mlPermalink` exposto no adapter
- [x] Botão "Editar e tentar de novo" para erros ✅ — mostra `erroMensagem` + volta à Revisão
- [ ] Custo de IA somado do lote — `~2h` (deferido; cards atuais: publicadas/publicando/erro)

### Bug bash do M4 (Publicação CREATE) — **✅ VALIDADO (2026-06-04, 2 anúncios reais; ver histórico no CLAUDE.md)**

> Task 13 do plano-10. Edges deployadas: `publicar-familias` v1, `publish-familia-ml` v2. Os 3 pontos da spec §5.4 foram descobertos e resolvidos contra a API real (GTIN sem EAN → `EMPTY_GTIN_REASON`; `listing_type_id` Clássico/Premium via modal; foto via `POST /pictures`). UPDATE, capa2/capa3, preço v2, catálogo e retry de foto também já validados em lotes reais posteriores.

- [x] Subir um lote novo pela UI (1 família simples, fotos + GTIN válido), processar até `pronto`
- [x] Selecionar e publicar pela UI; observar `familias.erro_mensagem` se falhar
- [x] Iterar os 3 pontos de descoberta (GTIN/listing_type/foto) re-deployando o worker
- [x] Validar 1 publicação real bem-sucedida (anúncio no ML com fotos/cores/preço; ids persistidos)
- [x] Atualizar os testes de `montarPayloadItem` para o formato final + ADR de fechamento se surgir decisão nova
- [x] (UPDATE validado em blocos seguintes — lotes #28/#31)

---

## 🏁 M5 — Polimento e testes

### Reprocessamento e edição pós-erro

- [ ] Botão "tentar de novo" reenfileira família com erro — `~2h`
- [ ] Substituir foto de variação na tela de revisão (upload pontual) — `~3h`

### Auditoria e qualidade IA

- [ ] Painel simples mostrando "% editado pelo operador" por categoria — `~3h`
- [ ] Export de pares "IA gerou X, operador editou pra Y" pra retroalimentar prompt — `~3h`

### Filtros e produtividade

- [ ] Atalhos de teclado finalizados (A/R/J/K/Espaço/Ctrl+A) — `~3h`
- [ ] Filtros funcionais na tela de revisão — `~3h`
- [ ] Busca por código ou nome com debounce — `~2h`

### Notificações

- [ ] Notification API do browser quando lote termina processamento — `~2h`
- [ ] Toast Sonner em sucessos/erros — `~2h`

### Export de relatório

- [ ] Geração de PDF do relatório (react-pdf ou similar) — `~4h`

### Bug bash final

- [ ] Lote real grande (50+ famílias) ponta a ponta — `~2h`
- [ ] Tudo o que aparecer no bug bash, fixar ou diferir explicitamente — *variável*

---

## 🏁 M6 — Lançamento

### Deploy de produção

- [ ] Configurar domínio customizado em Render (se aplicável) — `~2h`
- [ ] Configurar HTTPS e cookies seguros — `~1h`
- [ ] Smoke test em produção — `~1h`

### Documentação para operador

- [ ] Guia rápido em 1 página (fluxo + atalhos) — `~3h`
- [ ] Vídeo curto (3-5 min) gravando uma sessão completa — `~1h`

### Treinamento e acompanhamento

- [ ] Sessão presencial ou remoto com operador (1h) — `~1h`
- [ ] Acompanhar primeiros 3 lotes de uso real — *contínuo*
- [ ] Coletar feedback do operador e abrir tasks de melhorias — *contínuo*

### Métricas iniciais

- [ ] Medir tempo médio de processamento por lote — `~1h`
- [ ] Medir tempo médio de revisão pelo operador — `~1h`
- [ ] Medir taxa de aprovação sem edição (proxy de qualidade IA) — `~1h`
- [ ] Medir custo operacional mensal real — `~1h`

---

## 🚀 Evolução v2 — SaaS multicanal

> Decomposição operacional do [documento mestre](superpowers/specs/2026-06-13-evolucao-saas-multicanal-design.md). **Convenção:** após cada implementação, marco o checkbox e atualizo o **"📍 Passo atual"** no topo deste arquivo — assim você sempre sabe exatamente onde estamos. Cada épico roda em **branch isolada da `main`** (app em produção); merge → `main` + deploy só com OK do Diego.

**📍 Passo atual:** Evolução SaaS · Fase 1 · **E1 + E1b + E2 + E3 + E4 ✅ validados em produção** — a camada de canais, o modelo multicanal `anuncios_externos`, a categoria genérica e os atributos por IA closed-set estão em produção. Bug bash real do E4 cobriu publicação de vertical nova pela UI (`MLB4779431383`, depois removido do sistema; `anuncios_externos` voltou a 21). Próximo: **E5** (conector Shopee, ADR-0027).

| Fase | Épico | Status | ADR |
|---|---|---|---|
| 0 | E1 Camada de abstração (CREATE) | ✅ validado em produção | 0024 |
| 0 | E1b Abstração UPDATE + status | ✅ validado em produção | 0024 |
| 0 | E2 Modelo de dados multicanal | ✅ validado em produção | 0025 |
| 1 | E3 Taxonomia canônica + categoria por IA | ✅ validado em produção | 0026 |
| 1 | E4 Atributos por IA (closed-set) | ✅ validado em produção | 0026 |
| 2 | E5 Conector Shopee | ⬜ | (a criar) |
| 2 | E6 Orquestração multicanal | ⬜ | (a criar) |
| 3 | E7 Multi-tenancy | ⬜ | 0027 |
| 3 | E8 Billing (Asaas) + LGPD | ⬜ | 0028 |
| 3 | E9 Operação SaaS | ⬜ | (a criar) |

### Fase 0 — Fundação (sem mudança visível)

**E1 — Camada de abstração de canais (CREATE)** · [plano](superpowers/plans/2026-06-14-e1-camada-abstracao-canais.md) · ADR-0024 · ✅ **validado em produção**
- [x] E1.1 `contrato.ts` — `ChannelConnector` + tipos canônicos (`AnuncioCanonico`, `ResultadoCanal`, `Capabilities`, `RefAnuncio`) — commit `d64e256`
- [x] E1.2 `mapeamento.ts` — puras `mapearVariacoesExternas` + `classificarErroCanal` (TDD, 6 testes) — commit `e8f0116`
- [x] E1.3 `mercado-livre.ts` — `MercadoLivreConnector` delegando ao `_shared/ml` — commit `540066b`
- [x] E1.4 `registry.ts` — `getConnector` (TDD, 2 testes) — commit `bc61f95`
- [x] E1.5 religar `publish-familia-ml` via conector (comportamento idêntico) — commit `542c061`, review independente (opus) APROVADO
- [x] E1.✅ verificação: backend 505 testes verdes + lint + diff review + review opus + **bug bash real ✅** (lote de teste via automação de navegador → publicou `MLB6966315202` pelo conector; id/variação/foto persistidos; anúncio encerrado e removido) + merge→`main` (`1118d62`) + deploy `publish-familia-ml` via CLI **validado em produção (2026-06-14)**. As falhas transientes de foto no caminho foram tratadas corretamente pelo conector (retentável → retry).

**E1b — Abstração UPDATE + status** · [plano](superpowers/plans/2026-06-14-e1b-abstracao-update-status.md) · ADR-0024 · ✅ **validado em produção (2026-06-14)**
- [x] E1b.1 contrato: `atualizarAnuncio` + `sincronizarDescricao` + `lerStatus` + tipos `AtualizacaoCanonica`/`ResultadoAtualizacao`/`StatusCanal` + `status?` no `ErroCanal` — commit `d6d64bd`
- [x] E1b.2 `MercadoLivreConnector` implementa os 3 métodos delegando a `atualizar-item`/`atualizar`/`criar-item`/`pacote`/`status`; `mapearVariacoesPorSku` (UPDATE casa só por `seller_custom_field`, TDD) — commit `d6d64bd`
- [x] E1b.3 religar `update-familia-ml` via `conn.atualizarAnuncio`/`sincronizarDescricao`/`subirFoto` (catch/idempotência/limpeza de cache de foto preservados) — commit `a9f2510`
- [x] E1b.4 religar `status-publicados` via `conn.lerStatus` (`semCredencialML` preservado) — commit `a9f2510`
- [x] E1b.✅ backend 340 testes verdes + lint 0 erros + review independente (opus) **APROVADO — EQUIVALENTE** (8 pontos, `tsc` 0 erros) + merge→`main` (`08e77e5`) + deploy `update-familia-ml` v26/`status-publicados` v4/`publish-familia-ml` v25 via CLI + **bug bash real via automação de navegador**: família de teste descartável CREATE→UPDATE (reposição estoque 10→25/8→3 **+ cor nova** criada e casada via refetch; descrição "CORES DISPONÍVEIS" atualizada; estoque ao vivo 43 lido por `lerStatus` na tela Publicados) — anúncio `MLB6966427644` encerrado e todo o dado de teste removido (ML/banco/storage)

**E2 — Modelo de dados multicanal** · [plano](superpowers/plans/2026-06-14-e2-modelo-dados-multicanal.md) · [spec](superpowers/specs/2026-06-14-e2-modelo-dados-multicanal-design.md) · ADR-0025 · ✅ **validado em produção (2026-06-14)**
- [x] E2.1 migration aditiva `anuncios_externos` (1 produto → N anúncios) + enum `canal_externo` + RLS + índice + trigger — ancorada em `(user_id, canal, codigo_pai)` (não `familia_id`: `familias` é por-lote e várias linhas compartilham `ml_item_id`). `canais_conectados` diferido p/ E7; estoque único (decisões Diego)
- [x] E2.2 backfill na própria migration (agrega todas as variações de todas as famílias do mesmo `(user_id, codigo_pai)`, dedup por código) — verificado: 21 anúncios, 414 entradas == 414 `(codigo_pai,codigo)` distintos casados
- [x] E2.3 helper `_shared/anuncios/espelhar.ts` — puras `montarAnuncioExterno` + `mesclarVariacoesExternas` (TDD, 7 testes) + `espelharAnuncioExterno` best-effort (merge antes do upsert: reposição parcial não trunca o mapa)
- [x] E2.4 dual-write nos workers `publish-familia-ml`/`update-familia-ml`/`vincular-catalogo` (após a persistência `ml_*`, best-effort, leitura/idempotência inalteradas)
- [x] E2.✅ 579 testes verdes + tsc/lint 0 erros + **review independente (opus) APROVADO COM RESSALVAS** (🟠 do truncamento corrigido com merge + backfill agregado; 🟡 status/erro só no sucesso = intencional) + deploy `publish`/`update`/`vincular-catalogo` via CLI + **bug bash real via browser**: família de teste descartável **CREATE** (`MLB6966524308`, espelho criado com mapa de 2 cores) → **UPDATE** (reposição + cor nova Verde → mapa cresceu p/ 3, merge preservou as antigas) → **catálogo** (job QStash → `catalog_status` gravado no mapa) — anúncio encerrado no ML e todo o dado de teste removido (espelho voltou a 21 linhas de produção)
- [ ] E2.5 (diferido) view de compatibilidade + cutover de leitura para `anuncios_externos` + remover colunas `ml_*`/`catalog_*` de `familias`/`variacoes` quando o frontend migrar ("corte do tronco")

### Fase 1 — "Qualquer produto"

**E3 — Categoria genérica + schema dinâmico** · [spec](superpowers/specs/2026-06-14-e3-categoria-generica-design.md) · ADR-0026 · ✅ **validado em produção (2026-06-14)**
- [x] E3.1 resolução em camadas: override por vertical → preditor nativo ML (`domain_discovery`) → LLM desempate closed-set → manual
- [x] E3.2 schema dinâmico de atributos via `/categories/{id}/attributes` (cache Redis) + persistência de `categoria_nome`/`atributos_faltantes`
- [x] E3.3 UI da Revisão mostra categoria prevista, origem e faltantes; aviamentos mantêm override determinístico sem regressão
- [x] E3.✅ 25 testes novos, review independente aprovado, deploy via CLI e bug bash real via browser-use

**E4 — Preenchimento de atributos por IA (closed-set) + validação** · [spec](superpowers/specs/2026-06-14-e4-atributos-ia-closed-set-design.md) · ADR-0026 · ✅ **validado em produção (2026-06-14)**
- [x] E4.1 LLM extrai valores escolhendo dentro de `values[]` permitidos (closed-set), sem inventar `value_id`
- [x] E4.2 gate de publicação generalizado para categoria prevista/manual e aviamentos sem regressão
- [x] E4.3 `EMPTY_GTIN_REASON` generalizado por schema da categoria quando suportado pelo ML
- [x] E4.✅ 14 testes novos, review independente sem bloqueios, deploy via CLI, publicação real de vertical nova pela UI (`MLB4779431383`) e limpeza total do dado de teste (`anuncios_externos` voltou a 21)

### Fase 2 — 2º canal

**E5 — Conector Shopee** · ADR a criar · [deep-dive §8.1 do doc mestre]
- [ ] E5.1 registrar app no Shopee Open Platform (`partner_id`/`partner_key`); confirmar requisitos BR no portal logado
- [ ] E5.2 `ShopeeConnector`: auth OAuth + HMAC-SHA256 + refresh proativo (lock Redis, reusar ADR-0012); `capabilities`
- [ ] E5.3 mapeador `AnuncioCanonico → add_item` (item + `tier_variation`/`models`); upload `media_space`; categoria + `get_attribute_tree` + `brand`
- [ ] E5.4 `update_stock`/`update_price`/`lerStatus`
- [ ] E5.5 classificador de erro Shopee → enum canônico
- [ ] E5.6 bug bash com token real Shopee BR (GTIN/EAN: `3000*` não passa — depende do E3/E4)

**E6 — Orquestração multicanal** · ADR a criar
- [ ] E6.1 `publicar-familias` aceita `{ familia_ids, canais[] }`
- [ ] E6.2 worker genérico `publicar-anuncio` (`{ familia_id, canal }`); idempotência por `(familia,canal)`
- [ ] E6.3 fan-out com delay escalonado por canal (rate limit)
- [ ] E6.4 reconciliação: `lerStatus` por `(familia,canal)`
- [ ] E6.5 frontend: seleção de canais na Revisão + status por canal em Publicados

### Fase 3 — Virar SaaS comercial (só quando houver interessado externo)

**E7 — Multi-tenancy** · ADR-0027
- [ ] E7.1 migration: `organizations` + `organization_members` + `organization_invitations` + enum `org_role` + funções `is_member_of`/`has_role_on_org`
- [ ] E7.2 `org_id` aditivo em `lotes`/`familias`/`variacoes`/`anuncios_externos` + backfill (org pessoal) + índices
- [ ] E7.3 trocar policies `user_id=auth.uid()` → `is_member_of(org_id)` (manter `user_id` como criado_por)
- [ ] E7.4 `ml_credentials` → `marketplace_connections` (org+canal+conta); helpers Vault por `connection_id`
- [ ] E7.5 🔴 blindar edge functions (resolver+validar `org_id` do JWT antes de tocar segredos)
- [ ] E7.6 onboarding self-serve (`handle_new_user` + `accept-invite`) + troca de org ativa no frontend
- [ ] E7.7 `lotes.numero` global → sequência por org
- [ ] E7.✅ validar isolamento (get_advisors security + teste cross-tenant)

**E8 — Billing (Asaas) + LGPD** · ADR-0028
- [ ] E8.1 integrar Asaas (Pix/boleto/cartão recorrente + Pix Automático)
- [ ] E8.2 tabelas `assinaturas` + `uso_ciclo` (RLS por org)
- [ ] E8.3 edge `webhook-asaas` (HMAC + idempotência) + reconciliação por cron
- [ ] E8.4 entitlements/gating server-side (checar limite antes do claim; medir anúncios ATIVOS; repasse de IA com franquia+teto)
- [ ] E8.5 planos (Free/Starter/Pro/Scale)
- [ ] E8.6 LGPD: `audit_log` por org + DPA + export/exclusão de titular

**E9 — Operação SaaS**
- [ ] E9.1 observabilidade por canal (erro/latência/rate-limit) + alertas
- [ ] E9.2 gestão de rate-limit por canal (token bucket) no fan-out
- [ ] E9.3 painel de saúde de integração
- [ ] E9.4 suporte: logs por tenant + replay de job + fila de exceções
- [ ] E9.5 Supabase: pooler Supavisor (transaction mode) nas edges + revisão de plano/custo

---

## Backlog (v2 e além)

Itens fora do MVP, deliberadamente diferidos:

- Suporte a tecidos (escopo + atributos diferentes)
- Outros marketplaces (Shopee, Magalu, Amazon)
- Sincronização contínua com sistema interno (CDC/webhook)
- Multi-usuário com permissões
- Dashboard analítico (vendas, conversão)
- Bot de Q&A no ML
- Tabela "de-para" fornecedor → cor (caso Vision dê erro recorrente)
- Estratégias de preço configuráveis por lote

---

## ⚠ Gaps conhecidos da revisão crítica do spec (2026-05-26)

A revisão independente do spec (executada via agente crítico em 2026-05-26) levantou achados 🔴 críticos e 🟠 altos. Os 2 críticos foram **resolvidos** via [ADR-0009](decisions/0009-campos-payload-ml-e-categoria-deterministica.md). Os 4 altos foram **deferidos para tratamento durante a implementação** — abaixo, listados onde cada um precisa ser retomado para não cair no esquecimento.

### 🟠 Tratar durante M4 (Integração ML)

- [ ] **UPDATE com variação adicionada/removida** — quando reimportar uma família já publicada e ela ganhar/perder cores, sistema deve detectar e sinalizar com badge na tela de revisão. Não precisa publicar a mudança automaticamente, mas precisa COMUNICAR. Senão o operador publica com estoque/variação errados. Atualizar [ADR-0005](decisions/0005-lifecycle-publish-and-update.md) com regra antes de implementar.
- [x] **OAuth refresh com lock no Redis** — ✅ resolvido no bloco OAuth do M4. `getValidAccessToken` usa lock `SET NX` no Upstash (TTL 30s) + refresh proativo (buffer 5min). Documentado em [ADR-0012](decisions/0012-refresh-token-oauth-ml-com-lock-redis.md) (o gap citava "ADR-0010", mas esse número já era do OpenRouter).
- [x] **Alerta visual de preço perigoso** — ✅ 2026-06-01. `precoAbaixo20pc` no adapter (`familiaFromRow`): alguma variação com `preco_publicacao < 0.8 × preco`. O alerta vermelho na tela de revisão já existia (`familia-expanded.tsx`), agora alimentado por dado real. Não bloqueia publicação, só sinaliza.
- [ ] **Reavaliar duração de M4 para 3 semanas** — escopo real (~20 tarefas substanciais) parece pedir 3 semanas. Decidir ao iniciar M4: ou estender M4, ou mover busca de concorrência + estratégia de preço para M3 (são independentes do OAuth).

### 🟡 Tratar durante M2 (parsing de planilha) e M4

- [ ] **Edge cases da planilha** — regra definida em [ADR-0013](decisions/0013-edge-cases-da-planilha-no-ingest.md) (2026-05-31): todas não-bloqueantes (descartar + contar no resumo). CODIGO duplicado → manter a 1ª; filho órfão → pular o filho; PAI sem filho → pular a família. **Hoje os três casos ou rejeitam o lote (órfão/PAI vazio) ou são silenciosos (duplicado)** — ver comportamento atual no ADR. **Implementação pendente** no fluxo de ingest/publicação do M4 (dedup por CODIGO + trocar os 2 `throw` por coleta + contadores no resumo do lote).
- [ ] **Signed URL com TTL longo para foto no ML** — API ML faz download assíncrono; signed URL precisa de TTL > tempo de processamento ML (≥1h) ou usar upload direto via `POST /pictures`.
- [x] **Critérios de classificação de concorrência** — definidos em [ADR-0014](decisions/0014-busca-de-concorrencia.md): sem=0; moderada=1–5; alta=6+ (apenas informativo; o preço segue a regra binária do ADR-0008).
- [x] **Invalidar cache de cor** — implementado no M3: edge `invalidar-cache-cor` é chamada quando o operador edita a cor manualmente.

### 🟢 Lembretes pequenos

- [x] **CORS** — `_shared/cors.ts` aplicado em todas as Edge Functions (`handleOptions` + `corsHeaders`).
- [x] **Zustand vs TanStack Query** — divisão aplicada na prática: Zustand para UI/auth state; TanStack Query para server state.

---

## Ajustes de UX da Revisão

- [x] **Painel de Análise visual no topo do anúncio** (2026-06-01) — move estratégia/concorrência/categoria do final do expandido para um painel visual (cards + ícones + cores semânticas) ao lado da foto-capa; consolida o alerta de preço perigoso. Componente `PainelAnalise` (TDD 7 testes). Spec: [2026-06-01-painel-analise-revisao-design.md](superpowers/specs/2026-06-01-painel-analise-revisao-design.md) · Plano: [plano-08](superpowers/plans/2026-06-01-plan-08-painel-analise.md). Só frontend; 155 testes verdes.
- [x] **Card "Potencial de venda" no painel** (2026-06-01) — proxies de mercado (faixa de preço dos concorrentes, frete grátis, FULL, força dos concorrentes = MercadoLíder + maior vendas, ranking da categoria, idade no catálogo), já que a venda exata por produto não é exposta pela API do ML. Backend: `parseItensProduto`→`DadosOfertas` + `analisarMercado` (`_shared/ml/mercado.ts`, cache seller 24h/highlights 6h) + coluna `analise_mercado jsonb`; `process-familia` **v18**. Frontend: card no `PainelAnalise` (`fmtMilhar`). [ADR-0015](decisions/0015-potencial-de-venda-via-proxies.md) · spec `2026-06-01-potencial-de-venda-design.md` · [plano-09](superpowers/plans/2026-06-01-plan-09-potencial-de-venda.md). 162 testes verdes. **Falta:** bug bash com lote real (validar `analise_mercado` persistido + card na tela).

---

## Notas livres

Espaço para observações, decisões pendentes pequenas, ideias durante a implementação:

> _(adicione aqui conforme o projeto avança — exemplos: "operador prefere foto na esquerda", "categoria de fitas precisa de atributo X", etc.)_

- [x] **Fix margem `-Infinity` + JSON nulo no Faturamento** (2026-06-26) — `calcularResumo` dividia por `liqComCusto` com guarda em `custoTotal` (venda com líquido 0 e custo > 0 → `-Infinity`); guarda corrigida para `liqComCusto > 0`. Também: `faturamento.ts`/`financeiro.ts`/`perguntas.ts` retornavam `null as T` quando o body 200 não era JSON válido — agora lançam erro. TDD (1 teste novo). 900 testes verdes. Só frontend.
- [x] **Lazy routes + dedup `normGtin`** (2026-06-26) — páginas viraram `React.lazy` + `Suspense` em `App.tsx` (code-splitting): bundle inicial saiu de ~tudo para `index` 180kB gzip + chunk da rota; `Faturamento`/`Financeiro`/`xlsx`/`html2canvas` agora sob demanda. `normGtin` extraído p/ `lib/gtin.ts` (fonte única). **Não** mesclei as cadeias custos↔fotos (duplicação proposital p/ isolar o fluxo de dinheiro). 993 testes verdes; validado no browser. Só frontend.
- [x] **Segurança B+C** (2026-06-26) — **B:** `notificar-liberacao` era pública (`verify_jwt=false`) sem verificar assinatura QStash; adicionada `verificarAssinatura` (igual aos outros 11 workers), deployada com `--no-verify-jwt`. Validado: request sem assinatura → 401. **C:** `telegram_config_status()` (SECURITY DEFINER) tinha EXECUTE p/ `anon` (advisor 0028); migration revoga de anon (mantém authenticated). Validado no app (Configurações carrega). **D (proteção de senha vazada / HIBP):** bloqueada — só no plano Pro do Supabase; reabilitar quando fizer upgrade.
- [x] **Segurança A — migração SheetJS** (2026-06-26) — `xlsx` do npm (`^0.18.5`) está descontinuado/sem patch (Prototype Pollution CVE-2023-30533 + ReDoS CVE-2024-22363) e é usado p/ parsear uploads (`validar-planilha.ts` `XLSX.read`). Trocado pela versão oficial da CDN do SheetJS `0.20.3` (`pnpm add https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`). `pnpm audit --prod` não acusa mais SheetJS. 993 testes verdes; validado no browser (upload real → "Planilha válida, 14 colunas presentes"). Frontend.
- [x] **Fix categoria/título — tipo de produto genérico via IA (lote #50)** (2026-07-02) — 5 famílias do lote #50 saíram com categoria "Outros" (2x) ou "Corantes" (errada, 2x — barbante Euroroma confundido por colisão textual "CORES"→"Corantes" na busca do ML) e título sem o tipo de produto ("BARBANTE" sumiu mesmo estando na descrição-fonte). Root-cause via chamadas reais à API do ML (não hipotética): nome bruto da planilha é ruído de SKU pra busca textual do preditor; query limpa resolve. `gerarCopy` ganhou campo `tipo_produto_busca` (grounded, mesmo espírito anti-invenção do ADR-0052) que alimenta uma 2ª busca ao preditor + guard determinístico de título (`garantirTipoProdutoTitulo`). Candidatos de categoria genéricos ("Outros" etc.) nunca são aceitos como resposta final; IA de desempate passa a rodar sempre que houver candidato específico e ganhou permissão de abster-se (`category_id: null` — achado empírico: o modelo devolve a STRING `"null"`, não o literal, tratado explicitamente). [ADR-0054](decisions/0054-categoria-titulo-tipo-produto-generico.md) · plano [2026-07-02-categoria-titulo-tipo-produto.md](superpowers/plans/2026-07-02-categoria-titulo-tipo-produto.md). Fase 2 (sinal de categoria de concorrentes, já buscado hoje pra preço mas descartado) avaliada e adiada — testes empíricos mostram unanimidade de concorrentes pode ser **errada** (colisão de GTIN/catálogo). TDD completo (resolver.test.ts (a)-(k) preservados intactos + (l)-(r) novos); 1129 testes verdes (suíte inteira); wiring nos 3 pontos que chamam `gerarCopy` (`process-familia`, `regenerar-copy-familia`, `titulo-particao.ts`). Branch aguardando validação do Diego.
- [x] **Fix busca por código/EAN de variação (Publicados + Revisão + Vendas)** (2026-07-03) — na tela **Publicados**, buscar pelo código de uma variação (ex.: `03096963`, cuja família tem `codigo_pai` `03096955`) retornava "Nenhum resultado": `filtrarPublicados` só casava `codigoPai` + GTIN representativo, e `publicadoFromRow` descartava o `codigo`/`gtin` de cada variação (embora carregados no `select`). Root-cause via SQL real no banco (confirmado `03096963` = `variacoes.codigo`, não `codigo_pai`). Fix: `PublicadoItem.identificadores[]` (todos os codigo+gtin das variações) montado em `publicadoFromRow` e casado em `filtrarPublicados`. Auditadas as outras 2 buscas textuais do sistema: **Revisão** já casava `v.codigo` mas ignorava o GTIN (add `v.gtin` em `filtrarFamilias`); **Faturamento→Vendas** casava `it.codigo` mas omitia o EAN existente (add `it.ean` em `pedidoCasaBusca`). Demais telas (Financeiro/Viabilidade/Lotes/Dashboard) sem busca textual por código — N/A. TDD (RED→GREEN em `publicados.test.ts`); 1157 testes verdes; build ok. Só frontend. Branch aguardando validação do Diego.
- [x] **Desconto sobre concorrência configurável** (2026-07-04) — o percentual de desconto aplicado ao preço quando há concorrente (`preço = menor_concorrente × 0,95`, ADR-0020) estava fixo no código, já sinalizado como "config futura". Vira parâmetro por usuário: coluna `configuracoes.desconto_concorrencia_pct` (default 5), 6º argumento opcional em `sugerirPrecoVenda` (`_shared/preco/sugerir.ts`), lido em `process-familia` junto com as alíquotas, editável em Configurações (card "Desconto sobre concorrência", mesmo padrão de "Desconto de marketing"). [ADR-0059](decisions/0059-desconto-concorrencia-configuravel.md). TDD (1 teste novo, motivo dinâmico no texto); 1170 testes (2 falhas pré-existentes em `Publicados.test.tsx`, não relacionadas). Só backend/config — sem mudança na tela de Revisão.
- [x] **Busca na aba Vendas do Faturamento** (2026-07-03) — campo de busca livre (client-side) por cliente, produto (título/código), número do pedido e valor. `pedidoCasaBusca` extraída como função pura em `pedidos-faturamento.ts`, indexando valores no mesmo formato exibido na tela (`fmtBRLSemSimbolo`, achado da revisão de código — `String(number)` cru nunca batia com o que o operador vê em `fmtBRL`). Combina (AND) com o filtro de status de envio já existente; inclui `p.chave` p/ achar pack pelo pack_id. Estado vazio diferenciado ("Nenhum pedido encontrado para essa busca/filtro") quando o filtro zera a lista mas há vendas no período. Spec: [2026-07-03-busca-vendas-faturamento-design.md](superpowers/specs/2026-07-03-busca-vendas-faturamento-design.md). TDD (10 testes novos); 1156 testes verdes; validado no browser (nome, valor exibido, sem-resultado). Só Vendas — Devoluções/Perguntas/Geografia ficaram fora por decisão do Diego. Merge → main → deploy live (commit `2397e2a`).
