# ADR-0130 — Concorrentes relevantes no Pulse e na Viabilidade

**Status:** Aceito
**Data:** 2026-08-20 (spec aprovada) — ADR registrada em 2026-08-21
**Decisores:** Diego
**Relaciona:** qualifica ofertas coletadas pelo [ADR-0119](0119-pulse-inteligencia-de-mercado-dirigida.md)
(Pulse); mesma regra passa a alimentar o menor preço da [ADR-0014](0014-busca-de-concorrencia.md)
(Viabilidade); reputação normalizada de `seller_reputation` é pré-requisito de dados do ADR-0119.

## Contexto

No GTIN `7891025111825` (Aptamil Premium 1 800 g) o coletor do Pulse via 90 ofertas ativas: menor
preço R$ 36,00, mediana R$ 81,45, 33 vendedores com zero transações informadas, 56 anúncios com
zero visitas medidas nos últimos 30 dias. Esse R$ 36,00 alimentava, sem filtro, tanto o Pulse
(menor concorrente, posição, alertas) quanto a Viabilidade (comissão, imposto, frete, líquido,
semáforo) — uma referência comercial que não reflete concorrência real, vinda de um vendedor sem
força comercial ou de um anúncio sem tração.

Investigação (`docs/superpowers/specs/2026-08-20-concorrentes-relevantes-pulse-viabilidade-design.md`,
aprovada por Diego em 2026-08-20) confirmou que o problema é o mesmo nos dois módulos e pede a
mesma regra — dividir o mercado em **observado** (tudo, sempre preservado) e **relevante** (o que
qualifica), com um único classificador consumido por ambos.

## Decisão

| # | Decisão | Racional |
|---|---|---|
| **D-1** | Duas camadas de mercado: **observado** (todas as ofertas ativas, nunca apagado, auditável) e **relevante** (subconjunto qualificado). Só o relevante alimenta preço, posição, alertas e cálculo financeiro. | Preserva o dado bruto para auditoria sem deixá-lo influenciar decisão — reduz risco sem esconder informação do operador. |
| **D-2** | Regra de qualificação **fixa e não configurável** nesta primeira versão: `transactions_total < 10` → fora da referência (`POUCAS_TRANSACOES`); `visitas_30d === 0` → fora (`SEM_VISITAS_30D`); reputação `1_red`/`2_orange` → fora (`REPUTACAO_BAIXA`); `transactions_total` ausente → em observação (`DADOS_INSUFICIENTES`); senão, relevante (`QUALIFICADO`). Mais de um motivo pode coexistir; a UI explica todos. | Corte único e auditável evita inventar um valor por org sem dado que o sustente; simplicidade de v1 deixa configuração por usuário para depois de validar o corte em produção. |
| **D-3** | Ausência de dado **nunca reprova sozinha** — só valor medido reprova. `visitas_30d = null` (não medido/falha) e reputação ausente não excluem a oferta; zero é valor medido e permanece distinto de `null`. | Falha de coleta ou dado ainda não obtido não pode ter o mesmo peso de um sinal negativo real — puniria oferta por falta de dado, não por comportamento do vendedor. |
| **D-4** | Classificador único e puro (`qualificarOferta`/`resumirMercadoQualificado`, `supabase/functions/_shared/concorrencia/qualificacao.ts`), sem imports de Deno/Redis/Supabase, consumido pelo Pulse **e** pela Viabilidade. Proibida cópia local da regra em interface ou função distinta. | Regra de negócio duplicada diverge silenciosamente com o tempo — um único módulo testável fecha essa classe de bug de vez. |
| **D-5** | Viabilidade reaproveita o snapshot do Pulse quando fresco (≤24h, mesma `org_id`+`catalog_product_id`); sem correspondência segura, busca reputação e visitas sob demanda, com concorrência limitada e cache de reputação de vendedor por 24h. Falha isolada de um GTIN não derruba o lote. | Evita re-consultar a API do ML para todo item da Viabilidade quando o Pulse já coletou o mesmo produto recentemente; concorrência limitada protege o rate limit do ML. |
| **D-6** | Nenhuma falha (perfil, visitas, reputação) autoriza voltar ao menor preço **observado** como fallback financeiro — silencioso ou não. Sem concorrente relevante, a UI mostra "Sem concorrente relevante" e travessão nos campos financeiros dependentes do mercado, nunca R$ 0,00. | É exatamente o comportamento que motivou esta ADR: uma falha de coleta não pode reintroduzir a distorção que a regra existe para eliminar. |
| **D-7** | Cache de reputação de vendedor (`cache:seller:v2:{seller_id}`, TTL 24h) é **global**, sem `org_id` — dado público do Mercado Livre, sem credenciais. Consultas e caches que contenham dado próprio da organização continuam isolados por `org_id`. | Reputação pública é a mesma para qualquer organização que consultar o mesmo vendedor; isolar por org multiplicaria custo de API sem ganho de segurança. |
| **D-8** | A classificação é **puramente aditiva e computada** — nunca altera nem exclui dado bruto coletado do Mercado Livre. | Auditoria depende do dado bruto continuar íntegro; a classificação é uma lente sobre ele, não uma edição dele. |

