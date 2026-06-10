# Spec — Importar só a planilha (reposição de estoque) + foto por cor nova

**Data:** 2026-06-10
**Status:** Aprovado (brainstorming) — pronto para o plano de implementação
**Relacionado:** ADR-0005 (lifecycle CREATE/UPDATE), ADR-0016 (UPDATE = reposição de estoque), ADR-0004 (resolução de cor), ADR-0013 (edge cases da planilha)

---

## 1. Problema

Hoje, para repor estoque de anúncios já publicados, o operador é obrigado a:

1. **Subir imagens junto com a planilha** — a tela "Novo lote" bloqueia o processamento enquanto não há ao menos uma imagem (`podeProcessar = planilha.length === 1 && imagens.length > 0`). Numa reposição pura de estoque, isso força re-subir fotos que o Mercado Livre já tem.
2. **Descobrir sozinho quais cores são novas** — quando a planilha traz uma cor que ainda não existe no anúncio, ela entra desmarcada (`excluida_da_publicacao`) e sem foto, mas não há um pedido claro nem um meio fácil de subir a foto **daquela cor específica** (só existe upload de foto-capa por família).

O operador quer: **importar só a planilha para atualizar estoque**, e — só quando vierem cores novas — **subir apenas as fotos dessas cores novas**.

## 2. Achado central (o que já existe)

A lógica de negócio já está implementada; a feature é **destravar e expor** no frontend.

- **Detecção CREATE vs UPDATE automática** (`ingest-lote`): para cada família, compara o `codigo_pai` da planilha com as famílias já publicadas (`ml_item_id != null`). Se bate → `operacao = 'UPDATE'`, herda título/descrição/fotos/preço/atributos/análise; só o estoque entra novo. Não roda IA nem busca de concorrência (ADR-0016).
- **Cor nova no UPDATE** entra `excluida_da_publicacao: true` (desmarcada, opt-in) e `status: 'pendente'` para o `process-familia` resolver a cor (ADR-0004). As cores antigas, sem cor nova, viram `status: 'pronto'` direto e o lote vai para `revisao` sem IA.
- **Validação já exige foto** (`src/lib/publicavel.ts`): `familiaPublicavel` e `criticasVariacao` exigem cor + foto + preço para qualquer cor nova que vire variação plena no ML.
- **Upload de foto por cor já funciona no backend** (`upload-imagens-lote` → `processarArquivo`): um arquivo nomeado `00CODIGO.jpeg` é classificado como `variacao`, casado por `variacoes.codigo` dentro do lote, e grava `variacoes.imagem_path`. A cor nova já existe como variação (inserida no ingest), então há o que casar.
- **`useUploadLote` já tolera zero imagens**: com `imagens.length === 0` o loop de upload não roda e grava `imagens_paths: []`. O `ingest-lote` lida com `imagens_paths` vazio (os matchers retornam null).

**Conclusão:** nenhuma mudança de backend, schema, edge function ou migration. Mudança é só de frontend.

## 3. Escopo

### 3.1 Import só-planilha (`src/pages/NovoLote.tsx`)

- `podeProcessar` passa a exigir **apenas a planilha**: `planilha.length === 1`. As imagens viram opcionais.
- Texto da tela reescrito para deixar claro:
  - reposição de estoque pode subir **só a planilha**;
  - lotes novos / cores novas precisam de fotos, completáveis na Revisão.
- `useUploadLote` e `ingest-lote`: **sem alteração** (já lidam com lista de imagens vazia).

### 3.2 Foto por cor na Revisão

- **Helper novo** `subirFotoVariacao(loteId: string, codigo: string, arquivo: File): Promise<void>` em `src/lib/upload-imagens.ts`:
  - renomeia o arquivo para `{codigo.padStart(8, '0')}.{ext}`;
  - chama o `uploadImagensLote` existente;
  - valida sucesso por `ok === 1 || ja_tinha === 1` (a variação já existe no lote); em `sem_match`, erro claro ("cor não encontrada no lote").
  - Espelha o padrão de `subirCapaFamilia`/`subirCapa2Familia`.
- **UI por cor**: na linha/expandido da cor (`src/components/familia-expanded.tsx` / `variacao-card.tsx`), quando a variação **precisa de foto** — usando a regra que `criticasVariacao` já calcula (cor nova de UPDATE incluída sem foto, ou CREATE sem foto) — exibir um botão **"Subir foto"** por cor.
  - Após o upload, refetch das famílias do lote → o alerta "sem foto" some e a cor fica publicável.
- **Validação**: `familiaPublicavel` / `criticasVariacao` permanecem **inalteradas** (já exigem foto).

### 3.3 Sinalização

- Resumo no topo da Revisão: **"N cores novas precisam de foto"**, derivado das variações já carregadas (variações incluídas, novas no ML — `!mlVariationId` — e sem `fotoPath`). Função pura testável.
- A aba "Incompletas" e o selo da linha já existem e continuam funcionando.

## 4. Fluxos resultantes

1. **Reposição pura de estoque:** sobe só a planilha → famílias UPDATE viram `pronto` → lote vai a `revisao` → operador publica. Nenhuma foto envolvida.
2. **Reposição com cor nova:** sobe só a planilha → cor nova entra desmarcada e sem foto → Revisão destaca "precisa de foto" → operador sobe a foto **só daquela cor**, inclui, publica. As cores antigas (apenas estoque) publicam independentemente.
3. **Lote CREATE genuinamente novo sem fotos:** aparece como *incompleta* na Revisão (recuperável: completar por cor, ou refazer o import com a pasta de imagens). Não bloqueia o restante do lote.

## 5. Tradeoff aceito

Com imagens opcionais, é possível esquecer as fotos num lote genuinamente novo. Mitigação: a aba "Incompletas", o selo da linha e o resumo "N cores precisam de foto" tornam isso visível, e é recuperável a qualquer momento. O ganho de simplicidade (uma única tela de import) compensa.

## 6. Fora de escopo (YAGNI)

- Tela/modo separado "Atualizar estoque" (decidido: tela única com imagens opcionais).
- Etapa intermediária de análise/seleção de fotos durante o upload (decidido: resolver na Revisão).
- Detectar cor nova no momento do upload — a detecção continua no `ingest-lote`, como hoje.
- Qualquer mudança de backend, schema, edge function ou migration.

## 7. Testes (TDD onde agrega)

- `subirFotoVariacao`: renomeação correta do arquivo (`00CODIGO.ext`) e tratamento das respostas (`ok`, `ja_tinha`, `sem_match`).
- Função pura de contagem "cores novas precisam de foto" a partir da lista de famílias.
- Guarda do `podeProcessar`: planilha sozinha habilita o processamento; sem planilha, não.

UI puramente cosmética não é testada (convenção do projeto).
