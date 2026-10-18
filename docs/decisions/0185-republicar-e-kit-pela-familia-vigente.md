# ADR-0185 — Republicar e Criar kit agem na família vigente; preparação da republicação é atômica

- **Status:** aceito (em produção desde 2026-10-18, main `2a26c2a7`)
- **Data:** 2026-10-18
- **Emenda:** [ADR-0168](0168-remover-publicado-encerra-ml-sem-venda.md) (modo republicar do `remover-publicado`)
- **Relaciona:** ADR-0016 (UPDATE com reposição), ADR-0019 (exclusão preserva publicados), ADR-0048 (split),
  ADR-0088 (UP), ADR-0151 (kit vinculado), ADR-0060 emenda 2026-10-18

## Contexto

Depois de ciclos de UPDATE, o mesmo `codigo_pai` tem **várias** linhas em `familias` (uma por lote), todas
com o mesmo `ml_item_id`. A tela Publicados mostra 1 linha por anúncio e usa como representante a família
**mais antiga** (publicação original — `dedupePublicados`). Duas ações herdavam esse id:

1. **Corrigir e republicar** zerava o vínculo só da família mais antiga. As mais novas mantinham
   `ml_item_id`: a linha continuava na tela apontando para um anúncio pausado, o próximo `ingest-lote`
   (casa por `codigo_pai` + `ml_item_id not null`, `publicado_em desc`) virava UPDATE no anúncio morto, e o
   operador caía na Revisão do lote mais antigo, com dados velhos. As gravações eram separadas (família,
   variações, `anuncios_externos`, lote): trocar a família preservada sem transação deixaria, numa falha
   no meio, duas famílias `pronto/CREATE` do mesmo pai → anúncio duplicado.
2. **Criar kit** (ADR-0151) copiava custo/peso/fotos da família mais antiga — custo defasado × N.

Fatos medidos no código (2026-10-18):
- O snapshot de UPDATE criado pelo `ingest-lote` **herda `ml_item_id`** mas **não** `publicado_em`;
  os workers só gravam `publicado_em` ao publicar. `publicado_em not null` = publicada de fato (mesmo
  critério de `particionarExclusao`, ADR-0019).
- `excluir-lote` apaga famílias com `publicado_em` nulo → um snapshot pendente é removível pelo operador.

## Decisão

### D-1. Família vigente
Duas noções, cada uma para o seu uso:
- **Para republicar (D-2):** a família **mais nova por `criado_em`** entre as do `codigo_pai` (na org) com
  `ml_item_id` — mesmo critério de `migrar-preco-por-variacao`. Inclui o snapshot de UPDATE ainda não
  publicado e o CREATE de split parcial (grava `ml_item_id` antes de `publicado_em`): a cópia mais nova
  traz os dados mais novos e é a que volta para a Revisão.
- **Para copiar dados publicados (D-3):** a família com `publicado_em` mais recente (não nulo).

### D-2. Republicar prepara o produto numa transação (RPC `preparar_republicacao`)
Depois de pausar no ML (inalterado: filhos UP + todas as partições), a edge chama uma RPC plpgsql que,
numa única transação, com `for update` nas famílias e nas raízes `anuncios_externos` do pai:
- escolhe a vigente (D-1, republicar). Sem nenhuma família com `ml_item_id`: se ainda há raiz em
  `anuncios_externos` (UP com saga interrompida) preserva a família pedida; senão recusa
  `nao_publicada` — é o que torna a 2ª chamada (concorrente ou repetida) inofensiva: a 1ª apagou as
  raízes e zerou os vínculos, então a 2ª nunca cria outro `CREATE`;
- recusa `em_processamento` se a vigente estiver `pendente`/`processando`/`publicando` (transitório: o
  operador espera e repete);
- **incorpora** à vigente cada SKU que só existe numa cópia anterior (UPDATE parcial: o `ingest-lote` não
  clona os ausentes) — move a linha mais nova de cada SKU (`familia_id`), com preço/estoque/foto;
- **apaga** as demais famílias do pai com `ml_item_id` (cópias de lotes anteriores e snapshots
  obsoletos) — mesmo corte que o Remover já faz ("Codex P2": várias linhas publicadas do mesmo pai). Mantê-las
  `publicado` sem vínculo criaria zumbis que os guards de kit (`STATUS_KIT_VIVO` e os triggers de
  `kit_vinculado_guards`) contam como vivos. O ledger de estoque é por SKU (`codigo`) e a vigente
  mantém os SKUs; o trigger de base com kit só bloqueia a ÚLTIMA linha do pai; Kit Virtual publicado já
  é recusado antes (ADR-0154 D-13). Storage não é tocado (arquivos podem ser compartilhados);
- na vigente: zera `ml_item_id`, `ml_permalink`, `publicado_em`, `capa*_ml_picture_id`; nas variações dela,
  `ml_variation_id`, `preco_publicado_ml`, `ml_picture_id`; `operacao='CREATE'`; status `pronto`
  (`erro` continua `erro`, com a mensagem, para o operador reprocessar);
- apaga `anuncios_externos` do pai no canal; o lote da vigente vai para `revisao`;
- devolve `familia_id`/`lote_id` da vigente e os lotes das famílias apagadas (a edge reconta/remove
  lote vazio com `recontarOuRemoverLote`, como no Remover).

`recontarOuRemoverLote` (`_shared/lote/recontar.ts`) passou a lançar em erro de leitura — antes um erro
virava "lote vazio" e apagava o lote com as famílias restantes (afetava também `excluir-lote`,
`excluir-produto` e o Remover). A edge recusa `em_processamento` antes de pausar no ML, olhando a cópia
vigente ou, no UP interrompido, a família pedida.

Falha antes do commit não deixa nada pela metade; a pausa no ML é idempotente (GET pula item pausado).

**Risco residual aceito:** um `ingest-lote` que leu o anterior antes do commit e insere depois cria um
snapshot UPDATE com o `ml_item_id` antigo (agora pausado). Mesma classe "sem lock entre funções" já
aceita no ADR-0088; a janela é a de uma requisição de ingest, e o snapshot aparece na Revisão.

### D-3. Criar kit usa a vigente
`dedupePublicados` expõe `familiaIdVigente`; a tela usa esse id para o preview **e** para o
`familia_base_id` enviado à edge (preview = kit criado). A edge não força a vigente: a Revisão cria kit
de base ainda sem `ml_item_id` (`familia-expanded.tsx`), e esse fluxo continua igual.

## Consequências
- Republicar não deixa vínculo de UPDATE vivo em lote nenhum nem cria segunda família `CREATE`.
- Lotes antigos perdem a cópia do produto republicado (lote vazio é removido), como no Remover.
- Migration nova (RPC `security definer`, `execute` só para `service_role`).

## Como reverter
Edge volta a fazer os updates separados só na família pedida; dropar a RPC; tela volta a usar `familiaId`.
