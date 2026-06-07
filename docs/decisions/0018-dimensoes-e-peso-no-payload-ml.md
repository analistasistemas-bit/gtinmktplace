# ADR-0018 — Dimensões e peso reais no payload do ML (frete correto)

**Status:** Aceito — 2026-06-07
**Relacionado:** ADR-0009 (campos do payload), ADR-0016 (publicação UPDATE), ADR-0005 (lifecycle)

## Contexto

O Mercado Livre **modera** anúncios cujo frete fica desproporcional ao preço — mensagem ao vendedor: *"revise seu anúncio e certifique-se de não incluir outros tipos de serviço no valor do custo de frete"* → status `under_review` / `waiting_for_patch` (anúncio inativo). No ME2, o custo de frete é calculado pelo ML a partir das **dimensões e peso da embalagem**.

Diagnóstico (anúncio real MLB6914358210, 2026-06-07): o PubliAI **não envia** dimensões/peso no payload (`montarPayloadItem` só manda título, categoria, preço, fotos, atributos da categoria e variações). Sem dimensões válidas, o ML **estima** um pacote grande (ex.: 39×17×9 cm ≈ 1 kg volumétrico) → frete > produto (R$ 11,90) → moderação.

A planilha do sistema interno trazia dimensões **placeholder fixas** (todas as 650 variações = `0,10 × 0,10 × 0,10 cm`, `100 g`) — lixo, não dado real. **Decisão do Diego (2026-06-07): a planilha passará a exportar dimensões e peso reais por produto.** Isso elimina a necessidade de defaults por tipo ou edição manual: o app só precisa **repassar ao ML** o que a planilha já traz (o `ingest-lote` já lê e persiste `peso_gramas / altura_cm / largura_cm / comprimento_cm` por variação).

## Decisão

1. **Atributos.** Enviar os atributos **`SELLER_PACKAGE_HEIGHT` / `SELLER_PACKAGE_WIDTH` / `SELLER_PACKAGE_LENGTH`** (unidade fixa `cm`) e **`SELLER_PACKAGE_WEIGHT`** (unidade fixa `g`) no item. São `number_unit` writable (tag `hidden`); validados via `GET /categories/{id}/attributes` (2026-06-07). Os `PACKAGE_*` sem prefixo são `read_only` (o ML os calcula) — **não** enviar.

2. **Origem.** Dimensões da **variação representativa** = a variação principal (já ordenada primeiro na publicação); cores de uma mesma família compartilham o tamanho do produto. Sem variação principal, usa a 1ª.

3. **Guarda `dimensoesValidas`.** Só envia se **plausível**: altura, largura e comprimento **≥ 1 cm** e peso **≥ 1 g**. Isso descarta o placeholder `0,1 cm` e **protege contra a planilha antiga** (se subir antes da nova, omite e nada piora — o ML estima, como hoje). Dado inválido → **não bloqueia**: publica sem o atributo (ML estima) e a Revisão **sinaliza** "frete estimado pelo ML".

4. **CREATE e UPDATE.** Ambos enviam os atributos de pacote (decisão do Diego):
   - **CREATE** (`publish-familia-ml` → `montarPayloadItem`): mescla os `SELLER_PACKAGE_*` em `attributes` do item.
   - **UPDATE** (`update-familia-ml`): inclui os `SELLER_PACKAGE_*` no `atributosItem` já reenviado (hoje só BRAND). **Adendo ao ADR-0016**: o UPDATE passa a sincronizar também dimensões/peso (além de estoque e BRAND), permitindo corrigir o frete de um anúncio já publicado ao subir a planilha corrigida.

5. **Formato.** `{ id: 'SELLER_PACKAGE_HEIGHT', value_name: '18 cm' }` etc. (number_unit aceita `value_name` "{n} cm"/"{n} g"; números formatados sem zeros decimais supérfluos). Validar com token real (`POST /items/validate` e/ou publicação) antes de fechar.

## Consequências

- Frete proporcional ao produto → evita a moderação `waiting_for_patch` por "serviço no frete".
- **Depende** da planilha nova trazer dados reais; até lá, a guarda omite os atributos (sem regressão — comportamento atual preservado).
- UI: aviso/selo "frete estimado pelo ML" na Revisão quando a família não tem dimensões válidas.
- Função pura `montarAtributosPacote` + `dimensoesValidas` (TDD), reusada por CREATE e UPDATE.

## Alternativas consideradas

- **Default por tipo de aviamento** (linha/fita/botão): descartado — a planilha real torna desnecessário; defaults seriam chutes imprecisos para cones/rolos de tamanhos variados.
- **Bloquear publicação sem dimensão**: descartado — trava o fluxo se a planilha vier furada; preferimos publicar + avisar (decisão do Diego).
- **`shipping.dimensions` ("HxWxL,peso")**: o caminho atual do ML é por atributos `SELLER_PACKAGE_*`; mantido por ser o que a API expõe como writable na categoria.
