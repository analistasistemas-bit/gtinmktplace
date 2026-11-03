# Promoções: busca + simulação de desconto com líquido exato — plano

**Pedido (Diego, 03/11/2026):** na tela de cada promoção, (1) campo de busca para selecionar produtos
específicos; (2) escolher o desconto e já ver o lucro líquido com aquele desconto. Diego dispensou perguntas;
as decisões abaixo são do agente.

## Decisões

1. **Busca** (front puro) em `src/pages/PromocaoDetalhe.tsx`: `Input` acima da tabela; filtra `linhas` por
   título (`formatarNomeProduto`, sem acento/caixa), MLB (`ml_item_id`, `mlbExibido`, `anuncio_normal_id`) e SKU
   (`projecao[].sku`). Compõe com o filtro de semáforo e a aba. "Selecionar todos" já opera sobre `linhas` →
   passa a marcar só o resultado da busca. Seleção feita antes da busca é preservada.
2. **Simular desconto** só quando `tipo ∈ {DEAL, LIGHTNING}`, aba Convidados e campanha não `finished` (SMART
   tem preço do ML; participando não adere). Controle: `Input` "Desconto %" (aceita `12,5`; 1–90) + botão
   "Simular" que age **sobre os selecionados convidados** (botão desabilitado sem seleção). Preço simulado =
   `round2(preco_original × (1 − d/100))`; item sem `preco_original` não entra (fica com o número atual).
3. **Líquido exato no servidor** — nunca no front: comissão fixa e frete mudam por faixa de preço
   (`projecao.ts#ateQuantoDescer`), e a fórmula local com a tarifa gravada erraria em silêncio
   (regra financeira inviolável). Novo modo do usuário logado em `sincronizar-promocoes`:
   `POST { simular: { promocao_id, itens: [{ ml_item_id, preco }] } }`, ≤ 25 itens por chamada (CPU 2 s —
   ADR-0173); o front fatia em lotes de 25, em sequência.
   - Auth `requireUserOrg(req)` (leitura) + `exigirModulo('promocoes')`; **sem** throttle de 2 min (não é sync).
   - Lê as linhas de `ml_promocao_itens` por `org_id` + `promocao_id` + `ml_item_id in (...)` (item fora da
     org/promoção é ignorado), alíquotas, cadastro, `buscarItensML(ids)` e `criarTarifaEm(cx)` (cache Redis
     `promo:`, retry 429 + disjuntor) — os mesmos de `depsLeitura`.
   - Reusa `projetarItem` com novo parâmetro opcional `precoForcado`: substitui `precoAvaliado(it)` e **não**
     calcula "até quanto" (irrelevante na simulação, poupa tarifas). Sem `precoForcado` o comportamento é
     idêntico ao atual.
   - Responde `{ itens: [{ ml_item_id, preco, projecao, pior_semaforo }] }`. **Não grava nada** (nem banco,
     nem ML: só GET).
   - Lógica pura em `_shared/promocoes/simular.ts#simularPrecos(deps, pedidos)` — testável com fakes; a edge só
     liga as deps.
4. **Tela:** o resultado é mesclado no item (`preco_avaliado = preco`, `projecao`, `pior_semaforo`) e as células
   existentes (`precoPromo`, `liquidoCel`, `markupCel`, semáforo) mostram os números simulados sem código novo
   de cálculo; a linha ganha selo "simulado −d%". Preço fora de `[preco_min, preco_max]` (ou < R$ 19 na
   Relâmpago) → aviso "fora da faixa do ML" na célula de preço. Chips de contagem refletem a simulação.
   "Limpar simulação" volta aos números do sync. Trocar de aba/campanha limpa. Falha da edge → toast, nada
   mesclado.
5. **Aderir** com simulação ativa: `PreviewOperacao` recebe `precosIniciais: Map<ml_item_id, preco>` e
   `construirLinhas` usa esse preço (em vez do sugerido) quando existir — o operador ainda vê/edita no preview e
   o backend (`operacoes-massa`) revalida com tarifa real, como hoje. Nenhuma mudança no backend de operação.

