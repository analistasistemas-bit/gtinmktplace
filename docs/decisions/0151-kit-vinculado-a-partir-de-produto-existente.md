# ADR-0151: Kit vinculado — criar anúncios de kit (N unidades) a partir de um produto existente

**Status:** Aceito (design fechado — implementação pendente)
**Data:** 2026-09-02
**Decisores:** Diego
**Relacionado:** [ADR-0063](0063-publicacao-kit-preco-categoria-concorrencia.md)/[0071](0071-units-per-pack-forca-sale-format-kit.md)/[0073](0073-cores-conta-como-unidade-no-kit.md) (`SALE_FORMAT=Kit` detectado por regex — mecanismo reaproveitado aqui), [Spike 036](../spikes/036-kits-virtuais-mercado-livre.md) ("Kits Virtuais" do ML — feature diferente, colisão de nome, fora de escopo), [ADR-0094](0094-estoque-unico-cadastro-manual.md) (módulo Estoque — este ADR é uma extensão dele), [ADR-0129](0129-adicionar-variacao-a-familia-publicada.md) (incidente de família virando canônica com saldo 0 — precedente direto da Decisão 10), [ADR-0021](0021-vinculacao-automatica-ao-catalogo-ml.md)/[0036](0036-alerta-catalogo-no-match.md) (catálogo/alerta no-match), [ADR-0111](0111-reativacao-automatica-ao-repor-estoque.md) (reativação por reposição), [ADR-0096](0096-codigo-produto-automatico.md) (`proximo_codigo_produto()`), [ADR-0043](0043-fluxo-canonico-de-migrations.md) (migrations).

## Contexto

Diego pediu uma feature para, a partir de um produto, criar variantes "Kit com N unidades" (N de 2
a 6) do mesmo produto, cada uma virando um **anúncio novo e independente** no Mercado Livre.

O termo "kit" já está ocupado no domínio: `SALE_FORMAT=Kit` + `UNITS_PER_PACK` (ADR-0071/0073) é o
atributo nativo do ML pra "N unidades físicas do mesmo produto num SKU só" — mas hoje só é
preenchido **automaticamente** por regex quando o nome já diz "24UND"/"C/12 CORES", nunca por ação
do operador, e sem nenhum vínculo de estoque com outra família. Existe ainda "Kits Virtuais"
(Spike 036), um recurso *diferente* do ML que agrupa produtos **distintos** via `user_product_id`
— não se aplica aqui e continua sem decisão de avançar.

Esta feature nasce de uma sessão de `/grill-with-docs` (entrevista relatada decisão por decisão) e
evoluiu de "gatilho de UI simples" pra um épico dentro do módulo Estoque assim que Diego optou por
estoque **vinculado de verdade** (Decisão 6), não independente.

**Revisão adversarial (2026-09-02):** a primeira versão deste ADR foi revisada criticamente
(agente com leitura direta do código real — `_shared/estoque/baixa.ts`, `_shared/estoque/alvos.ts`,
`_shared/ml/atualizar.ts`, migrations do ledger) antes de qualquer implementação. A revisão achou 5
lacunas bloqueantes e 6 altas — a maioria porque a v1 descrevia a *intenção* certa sem nomear o
*mecanismo* que a implementaria de fato (ex.: "a baixa acontece na base" sem dizer que o código
de baixa hoje resolve pelo `codigo` do próprio SKU vendido, então debitaria o kit — saldo 0 — em
vez da base, em silêncio). As decisões abaixo já incorporam as correções.

## Decisão

### 1. Mecanismo de publicação
Kit reaproveita o atributo nativo do ML `SALE_FORMAT=Kit` + `UNITS_PER_PACK=N` (ADR-0071/0073),
disparado manualmente pelo operador — nunca via "Kits Virtuais"/`user_product_id` (Spike 036, fora
de escopo). Cada tamanho de kit vira uma **família nova** (`codigo_pai` próprio, gerado por
`proximo_codigo_produto()`, mesmo mecanismo do cadastro manual ADR-0096), com CREATE próprio no ML.

