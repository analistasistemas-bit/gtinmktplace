# Marca própria por organização (Zaven) — design

Data: 2026-10-18 · Pedido: Diego · ADR a escrever antes do código: **0186** (conferir com `git fetch` na hora — ver numeração paralela)

## Intenção

A Zaven revende roupa comprada em atacadistas e vende com **marca própria "Zaven"**. Hoje o
anúncio no Mercado Livre mostra o **fornecedor da planilha** no campo Marca (ex.: `MLBU5549781487`,
"Marca: STAR GLAMOUR"). O fornecedor é onde a mercadoria é comprada — o cliente final **nunca** pode
vê-lo. Para a Avil a regra atual está certa (o fornecedor é a marca real: Búfalo, Círculo…), por isso
a mudança é **por organização**, não global.

## Situação medida (2026-10-18)

- Regra atual: `brand = fornecedor?.trim() || marca_padrao_da_org` (`montarAtributosBase` /
  `montarAtributosML` em `_shared/categoria/atributos.ts`). MANUFACTURER espelha o mesmo valor.
- `organizations.marca_padrao` da Zaven (`b95a1c97-8477-4e3a-89b8-04f735549072`) **já é `Zaven`** —
  nunca usado, porque as 7 famílias têm fornecedor preenchido.
- Vazamento só em BRAND (e MANUFACTURER, onde a categoria pede). Título e descrição dos 7: limpos
  (regex por araujo/star glamour/galpao/feira = 0).
- 7 famílias publicadas, **todas User Products**, 109 SKUs, 1 `family_id` cada, 0 vendas, todas
  **pausadas pelo Diego de propósito**:
  `00000010` (32 SKUs), `00000043` (20), `00000064` (4), `00000069` (35), `00000105` (6), `00000112` (6), `00000119` (6).
- No ML, BRAND desses itens está **sem `value_id`** (texto livre) e não há MANUFACTURER (conferido em
  4 dos 7 via `scripts/ops/ml-get.ts`). Logo o delta do UPDATE UP (`atributos-divergentes.ts`,
  ADR-0157) compara por nome e **vai** detectar `Zaven` ≠ valor atual.

## Objetivos

1. Org com marca própria: BRAND e MANUFACTURER = `marca_padrao` da org, **sempre**, em todo caminho
   que monta ou sincroniza esses atributos. O fornecedor nunca sai para o canal.
2. Corrigir os 7 anúncios já publicados para Marca = Zaven, pelo fluxo de Atualizar do app.
3. Avil e demais orgs: comportamento byte-a-byte igual ao de hoje.

## Não-objetivos

- Tela/toggle para ligar a opção (Diego: "direto no banco, só pra Zaven").
- Mexer em título/descrição (já limpos), em `familias.fornecedor` (segue gravado para nota de compra,
  custo, controle interno) ou em outros canais além do ML.
- Reativar os anúncios — fica com o Diego.

## Anti-objetivos (falha mesmo se "funcionar")

- Qualquer SKU da Zaven ainda mostrando o fornecedor no ML depois da entrega.
- Família UP desagrupada (`family_id` diferente entre SKUs) por causa da troca de marca.
- Escrita direta no ML fora do fluxo do app (PUT manual de BRAND) — proibido, inclusive em diagnóstico.
- Mudança de comportamento na Avil (que depende de fornecedor = marca).

## Decisões do Diego

- **Proibido republicar** (remover + publicar de novo) qualquer um dos 7, em qualquer cenário de falha.
- Se o ML exigir item ativo para aceitar a troca: pode despausar pelo app, atualizar, e **pausar de
  novo** pelo app logo em seguida (conferir `paused` no fim).
- Nada pode sobrescrever as fotos que o Diego colocou direto no ML. Conferido: o Atualizar UP não envia
  `pictures`; a descrição só é reenviada se a lista de cores mudar (`houveMudanca`). Guard do rollout:
  antes de atualizar, conferir que os SKUs desejados = filhos atuais (nenhuma cor nova/removida) —
  divergiu → não atualizar, voltar ao Diego.

- Opção vale **só para a Zaven**, ligada **direto no banco**, sem UI.
- Os anúncios já publicados entram no mesmo trabalho ("ao finalizar, já ajuste nos anúncios").

## Decisões minhas (o Diego pode corrigir)

- **Modelo de dados:** coluna `organizations.marca_propria boolean not null default false`, migration
  via `supabase migration new` + `db push` (ADR-0043), com `update ... set marca_propria = true where
  slug = 'zaven'` na própria migration. RLS de `organizations` já cobre a coluna.
- **Um único ponto de decisão:** uma função em `_shared` (ex.: `marcaDoAnuncio({ fornecedor,
  marcaPadrao, marcaPropria })`) que todos os caminhos usam; com `marcaPropria` → `marcaPadrao`; sem →
  regra atual. Caminhos que hoje leem fornecedor como marca (todos precisam passar por ela):
  - `process-familia/index.ts` (~260–339: `montarAtributosML` e o resolver genérico)
  - `definir-categoria-familia/index.ts` (~70–80)
  - `criar-kit-vinculado/index.ts` (~150)
  - `update-familia-ml/processar.ts:291` (BRAND do UPDATE legado, ADR-0016)
  - `publicar-split-ml/index.ts:212`
  - `_shared/categoria/resolver-atributos-genericos.ts:43`
  Org com `marca_propria` e `marca_padrao` nulo/vazio = erro explícito (nunca cair no fornecedor nem no
  default `'Avil'`).
