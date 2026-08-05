# Spike — "Especificação mestre de títulos" externa × ADR-0099

**Data:** 2026-08-04
**Status:** análise, nenhuma implementação
**Fonte:** documento externo `titulo-marketplace-agent.md` (18 slots, 10 templates por categoria, score 0-10)
**Compara com:** [ADR-0099](../decisions/0099-titulo-padrao-mercado-livre.md) (contrato de 10 slots, em produção desde 2026-08-02)
**Método:** duas passagens independentes sobre o mesmo código (Opus 5 e Fable 5), com a segunda
instruída a refutar a primeira. As divergências que a segunda encontrou estão incorporadas —
cobertura de §8/§11/§12 rebaixada de "implementada" para "parcial/diverge", premissa dos templates
corrigida, `console.warn` desqualificado como censo, e o achado da invariante de `variacao`.

---

## Conclusão em uma linha

O documento externo e o ADR-0099 são **o mesmo desenho**: extração factual em slots → montagem
determinística por template → redução por prioridade → validação de ancoragem. O PubliAI já
implementa ~85% dele. Dos deltas restantes, **2 devem ser rejeitados** por reabrir defeitos já
medidos e corrigidos em produção (`atributo_principal` → ADR-0098/0099; dicionário de sinônimos →
ADR-0070), e o censo do catálogo (seção própria, abaixo) **rejeitou por inexistência** quase todo o
resto: `2x10ml` existe em 1 família de 305, `SORT`/`PAD`/`PC` em zero, e a gramatura já chega
canônica da fonte.

**Sobra um único item com valor:** `termos_com_risco` — **implementado**, ver
[ADR-0100](../decisions/0100-termos-com-risco-valvula-de-escape.md). Com uma ressalva medida que
vale mais que a entrega: o A/B contra a API real mostrou que o modelo padrão **já não
contrabandeava** nos casos de pressão testados, então a válvula é trava preventiva, não correção de
defeito observado.

