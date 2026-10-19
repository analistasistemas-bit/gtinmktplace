# ADR-0187 — NCM validado na tabela oficial (Siscomex)

- **Status:** aceito
- **Data:** 2026-10-19
- **Relaciona:** ADR-0135 (cadastro fiscal), ADR-0107 (ORIGEM aborta o lote), ADR-0043 (migrations só por CLI)
- **Spec/plano:** `docs/superpowers/specs/2026-10-19-ncm-tabela-oficial-design.md`,
  `docs/superpowers/plans/2026-10-19-ncm-tabela-oficial.md`

## Contexto

Em 19/10 o produto `00000140` (Zaven) foi publicado com NCM `75937727`, copiado da nota do fornecedor.
O código não existe (capítulo 75 vai só até 7508). O app só conferia "8 dígitos"; o ML recusou o envio
fiscal (`10029 Invalid ncm`) e 9 anúncios ficaram "Sem dados fiscais", percebido só no painel do ML.

## Decisão

1. **Trava ao salvar o fiscal**, antes de qualquer publicação (Fiscal, cadastro, grade, entrada por nota).
2. **A tela mostra a descrição** do NCM digitado (composta pelos ancestrais: posição › níveis › folha).
3. **Planilha com NCM fora da tabela aborta o lote**, igual à ORIGEM (ADR-0107).
4. **NCM vencido** (extinto por resolução Gecex) **trava em tudo**, igual a inexistente: salvar, planilha
   (inclusive UPDATE só de preço/estoque), publicação/update e envio fiscal ao ML; entra no filtro
   "Fiscal pendente". Custo aceito: produto com NCM extinto fica travado até alguém corrigir.
5. **Tabela `ncm_oficial`** (global, sem `org_id`, RLS só leitura para `authenticated`): `codigo`,
   `descricao` composta, `data_inicio`, `data_fim` (`31/12/9999` = sem fim), `atualizado_em`. A validação
   lê a tabela **local**, nunca o Siscomex em tempo real.
6. **Vigência por datas, calculada em SQL na hora:** `current_date between data_inicio and data_fim`
   (função `ncm_consultar`, mesma regra para front e edges). Resolução futura passa a valer no dia certo
   e o extinto expira no dia certo, sem depender de quando o script rodou.
7. **Código extinto nunca é apagado:** recebe `data_fim = ontem`; produtos antigos continuam referenciados.
8. **Rollout em duas migrations, aditivo:**
   - **A** — tabela + carga inicial (10.516 códigos, mesma migration) + `ncm_consultar` + resumo do
     Estoque → depois edges → depois front.
   - **B** — FK `familias.ncm → ncm_oficial(codigo)` `NOT VALID`, **por último**, para nenhuma edge antiga
     bater na FK com erro cru (`23503`). Todo caminho de escrita valida antes (inclui os fluxos de cópia
     `adicionar-variacoes-familia` e `criar-kit-vinculado`).
9. **Atualização manual**, sem cron (a tabela muda poucas vezes por ano): `scripts/ncm/gerar-sql.ts`
   baixa/compõe o JSON e emite SQL (modo `seed` para a migration, `atualizar` para upsert via Management
   API — DML, não DDL). Código vigente na tabela e **ausente do JSON nunca é encerrado sozinho**: o CLI
   lista os ausentes no stderr e só gera o encerramento com `--confirmar-encerramentos=<n>` igual à
   quantidade listada, depois de o operador conferir contra a resolução Gecex (um JSON parcial acima do
   mínimo de 10.000 códigos não pode extinguir um código válido).

## Consequências

- Não valida se o NCM é o **certo** para o produto (é do contador); a descrição ajuda a conferir.
- CEST não é validado contra tabela. `notas_compra_itens.ncm` guarda o que veio da nota.
- Resolução Gecex nova exige rodar o refresh à mão; esquecer deixa código novo "inexistente" e o
  operador travado até a atualização.
- Fonte: `https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json` (~3 MB,
  15.157 nós, 10.516 códigos de 8 dígitos em 19/10/2026).
- O repo é público: a tabela (dado público) pode viver na migration.
