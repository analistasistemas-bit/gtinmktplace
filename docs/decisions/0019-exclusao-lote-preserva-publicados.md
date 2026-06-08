# ADR-0019 — Exclusão de lote preserva famílias publicadas; tela "Publicados" com status ao vivo

**Status:** Aceito
**Data:** 2026-06-08
**Contexto relacionado:** ADR-0005 (lifecycle), ADR-0016 (UPDATE/reposição), ADR-0013 (ingest)
**Spec:** `docs/superpowers/specs/2026-06-07-excluir-lotes-e-publicados-design.md`

## Contexto

Depois de muitos testes, o dashboard acumulou lixo (lotes de teste) e não havia como excluí-los — nem na UI nem com limpeza do Storage. Faltava também uma visão consolidada do que está publicado no ML (anúncios espalhados por vários lotes).

A restrição central: o `ingest-lote` decide CREATE vs UPDATE buscando famílias anteriores com `ml_item_id is not null` e casando por `codigo_pai` (busca **global por `user_id`**, não por lote). O vínculo com o anúncio do ML vive nesse registro publicado. Apagá-lo faria uma nova planilha do mesmo produto virar CREATE → **anúncio duplicado no ML**.

## Decisão

1. **Exclusão de lote nunca remove famílias publicadas** (`ml_item_id != null`). Remove só as não publicadas + suas imagens no Storage; as publicadas sobrevivem (preservando o vínculo de UPDATE e alimentando a tela "Publicados"). Se nenhuma família sobrar, o lote inteiro é apagado.

2. **O Mercado Livre nunca é tocado pela exclusão.** Decisão do operador: "quando quiser mexer no ML, subo nova planilha" (UPDATE). Encerrar/editar anúncio no ML está fora de escopo.

3. **Guarda de race com QStash:** exclusão bloqueada se o lote estiver em `processando`/`publicando` (workers ativos).

4. **Contadores recontados na edge, não via trigger:** o trigger `update_lote_counters` é `after insert or update` — **não cobre DELETE**. Após excluir famílias, a edge `excluir-lote` reconta `total_familias`/`total_publicadas` (por `status='publicado'`, mesma base do trigger)/`total_erros` e seta `status='concluido'`. (Evita uma migration que adicionasse `OR DELETE` ao trigger.)

5. **Storage limpo manualmente** (cascade do banco não limpa Storage): remove `planilha_path` + `imagens_paths` + imagens das famílias removidas, **menos** os arquivos referenciados pelas publicadas sobreviventes.

6. **Tela "Publicados"** lista todas as famílias com `ml_item_id` (qualquer lote) e cruza com o **status ao vivo do ML** (edge `status-publicados`: batch `GET /items?ids=`, sem cache — volume baixo). Filtros por fornecedor/status/tipo/busca. Sem credencial ML → tabela só com banco + banner.

7. **"Remover do sistema"** (edge `remover-publicado`): escape hatch para registros já mortos no ML. Remove só o registro local (ML intocado), com aviso de que o vínculo de UPDATE se perde para **todas** as futuras planilhas daquele `codigo_pai`. Bloqueado se houver família do mesmo `codigo_pai` em `publicando`.

## Consequências

- Limpar lixo de teste fica seguro: nunca duplica anúncio nem apaga vínculo de UPDATE sem aviso explícito.
- A tela "Publicados" vira o inventário operacional (saúde dos anúncios + caça a moderados/mortos).
- A recontagem na edge duplica a lógica do trigger para o caso DELETE (aceito; documentado aqui).
- Sem migration nova; sem mudança de schema.