## Alternativas consideradas

- **Corte configurável por usuário ou organização**: rejeitada nesta versão — sem um corte validado
  em produção, expor configuração cedo demais arrisca cada org inventar seu próprio número sem base.
- **Exclusão física das ofertas fora da referência**: rejeitada — quebraria a auditoria e o
  "mostrar todas" que a interface do Pulse expõe.
- **Novos limites a partir das métricas detalhadas de reclamação/atraso/cancelamento**: rejeitada
  — a spec optou por não inventar corte não validado; essas métricas entram só como informação de
  apoio à decisão do operador.
- **Fallback silencioso para o menor observado quando a coleta de perfil/visitas falha**: rejeitada
  — reintroduziria exatamente a distorção que motivou a ADR.

## Consequências

- **Boas:** elimina a distorção de preço mínimo, posição, alertas e viabilidade financeira por
  ofertas de vendedores sem força comercial ou anúncios sem tração; uma única fonte de verdade
  (D-4) evita divergência entre Pulse e Viabilidade.
- **Riscos/tradeoffs aceitos:**
  - Uma oferta nova de vendedor ainda sem perfil coletado, entrando numa coleta do tier quente
    (6/6h, que não busca vendedores), fica em observação até a coleta completa seguinte trazer o
    perfil — se nesse intervalo o diff parar de ver a oferta como "nova entrada", o alerta
    `novo_concorrente` não dispara para aquele evento específico (perda silenciosa, não um adiamento).
    Aceito por ora; revisitar se motivar reclamação real em produção.
  - O corte fixo (10 transações, visitas medidas ≠ 0, reputação fora de `1_red`/`2_orange`) pode
    não servir todo nicho; configuração por org é `Fora de escopo` deliberado da spec.
- **Como reverter:** a feature é aditiva — reverter é voltar a usar `menor_observado`/estatísticas
  brutas em vez de `menor_relevante`/estatísticas do mercado qualificado. Nenhuma migration
  destrutiva: `pulse_vendedores.reputacao_detalhe`/`perfil_coletado_em` e
  `pulse_ofertas.visitas_30d_em` são colunas aditivas; a view `pulse_ofertas_atual` foi recriada
  (`create or replace`), não substituída por uma tabela nova.

## Implementação (2026-08-21)

Implementada e testada localmente na branch `codex/brainstorm-pulse-qualificado`
(`docs/superpowers/plans/2026-08-20-concorrentes-relevantes-pulse-viabilidade.md`, 8 tarefas).
Arquivos-chave: `_shared/concorrencia/qualificacao.ts` (classificador), `_shared/analise/mercado-relevante.ts`
(resolvedor da Viabilidade — snapshot Pulse ≤24h ou busca sob demanda com pool de concorrência 6
compartilhado entre perfil e visitas, dedupe por chave retry-safe), `_shared/ml/perfil-vendedor.ts`
(normalização de `seller_reputation`), migration `20260821110914_pulse_qualificacao_vendedor.sql`.
174 testes focados, `tsc -b --force`, `deno check`/`check:functions`, `pnpm lint` e
`git diff --check` verdes; revisão adversarial final e QA visual em runtime real (Playwright,
conta de validação) sem achado bloqueante (`docs/TASKS.md`).

**Addendum (2026-08-21, `code-review-fable5` pré-deploy):** a revisão encontrou que
`shipping.logistic_type === 'fulfillment'` já era lido em `_shared/concorrencia/parse.ts` (usado
pela Viabilidade) mas nunca em `_shared/pulse/parse.ts` (usado pelo coletor do Pulse) — o mesmo
endpoint `/products/{id}/items`, o mesmo campo, só não replicado no parser do Pulse.
`full_relevantes` do Pulse era hard-coded `false`, não uma limitação de dado indisponível. Corrigido
na mesma sessão: coluna `pulse_ofertas.full_ml` (migration
`20260821151141_pulse_ofertas_full_logistica.sql`), parser, `mudou()` do diff e `mercadoPulse`
atualizados; 700 testes focados + `tsc -b --force` + `check:functions` + lint + `git diff --check`
verdes após o fix. D-1/D-2/D-4 acima não mudam — é uma correção de implementação, não uma nova
decisão.

## Validação (critérios de aceite)

Cenário de referência — GTIN `7891025111825`, snapshot de 2026-08-20:

- R$ 36,00 permanece como menor oferta observada, nunca afeta preço/posição/alerta/viabilidade;
- 28 de 90 ofertas são relevantes; R$ 70,19 é o menor concorrente relevante;
- Pulse e Viabilidade apresentam a mesma referência;
- estado sem nenhum concorrente relevante mostra "Sem concorrente relevante" e travessão nos
  campos financeiros, nunca R$ 0,00.
