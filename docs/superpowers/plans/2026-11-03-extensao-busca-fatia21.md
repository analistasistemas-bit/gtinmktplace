# Extensão — busca, fatia 2.1 (0.5.1): marca, participação, reputação, cidade e frete

> Diego, 03/11: comparou com o card do Avant e escolheu "faz 2.1 + frete". Base: fatia 2 "lote por página" (main `2e1db6b7`, edge `extensao` v25, emenda ADR-0189 2026-11-03-b). Fatia 3 (simulação sem vínculo) fica suspensa: a página do produto já simula com custo digitado.

## Objetivo

Acrescentar ao Mini-bloco e ao painel da busca, sem banco de mercado (D-1), sem cache Redis novo e sem chamada ML extra além do frete:

| Campo | Fonte | Custo |
|---|---|---|
| **Marca** | `/products/{id}` → atributo `BRAND` (`value_name`), já baixado | 0 chamada |
| **Reputação** (termômetro) | `/users/{id}` → `seller_reputation.level_id` (`1_red`…`5_green`), já baixado (`PerfilVendedor.nivel`) | 0 |
| **Cidade** | `/users/{id}` → `address.city`, já baixado | 0 |
| **Participação na página** | cálculo local: piso de vendidos do card ÷ soma dos pisos de vendidos dos cards da página (um por ocorrência única de item) | 0 |
| **Frete da oferta** | `/items/{itemId}/shipping_options?zip_code=01310100` → `list_cost` (helper existente `freteDaRespostaShipping`, medido 200 para item de terceiro em 25/10) | +1 chamada por item exato da página (≤50) |

Fora (sem dado ou exige banco de mercado): vendas estimadas, ritmo/mês, visitas, ganhador atual, data do anúncio ganhador.

## Regras

1. **Procedência:** frete só do item exato do card (oferta exata); marca só do catálogo; cidade/reputação só do vendedor da oferta exata. Desconhecido nunca vira zero/“Excelente”.
2. **Rótulos fiéis:** reputação mostrada como cor do termômetro do ML (“verde”, “verde-claro”, “amarela”, “laranja”, “vermelha”) com ⓘ explicando; não inventar “Excelente”. Frete: “Frete R$ X” com ⓘ: cotação do ML para a oferta, para um CEP de São Paulo capital (01310-100), sem descontos de reputação; com frete grátis é custo do vendedor; não é “na sua conta”. Participação: “X% da página” com ⓘ (piso de vendidos ÷ soma da página; não é participação de mercado).
3. **Edge:** frete entra na fase 2 como família própria `frete` no pool (sublimite 4, como comissão), parada da família no 1º 429, resultado `indisponivel` com motivo; conta na reserva global (B máx. passa de 200 para 250). Nenhum `SET` Redis (não usar `chaveFreteOferta` nesta ação). Comandos Redis por busca inalterados.
4. **Cache no navegador:** frete por item + preço exato, TTL 6 h; marca junto dos metadados do catálogo (6 h); cidade/reputação junto do perfil (24 h). Versão do cache sobe (descarta formato antigo).
5. **Compatibilidade:** extensões 0.3.2/0.4.2/0.5.0 continuam funcionando contra a edge nova (campos novos só aditivos no DTO). Edge antes da extensão.
6. **UI:** Mini-bloco continua compacto (máx. 6 linhas no caso cheio): cidade/UF no lugar da UF; reputação como ponto colorido acessível (texto no `title`/aria + ⓘ); marca e frete e participação encaixados nas linhas existentes. Painel: as mesmas informações na linha de cada card; resumo “Catálogos e vendedores” ganha distribuição por reputação. Cores da marca PubliAI; ⓘ em todo termo não óbvio. Prints 320/400/600 e zoom 150%.

## Tasks

### Task A — edge: marca, cidade, reputação e frete no enriquecimento
- Arquivos: `_shared/ml/perfil-vendedor.ts` (cidade), `_shared/extensao/enriquecimento-busca.ts` (+ `enriquecimento-busca-io.ts` se preciso), `extensao/roteamento.ts` (limites), testes.
- RED: BRAND ausente → `marca: null`; cidade/nível ausentes → null; frete 200 → valor; 404/sem opções → indisponível; 429 em frete para só a família frete; reserva ≤ 250; custo Redis igual ao de antes; DTO antigo intacto.
- Medir no gate final: 429 de `shipping_options` com 50 itens em pool 4.

### Task B — extensão: cache, Mini-bloco e painel
- Arquivos: `cache-enriquecimento.ts`, `compartilhado/enriquecimento.ts`, `compartilhado/busca-resumo.ts`, `conteudo/mini-bloco-busca.ts`, `painel/Busca.tsx`, QA `extensao/qa/`, testes.
- RED: participação com cards sem vendidos (fora do denominador e mostra “—”); frete indisponível não vira zero; preço diferente não herda frete; reputação desconhecida sem ponto.
- Versão 0.5.1.

