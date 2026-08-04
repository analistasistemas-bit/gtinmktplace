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
ADR-0070), e só **1 tem valor claro hoje**: registrar o que os guards descartam.

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

## A medição que destrava quase todos os "diferir"

Um censo-sombra único responde a maioria das dúvidas em aberto: rodar os guards atuais sobre o
catálogo inteiro e contar

1. o que `validarSlotsAncorados` e `RUIDO` derrubam, e com que frequência;
2. quantas famílias têm padrão `N×volume` (`2x10ml`), `SORT`/`PAD`/`PC` isolado, `G/M2`;
3. quantos `TituloInviavelError` ocorreram desde 2026-08-02.

O A/B do ADR-0099 (n=70) mediu o **formato antes do merge** — ninguém auditou os **descartes em
produção** depois dele. Sem esse dado, cada "diferir" acima é opinião; com ele, metade vira
"rejeitar por inexistência no catálogo" e a outra metade vira backlog com número na frente. É
também o que decide entre `console.warn` e persistência: se o censo importa, o warn não basta por
construção.

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
