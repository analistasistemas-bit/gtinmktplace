# Kit Virtual: capa por IA, galeria intercalada e texto por IA — design

Data: 2026-11-15 · Status: aprovado pelo Diego (caminho A) · ADR a escrever antes do código: **ADR-0206** (emenda ao ADR-0154 D-4/D-5)
Relaciona: ADR-0154 (kits virtuais), ADR-0205 (capa IA N unidades do vinculado), ADR-0204 (galeria da base), ADR-0200 adendo 12/11 (galeria das peças), ADR-0203 (texto não pedido no gerador).

## 1. Intenção
O Criar Kit Virtual hoje exige foto manual e publica só a capa. O Diego quer o mesmo nível do kit vinculado: capa gerada por IA juntando os produtos do kit, fotos 2–7 alternando entre as fotos de cada produto, e a tela em etapas com o mesmo visual premium do vinculado. Na etapa 2, título e descrição já chegam gerados pela IA, com opção de regerar.

## 2. Objetivos
1. **Capa IA** a partir da **foto unitária de cada componente** (foto 1 do anúncio do componente no ML).
   - Soma das quantidades ≤ 6 → a imagem mostra **todas as unidades** (2 shampoos + 1 máscara = 3 itens).
   - Soma > 6 → **uma unidade de cada produto**.
   - Verificação por visão conta cada produto (fail-closed); aprovação humana obrigatória ("Usar esta foto"); upload manual continua.
2. **Galeria** fotos 2–7: intercaladas entre os componentes (foto k = imagem k+2 do componente k mod n, pulando a capa de cada um; componente sem a imagem pula a vez — mesma regra do kit com variação). Operador pode remover fotos.
3. **Texto IA automático**: ao entrar na etapa 2, título e descrição gerados numa chamada; botão **"Regerar"** (título+descrição); edição manual não é sobrescrita por recálculo de desconto.
4. **Tela**: `EtapasKit` com 2 etapas — **1. Composição** (busca + composição, como hoje, sem foto) → **2. Anúncio** (capa, galeria, título, descrição, desconto/preço/margem). Visual igual ao `dialog-criar-kit.tsx`.

## 3. Não-objetivos
- Mudar o kit vinculado ou o kit com variação (`gerar-capa-kit-unidades`, `gerar-foto-kit`, `fotos-pecas-kit` ficam intactos).
- Editar fotos de kit virtual já publicado (Refazer continua como hoje; galeria só no CREATE).
- Capa IA com mais de 6 itens na imagem.

## 4. Anti-objetivos (falha mesmo funcionando)
- Capa IA indo ao anúncio sem o operador clicar "Usar esta foto".
- Imagem com produto inventado, texto/rótulo trocado ou contagem errada passando pela visão.
- Qualquer regressão no kit vinculado (edge cobrada e no ar).
- Gasto de IA sem teto.

## 5. Restrições
- Caminho **crítico**: migration em tabela ligada a cobrança + publicação no ML → revisão independente (Opus/Codex) obrigatória; nunca rebaixar modelo.
- Migration só por `supabase migration new` + `db push` (ADR-0043); conferir timestamp contra a main antes do merge.
- Foto de origem lida **no servidor** a partir dos itens da composição (nunca URL/path do cliente); item moderado/fechado não serve de fonte.
- Gate: admin (ou suporte `full`) + módulo `imagem_ia` para a capa. Sem o módulo, a etapa 2 mostra só o upload manual.
- `thumbnail` exige `secure_url` (ADR-0154); a capa aprovada sobe ao ML no momento da aprovação (propagação assíncrona, ADR-0033), pelo caminho já existente `subir-foto-kit-virtual`.
- Mensagens ao operador em pt-BR.

## 6. Abordagens consideradas
| | Abordagem | Trade-off | Decisão |
|---|---|---|---|
| **A** | Edge nova `gerar-capa-kit-virtual` copiando a máquina de estados de `gerar-capa-kit-unidades`; prompt/verificação novos para composição; galeria reaproveitando `galeriaDasPecas`; texto IA em `preview-kit-virtual` | Duplica código, mas não toca edge cobrada no ar | **Escolhida pelo Diego** |
| B | Generalizar `gerar-capa-kit-unidades` para composição | Uma edge só; risco de regressão no vinculado | Rejeitada |
| C | Usar `gerar-foto-kit` | Específica de roupa (ficha por cor) | Descartada |