### Task C — gate e publicação
- Codex revisa cada task; revisão pré-merge do Codex (rodada única); CI verde; deploy da edge `extensao` antes; teste real do Diego; merge; zip 0.5.1.
- Gate: Redis por busca igual ao da 0.5.0 (4–9); página fria ≤ 8 s; 0 429 em frete na busca real (ou parcial terminal correto); CPU < 1 s.

---

## Revisão Codex (03/11) — prevalece sobre o texto acima

1. **Mapeamento:** os endpoints já são consultados; aproveitar os campos quando presentes, sem GET adicional. Marca = `attributes[id=BRAND].value_name` na projeção do produto em `enriquecimento-busca.ts` (propagar por DTO, cache e vista). Cidade (`address.city`) e reputação (`seller_reputation.level_id`, aceitos só `1_red`, `2_orange`, `3_yellow`, `4_light_green`, `5_green`; outro = `null`) em `vendedorDoUsuario`/`VendedorBusca`. Não reutilizar `buscarPerfilVendedor` (acessa Redis e exige `transactions.total`). Ausente/inválido = `null`. Cidade = “cidade cadastrada do vendedor”, sem prometer origem do envio.
2. **Frete — despacho e reserva:** fila e contador próprios de frete dentro do pool global de 16; comissão ≤4 e frete ≤4 simultâneos (frete pode subir só se o spike provar); dados existentes têm prioridade de orçamento sobre o frete. Reserva `B = tarefas da fase 1 + teto de perfis novos + teto de comissões + fretes pedidos`, máx. 250; teto global 1.000/min. GET despachado conta mesmo com erro; devolve só saldo não despachado; virada UTC, fail-closed e bloqueio após MGET falho preservados. HTTP via `getMlUmaVez` (prazo restante, cancelamento, sem retry); reaproveitar só o parser puro `freteDaRespostaShipping`. Nenhum GET/SET Redis de frete; nada de concorrente persistido; métricas agregadas.
3. **Frete — componente explícito:** pedido opcional `fretes: {itemId, preco}[]` (≤50, dedupe), resposta e expiração próprias (6 h, chave identidade + impressão da conta ML + item + preço exato + CEP). **Ausência do pedido = zero `shipping_options`** (a 0.5.0 não paga nada a mais). Atende qualquer item exato de card (catálogo ou não), pelo id do próprio card. Repetir ofertas após 60 s não recota frete válido; frete vencido pode ir sozinho no pedido. Cache participa de expiração, evicção e todas as limpezas; versionar o estado salvo das abas (não só `enr:cache`). Arquivos incluem `extensao/index.ts`, `extensao/src/busca-sw.ts`, `extensao/src/conteudo/busca.ts`.
4. **Participação:** “participação nos pisos observados dos produtos carregados”: por grupo de vendas existente (`resumoBusca`: catálogo → `/up/` → item) usar o maior piso válido; dividir pela soma dos pisos dos grupos. Patrocinado+orgânico do mesmo item não duplicam; itens do mesmo catálogo = mesmo grupo; conflitos de identidade fora. Sem vendidos = “—”; grupo sem piso fora da soma; soma zero = “—”; mostrar cobertura. Base única = produtos carregados na geração atual (SW), independente de filtro/ordenação do painel; scroll recalcula e atualiza blocos antigos (participação entra na assinatura de renderização de `conteudo/busca.ts`). Rótulo: “X% dos pisos observados” + ⓘ.
5. **Rótulos:** “Frete cotado R$ X · CEP 01310-100” + ⓘ “Valor antes dos descontos, para a opção recomendada ou primeira disponível. Não representa o custo efetivamente pago pelo vendedor.” Fora da margem, distinto de “Frete na sua conta”. Reputação = cor do termômetro; distribuição no resumo por vendedores únicos com desconhecidos e denominador explícitos.
6. **Gate:** preenchimento bem-sucedido p95 ≤ 8 s desde a entrada na edge; falhas terminam no deadline preservando dados; parcial por 429 não aprova capacidade; CPU, Redis (sem operação por item) e cobertura como antes. **Medir `shipping_options` antes da implementação funcional** (50 itens, pool 4 e 8, duas páginas simultâneas).
7. **REDs adicionais:** os da tabela da revisão (mapeamento, frete/reserva, cache/isolamento, participação, compatibilidade 0.3.2/0.4.2/0.5.0 com zero fretes sem pedido, UI 320/400/600/zoom 150%, teclado).

8. **Spike (§7 do documento de medições):** frete com fila própria de **8** (não 4), iniciando na **fase 1** em paralelo a produtos/ofertas (id do item vem do card); pool total 24 (16 existentes + 8 frete); dados existentes mantêm prioridade de orçamento. Sobrepõe o item 2 quanto a sublimite e fase.
