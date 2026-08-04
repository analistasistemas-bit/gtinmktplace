# Spike — "Especificação mestre de títulos" externa × ADR-0099

**Data:** 2026-08-04
**Status:** análise, nenhuma implementação
**Fonte:** documento externo `titulo-marketplace-agent.md` (18 slots, 10 templates por categoria, score 0-10)
**Compara com:** [ADR-0099](../decisions/0099-titulo-padrao-mercado-livre.md) (contrato de 10 slots, em produção desde 2026-08-02)

---

## Conclusão em uma linha

O documento externo e o ADR-0099 são **o mesmo desenho**: extração factual em slots → montagem
determinística por template → redução por prioridade → validação de ancoragem. O PubliAI já
implementa ~85% dele. Restam 4 deltas reais, dos quais **1 deve ser rejeitado** por reabrir um
defeito já medido e corrigido.

## Três fatos que decidem o valor de qualquer mudança aqui

1. **`atualizarTituloML` não existe no código.** ADR-0070 cita o nome como *pendência operacional
   manual*; `grep` em `supabase/` + `src/` não retorna nenhuma implementação, e `atualizarItemML`
   nunca envia `title`. **Qualquer melhoria de título tem raio zero sobre anúncios publicados** —
   vale só para CREATE novo.
2. **O caminho `family_name` não escapa do pipeline.** `publicar.ts:170` grava
   `family_name: familia.titulo_ml`. Categorias que exigem item plano (Zíperes/MLB271227, ADR-0084)
   rejeitam `title`, mas consomem o mesmo `titulo_ml` como `family_name`. **O pipeline de título
   alimenta 100% dos CREATEs**, nos dois formatos de payload.
3. **A montagem já é única e pós-guards.** `posProcessarTitulo` (`_shared/ai/titulo-pos.ts`) executa
   exatamente o pseudocódigo da §21 do documento externo, com `TituloInviavelError` no lugar do
   truncamento — que o próprio documento não prevê e é a decisão mais forte do ADR-0099.

## Mapa slot a slot

| Documento externo | PubliAI hoje | Situação |
|---|---|---|
| `produto` | `produto` | idêntico, incl. "nunca vazio" |
| `marca` | `marca` | idêntico, incl. "razão social não é marca" |
| `linha` | — | **coberto**: `titulo-slots.ts` documenta `modelo` como "numeração, **linha** ou referência" |
| `modelo` | `modelo` | idêntico, incl. a proibição de código interno (`RUIDO`) |
| `atributo_principal` | — | **delta — rejeitar** (ver abaixo) |
| `embalagem` | `quantidade` | parcial: falta a composição `2x10ml` |
| `medida` | `medida` | idêntico |
| `material` | `material` | idêntico, com redução `100% Poliéster → Poliéster` |
| `variacao` | `variacao` | PubliAI é mais forte: `variacaoDiscrimina` protege do corte |
| `compatibilidade` | `compatibilidade` | idêntico |
| `aplicacao` | `aplicacao` | idêntico |
| `sinonimo` | `sinonimo` | idêntico (T7: só da fonte) |
| `tipo_produto` | `tipo_produto_busca` | existe, mas serve à categoria (ADR-0054), não à ordem |
| `template_recomendado` | `ORDEM_LEITURA` única | **delta — diferir** |
| `catalogo` | — | delta sem valor no ML (ver abaixo) |
| `termos_com_risco` | descarte silencioso | **delta — adotar** |

Regras não-slot do documento já implementadas: §8 termos proibidos (`ADJETIVOS_VAZIOS`,
`MARKETING_TERMOS`), §9 dialeto (`ABREVIACOES`, `RUIDO`), §10 unidades (`CONVERSOES_UNIDADE`),
§11 dedup cross-slot (`aplicarGuardsTitulo`), §12 ordem de redução (`REDUCOES` + `ORDEM_CORTE`),
§14 legibilidade (`tituloCase`), §20 regras do montador (`montarTitulo`).

---

## Rejeitar: `atributo_principal`

É um slot livre para "o diferencial do produto" — **exatamente a Causa C** do ADR-0098/0099. O
segmento `| DIFERENCIAL` do formato antigo produziu 35% de títulos terminando em adjetivo vazio
(`ELEGANTE` 8×, `ALTA RESISTÊNCIA` 7×, `QUALIDADE PREMIUM` 4×). O ADR-0099 fechou isso com
`additionalProperties: false` no schema, justamente para o modelo não inventar um slot
`diferencial`/`beneficio`.