- **Mapa de marcas do título** (`marcaDoFornecedor` em `titulo-guards.ts:464`): com `marca_propria`,
  não consultar (passar fornecedor nulo). Não vaza hoje, mas fecha a porta.
- **Anúncios já publicados:** o UPDATE UP manda o delta a partir de `familias.atributos_ml`, que hoje
  guarda `BRAND=<fornecedor>`. Corrigir BRAND/MANUFACTURER gravados das 7 famílias da Zaven para
  `Zaven` (data fix na mesma migration, restrito a `org_id` da Zaven e às chaves BRAND/MANUFACTURER do
  jsonb), depois rodar **Atualizar** pelo app.
- **Ordem de rollout dos 7:** primeiro só `00000064` (4 SKUs). Conferir via `ml-get.ts`: BRAND =
  Zaven nos 4 e `family_id` único. Só então as outras 6. Se o ML recusar a troca ou desagrupar:
  **parar e voltar ao Diego. NUNCA republicar** (decisão do Diego, 18/10: há imagens colocadas direto
  no ML que se perderiam).

## Respostas do builder check (minhas, conferidas no código/banco)

- **O Atualizar UP manda a marca?** Sim. "Atualizar tudo" (não "somente estoque", não
  `preservarPublicadas`) passa `familia.atributos_ml` (com grade, via `comGeneroDaFamilia`) para
  `atributosDaReposicao` → delta contra a ficha publicada → `attributes` no PUT de **cada** filho
  (`atualizar-familia-up.ts:582`, `atualizar-composicao.ts:144-190`). Usa o `atributos_ml` **gravado**
  (não reprocessa) → o data fix é obrigatório. Conferir que BRAND sobrevive ao `comGeneroDaFamilia`.
- **A pausa trava o Atualizar?** Não: os 109 filhos estão `status='ativo', retirado=false` no banco
  (a pausa ficou só no ML), então não cai em `filho_em_estado_terminal`. O PUT de reposição leva
  `available_quantity`/`price`/`attributes`, sem `status`. **Critério do teste no `00000064`:** os 4
  seguem `paused` no ML depois do Atualizar. Se algum reativar → pausar de novo pelo app e parar.
- **Efeito colateral aceito:** "Atualizar tudo" também reenvia estoque e preço (preço vivo lido do ML
  desde 16/10 — ver reposição). É o fluxo normal do app; sem rota nova.
- **Critério de sucesso do rollout:** GET logo após e de novo ~30 min depois (o ML já reverteu campo
  minutos depois em outro caso — medidas): BRAND=Zaven, 1 `family_id`, status `paused`.
- **Migration:** filtrar por `id = 'b95a1c97-8477-4e3a-89b8-04f735549072'` (slug `zaven` existe e é
  único, mas id é à prova de erro) e falhar se afetar ≠ 1 linha. No `atributos_ml`, trocar só
  `value_name` de BRAND/MANUFACTURER e remover `value_id`/`values` desses dois se existirem.
- **UPDATE legado (`update-familia-ml/processar.ts`)**: não toca os 7 (são UP), mas entra por
  consistência — precisa ler a org (nova query). Sem isso, um anúncio legado futuro da Zaven vazaria.
- **`atributos-irmao.ts`**: copia a ficha **como está no ML** só ao criar cor nova. Depois da
  correção o irmão já tem Zaven → herda Zaven. Antes da correção, criar cor nova na Zaven herdaria o
  fornecedor — por isso a correção dos 7 vem junto com o deploy.
- **MANUFACTURER:** mesma regra de hoje (só onde o schema da categoria expõe); no UPDATE, só BRAND
  (como hoje). Nada novo enviado onde a categoria não pede.
- **`mercado-livre.ts:312`** só recebe `a.marca` já decidido pelo chamador — coberto pelos chamadores.

## Verificação

- Teste unitário da função de decisão (com/sem `marca_propria`, `marca_padrao` vazio → erro) e dos
  caminhos que a usam onde já há teste (montar atributos, UPDATE legado, delta UP com BRAND texto).
- Teste da migration pelo padrão sem Docker (`scripts/teste-sql-desfeito.py`): só a Zaven recebe o
  flag; só BRAND/MANUFACTURER das famílias da Zaven mudam; Avil intacta (md5 antes/depois).
- Deploy de **todas** as edges afetadas (mudança em `_shared/`) com conferência de versão.
- Final: GET dos 109 SKUs (ou 1 por família + `family_id`) mostrando BRAND=Zaven e 1 `family_id` por
  família; status segue `paused`.

## Deixado para quem implementar

- Nome exato da função/arquivo e como cada edge lê `marca_propria` (mesma query que já lê `marca_padrao`).
- Se o data fix vai na migration do schema ou em uma segunda migration.
