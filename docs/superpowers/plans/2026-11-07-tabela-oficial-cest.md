# Plano — Tabela oficial de CEST (ADR-0197)

Objetivo: quando o XML da nota não trouxer CEST, sugerir ou preencher o CEST pela tabela do Convênio
ICMS 142/2018 no cadastro de produto novo.

## Task 1 — Parser e gerador de SQL
- `scripts/cest/compor.ts`: lê o HTML do CONFAZ, ignora células com classe `*verde*` (redação anterior),
  itens `REVOGADO` e os Anexos I, XXVI, XXVII e seguintes; expande a célula de NCM em prefixos sem ponto.
- `scripts/cest/gerar-sql.ts`: CLI no molde de `scripts/ncm/gerar-sql.ts`; recusa carga com menos de 900
  linhas ou anomalia não tratada.
- Teste em `tests/scripts/cest-compor.test.ts`, com HTML mínimo cobrindo verde, revogado e `<br>`.
- Verificar: 2001400 ↔ 33049910; 33049990 → 2001500 e 2001600.

Anomalias da fonte (5 linhas): `01.999.00` sem NCM, `17.116.00` com `008.13 009.09`, `20.040.00` com
`926.90.90`, e `25.020.00`/`25.021.00` com vírgula final. Tratamento: ADR-0197 D-8; anomalia desconhecida
aborta o gerador.

## Task 2 — Migration
- `supabase migration new adr197_cest_oficial`: tabela, RLS, carga e `cest_candidatos(text)`.
- `supabase db push`, `npm run db:check`, regenerar `src/lib/database.types.ts`.
- Teste SQL em transação desfeita (sem Docker).

## Task 3 — Hook e regra pura
- `src/hooks/useCestOficial.ts`: status `inativo | carregando | erro | sem | unico | varios`, candidatos.
- `classificarCest`: `unico_exato` só com um CEST distinto em todas as correspondências e ao menos uma
  exata; o resto com candidato é `varios`.
- `useSugestaoCest`: aplica só `unico_exato`, por `mudarFiscal`, uma vez por NCM e por abertura; dado
  vinculado ao NCM pela queryKey; não sobrescreve digitação; troca de NCM limpa o valor automático.
- `confirmacoesNotaOk` não muda: sem candidato, a declaração continua obrigatória.
- Testes do hook e da regra.

## Task 4 — Tela
- `EtapaFiscalForm`: selo "Sugerido pela tabela oficial — confira" com a descrição; botões de candidatos;
  aviso de NCM fora da tabela; declaração "Este produto não se enquadra em CEST"; "Veio da nota" só com
  valor igual ao do XML.
- `dialog-cadastro-produto.tsx` e `dialog-cadastro-grade.tsx`: chamam os hooks. Ativo só com
  `sugestaoDaNota` e sem CEST inicial.
- Testes dos 4 casos do ADR, de apagar sem refazer e de trocar o NCM, nos **dois** dialogs.

## Task 5 — Docs e entrega
- ADR aceito, índices, `docs/reference/modelo-de-dados.md`, vault, TASKS.
- `pnpm preflight`, revisão de diff pelo Codex high, validação visual, push.