**Vínculo no schema (corrige lacuna da v1 — não existia coluna nenhuma):** `familias` ganha
`kit_base_codigo_pai text` (nullable) e `kit_multiplicador smallint` (nullable, `check` 2–6) —
migration nova (ADR-0043). A chave de referência é **`(org_id, codigo_pai)`**, não `familias.id`:
é a mesma chave que já resolve "estoque canônico" hoje (glossário — "a família mais recente do
`(org_id, codigo)`"), porque a base pode ganhar linhas novas de `familias` a cada lote de UPDATE
sem `codigo_pai` mudar. `kit_multiplicador is not null` é o predicado que identifica "esta família
é um kit vinculado" em todo o código novo abaixo.

**Resolvedor único, reusado em todo lugar (baixa, estorno, push, CREATE/UPDATE):**
`resolverOrigemEstoque(org_id, codigo)` — se `codigo` pertence a família com `kit_multiplicador`
preenchido, devolve `{ codigoCanonico: kit_base_codigo_pai, multiplicador }`; senão devolve
`{ codigoCanonico: codigo, multiplicador: 1 }`. Todo site que hoje lê/escreve
`variacoes.estoque` por `codigo` (listados nas decisões 6 e 10) passa a resolver por aqui primeiro.

### 2. Dois pontos de entrada, mesma derivação
- **Na criação** (tela Revisão, produto ainda não publicado): operador marca os tamanhos de kit
  desejados; o clique de publicar dispara o CREATE da **base primeiro**. Os CREATEs dos kits só são
  enfileirados **depois** que o CREATE da base confirma sucesso (`familias.status='publicado'` +
  `ml_item_id` preenchido). Se o CREATE da base falhar, nenhum kit é publicado — o operador vê o
  erro na base e reenvia o lote inteiro depois de corrigir. Evita kit órfão publicado contra uma
  base que nunca foi ao ar.
- **Pós-publicação** (tela Publicados, produto já vivo no ML): mesma ação, mesmo fluxo de
  derivação — a base já está com `ml_item_id`, então os CREATEs dos kits disparam direto.

Em ambos os casos, a família-base já sai de `processando` com título/preço/categoria/atributos
resolvidos pela IA antes da Revisão — publicada ou não —, o que sustenta a Decisão 3 (kit não roda
IA de novo).

### 3. Kit não passa por `process-familia` — copia o que já foi resolvido
A família do kit **não roda o pipeline de IA/categoria/repricing/catálogo** (`process-familia`).
Ela nasce copiando da base: `categoria_ml_id`, `categoria_nome`, `atributos_ml` (com
`SALE_FORMAT`/`UNITS_PER_PACK` sobrescritos pelo `kit_multiplicador` — nunca re-extraídos por regex
do título, mesma classe de bug que o ADR-0071 corrigiu), `descricao_ml` (+ linha do tamanho do
kit), e vai direto pro estado equivalente a "pronto" — pronta pra cair no preview (Decisão 4) sem
reprocessamento depois. Isso garante que o preview que o operador confirma **é** o resultado final
— se `process-familia` rodasse depois, título/preço/atributos poderiam divergir do que foi
revisado, furando a revisão humana da Decisão 4.

### 4. Revisão em lote, sem card por kit
Marcar os tamanhos + revisar a base + confirmar no preview abaixo **é** a revisão humana exigida
pela regra inegociável do projeto. Não há uma segunda parada de Revisão por kit gerado.

**Preview editável antes de confirmar**, por kit:
- **Título**: herda o slot `quantidade` do sistema de montagem de título (ADR-0099) — "Kit com N
  unidades" entra por esse slot já existente.
- **Descrição**: base + linha indicando quantidade do kit.
- **Foto**: pré-preenchida com a foto da base, **trocável por kit** (ex.: foto das N unidades
  juntas).
- **Dimensões** (altura/largura/comprimento): pré-preenchidas iguais à da base — empacotar N
  unidades numa caixa não é estritamente N× linear —, mas **editáveis**, porque dimensão errada
  cota frete errado pro comprador (ADR-0018).
- **Preço**: sugestão = unitário × N (com desconto opcional), editável.
- **Atacado**: vazio por padrão (não herda as faixas da base), editável.

**Derivados sem tela própria (fórmula fixa, sem julgamento humano):**
- `custo` do kit = `custo` unitário da base × N — alimenta markup/margem (ADR-0055), não pode
  nascer 0 nem em branco.
- `peso_gramas` do kit = peso unitário da base × N — alimenta frete (ADR-0018).

### 5. GTIN
Kit publica **sem GTIN** por padrão. Campo disponível pro operador preencher se tiver o código real
do kit; nunca herda o GTIN da base.

**Consequência aceita:** sem GTIN, o catálogo classifica todo kit como divergente
(`sem_produto`/`nao_elegivel`, ADR-0021), e o kit fica fora do alerta de no-match (Decisão 11). Em
categorias onde o ML **exige** vínculo de catálogo pra publicar, isso pode levar a uma pausa
silenciosa pelo próprio ML sem aviso nosso — risco aceito explicitamente, não coberto nesta v1.

### 6. Estoque 100% vinculado/virtual (decisão central)
O kit **não tem saldo próprio real**. O saldo é sempre `floor(estoque_base / N)`, recalculado ao
vivo. Vender **1 unidade de venda do kit** (quantidade do item do pedido × N) debita o ledger da
**família-base**, resolvida via `resolverOrigemEstoque` (Decisão 1) — nunca uma linha própria do
kit.

- **Baixa por venda**: o caminho de baixa (`baixa.ts`) passa a resolver `codigo` →
  `resolverOrigemEstoque` **antes** de chamar `baixar_estoque`, usando `codigoCanonico` da base e
  `quantidade_vendida × multiplicador` como delta. Sem essa resolução, `baixar_estoque` acha a
  linha do próprio kit (saldo 0) e aplica delta 0 em silêncio — a base nunca seria debitada.
- **Estorno de cancelamento**: reusa `motivo='venda'` no ledger (não cria motivo novo — um motivo
  novo quebraria `estornar_estoque`, que hoje só repõe `where motivo='venda'`). A auditoria de
  origem (rastrear que o débito veio de venda de kit, não de venda direta) é uma coluna nova e
  nullable no movimento (`origem_kit_codigo_pai` + `origem_kit_multiplicador`), não um motivo
  diferente — assim o estorno continua funcionando sem mudança de lógica.
- **Oversell dentro do mesmo canal — risco aceito, com alerta:** como o saldo é recalculado após
  a venda (não reservado antes dela), existe uma janela entre a venda acontecer no ML, o webhook
  chegar, a baixa acontecer e o novo saldo ser empurrado de volta — nessa janela, a base e um kit
  (ou dois kits) podem vender simultaneamente mais do que o saldo físico real permite. Aceito como
  risco operacional (janela curta); dispara um alerta (`vendaAcimaSaldo` ou equivalente) quando o
  saldo resultante da base ficar negativo antes do `greatest(0, …)`, pro operador resolver
  manualmente (ex.: cancelar um dos pedidos conflitantes). Nenhuma reserva/trava prévia é
  implementada nesta v1.

### 7. Push de estoque — sem exclusão nenhuma pra família com kit vinculado
O código atual (`alvos.ts`) pula o push pro **canal de origem inteiro** quando a baixa veio de
venda naquele canal (assumindo 1 produto = 1 anúncio por canal) — uma otimização que evita mandar
de volta pro ML o número que ele já sabe. Com kit, base e vários tamanhos de kit dividem o **mesmo
canal** (`mercado_livre`) em anúncios diferentes, então essa exclusão pularia todos eles, não só
o que vendeu.

**Decisão (revisada após o plano de execução — simplificação deliberada, não a exclusão fina
originalmente desenhada):** quando a família envolvida no evento tem `kit_multiplicador` (é kit) ou
tem kit vinculado ativo (é base), a exclusão por canal de origem **não se aplica** — o push
recalcula e reempurra o valor absoluto pra base + todos os tamanhos de kit vinculados, **sempre**,
sem tentar identificar e pular o anúncio que originou o evento. Como o push manda sempre o valor
**absoluto** (nunca um delta) e o cálculo é refeito do zero a cada vez, o resultado final é idêntico
a uma exclusão fina — a diferença é só 1-2 chamadas de API a mais por evento, contra o custo de uma
coluna nova no ledger e lógica extra só pra evitar essas chamadas. Escolhido pelo Diego
explicitamente por ser observacionalmente equivalente por uma fração do código. Cada evento (venda,
entrada, estorno, ajuste na base) pode gerar até 6 pushes (base + 5 tamanhos de kit), sempre
serializados pela fila existente por organização (`estoque-{orgId}`) — mais lento sob carga, sem
corrida nova.

### 8. Publicação (CREATE/UPDATE) usa o valor calculado, não a coluna crua
`variacoes.estoque` do kit nasce em 0 (guard de estoque inicial zero no INSERT, mesmo padrão do
ADR-0129). Os workers que montam o payload pro ML (`_shared/ml/atualizar.ts` e o CREATE
equivalente) hoje mandam `available_quantity: v.estoque` direto da coluna — para famílias com
`kit_multiplicador`, esse valor precisa vir de `resolverOrigemEstoque` + o cálculo `floor(base/N)`
no momento do CREATE/UPDATE, nunca da coluna crua. Sem essa correção, todo kit nasceria publicado
com "0 em estoque" no ML.

### 9. Escrita direta no SKU do kit é bloqueada no banco
`registrar_entrada`/`ajustar_estoque` (e o picker de SKU da tela Estoque) continuariam aceitando o
`codigo` do kit normalmente, criando um saldo real numa linha que o resto do sistema trata como
"sempre 0/irrelevante" — um segundo número dessincronizado, o mesmo risco do ADR-0129. Nova guard
(mesmo padrão de `guard_manual_product_direct_writes`): as RPCs de entrada/ajuste recusam LOUD
quando o `codigo` resolve pra uma família com `kit_multiplicador is not null`. Esconder na UI
(ADR-0047) não substitui essa trava — é só navegação.

### 10. Escopo v1: só produto sem variação de cor, e trava contra adicionar depois
Kit só é oferecido em famílias com **1 variação só** (sem cor) — multi-cor × multi-tamanho-de-kit
multiplicaria o número de famílias vinculadas por produto dentro de um mecanismo já invasivo.

**Trava simétrica (mesmo padrão do ADR-0129 D-8):** enquanto a base tiver pelo menos um kit
vinculado ativo (`kit_multiplicador` apontando pra ela, `familias.status` publicado/publicando),
adicionar uma variação/cor nova à base (UPDATE por planilha ou pela tela Estoque) é **recusado**.
O operador precisa remover os kits vinculados primeiro se quiser adicionar cor à base — evita
`estoque_base` virar ambíguo entre variações.

### 11. Vínculo automático é só de estoque
Editar título/descrição/preço/custo da base **depois** que kits já existem **não propaga**
automaticamente pros kits — cada um fica independente nesses campos a partir da criação. Propagar
edição sem checkpoint de revisão fura a regra inegociável "sempre há revisão humana antes de
publicar". Só o recálculo de estoque é automático, porque é determinístico.

### 12. Kit exige o módulo Estoque habilitado
O vínculo virtual só existe dentro do ledger do ADR-0094. Kit é uma **extensão do módulo pago
Estoque** — a ação de criar kit fica indisponível pra organização sem `'estoque'` em
`modulos_habilitados`.

### 13. `variacoes.estoque` do kit é excluído do "estoque canônico", nunca espelhado
`variacoes.estoque` do kit fica sempre em 0 (não é escrito por venda/entrada — Decisão 9) e é
**excluído explicitamente** de todo ponto que hoje trata essa coluna como saldo real:
- Tela Estoque (listagem geral) — kit não aparece como linha própria; aparece no contexto do
  produto-base ("3 kits de 2 disponíveis"), calculado on-the-fly.
- Job de reconciliação diária (`reconciliar-estoque`) — hoje só re-empurra produto com movimento
  próprio no ledger; kit nunca tem. Regra nova: reconciliar kit **junto** da reconciliação da base
  (toda vez que a base é reconciliada, recalcula e reempurra todos os tamanhos de kit vinculados
  dela também, independente de eles terem movimento próprio).
- Qualquer leitura futura de "estoque canônico" que apareça no código.

Rejeitada a alternativa de espelhar o valor calculado na própria coluna do kit: recriaria um
segundo número que pode dessincronizar da fonte de verdade — o mesmo risco do incidente do
ADR-0129.

### 14. Remover a base com kit vinculado ativo é bloqueado
Remover/despublicar a família-base do marketplace enquanto ela tem pelo menos um kit vinculado
ativo é **recusado** — o operador precisa remover ou pausar os kits vinculados primeiro. Evita kit
órfão vendendo contra uma base que não existe mais no sistema (venda de kit sem base pra debitar
quebraria a Decisão 6 inteira).

### 15. Reativação por reposição (ADR-0111) atravessa famílias
Um kit pausado manualmente pelo admin **reativa automaticamente** quando a base recebe reposição de
estoque e `floor(estoque_base/N)` volta a ser > 0 — mesmo o gesto de reposição tendo sido na base,
não no próprio kit. Aceito como consequência direta do vínculo (Decisão 6): impedir a reativação
faria o kit ficar pausado pra sempre mesmo com saldo virtual disponível. O job de fan-out de
reativação precisa herdar corretamente qual família (base ou kit) está sendo avaliada em cada
iteração.

### 16. Terminologia nova no glossário
"Kit" continua significando o atributo `SALE_FORMAT=Kit` (detectado por regex, sem vínculo,
ADR-0071/0073). Esta feature introduz **"Kit vinculado"**: família derivada de um produto existente
(`kit_base_codigo_pai`/`kit_multiplicador` preenchidos), publicada como `SALE_FORMAT=Kit`, com
estoque 100% calculado a partir da família-base. Não confundir com "Kits Virtuais" (Spike 036,
produtos diferentes, sem decisão de avançar).

## Consequências

- O trabalho real não é a UI de criação — é a extensão do módulo Estoque (ADR-0094) pra saldo
  derivado entre famílias: resolvedor único (`resolverOrigemEstoque`) usado em baixa, estorno,
  push, CREATE/UPDATE e reconciliação; exclusão do estoque canônico em todos os pontos de leitura;
  novas guards de escrita direta e de adicionar-cor-com-kit-vivo; e o fan-out de push sem exclusão
  de origem pra famílias com kit vinculado (base + todos os tamanhos, sempre).
- Kit fica restrito a organizações com o módulo Estoque habilitado e a produtos sem variação de
  cor — ambos escopos deliberadamente estreitos pra v1.
- Nenhum código de catálogo/concorrência tenta casar kit com ficha de catálogo (sem GTIN, por
  design); risco aceito de pausa silenciosa do ML em categorias que exigem catálogo.
- Push de estoque por evento passa de 1 pra até 6 chamadas (base + 5 tamanhos de kit) sempre que a
  família envolvida tem vínculo de kit, sempre serializado pela fila existente por organização —
  throughput menor sob carga alta, sem corrida nova. Simplificação deliberada (Decisão 7): sem
  exclusão por anúncio de origem, só um pouco mais de chamadas de API.
- Oversell intra-canal é um risco estrutural aceito nesta v1, mitigado só por alerta pós-fato —
  não por reserva/trava prévia.
- Remover a base ou adicionar cor a ela fica bloqueado enquanto houver kit vinculado ativo —
  muda o comportamento de duas ações que hoje são livres (Decisões 10 e 14).

## Como reverter

Nenhum código foi implementado ainda (ADR fecha o design, não a execução). Reverter = não
implementar, ou revisar esta decisão numa nova sessão de grilling antes do plano de execução.