## 7. Decisões do Diego
- Caminho A.
- Capa: todas as unidades até 6 no total; acima disso, uma de cada. Origem = foto dos produtos unitários (componentes).
- Etapa 2 já abre com título e descrição gerados por IA, com "Regerar".
- Cobrança e teto: **iguais ao vinculado** (proposta aceita junto com o caminho A): `image_unit_cents` da org cobrado em `status='gerada'`; 6 tentativas por (org, composição) a cada 24 h, atômico na reserva.

## 8. Design
### 8.1 Capa IA (`gerar-capa-kit-virtual`)
- Entrada `{ request_id, componentes: [{ user_product_id, quantidade }] }` (2..6 componentes, qtd 1..10). O servidor resolve cada `user_product_id` → item da org (`anuncios_externos_itens`/busca já usada por `buscar-componentes-kit-virtual`) e baixa a foto 1 do item no ML (reusar `baixarFotoMl` de `gerar-capa-kit-unidades/capa-ml.ts`).
- Modo: `todas` (Σqtd ≤ 6) ou `uma_de_cada`. Pedido à IA: N imagens âncora (uma por componente) + "exatamente q_i unidades do produto i, idênticas à referência, mesma escala, fundo neutro claro, sem texto/logo novos, sem itens extras", 1:1 (`adequadaAoML`).
- Visão: conta por produto (`contagem[i] === q_i`), texto novo/alterado, fundo; reprova → próxima tentativa recebe os motivos (até 3 por `request_id`, `MAX_TENTATIVAS`).
- Persistência em `kit_variacao_imagens` (migration): `familia_base_id` passa a aceitar NULL; coluna nova `composicao text` (chave canônica: `user_product_id:qtd` ordenados, separados por `|`); check estrito: linha é de cores, de unidades ou de composição (exatamente um). Trigger de cobrança não muda. RPC nova `kit_capa_virtual_reservar` (mesmo desenho da `kit_capa_unidades_reservar`: advisory lock sobre (org, composição), teto 6/24 h, só service_role). Índice parcial para o teto.
- Saída igual à do vinculado (`path`, `url`, `aprovado`, `motivos`, `proxima`, `previa_url`), caminho `${orgId}/kit-virtual-ia/${requestId}.${ext}`.
- Aprovação no front ("Usar esta foto") → `fotoStoragePath = path` → efeito existente sobe ao ML (`subir-foto-kit-virtual`), que deve aceitar o prefixo novo (checar `fotoDaOrg`).

### 8.2 Galeria
- Edge leitura `fotos-componentes-kit-virtual` (ou ação na `preview-kit-virtual`; escolha do builder): usa `galeriaDasPecas` com `PecaOrigem { cor: <rótulo do componente>, itemId }` e `lerLimiteFotos(categoria do principal)`; limite total = min(7, limite da categoria) incluindo a capa.
- Front: grade de miniaturas com remover (padrão `galeria-pecas.tsx`/`galeria-base-kit.tsx`).
- `kits_virtuais` ganha `galeria_ml_fotos jsonb` (`[{id,item}]`, mesma forma de `variacoes.galeria_ml_fotos`); `criar-kit-virtual` revalida (`revalidarGaleria`) e envia.
- **Gate de medição (tarefa 1 do plano):** confirmar que o ML aceita galeria em Kit Virtual — (a) `pictures` no `POST /items/kits`, ou (b) `PUT /items/{kit} {pictures}` logo após o CREATE. Medir num kit real já publicado **só com OK explícito do Diego** e com snapshot para desfazer. Se nenhum funcionar: galeria sai do escopo, registra no ADR, entrega só capa + texto.
- Recusa definitiva de foto da galeria → zera a galeria e publica só com a capa (sem 2º POST), como no vinculado.

### 8.3 Texto IA
- `preview-kit-virtual`: entrar na etapa 2 dispara `gerar_texto: true` uma vez (título + descrição); recálculo de desconto continua com `gerar_texto: false` e nunca sobrescreve texto.
- Título por IA: começa com "Kit", cita os componentes/quantidades, ≤ 60 caracteres (o ML não expande `family_name`); inválido → cai no template atual, com aviso discreto. Descrição: esteira atual (`gerarCopy` + `posProcessarDescricao`).
- "Regerar" substitui título e descrição (confirmação se o operador editou à mão).