A defesa que o documento externo oferece é uma **lista de proibições declarada** — e o achado
central do ADR-0098 é que *exemplo few-shot vence regra declarada*. A mesma cerca já falhou uma vez.

Payoff medido neste catálogo: os exemplos do documento (`FPS 60`, `Sem Fragrância`) são a única
família Eucerin da tabela de fornecedores do ADR-0099. `Estampado Natal` pertence a `produto` ou
`variacao`. Nada a ganhar, defeito conhecido a reabrir.

**Se for adotado mesmo assim**, a única forma segura é exigir que o valor seja um trecho contíguo
literal da fonte (padrão de `validarTextoLivre`, ADR-0052) — nunca o padrão frouxo de
`tipo_produto_busca`.

## Diferir: templates por categoria (§6)

Diferença real entre as 10 ordens do documento e a `ORDEM_LEITURA` única:

- `TECIDO`, `PAPELARIA_VOLUME`, `CASA_DECORACAO`, `FERRAMENTA`, `GENERICO`: mesma ordem relativa
  dos slots que existem hoje. Zero mudança.
- `MARCA_LINHA` / `COSMETICO` / `ELETRONICO`: marca antes do produto. Muda de verdade — mas neste
  catálogo a marca é ancorada em ~55% das famílias (ADR-0099), e best-effort por decisão.
- `COMPATIBILIDADE`: `variacao` antes de `compatibilidade` — já é a ordem atual.

Custo: `ORDEM_LEITURA`, `ORDEM_CORTE`, `slotsIncortaveis`, `REDUCOES`, prompt e toda a suíte.
Benefício medido no catálogo atual: nenhum. Reavaliar quando entrar categoria com marca dominante.

## Diferir: `embalagem` composta (`2x10ml`) e limite configurável

- **`2x10ml`**: só vale se existirem famílias com volume unitário *e* contagem de pacote. Kits
  existem (ADR-0063/0071/0073), mas o padrão do catálogo é `100un` + `14mm`, não `2x10ml`.
  **Medir no banco antes de construir.**
- **`TITULO_MAX` configurável por canal**: real (vive em 2 arquivos), mas é trabalho do conector
  Shopee (E5), não especulação agora.

## Sem valor: `catalogo: true` (§15)

O PubliAI já é conservador por construção — nenhum slot aceita dado não ancorado, com ou sem
catálogo. E o opt-in de catálogo (ADR-0021) é posterior ao CREATE. Não há comportamento novo a
adicionar.

---

## Adotar (custo baixo, valor real)

### 1. `termos_com_risco` como telemetria

`validarSlotsAncorados` já derruba o que não tem respaldo na fonte — mas **em silêncio**. Passar a
devolver/registrar *o que* foi derrubado dá a mesma visibilidade de censo que produziu o ADR-0099,
sem mudar nenhum título. Risco ~zero.

### 2. Entradas faltantes de dialeto e unidade

Comparação linha a linha com `ABREVIACOES`/`RUIDO`/`CONVERSOES_UNIDADE`:

| Item do documento | Hoje |
|---|---|
| `SORT`, `VR`, `PAD` isolados | ausentes de `RUIDO` |
| `PC` → peças | coberto quando vem com número (`12PC` → `12pc`); `PC` isolado, não |
| `120 G/M2 → 120g/m²` | **não coberto** — `G` de uma letra foi deliberadamente excluído de `CONVERSOES_UNIDADE` (colide com tamanho P/M/G). Gramatura é dado real num catálogo de tecidos; precisa de regra própria ancorada em `/M2`, não da entrada genérica de gramas. |

Poucas linhas de array + a regra de gramatura.

---

## Se algo tocar slots: método obrigatório

O ADR-0099 registra **8 travas perdidas em silêncio** na última migração de guards, com a suíte
verde (2400+ casos) o tempo todo — porque os testes que as provavam foram removidos junto com o
código antigo. Os métodos que as encontraram:

1. teste de mutação (remover a linha do guard e ver se a suíte segue verde);
2. portar as asserções dos testes antigos antes de apagá-los;
3. auditar a tabela "onde cada garantia vive agora", uma a uma;
4. rodar contra API e banco reais.

Somar a isso: testar `normalizarSlots` → `aplicarGuardsTitulo` **compostos**, nunca isolados — foi
esse isolamento que deixou passar o CRITICAL de dimensão composta duplicada.
