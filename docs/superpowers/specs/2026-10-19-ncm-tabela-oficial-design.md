# NCM validado na tabela oficial — desenho

**Data:** 2026-10-19 · **ADR a escrever:** 0187 (antes da implementação) · **Relacionados:** ADR-0135
(cadastro fiscal), ADR-0107 (ORIGEM aborta o lote), ADR-0043 (migrations só por CLI)

## Por que

Em 19/10 o produto `00000140` (Zaven) foi publicado com NCM `75937727`, copiado da nota do
fornecedor. O código **não existe** (capítulo 75 = níquel, vai só até 7508). O app aceitou porque
só confere "8 dígitos"; o ML recusou o envio fiscal (`10029 Invalid ncm`) e os 9 anúncios ficaram
"Sem dados fiscais" no Editor em massa do ML — só percebido olhando o painel do ML.

**Objetivo:** NCM inexistente nunca entra no cadastro fiscal. O erro aparece **na hora de salvar o
fiscal**, antes de qualquer publicação, e a tela mostra **o que o NCM digitado significa** para o
operador conferir se é o produto certo.

## Decisões do Diego

1. Trava **ao salvar o fiscal** (não só na publicação).
2. A tela mostra a **descrição** do NCM digitado.
3. Planilha com NCM fora da tabela **aborta o lote com erro**, igual à ORIGEM (ADR-0107).
4. NCM **vencido** (já gravado, depois extinto por resolução Gecex) **trava em tudo**, igual a
   inexistente: salvar fiscal/cadastro, planilha (inclusive UPDATE só de preço/estoque),
   **publicação/update e envio fiscal ao ML**; e aparece no filtro "Fiscal pendente" do Estoque.
   Custo aceito: produto com NCM extinto fica travado até alguém corrigir.

## Fonte

Tabela oficial da Receita/Siscomex, JSON público:
`https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json`
(segue 307 → `?perfil=PUBLICO`). Medido 19/10/2026: ~3 MB, 15.157 nós, **10.516 códigos de 8
dígitos**, cabeçalho `"Data_Ultima_Atualizacao_NCM": "Vigente em 19/10/2026"`, `"Ato": "Resolução
Gecex nº 926/2026"`. Cada nó: `Codigo` (com pontos: `6203.49.00`), `Descricao`, `Data_Inicio`,
`Data_Fim` (`31/12/9999` = vigente), ato legal.

