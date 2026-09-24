# ADR-0170 — Central de Promoções do ML: leitura com líquido projetado

**Status:** Aceito
**Data:** 2026-09-24
**Relacionado:** [ADR-0017](0017-selo-de-desconto-via-api-de-promocoes.md) (403 histórico na API),
[ADR-0162](0162-desconto-visual-descartado.md) (desconto visual descartado),
[ADR-0020](0020-estrategia-de-preco-liquido-minimo.md) (piso e semáforo),
[ADR-0055](0055-imposto-por-origem-nacional-importado.md) (imposto por origem),
[ADR-0065](0065-reancora-preco-piso-lider.md) (pior caso família-level),
[ADR-0094](0094-estoque-unico-cadastro-manual.md) (módulo por org),
[ADR-0108](0108-custo-duplicado-vence-o-mais-recente.md) (mapa de custo),
[ADR-0121](0121-cancelamento-tratado-tambem-pela-reconciliacao.md) (avalanche de alerta),
[ADR-0169](0169-monitor-de-frete.md) (padrão de alerta com switch)
**Spec:** `docs/superpowers/specs/2026-09-24-central-de-promocoes-design.md`

## Contexto

O ML convida os anúncios da conta para promoções (10.10, SMART, Relâmpago...) com preço já descontado.
A adesão acontece no Seller Center olhando só preço: nem o ML nem o Mercado Turbo mostram quanto sobra.
Dá para entrar em campanha no prejuízo sem perceber — e em `SMART` o ML inscreve anúncios sozinho.
O spike de 2026-09-21 (fora do repo, `docs/Roadmap/SPIKE-I1-CENTRAL-PROMOCOES.md` local) provou que o
403 do ADR-0017 caiu: `/seller-promotions/*` responde 200 nas contas Avil e DSA (12 promoções, 504
convidados na 10.10, `meli_percentage` por item). Iniciativa I1 do roadmap de melhorias, desenhada com
o Diego em 2026-09-24.

## Decisão

1. **Só leitura no MVP.** Nenhuma escrita no ML: o app diz o que aceitar e o botão "Abrir no ML"
   leva ao Seller Center. Aderir pelo app (com confirmação humana) é V2.
2. **Sync agendado + sob demanda, em duas etapas**, num worker novo `sincronizar-promocoes`. QStash a cada
   6 h faz fan-out de uma mensagem por org com o módulo. A **etapa de lista** (por org, segundos, com trava)
   lista as promoções, encerra as que sumiram da lista do ML, avisa e **reserva + enfileira uma leitura por
   promoção**. A **etapa de leitura** (por promoção) projeta os anúncios em lotes e, se o orçamento de tempo
   da execução acabar, re-enfileira a si mesma com o cursor — uma campanha grande nunca trava as outras nem
   a org. O botão "Atualizar agora" roda a etapa de lista como usuário logado (só a própria org), no padrão
   de dupla autenticação do `monitorar-moderados`. A tela lê só do banco (`ml_promocoes`,
   `ml_promocao_itens`) e mostra "atualizado há X".
3. **O líquido projetado é calculado no backend, no sync, e gravado.** Uma única conta —
   `liquidoClassico` com comissão de `listing_prices` e frete de `shipping_options/free` **no preço
   promocional**, alíquota por origem — serve à tela e aos alertas; a tela só aplica `calcularSemaforo`
   e `calcularMarkup` (puros) sobre os números gravados. Custo, piso, origem e dimensões vêm de
   `variacoes` por um resolvedor próprio (`_shared/promocoes/cadastro.ts`) com a mesma cadeia do custo
   vigente do financeiro (variação → anúncio → GTIN → código; linha com custo vence
   linha sem custo, depois a mais recente, ADR-0108), com o vínculo de item filho de User Products por
   `anuncios_externos_itens` na frente (família dissolvida não tem SKU, ADR-0105) e "anúncio" valendo só
   para anúncio de cor única. O mapa do financeiro não é tocado. Custo e piso são os **atuais**; mudança
   no cadastro aparece no próximo sync. Comissão ou frete que o ML não informou (proveniência
   `estimated`) deixam a cor **sem líquido** — nunca viram zero. A origem vem de `familias.origem`
   (obrigatória desde o ingest, ADR-0107).
