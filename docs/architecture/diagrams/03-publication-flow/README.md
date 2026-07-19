# 03 · Fluxo de Publicação de Anúncio

**Tipo Archify:** `workflow` · **Status:** AS-IS

## Especificação (antes da geração)

- **Mensagem principal:** planilha → IA → revisão humana obrigatória → publicação (Mercado Livre e, opcionalmente, canais extras em paralelo isolado).
- **Público:** novo desenvolvedor, arquiteto.
- **Elementos:** Upload, Ingestão, Enriquecimento (IA), Revisão humana, Publicar (fan-out), Mercado Livre, Canal extra (E6).
- **Relações:** sequência principal (mainPath) + 1 bifurcação no passo "Publicar" (canal = ML vs. canal ≠ ML).
- **Direção de leitura:** esquerda → direita, topo → baixo nas lanes.
- **Omitido:** detalhe de retry/idempotência de cada worker; sincronização inversa (webhooks) — ver [04](../04-marketplace-sync/).
- **Fontes principais:** `docs/explanation/arquitetura.md` ("Pipeline ponta a ponta"); `docs/decisions/0061-orquestracao-multicanal.md`; `docs/project-status.md` (E6).

## O que mostra

O caminho completo de uma família de produtos desde o upload da planilha até o anúncio publicado: ingestão, enriquecimento por IA, revisão humana (obrigatória) e publicação — com o fan-out do E6 que permite publicar em canais além do Mercado Livre sem afetar o caminho principal.

## Como ler

Siga o caminho principal (destacado) da esquerda para a direita: Upload → Ingestão → Enriquecimento IA → Revisão humana → Publicar. No passo "Publicar", a família segue para o Mercado Livre (canal = ML, caminho intocado desde o E1) e, se houver outros canais selecionados, também dispara — em paralelo, isolado — o worker genérico de canal extra.

## Fontes

- `docs/explanation/arquitetura.md` (seção "Pipeline ponta a ponta")
- `docs/decisions/0061-orquestracao-multicanal.md` (fan-out por família×canal, D-E6.1/D-E6.2)
- `docs/project-status.md` (seção E6, "orquestração multicanal EM PRODUÇÃO")
- `obsidian-vault/01-Arquitetura/Arquitetura Geral.md` (pipeline ponta a ponta, mermaid)

## Limitações

- Não representa o retry automático do QStash nem os estados intermediários de `familias.status` (pendente/processando/pronto/erro) — ver `docs/reference/modelo-de-dados.md`.
- "Canal extra" hoje só tem um conector fake em teste (nenhum canal real ativo) — o próximo real é Shopee (E5).
- Não mostra o split por partição (>100 cores, ADR-0048) nem o split por faixa de preço (ADR-0078) — são variações do passo "Mercado Livre", não fluxos novos.

## Atualização

- **Última revisão:** 2026-07-19.
- **Regenerar quando:** um canal real (Shopee) entrar em produção; o cutover do ML para o worker genérico acontecer (ver [08](../08-to-be/)); a etapa de revisão mudar de forma relevante.
- **Como regenerar:**
  ```bash
  node bin/archify.mjs validate workflow <caminho>/diagram.workflow.json --json
  node bin/archify.mjs render workflow <caminho>/diagram.workflow.json <caminho>/diagram.html
  ```
  Exportar SVG/PNG: ver `docs/architecture/archify-usage.md`.
