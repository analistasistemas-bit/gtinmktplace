# ADR-0177 — Multiget do Mercado Livre via `/items/bulk`

**Status:** Aceito (2026-10-03). **Prazo externo:** o ML desliga `GET /items?ids=` em 25/10/2026.

## Contexto
14 chamadas em 13 arquivos usavam `/items?ids=`. O substituto `GET /items/bulk?ids=` muda o envelope
(`status_code` no lugar de `code`). Os spikes reais de 03/10/2026 (4 orgs, só GET) mediram:
- bodies idênticos;
- seleção com `status_code` + `body.`;
- id repetido → HTTP 400 (o antigo deduplicava antes do limite);
- 21 ids → 400;
- id inexistente → `{status_code:404}` sem body, na posição pedida;
- ordem dos envelopes = a pedida (a do antigo era arbitrária).

## Decisão
- **Adaptador, não parser** (`_shared/ml/multiget.ts`):
  - `caminhoMultiget` monta a URL com dedup só dentro da requisição;
  - `comoEnvelopeAntigo` converte entradas bulk para `[{code, body}]`. Só o 404 sem body ganha
    `body:{id}`, e só com as posições confirmadas. Entradas no formato antigo passam intactas.
  - Nenhum módulo muda predicado, particionamento ou tratamento de erro.
- Leituras inline (componentes de kit, PxV, Pulse) ganham uma extração mínima, só para serem testáveis.
- `fiacao.ts` (primeiro módulo migrado, `6f8f6c9b`) não muda.
- Validação por fatia:
  - testes de fronteira nos dois envelopes;
  - A/B em duas fases contra a baseline (só GET ao vivo, escrita simulada por cenário, violação fatal);
  - deploy com manifesto de hash por arquivo e por edge.
- Plano: `docs/superpowers/plans/2026-10-03-ml-items-bulk.md`. Spec: `docs/superpowers/specs/2026-10-03-ml-items-bulk-design.md`.

## Consequências
- As decisões de negócio ficam equivalentes.
- A ordem das listas segue a pedida, e logs que imprimem a URL mostram `/items/bulk`.
- Mais de 20 ids onde não há blocos continua respondendo 400.
- Rollback antes de 25/10 redeploya as mesmas fontes com as dependências resolvidas no momento.
  Isso é um risco aceito: a CLI resolve as faixas no bundler remoto. Depois de 25/10, só correção para a frente.
- Um módulo novo que precise de multiget usa o adaptador. Escrever `/items?ids=` à mão é regressão.