4. **Granularidade por cor, exibição por anúncio.** A promoção dá um preço por anúncio; o líquido é
   projetado por variação. A linha do anúncio mostra a **pior cor** (regra do ADR-0065); expandir mostra
   cada uma. Em User Products cada cor já é um item.
5. **Anúncio ou cor sem custo no PubliAI aparece (⚪), sem semáforo.** A campanha fica completa como no
   Seller Center.
6. **Preço avaliado:** anúncio **participando** → o `price` que está no ar; **convidado** →
   `suggested_discounted_price` em campanha com faixa, `price` nas demais. Para convidado em campanha com
   faixa, "até quanto descer" = menor preço da faixa com líquido ≥ piso, pelo gross-up já existente
   (`_shared/preco/sugerir.ts`) refeito com a tarifa de cada candidato até parar de descer, recortado a
   `[min, max]`.
7. **"ML banca" nunca entra no líquido por suposição.** A fórmula do subsídio (`meli_percentage`) só
   entra no cálculo depois de conferida contra uma venda real de item em promoção co-participada
   (`ml_vendas`). Até lá o líquido é o conservador (sem subsídio) e a tela diz "ML banca X% — não
   incluído no líquido". Subestimar é aceitável; superestimar lucro não é.
8. **Módulo `promocoes` por org** (`organizations.modulos_habilitados`), nasce desligado; o worker
   recusa org sem o módulo (403) — esconder o menu não é a fronteira de segurança.
9. **Dois alertas, com switch por org** `configuracoes.alertas_promocoes_ativo` (default `false`),
   destinatários = assinantes de `financeiro` via `notificarCategoria` (sem categoria nova):
   (a) **participando no prejuízo** (item `started` ou `pending` com pior cor 🔴); (b) **prazo de adesão ≤ 48 h**
   com convidados 🟢 (`candidate` = convidado; `started` e `pending` = participando). Os alertas leem o banco (última leitura concluída) na etapa de lista. Dedup por
   `reservarNotificacao` (chave por promoção+item e por promoção). No máximo **uma mensagem agregada por
   org por sync** — o primeiro sync não vira avalanche (ADR-0121).
10. **Cupom do vendedor** aparece como card informativo, sem líquido nem semáforo (depende do carrinho).

## Alternativas descartadas

- **Buscar ao vivo ao abrir a tela:** 504 convidados × tarifa + frete por preço → tela lenta e rate
  limit do ML a cada abertura; sem base para alertas.
- **Calcular o líquido no frontend:** duas implementações (tela e alerta) do mesmo número, com risco de
  divergirem; o backend já tem a conta e o gross-up.
- **Esconder anúncios sem custo:** a contagem não bate com o Seller Center e o operador perde a visão
  da campanha.
- **Semáforo por média ponderada das cores:** esconde a cor que dá prejuízo.
- **"Margem %" / "lucro":** termos novos com fórmula diferente do resto do app; ficou Líquido + Markup.
- **Categoria de notificação própria:** exigiria migration nos CHECKs e nas duas listas espelhadas;
  reusa `financeiro` como o ADR-0169.

## Consequências

- Três tabelas novas (`ml_promocoes`, `ml_promocao_itens`, `ml_promocoes_sync`) com RLS `org_id = current_org_id()` (select) e escrita só via service role.
- Chamadas ao ML por sync crescem com o nº de convidados (listing_prices e frete por preço, e o ponto
  fixo do "até quanto") — cache Redis separado para comissão e frete, lotes de 20 itens e concorrência
  limitada; o volume real da 10.10 (504) é medido antes do deploy.
- Duas colunas de controle: `ml_promocoes.rodada_em_curso` (reserva da leitura, 30 min; toda escrita da leitura confere a posse) e
  `ml_promocoes_sync.estado='sincronizando'` (trava da lista, 5 min). `candidate` = convidado; `started` e
  `pending` = participando; outro status do ML não é presumido.
- A elegibilidade é por conta: lista vazia, conexão sem scope `offers` ou 403 são **estados** exibidos
  com explicação, nunca erro.
- `promocoes` entra em `MENU_KEYS` (front e o espelho da edge `usuarios`), em `MODULOS` e no `MODULOS_VALIDOS` da edge `usuarios`; a migration faz o backfill de `profiles.allowed_menus` como no Pulse.
- Deploy: `supabase db push` → deploy de `sincronizar-promocoes` (+ `usuarios`) → schedule QStash →
  merge do front.