## Revisão Codex do plano (REVISE, 5 achados) — como cada um foi absorvido

Substitui os itens 3–5 acima onde conflitarem:

- **Reuso em vez de `precoForcado`:** `_shared/operacoes/deps.ts#criarSemaforoExato` já reprojeta no preço
  exato (convidado com `preco_sugerido = preco`, faixa nula → sem "até quanto"). Extrair
  `criarProjecaoExata(admin, cx)` para `_shared/promocoes/deps.ts` devolvendo a `LinhaItem` inteira;
  `criarSemaforoExato` vira `projecao(l, p).pior_semaforo` (fonte única do número da simulação e da trava).
- **Achado 2 (CPU):** teto de **50 itens por simulação, uma chamada** (sem lotes no front; cadastro 1×). A trava
  de `operacoes-massa` revalida cada preço alterado com a mesma `criarTarifaEm` → reaproveita o cache `promo:`
  aquecido pela simulação. `ponytail:` teto 50; validação retomável no servidor se precisar de mais.
- **Achado 3 (faixa):** item sem `preco_min/max` não é simulado → `{ status: 'ignorado', motivo: 'ML sem faixa
  de preço' }` (o executor recusa sem faixa). Fora da faixa / < R$ 19 (Relâmpago): simula, marca aviso e o
  preview bloqueia (validação já existente).
- **Achado 4 (resposta atrasada):** geração (`useRef` contador) por simulação; resposta só é aplicada se a
  geração e a campanha/aba ainda forem as mesmas. Limpar/trocar aba/campanha incrementa a geração.
- **Achados 1 e 5 (preview):** `PreviewOperacao` recebe os itens **já mesclados** com a projeção do servidor
  (`preco_avaliado`, `projecao`, `pior_semaforo`) e `precosSimulados: Map`; `montarPreview` usa o preço simulado
  antes de calcular semáforo/marcado. Com simulação ativa, item selecionado **não simulado** vem desmarcado.
  A resposta da edge é por item: `simulado` (preco, projecao, pior_semaforo) ou `ignorado` (motivo); a tela
  mostra "N simulados · M ignorados".

## Fora de escopo
Simulação em SMART/participando; desconto por linha diferente (já existe: editar preço no preview); salvar
simulação.

## Tarefas (TDD)

1. `projetarItem(…, precoForcado?)` — teste em `sincronizar.test.ts`: com preço forçado usa a tarifa daquele
   preço e `ate_quanto` null; sem ele, inalterado.
2. `simular.ts#simularPrecos` + teste: ignora id fora da lista lida; sem alíquota → erro claro; cor com
   `erro_tarifa` volta indisponível (nunca zero).
3. Edge `sincronizar-promocoes`: ramo `simular` antes do throttle; validação do body (promocao_id string,
   1–25 itens, preco > 0 finito); 400 em body inválido.
4. Front: `src/lib/promocoes.ts` → `filtrarPorBusca(itens, termo)`, `precoComDesconto(original, pct)`,
   `parseDesconto(txt)`, `foraDaFaixa(item, preco, tipo)` + testes; hook `useSimularDesconto` em
   `usePromocoes.ts` (lotes de 25); `PromocaoDetalhe.tsx` (busca, controle, merge, selo, aviso);
   `PreviewOperacao` (`precosIniciais`) + teste.
5. Docs: emenda ADR-0174, `obsidian-vault/03-Módulos/Promoções.md`, `docs/reference/edge-functions.md`,
   `docs/TASKS.md`.
6. Validação: testes, `pnpm preflight:static`, deploy `sincronizar-promocoes` (+ funções que importam
   `_shared/promocoes/sincronizar.ts`), validação visual na Zaven (simular 10% em 3 itens e conferir 1 líquido
   contra a Revisão/`calcular-tarifa-ml`).
