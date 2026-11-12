# Kit vinculado — evolução (design)

Data: 2026-11-12 · Origem: teste do Diego com kit de 6 (Hairfly, ampola 3 em 1).
Base de código: `src/components/kit/`, `src/lib/kit.ts`, `supabase/functions/criar-kit-vinculado/`. Reuso do kit com variação (ADR-0200/0203).

## Intenção
Kit vinculado (N unidades do mesmo produto-base, ADR-0151) hoje sai "pelado": só o título cita N, só a capa da base, sem saber quanto o vendedor recebe. Queremos paridade com o kit com variação e uma identidade visual única para a criação de kits.

## Escopo — 3 fatias (decidido pelo Diego)

### Fatia 1 — Texto, financeiro e visual (sem backend novo de publicação)
1. **Descrição cita a quantidade.** Em `descricaoDoKit` (`src/lib/kit.ts:112`): se o texto não cita N, abrir com "Kit com N unidades de <produto>." (padrão `citaN` de `copywriter-kit-prompt.ts:374`). Determinístico, sem IA. Editável no preview.
2. **"Você recebe por venda" + promoção + recálculo.** No `preview-kit.tsx`: reusar `DetalheRecebe`, `useTarifaML`, `calcularTarifaML`, `useAliquotas`, `aliquotaDoKit`, `calcularMarkup`. Preço com debounce 500 ms (padrão `SimuladorKit`); sem cotação do preço digitado → não mostra lucro. Prejuízo ou imposto fora da conta → exige confirmação ("Seguir mesmo assim"). Frete usa as **dimensões editadas do kit** e peso = base × N. Expor `origem` e `listingType` em `BaseParaKit` (`Publicados.tsx:185`, `familia-expanded.tsx:58`). Exportar `resumoDaTarifa` de `kit-variacao-simulacao.ts`.
3. **Promoção ativa/futura da base.** Reusar `lerPrecosAvulsos` (`preco-avulso-kit/processar.ts`) numa edge sem o gate `kit_variacao` (gate de `estoque`, como `criar-kit-vinculado`). UI: `PromocoesFuturas`/`CelulaAvulso`. ML oscila em seller-promotions → degradar para "indisponível" sem erro. Informativo: não replica promoção no kit.
4. **Visual.** Mesma linguagem do kit com variação (passos/etapas, cartões, tipografia), pensada como família única de "criação de kits". Direção de design via skill ui-ux-pro-max na etapa de plano.

### Fatia 2 — Fotos 2 a 7 do anúncio principal (decidido: reusar `picture_id` do ML)
- Ler `item.pictures` da base (`/items/bulk`, `ml_item_id` em `anuncios_externos_itens`), descartar a foto 1, pegar 2–7 (limite da categoria via `lerLimiteFotos`). Reusar `montarGaleriaKit`/`galeriaDasPecas` com uma única "peça".
- Alterar a **publicação comum** (`montarPayloadItem`/`publicar-familia-up`) para aceitar `pictures` extras no CREATE. Afeta todas as famílias → feature só ativa quando o kit traz galeria; demais caminhos byte-idênticos (teste de regressão).
- Persistir em `variacoes.galeria_ml_fotos` (já existe). Revalidar ids no ML antes do POST; 4xx de foto → zera galeria e cria só com a capa (saga do kit-variacao).
- **Anti-bug MLB7585283770:** variação do kit mantém `imagem_path`/`ml_picture_id` nulos; dedup por `picture_id`; capa nunca repetida na galeria.
- Contradiz ADR-0200 item 6 ("publicação comum não leva galeria") → **ADR novo antes de implementar.**
- Risco aberto: o CREATE real com galeria nunca foi medido (só PUT, 9/9). Primeiro CREATE real validado pelo Diego antes de dar como no ar.

### Fatia 3 — Capa por IA com N unidades
- Botão "Gerar capa com N unidades" no campo Foto: parte da capa existente da base e gera imagem com N cópias idênticas do produto (N=6 → 6 produtos).
- **Edge nova** (ex.: `gerar-foto-kit-unidades`, entrada `{familia_base_id, n}`). `gerar-foto-kit` não serve (exige 2–6 cores). Reusar `gerarImagem`, `resolverModeloImagem` (Nano Banana 2.1), `adequadaAoML`, `dimensoesImagem`, padrão `request_id` idempotente (até 3 tentativas), `FotoCombinacao`/`PreviaAmpliada` se o contrato `RespostaFotoKit` for mantido.
- Verificação por visão própria: conta N itens e rejeita texto/logo inventado (gerador acrescenta texto não pedido em ~3 de 7).
- Gate: módulo `imagem_ia` + admin; sem `kit_variacao`. Custo ~US$ 0,05–0,06/tentativa, registrado por tentativa (tabela/coluna a decidir no plano: migration nova vs relaxar `kit_variacao_imagens`).
- **Aprovação humana obrigatória** ("Usar esta foto"); upload manual continua disponível.
- ADR novo (ou adendo ao ADR-0151).

## Não-metas
Replicar promoção da base no kit; mudar kit com variação; IA na descrição; mais de 7 fotos; cobrança ao cliente pela imagem (decisão comercial separada).

## Anti-metas (falha mesmo funcionando)
Foto repetida na galeria; imagem de IA publicada sem aprovação; lucro exibido com preço desatualizado ou imposto presumido; regressão na publicação comum de qualquer família.

## Restrições
ADR antes de código nas Fatias 2 e 3. Edge nova → deploy CLI + conferir versão. Migration só via `supabase migration new` + `db push`. RLS por org. Dropdown = `ui/select`. Teste obrigatório por feature (não só mock). Validação visual com print real no fim de cada fatia. Nada vai ao ML sem revisão humana.

## Decisões do builder (marcadas como minhas, revisáveis)
- Descrição determinística, não IA (mais barato, sem custo novo).
- Fatia 1 primeiro porque não toca a publicação comum.
- Promoção via edge separada em vez de relaxar o gate de `preco-avulso-kit`.
