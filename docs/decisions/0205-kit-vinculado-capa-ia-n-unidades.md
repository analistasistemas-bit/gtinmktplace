# ADR-0205 — Kit vinculado: capa por IA com N unidades

Status: PROPOSTO (2026-11-12) · Relaciona: ADR-0151 (kit vinculado), ADR-0200 (Adendo 1: `gerar-foto-kit`), ADR-0203 (texto não pedido no gerador), ADR-0204 (galeria da base)

## Contexto
O kit vinculado de N unidades sai com a capa de UMA unidade (a da base). O Diego quer um botão "Gerar capa com N unidades" que parta da capa existente e gere uma imagem com N cópias idênticas do produto (kit de 6 → 6 produtos).
O `gerar-foto-kit` (kit com variação) exige 2 a 6 cores distintas e uma ficha de roupa por cor: não serve. O que serve é a infraestrutura em volta: `gerarImagem`, `resolverModeloImagem` (padrão `google/gemini-nano-banana-2.1`), `adequadaAoML`, `dimensoesImagem`, visão (`visaoJson`), a máquina de estados com `request_id` idempotente e a cobrança por imagem aprovada (`kit_variacao_imagens` → trigger → `platform_image_deliveries`).
Medições existentes: ~US$ 0,05–0,06 por tentativa; o gerador acrescenta texto não pedido em ~3 de 7 imagens (ADR-0203). **Não há medição de N cópias idênticas.**

## Decisão
1. **Edge nova `gerar-capa-kit-unidades`** (o `gerar-foto-kit` não muda). Entrada `{ request_id, familia_base_id, n }`, `n` inteiro 2..6 (os `TAMANHOS_KIT`). A foto de origem é lida NO SERVIDOR da capa da base (`familias.capa_storage_path`, da org), nunca de path enviado pelo cliente.
2. **Gate:** admin (ou suporte `full`) + módulo `imagem_ia`. Sem `kit_variacao` (o kit vinculado usa `estoque`, mas a edge não cria kit).
3. **Pedido:** foto da base como âncora + instrução de "exatamente N unidades do MESMO produto, idênticas, mesma escala, em linha/grade simples, fundo neutro claro, sem texto/logo/marca d'água novos, sem itens extras", em 1:1 (`adequadaAoML`). Sem ficha por cor.
4. **Verificação por visão, fail-closed:** o inspetor conta os produtos (`quantidade_produtos === n`), checa `texto_visivel` novo/alterado e fundo neutro; reprova → próxima tentativa recebe os `motivos` (até 3 por `request_id`). Exige exportar `visaoJson` de `foto-kit-fiel.ts`.
5. **Persistência:** reusa `kit_variacao_imagens` por migration: `cores` e `rotulo` passam a aceitar NULL, nova coluna `n smallint`, check `(cores is not null) or (n is not null)`; o trigger de cobrança e os índices não mudam. `pedido_diferente` compara `n`. A foto aprovada fica em `${orgId}/kit-variacao-ia/${requestId}.${ext}` (mesmo bucket e prefixo da org).
6. **UI:** botão no campo Foto do preview, só para kits de 2..6 e base com capa; uma geração por tamanho marcado (`request_id` próprio); a imagem candidata fica separada de `imagemPath` até o operador clicar **"Usar esta foto"** (aprovação humana obrigatória); "Gerar de novo" até 3 tentativas; upload manual continua. Ao aprovar, `imagemPath = path` e `fotoFile = null` (sem upload no dialog).
7. **Custo:** sem preço novo — vale o `image_unit_cents` já existente, cobrado só por imagem aprovada (`units` 0 sem módulo). Reprovadas ficam por conta da plataforma. **Não há quota por org**: mitigação = botão travado durante a geração, no máximo 3 tentativas por `request_id`, e uma linha de custo por tentativa.

## Não-decisões / riscos
- **Qualidade de N cópias nunca medida.** Primeira rodada real (N=2,3,6, com e sem rótulo no produto) validada pelo Diego depois do deploy; a verificação fail-closed e a aprovação humana são a rede. Produto com rótulo/embalagem tem risco alto de texto trocado (ADR-0203).
- N > 6 fora de escopo (sem evidência; contagem por visão tende a falhar).
- Timeout de 145 s do edge como no `gerar-foto-kit` (uma tentativa por chamada, repetição do mesmo `request_id` devolve o estado).
- Segurança: `criar-kit-vinculado` aceita `imagemPath` do cliente sem checar a org (o `criar-kit-variacao` checa com `fotoDaOrg`). Verificar a convenção de prefixo do storage e, se uniforme, aplicar a mesma checagem.
- Migration só via `supabase migration new` + `db push` (ADR-0043); mexe em tabela ligada a cobrança: não rebaixar modelo na implementação.