### 8.4 Tela (skill ui-ux-pro-max na implementação)
```
Criar Kit Virtual                         (1. Composição) (2. Anúncio)
2. Anúncio
 ┌ Capa ───────────────┐ ┌ Galeria (6) ─────────────────────┐
 │ [prévia 1:1]         │ │ P1·f2  P2·f2  P1·f3  P2·f3 … ✕   │
 │ ✨ Gerar capa do kit │ └──────────────────────────────────┘
 │ ou enviar foto       │
 └──────────────────────┘
 Título     [Kit Shampoo + Máscara Tanox Sete Óleos   ] ↻ Regerar
 Descrição  [ … gerada por IA …                         ]
 Desconto · preço estimado · margem              [Voltar] [Publicar kit]
```
Reusar `EtapasKit`, `PreviaCapaUnidades` (ou equivalente), estados `gerando/candidata/reprovada/erro` do `useCapasUnidades`.

### 8.4.1 "Você recebe vendendo avulso" (pedido do Diego, 15/11)
- Na etapa 2, card por componente: **quanto você recebe vendendo 1 unidade sozinha**, no preço atual dele no ML: preço − comissão − frete − imposto (origem) → recebe; − custo → lucro e margem %.
- Reuso, sem fórmula nova: `calcularTarifaML` (tarifa oficial: categoria do componente, preço dele, listing type dele, medidas/peso de `variacoes`) + `simularRecebe` (`src/lib/kit-recebe.ts`) + `DetalheRecebe` (mesmo visual do card do vinculado). Alíquota por `useAliquotas` + origem do componente.
- Estados honestos (ADR-0107): sem custo → mostra recebe e "custo não cadastrado" (sem lucro); tarifa não oficial/indisponível → "indisponível", nunca número inventado; sem medidas → frete indisponível.
- Linha de comparação: **Σ (recebe avulso × qtd)** vs **líquido do kit** (já calculado no preview). Assim o operador vê se o desconto do kit come mais do que a economia de frete. Limitação conhecida: o líquido do kit usa frete 0 (ADR-0154, estimativa) — a linha avisa isso.
- Só leitura, sem IA, sem custo; não depende do módulo `imagem_ia`. Entra na **F1**.

## 8.5 Decisões do autor (calls do Claude, conferir)
1. **Fatias:** F1 = tela em etapas + capa IA + texto IA (migration da capa). F2 = galeria, só depois do gate de medição; `kits_virtuais.galeria_ml_fotos` entra na migration da F2. Preferência no gate: (a) `pictures` no POST; (b) PUT pós-CREATE só se (a) falhar.
2. **Chave do teto** = conjunto de `user_product_id` ordenados, **sem quantidades** (trocar 2x→3x não zera o teto).
3. **Foto de origem** = foto 1 do `itemId` que o candidato já traz da busca (`buscar-componentes-kit-virtual`); o servidor confere que o item é da org e pertence ao `user_product_id`. Item inelegível (fechado/moderado/sem foto) → 409 com o nome do componente; a UI mostra o motivo e mantém o upload manual. Foto 1 promocional/de kit é risco aceito: a visão reprova e o operador sobe a foto à mão.
4. **Mudar a composição** depois de gerar: zera capa candidata/aprovada, galeria e texto (não batem mais com o kit). Tentativas gastas ficam no teto da composição antiga. Sem limpeza de storage (mesmo comportamento do vinculado). Nada vai ao kit no ML antes de "Publicar kit", então não há `picture_id` órfão vinculado.
5. **Texto IA:** gera ao entrar na etapa 2 só se a composição mudou desde a última geração; "Regerar" sem teto próprio (custo de texto é ordens de grandeza menor que imagem; consumo registrado como hoje). Validação do título só estrutural: começa com "Kit", ≤ 60 caracteres, não vazio; falhou → template atual. Conteúdo inventado é coberto pela revisão humana da etapa 2.
6. Galeria **não** depende do módulo `imagem_ia` (não usa IA).

## 9. Deixado ao builder
- Nome/forma da edge de galeria; reuso por import vs cópia de `capa-ml.ts`; layout fino da etapa 2; textos de UI; testes (TDD obrigatório, inclusive teste SQL da RPC em transação desfeita).

## 10. Riscos
- Qualidade da composição de produtos distintos nunca medida (rótulos trocados — ADR-0203). Medir 1ª rodada real (2, 3 e 6 itens) com o Diego e registrar no ADR-0206.
- Galeria pode ser impossível na API de kits (gate 8.2).
