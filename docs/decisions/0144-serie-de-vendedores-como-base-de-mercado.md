# ADR-0144 — A série de vendedores é base de mercado, lida por RPC sem `org_id`

**Status:** Aceito. Decisão de Diego em 2026-08-29 ("opção B, base de mercado compartilhado"), depois de medido que o modo EAN falha por escopo, não por falta de dado.
**Data:** 2026-08-29
**Decisores:** Diego
**Relaciona:** [0143](0143-demanda-do-nicho-pela-ponte-do-catalogo.md) (a ponte pelo catálogo), [0142](0142-vendas-mensais-por-vendedor.md) (o cálculo), [0027](0027-multi-tenancy.md) (isolamento por organização), [0119](0119-pulse-inteligencia-de-mercado-dirigida.md) (o coletor que popula `pulse_vendedores`), [Spike 045](../spikes/045-cobertura-do-sonar-por-vendedor.md)
**Contrato regido:** [contrato-analise-publiai-secoes-2-3-7.md](../reference/contrato-analise-publiai-secoes-2-3-7.md)

---

## Contexto

A ADR-0143 destravou a demanda do nicho pela ponte do catálogo, mas o **modo EAN** — o caso de uso
mais direto do Sonar, onde todos os anúncios são o mesmo produto — continuava mudo.

Medido no EAN `7891113175371` (fio de viscose Círculo):

| | |
|---|---|
| Vendedores nos catálogos | **9** |
| Presentes em `pulse_vendedores` | **6** |
| Presentes **sob a org que perguntou** (DSA) | **0** |

**O dado existe e é coletado todo dia — sob a org Avil.** `carregarSeriePulseVendedores` filtra
`org_id`, então a DSA lê zero e o card fica silencioso enquanto a resposta está no banco.

## A distinção que sustenta a decisão

`transactions_total` vem de `/users/{id}` da API do Mercado Livre, de **terceiro**, sem escopo
especial. É o mesmo número que qualquer pessoa vê na página pública do vendedor.

**Não é dado da organização que coletou. É dado do mercado que ela calhou de coletar primeiro.**

O que **é** privado não é o número: é **o fato de que a org X monitora o vendedor Y**. Isso revela o
nicho da org e não pode vazar. A decisão abaixo separa as duas coisas.

## Decisões

### D-1 — A leitura é por RPC, nunca por `select` direto

Nasce `mercado_serie_vendedores(p_seller_ids bigint[])`, `SECURITY DEFINER`, que devolve
`(seller_id, dia, transactions_total)` **de todas as organizações**, deduplicado por
`(seller_id, dia)`.

`pulse_vendedores` **continua org-scoped, com a RLS intacta**. Nada é aberto na tabela.

### D-2 — A saída não tem `org_id`, e a entrada não permite enumerar

Duas travas, e as duas importam:

1. **Sem `org_id` na saída.** O consumidor recebe a série pública do vendedor e não fica sabendo
   quem a coletou.
2. **Só responde sobre `seller_id` que o chamador já tem em mãos.** Não existe "listar a base".
   Os ids chegam da ponte do catálogo (ADR-0143), que é descoberta **pública** feita pela própria
   org em `/products/{id}/items`.

Sem a segunda trava, uma org poderia varrer a tabela e inferir o nicho da outra. Com ela, só se
descobre a série de quem já se descobriu sozinho.

### D-3 — `execute` só para `service_role`

`revoke execute from public, anon, authenticated` e `grant execute to service_role`. A função é
chamada pela edge com `adminClient()`; **o navegador nunca a alcança**.

Isso fecha o vetor de enumeração pelo cliente mesmo que a D-2 fosse contornada. Como a função é
`SECURITY DEFINER`, leva `set search_path = public, pg_temp` para não ser sequestrada por schema
de chamador.

### D-4 — Deduplicação por `(seller_id, dia)` com `max`

Duas orgs coletando o mesmo vendedor no mesmo dia gravam duas linhas. A série tem que ter **um
ponto por dia**, senão `estimarVendasMensais` compara o primeiro snapshot de uma org com o último
de outra.

`max(transactions_total)` é a escolha: o total é monotônico dentro do dia (só cresce), então o
maior é o mais recente.

### D-5 — Nenhuma mudança no coletor

`pulse-coletar` continua igual, gravando com `org_id`. Esta ADR é **só leitura**. Cada org continua
alimentando a base com o que o próprio Radar vigia; o que muda é que todas leem o conjunto.

**Efeito colateral desejado:** quanto mais organizações usam o PubliAI, melhor a cobertura de
mercado para todas. A base fica mais útil com escala, sem ninguém abrir o próprio dado.

### D-6 — O piso de 5 vendedores não muda

Continua valendo (ADR-0143, Errata 2 do contrato). Medido no EAN após a mudança: **exatamente 5
elegíveis**. Passa, e passa raspando — um vendedor a menos e o card apaga.

Isso é a trava funcionando, não um defeito. Mas registra-se que o modo EAN opera **na fronteira**
do piso, e nichos menores continuarão silenciosos até a base crescer.

---

## O que fica registrado como risco aceito

Com **duas** organizações na base, saber que um vendedor está presente é quase equivalente a saber
que a outra org o monitora. O anonimato da D-2 é estatístico e **fraco com N=2**; ele melhora
conforme entram organizações.

Diego aceitou este risco em 2026-08-29, ponderando que:

- o número em si é público e não revela operação de ninguém;
- a saída não nomeia a org;
- a função não é alcançável pelo navegador (D-3), então a inferência exigiria acesso ao
  `service_role`, que já implicaria acesso total ao banco.

**Se entrar organização concorrente entre si no mesmo PubliAI, esta ADR precisa ser revisitada.**

## Alternativa recusada

**Coletar por org** (cada organização passa a acompanhar os vendedores que o próprio Sonar
descobre). Mantém isolamento perfeito, mas: a estimativa só existe **a partir do 2º dia** (a D-4 da
ADR-0142 exige dois snapshots), fica confiável em ~1 semana, e multiplica chamadas a `/users/{id}`
por organização para coletar exatamente o mesmo número público.

Recusada por Diego em favor da resposta imediata.

## Consequências

**Ganhamos** o modo EAN, que é a pergunta mais direta do Sonar. Medido no fio de viscose: mediana
de **1.005 un./mês** entre 5 vendedores — contra o silêncio de antes, e em contraste útil com a
mediana **0** do `aptamil premium 2`, que é nicho parado.

**Perdemos** a propriedade de que toda leitura do Pulse é estritamente org-scoped. A exceção é
única, nomeada e auditável: uma função, uma coluna a menos, um `grant`.

## Critérios de aceite

1. `pulse_vendedores` mantém RLS e `org_id`; nenhuma policy é alterada.
2. A RPC não devolve `org_id` em nenhuma coluna.
3. `execute` negado a `anon` e `authenticated`, concedido a `service_role` — verificado por query
   de privilégio, não por inspeção do arquivo.
4. Vendedor coletado por duas orgs no mesmo dia produz **uma** linha na série.
5. O modo EAN do Sonar passa a exibir 3.2; `aptamil premium 2` continua com mediana 0.
6. `pnpm test`, `pnpm lint` e `npx tsc -b --force` verdes.