O censo também produziu um susto útil: 119 títulos com separador `|` criados *depois* do merge do
ADR-0099 pareciam indicar deploy defasado — o incidente clássico deste projeto. Não era. São
`UPDATE`s herdando o título anterior por decisão do ADR-0016. **Dos 7 `CREATE` do período, 7
saíram limpos.** O caminho da apuração está registrado abaixo porque a métrica ingênua ("títulos
criados após o merge") mede o regime antigo, e qualquer auditoria futura cairá na mesma armadilha.

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
| `linha` | `modelo` | coberto pelo **contrato**, não exercitado pelo **prompt** — diferir (ver abaixo) |
| `modelo` | `modelo` | idêntico, incl. a proibição de código interno (`RUIDO`) |
| `atributo_principal` | — | **delta — rejeitar** (ver abaixo) |
| `embalagem` | `quantidade` | parcial: falta a composição `2x10ml` |
| `medida` | `medida` | idêntico |
| `material` | `material` | idêntico, com redução `100% Poliéster → Poliéster` |
| `variacao` | `variacao` | PubliAI é mais forte: `variacaoDiscrimina` protege do corte |
| `compatibilidade` | `compatibilidade` | idêntico |
| `aplicacao` | `aplicacao` | idêntico |
| `sinonimo` | `sinonimo` | slot idêntico (T7: só da fonte); o **dicionário aprovado** da §16 é proposta nova — **rejeitar** |
| `tipo_produto` | `tipo_produto_busca` | existe, mas serve à categoria (ADR-0054), não à ordem |
| `template_recomendado` | `ORDEM_LEITURA` única | **delta — diferir** |
| `catalogo` | — | delta sem valor no ML (ver abaixo) |
| `termos_com_risco` | descarte silencioso | **delta — adotar** |

Regras não-slot do documento, com o grau real de cobertura (corrigido na 2ª análise):

| Regra | Onde vive | Cobertura |
|---|---|---|
| §8 termos proibidos | `ADJETIVOS_VAZIOS`, `MARKETING_TERMOS` | **parcial** — `ADJETIVOS_VAZIOS` casa o **slot inteiro** (`titulo-guards.ts:463`); "Conforto", "Exclusivo", "Profissional" sozinhos, e frete/parcelamento/garantia, não têm guard — só o prompt |
| §9 dialeto | `ABREVIACOES`, `RUIDO` | cobre os casos medidos |
| §10 unidades | `CONVERSOES_UNIDADE` | cobre, menos gramatura `g/m²` |
| §11 dedup cross-slot | `aplicarGuardsTitulo` | **parcial** — dedup é *dirigido pela fonte* (metragem/contagem `:349-355`, largura `:320`, cor `:370`), não semântico genérico |
| §12 ordem de redução | `REDUCOES` + `ORDEM_CORTE` | **diverge** — a spec corta `material` antes de `variacao` e trata `compatibilidade` como quase incortável; a `ORDEM_CORTE` faz o inverso nos dois |
| §14 legibilidade | `tituloCase` | cobre |
| §20 montador | `montarTitulo` | cobre, e vai além (`TituloInviavelError`) |

O score 0-10 da §22 não
tem equivalente e não precisa ter: o censo de defeitos do ADR-0099 (medido em produção, não
auto-atribuído pelo próprio gerador) já cumpre esse papel com evidência melhor.

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

## Rejeitar: dicionário controlado de sinônimos (§16)

Hoje o T7 admite **uma** fonte de sinônimo: o texto do produto. A §16 propõe uma segunda —
um dicionário aprovado (`Tecido Helanca Light → Helanquinha`). O ADR-0070 é o argumento contra,
e ele é empírico: em "Linha Cléa", `linha` e `fio` estavam **os dois ancorados na fonte** e o
modelo escolheu errado assim mesmo, em produção, em 2 de 3 famílias do mesmo lote — a inconsistência
apareceu na mesma chamada, com a mesma fonte. A correção foi *estreitar* a decisão à palavra que a
planilha declara, não alargá-la. Um dicionário aprovado alarga exatamente o espaço de escolha que o
ADR-0070 teve que fechar.

## Diferir: `linha` como conceito (Aquaphor, EcoTank)

`titulo-slots.ts` documenta `modelo` como "numeração, **linha** ou referência", mas todos os
exemplos do prompt (`copywriter-prompt.ts:308`) são numéricos: `N.3`, `Nº 6`, `Tex 29`, `4/6`.
Pelo próprio achado do ADR-0098 — *exemplo few-shot vence regra declarada* — uma linha comercial
como "Aquaphor" provavelmente não cai em `modelo` hoje.

Não é um slot novo, é um exemplo faltando no prompt. Mas fica em diferir por um risco específico
deste catálogo: aqui existem produtos cujo **tipo** é literalmente a palavra "Linha" (ADR-0070).
Ensinar `modelo` a carregar linhas comerciais convida a mesma confusão que o ADR-0070 fechou.
Reavaliar quando entrar catálogo com linhas de marca de verdade.

## Diferir: templates por categoria (§6)

Diferença real entre as 10 ordens do documento e a `ORDEM_LEITURA` única (mapeando
`embalagem`→`quantidade`):

- `CASA_DECORACAO`, `FERRAMENTA`, `COMPATIBILIDADE`: mesma ordem relativa. Zero mudança.
- `PAPELARIA_VOLUME`: **diverge** — a spec põe `material` antes de `embalagem` ("Lápis Nº 2
  **Resina Caixa com 144** Preto"); o PubliAI renderiza "Lápis N.2 **144un Resina** Preto".
- `TECIDO` / `GENERICO`: a spec põe `embalagem` antes de `medida`; comparação parcialmente
  ambígua porque o "Rolo de 10m" da spec cai em `medida` aqui, não em `quantidade`.
- `MARCA_LINHA` / `COSMETICO` / `ELETRONICO`: marca antes do produto. Muda de verdade — mas neste
  catálogo a marca é ancorada em ~55% das famílias (ADR-0099), e best-effort por decisão.

Custo: `ORDEM_LEITURA`, `ORDEM_CORTE`, `slotsIncortaveis`, `REDUCOES`, prompt e toda a suíte.
Benefício medido no catálogo atual: nenhum. Reavaliar quando entrar categoria com marca dominante.

## Diferir: `embalagem` composta (`2x10ml`) e limite configurável

- **`2x10ml`**: só vale se existirem famílias com volume unitário *e* contagem de pacote. Kits
  existem (ADR-0063/0071/0073), mas o padrão do catálogo é `100un` + `14mm`, não `2x10ml`.
  **Medir no banco antes de construir.**
- **`TITULO_MAX` configurável por canal**: real (vive em 2 arquivos), mas é trabalho do conector
  Shopee (E5), não especulação agora.

## Rejeitar: `embalagem` na forma natural ("Caixa com 144 Unidades")

Distinto do `2x10ml` (esse é diferir-por-medição). Aqui a spec prefere a forma extensa, comprimida
só sob pressão de limite (§12, passo 7) — enquanto `normalizarSlots` canoniza `144 unidades →
144un` **sempre** (`titulo-guards.ts:84`), mesmo com folga (média de 45,6 chars em 60).

A canonização eager parece desperdício, mas é estrutural: os guards de dedup (`numeroAncorado`,
`RE_CONTAGEM_TOKEN`) comparam contra a forma canônica **já estabilizada**. Adiar a compressão para
o montador reabriria a comparação sobre texto livre — a classe de bug do lote #40/#65. Efeito
colateral honesto: `REDUCOES.quantidade` em `titulo-montar.ts:65` é hoje quase código morto (o
próprio comentário o chama de "rede").

## Sem valor: `catalogo: true` (§15)

O PubliAI já é conservador por construção — nenhum slot aceita dado não ancorado, com ou sem
catálogo. E o opt-in de catálogo (ADR-0021) é posterior ao CREATE. Não há comportamento novo a
adicionar.

---

## Adotar

### 1. `termos_com_risco` — o único item com valor claro, em duas metades

`validarSlotsAncorados` (`titulo-guards.ts:445`) já derruba o que não tem respaldo na fonte — mas
**em silêncio**: devolve `TituloSlots` e nada mais.

**Metade A — o campo no schema (é o mecanismo original da spec, não telemetria).** Um 11º campo
dá ao modelo um lugar *legítimo* para depositar o termo não comprovado ("HB", "Escolar"),
reduzindo a pressão de contrabandeá-lo para dentro de `produto`. Um campo que **nunca é
renderizado** não reabre a Causa C — o risco da Causa C é slot que *entra* no título. Custo:
schema + normalização + testes (com o método das 8 travas).

**Metade B — persistir o descarte.** `console.warn` **não** entrega o censo: o censo de 143
títulos do ADR-0099 só foi possível porque `titulo_ml` **persiste no banco**. Log de edge function
tem retenção curta e não é consultável em massa — serve a debug pontual (padrão ADR-0084), não a
censo. Se o objetivo é medir, o descarte precisa persistir (coluna `jsonb` em `familias` ou tabela
de eventos). Se `console.warn` for suficiente, então o benefício prometido é debug, não censo, e
deve ser vendido assim.

### 2. Dialeto e unidade — baixo custo, frequência não medida

Comparação linha a linha com `ABREVIACOES`/`RUIDO`/`CONVERSOES_UNIDADE`:

| Item do documento | Hoje |
|---|---|
| `SORT`, `VR`, `PAD` isolados | ausentes de `RUIDO` (que só cobre `VR` dentro de "TAM VR") |
| `PC` → peças | coberto quando vem com número (`12PC` → `12pc`); `PC` isolado, não |
| `120 G/M2 → 120g/m²` | não coberto — `G` de uma letra foi deliberadamente excluído de `CONVERSOES_UNIDADE` (colide com tamanho P/M/G). Exigiria regra própria ancorada em `/M2`. |

**Ressalva de raio (a mais séria da lista):** uma regra de gramatura ancorada em medida iria
naturalmente para `titulo.ts` — e `titulo.ts` **não tem raio zero**. `copywriter-prompt.ts:4`
importa `extrairMetragem`/`extrairLargura` de lá para os guards de descrição, e o ADR-0099 já
registra que mexer em `normalizarUnidade` mudou bullets de descrição de anúncios **já publicados**
no UPDATE seguinte (`sincronizarDescricao`). Qualquer adoção de §9/§10 precisa declarar o
arquivo-alvo: `titulo-guards.ts` (só título, raio zero) × `titulo.ts` (título + descrição + UPDATE
de anúncio vivo).

**Ressalva de evidência:** nenhum destes aparece no censo de 143 títulos do ADR-0099 (o `GR` de lá
é grama, já coberto). São itens de um documento genérico, não medidos contra a planilha do Diego.
E `RUIDO` é **destrutivo** — `if (RUIDO.some(...)) v = ''` zera o slot inteiro; uma entrada nova
com falso positivo apaga dado real.

Mesmo gate do `2x10ml`: contar a ocorrência no catálogo antes de escrever a regra. São poucas linhas
de array, mas poucas linhas erradas num guard destrutivo já custaram lotes inteiros neste projeto.

---

## Achado colateral: `variacao` é incortável por construção, sem teste que o asserte

Rastreando os quatro caminhos de `aplicarGuardsTitulo` (`titulo-guards.ts:371-381`) contra
`titulo-pos.ts:36-43`, `variacao` **não-vazia sempre chega protegida** do corte:

| Caminho | `variacao` | Proteção |
|---|---|---|
| cor única, válida, não coberta | `= corUnica` | `corDiscrimina = true` |
| cor única indefinida, ou já coberta por produto/medida | `= ''` | irrelevante (vazia) |
| múltiplas cores | `= ''` | irrelevante (vazia) |
| `cores.length === 0` | intocada (tamanho/espessura) | `semCorMasComVariacao = true` |

Logo, a posição de `variacao` em `ORDEM_CORTE` **nunca executa**. Não é bug — é o comportamento
desejado, obtido por duas peças em arquivos diferentes que concordam por acidente de leitura. É
exatamente a forma das 8 travas perdidas: uma invariante que ninguém escreveu, que a próxima
refatoração quebra em silêncio com a suíte verde. **Merece um teste que a asserte**, ou no mínimo
um comentário em `ORDEM_CORTE` apontando para `slotsIncortaveis`.

## O censo — medido, não presumido

Rodado em 2026-08-04 contra o banco de produção (305 famílias, 138 criadas após o merge do
ADR-0099). Script versionado em `scripts/censo-titulo/index.ts`, somente SELECT, sem chamada de IA.

| Padrão procurado na fonte | Famílias | % |
|---|---|---|
| A1a — contagem + volume unitário (`2 unidades de 10ml`) | **1** | 0,3% |
| A1b — só `CAIXA/KIT/PACOTE COM N` | 22 | 7,2% |
| A2 — `SORT` isolado | **0** | 0% |
| A2 — `PAD` isolado | **0** | 0% |
| A2 — `VR` isolado (fora de `TAM VR`, já tratado) | 1 | 0,3% |
| A3 — gramatura (`G/M2`, `g/m²`…) | 9 | 3,0% |
| A4 — `PC` isolado | **0** | 0% |

### O que o censo decide

**`2x10ml` → rejeitar, não diferir.** Existe **1** família no catálogo inteiro — e é a Eucerin
Aquaphor, exatamente o produto do exemplo da spec. A spec foi escrita a partir de um catálogo que
não é este. Construir composição de embalagem para 0,3% do catálogo é trabalho sem retorno.

**`SORT`/`PAD`/`PC` → rejeitar por inexistência.** Zero ocorrências, os três. A única ocorrência de
`VR` isolado está dentro de `AGULHA BAR-03-VR C VAR NYBC` — um código interno, classe que o `RUIDO`
já trata. Adicionar entradas a um guard destrutivo para casos que não existem é risco puro.

**Gramatura → rejeitar, e por um motivo melhor que "não medido".** As 9 ocorrências já vêm
canônicas na fonte (`Gramatura: 145g/m²`, `120g/m²`). Não há conversão a fazer: a regra nasceria
sem trabalho. Isso também elimina a ressalva de raio — não é preciso tocar `titulo.ts` nem arriscar
a descrição de anúncio vivo.

**`CAIXA COM N` → observação honesta, veredito mantido.** 22 famílias (7,2%) têm a forma natural na
fonte e hoje são renderizadas como `24un`. A rejeição da forma natural continua válida pelo
argumento estrutural (o dedup compara contra a forma canônica já estabilizada), mas o custo dela
**não é zero** — é 7,2% do catálogo perdendo "Caixa com" no título. Se algum dia houver evidência
de que a forma natural converte melhor, é aqui que se mede.

### Saúde do pipeline pós-ADR-0099 — e uma correção metodológica

**Das 138 famílias criadas após o merge, apenas 7 são `CREATE`.** As outras 131 são `UPDATE`, e
`ingest-lote/index.ts:205` **herda `titulo_ml` da família anterior** por decisão do ADR-0016
(UPDATE não re-roda IA). Isso significa que a maioria dos títulos "novos" no banco são títulos
**antigos herdados** — qualquer métrica agregada sobre as 138 mede o regime anterior, não o atual.

| Operação | Famílias | Com `\|` (formato antigo) |
|---|---|---|
| UPDATE | 131 | 119 |
| CREATE | **7** | **0** |

**O pipeline novo está limpo em 100% dos CREATEs.** Os 7 títulos:

```
53  Agulha de Costura Singer 2020 10un Tecidos de Algodão
51  Pomada Reparadora Eucerin Aquaphor 10ml 2un Incolor
48  Kit Agulha 1025 18x8cm 5un Plástico Tricô Crochê
46  Kit Agulha Índio Búfalo Tamanhos Variados 25pc
37  Fio para Amigurumi Pingouin 100g/110m
34  Agulha de Costura Singer 2045 10un
34  Agulha de Costura Singer 2024 02un
```

Sem separador, sem adjetivo vazio, Title Case, unidades canônicas (`10un`, `100g/110m`, `25pc`,
`18x8cm`). Máximo de 53 chars — nenhum encosta no teto, confirmando a regra T6.

**O pico de 13 títulos em exatamente 60 caracteres não é bug do sistema atual.** Todos os 13 têm
separador `|` — são do formato antigo, herdados via UPDATE. O clamp em 60 era comportamento do
regime anterior (os guards antigos "clampavam o título final em 60 caracteres", ADR-0054). O
`.slice(0, 60)` de `titulo-particao.ts:66` **não** é a causa: aquela função só roda para partições
`>0`, cujo resultado vai para `anuncios_externos.titulo`, nunca para `familias.titulo_ml`.

**Ressalva de honestidade sobre o "zero `TituloInviavelError`":** o denominador real é **7
CREATEs**, não 138. Com essa amostra, "zero erros" é consistente com o desenho saudável, mas não é
evidência forte. As 6 famílias em erro são todas de anúncio removido/fechado no ML — nenhuma de
título, isso permanece verdadeiro.

### Evidência direta contra o `2x10ml`

A única família multipack do catálogo (Eucerin, `00000006`) passou pelo pipeline novo e saiu:

```
Pomada Reparadora Eucerin Aquaphor 10ml 2un Incolor   (51 chars, folga de 9)
```

A spec produziria `2x10ml` no lugar de `10ml 2un` — economia de 2 caracteres num título que já tem
9 de folga. O único caso do catálogo onde a regra se aplicaria não tem problema que ela resolva.

### O que o censo NÃO respondeu

Não mediu **o que `validarSlotsAncorados` derruba em produção** — isso exige gerar slots via IA
(custo real) e só se justifica se houver suspeita concreta. O A/B do ADR-0099 (n=70) mediu o
formato antes do merge; os descartes seguem sem auditoria. É a única pergunta aberta que
sustentaria a metade B do `termos_com_risco`.

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