**A descrição é hierárquica:** o nó folha traz só o fragmento (`6203.49.00` = "-- De outras
matérias têxteis"); o contexto vem dos ancestrais (`6203` "Ternos, conjuntos, …, calças,
jardineiras, bermudas e shorts…, de uso masculino" › `6203.4` "- Calças, jardineiras, bermudas e
*shorts* (calções):"). Descrições têm HTML (`<i>shorts</i>`) e travessões de nível.

## Desenho

### Tabela `ncm_oficial` (referência global)

- Colunas: `codigo text primary key` (8 dígitos, sem pontos), `descricao text` (composta: posição
  de 4 dígitos › níveis intermediários › folha, sem HTML nem travessões), `data_inicio date`,
  `data_fim date` (`31/12/9999` do JSON = sem fim), `atualizado_em timestamptz`.
- **Vigente = `current_date between data_inicio and data_fim`, calculado na hora** (decisão
  minha): código de resolução futura passa a valer no dia certo e o extinto expira no dia certo,
  sem depender de quando o script rodou. Expor como view ou função SQL (`ncm_vigente(codigo)`)
  pra front e edges usarem a mesma regra.
- Sem `org_id`: dado público, igual para todas as orgs. RLS ligado, `select` para `authenticated`
  sem escrita (molde: `sonar_snapshots`, `20260819145325_sonar_snapshots.sql:21-29`). Só
  service_role escreve.
- **Carga inicial dentro da própria migration** (decisão minha): tabela + 10.516 linhas no mesmo
  arquivo, aplicado por `supabase db push`. Motivo: a FK abaixo exige a tabela populada no mesmo
  instante em que passa a valer — carga separada abriria janela em que todo save de NCM falharia.
  O dado é público (repo é público, sem problema).
- **Atualização:** script `scripts/atualizar-tabela-ncm.py` (baixa o JSON, recompõe descrições,
  upsert com as datas do JSON; código que **sumiu** do JSON recebe `data_fim = ontem` e **nunca é
  apagado** — produtos antigos continuam referenciando pela FK). Rodado à mão quando sair resolução Gecex; sem cron (a tabela muda
  poucas vezes por ano). DML pela Management API, não DDL (ADR-0043 respeitado).

### Rede de segurança no banco

FK `familias.ncm → ncm_oficial(codigo)` criada `NOT VALID` (linhas existentes não são
re-checadas; hoje as 11 famílias com NCM são todas válidas — medido 19/10). Cobre qualquer
escritor futuro que esqueça a validação. O CHECK de 8 dígitos atual fica.

### Validação amigável (o que o operador vê)

Função compartilhada nova na edge, `ncmsInvalidos(admin, ncms) → { codigo, motivo }[]` (motivo:
"não existe na tabela oficial" | "não está mais vigente"), usada em:

| Caminho | Onde encaixa | Comportamento |
|---|---|---|
| Botão Fiscal (Estoque/Publicados) | `atualizar-fiscal-familia/processar.ts` (antes do update, junto de `camposFiscaisFaltantes`) | devolve `{tipo:'invalido', erros}` — a lista que o dialog já mostra |
| Cadastro de produto, cadastro em grade, entrada por nota | `cadastrar-produto/processar.ts` (`validarFiscalDaEntrada`) | idem; a nota só pré-preenche o form, então cai aqui |
| Planilha | `ingest-lote/verificar-fiscal.ts` `exigirFiscalExplicito` | aborta o lote listando os PAIs com NCM inválido, mesma mensagem acumulada da ORIGEM |
| Sugestão por IA | `sugerir-ncm` | sugestão fora da tabela vigente vira "sem sugestão" — a IA nunca propõe código inexistente |

| Publicação / update | `_shared/fiscal/gate.ts` `exigirFiscalCompletoSePreciso` (usado por `publish-familia-ml` e `update-familia-ml`) | NCM inexistente/vencido → erro 400 "NCM X não está mais vigente" (decisão 4) |
| Envio fiscal ao ML | `sincronizar-fiscal-ml/processar.ts` (junto do `camposFiscaisFaltantes`) | recusa definitiva → `can_invoice=false` com a causa (causa começa com "push recusado", então a reconciliação não a limpa) |

`camposFiscaisFaltantes` continua **pura** (sem banco); a checagem de vigência é a função
separada `ncmsInvalidos`, chamada ao lado dela nos pontos acima.

**Filtro "Fiscal pendente" (Estoque):** produto com NCM inexistente/vencido entra no filtro e
mostra o botão Fiscal. O front lê a vigência pela mesma regra SQL (ex.: o resumo de estoque traz
um booleano `ncm_vigente`) — não replica a tabela no bundle.

**Front (formulário fiscal, `etapa-fiscal-form.tsx`):** ao completar 8 dígitos, consulta
`ncm_oficial` (supabase-js, RLS de leitura) e mostra abaixo do campo:
- encontrado e vigente → a descrição composta, ex. "6203.49.00 — Calças, jardineiras, bermudas e
  shorts, de uso masculino › De outras matérias têxteis";
- não encontrado / não vigente → erro em vermelho e **Salvar desabilitado**
  (`fiscalCompleto` passa a exigir NCM confirmado).
Vale para os três formulários que usam esse componente (Fiscal, cadastro, grade) e para o NCM
pré-preenchido da nota (aparece já marcado inválido, operador corrige).

## Não-objetivos

- Não validar se o NCM é o **certo** para o produto (isso é do contador; a descrição ajuda o
  operador a conferir).
- Não validar CEST contra tabela (só NCM).
- Não corrigir notas de fornecedor nem o XML importado (`notas_compra_itens.ncm` guarda o que veio).
- Sem cron de atualização da tabela.

## Anti-objetivos (seria falha mesmo funcionando)

- Bloquear o operador quando o Siscomex estiver fora do ar — a validação lê a tabela **local**,
  nunca o Siscomex em tempo real.
- Apagar código extinto da tabela e quebrar produto antigo (FK) — extinto vira `vigente=false`.
- Mensagem crua de FK (`23503`) chegando ao operador — todo caminho de escrita valida antes.

## Deixado para o executor

- Forma exata da composição da descrição (separador, quantos níveis), desde que caiba numa linha
  legível e comece pela posição de 4 dígitos.
- Debounce/cache da consulta no front.
- Testes: unidade da composição de descrição (com o caso `6203.49.00`), `ncmsInvalidos`, os 4
  encaixes de edge e o form (NCM inválido → salvar desabilitado); teste SQL da FK `NOT VALID`.

## Deploy

**Revisado após a revisão do plano (Codex):** rollout aditivo em duas migrations — (A) tabela +
carga + `ncm_consultar` + resumo do Estoque → edges → front → (B) FK `NOT VALID` por último, para
nenhuma edge antiga bater na FK com erro cru. Os fluxos de cópia `adicionar-variacoes-familia` e
`criar-kit-vinculado` também validam. Detalhe no plano.

Texto original:

Migration (`supabase db push`) → edges `atualizar-fiscal-familia`, `cadastrar-produto`,
`ingest-lote`, `sugerir-ncm`, `publish-familia-ml`, `update-familia-ml`, `sincronizar-fiscal-ml`
(e qualquer outra que importe `_shared/fiscal/gate.ts` ou o helper novo) → front. Ordem: migration
primeiro (FK + dado), depois edges, depois front.
