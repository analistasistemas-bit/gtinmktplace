# ADR-0175 — Arquivar organização (soft delete) antes de excluir

- **Status:** Proposto
- **Data:** 2026-10-01
- **Relacionados:** ADR-0027 (multi-tenancy), ADR-0158 (Central de organizações), ADR-0173 (fan-out por org), ADR-0090 (lockdown de `profiles`)

## Contexto

A Central de organizações não tem como tirar uma org de cena. `delete_org` (edge `usuarios`)
existe mas responde 409 de propósito: a limpeza sequencial não era atômica e podia apagar a org
pela metade, e a trava de histórico recusa qualquer org com `platform_commercial_terms` ou
`platform_audit_events` — ou seja, qualquer org que já operou.

Caso concreto (2026-10-01): a org **Hairflay** foi substituída por **Hairfly Cosmeticos** após
problema no cadastro do ML. Os usuários já migraram; a Hairflay ficou sem membros, mas continua
na Central, nos totais da carteira e — por ainda ter conexão ML — em todas as rotinas
agendadas (reconciliação, Pulse, ads, tráfego, moderados, renovação de token), gastando CPU e
cota de chamadas do app no ML (limite por app, não por conta).

Não há ponto único de enumeração: ~10 rotinas repetem
`from('marketplace_connections')` e duas listam `organizations` direto
(`sincronizar-promocoes`, `materializar-metricas`). O webhook do ML resolve a org pela conexão
(`_shared/faturamento/io.ts` `resolverIdentidade`).

## Decisão

1. **Arquivar é o caminho padrão para "remover" uma org.** Coluna nova
   `organizations.arquivada_em timestamptz null` (null = ativa). Histórico comercial, vendas e
   auditoria ficam intactos; é reversível.
2. **Arquivar desliga a org desconectando o canal**, não filtrando cada rotina. A função SQL
   `arquivar_organizacao(p_org_id uuid)` (security definer, só `service_role`) faz numa única
   transação: apaga as conexões da org (mesma lógica de `delete_marketplace_connection`, inclusive
   os segredos no Vault) e grava `arquivada_em = now()`. Sem conexão, as rotinas que partem de
   `marketplace_connections` e o webhook do ML deixam de enxergar a org.
3. **As duas rotinas que listam `organizations` direto filtram `arquivada_em is null`**
   (`sincronizar-promocoes`, `materializar-metricas`).
4. **Travas (na função SQL, não só na edge):** recusa se houver `profiles` ativos na org; recusa a
   própria org do chamador (checado na edge, que conhece o chamador); idempotente se já arquivada.
5. **Desarquivar** (`desarquivar_organizacao`) só limpa `arquivada_em`. A conexão **não** volta:
   reconectar o ML em Canais é obrigatório (OAuth). Também recusa se outra org já usa a mesma
   conta ML — garantido pela UNIQUE existente na reconexão.
6. **Central:** ações "Arquivar" / "Desarquivar" no menu ⋯ (super-admin, confirmação digitando o
   slug), filtro "Incluir arquivadas" (desligado por padrão), selo "Arquivada"; org arquivada fica
   fora dos totais e da previsão de cobrança. Auditoria em `platform_audit_events`
   (`archive_org` / `unarchive_org`, intent + success/failure).
7. **Exclusão definitiva fica para uma segunda fatia** e terá como pré-requisito a org estar
   arquivada.

## Consequências

- Anúncios da org arquivada continuam no ar no ML, mas o PubliAI deixa de registrar vendas e de
  baixar estoque deles. **Operacional:** pausar/encerrar os anúncios no ML **antes** de arquivar
  (depois, sem conexão, a tela não alcança mais o ML).
- Desarquivar exige reconectar o ML — custo aceito em troca de não tocar ~10 rotinas.
- `delete_org` continua desabilitado até a fatia 2.
