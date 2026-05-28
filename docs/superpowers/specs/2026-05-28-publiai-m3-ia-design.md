# PubliAI — Spec do M3 (IA copywriting + Vision)

**Marco:** M3 — IA copywriting + Vision
**Data:** 2026-05-28
**Autor:** Diego (decisões) + Claude (redação)
**Status:** Aprovado em brainstorming; aguardando revisão escrita antes de virar plano de implementação

> Continua o trabalho do M2 (backend core). Pré-requisitos cobertos: schema com 4 tabelas + RLS, auth, upload real, `ingest-lote` processando planilha real (290 variações validadas), `process-familia` esqueleto idempotente, Realtime + polling, tela de Revisão consumindo `useFamilias` real com edição inline persistente.

---

## 1. Objetivo do M3

Transformar o stub atual de `process-familia` (que apenas marca `status='pronto'`) em um pipeline real de IA que:

1. Resolve a **cor** de cada variação (texto primeiro, IA Vision como fallback)
2. Gera **título** e **descrição** da família via IA copywriter (sem inventar specs)
3. Persiste tudo + captura custo de IA
4. Reflete na tela de Revisão com badges de origem da cor e edição manual

Como subprodutos, restaura a verificação de assinatura QStash (regressão herdada do M2) e adiciona a capacidade de subir imagens em lote existente (decidida no bug bash do M2).

**Critério objetivo de "M3 entregue":** lote real com 10 famílias diversas processado → ≥8 famílias com copy aprovado pelo Diego sem edição.

---

## 2. Escopo

### Dentro do M3

- Edge function `process-familia` reescrita (orquestra cor + copy + persistência)
- Edge function nova `upload-imagens-lote` (drop zone + ícone câmera no frontend)
- Camada de IA isolada em `supabase/functions/_shared/ai/`
- Parser de cor PT-BR (`_shared/cor/`) com dicionário + regex
- Cliente Redis (`_shared/redis/`) para cache de cor
- Migration aditiva 0007 (custos de IA + flags `editado_pelo_operador`)
- Tela de Revisão consumindo dados reais (substituindo placeholders) + badges + drop zone + ícone câmera
- Restauração da verificação de assinatura QStash em `process-familia`

### Fora do M3 (vão pro M4 ou depois)

- Busca de concorrência no Mercado Livre (M4)
- Cálculo de preço sugerido (M4)
- Atributos por categoria (M4 + ADR-0009)
- Botão "Tentar de novo" para famílias com erro (M5)
- UI do custo somado por lote (M5; mas dados já são capturados no M3)
- Painel de "% editado pelo operador" (M5)

---

## 3. Arquitetura

### Estrutura de pastas após o M3

```
supabase/functions/
├── _shared/
│   ├── ai/                          # NOVO — camada de IA
│   │   ├── client.ts                # OpenRouter client (SDK OpenAI + baseURL)
│   │   ├── modelos.ts               # slugs por função (env-configurável)
│   │   ├── copywriter.ts            # gerarCopy(input) → { titulo, descricao, usage }
│   │   ├── vision.ts                # extrairCorPorVision(imagemUrl) → cor
│   │   └── tokens.ts                # custoCentavos(modelo, usage)
│   ├── cor/                         # NOVO — parser de cor (Camada 1)
│   │   ├── dicionario.ts            # ~50 cores PT-BR + sinônimos
│   │   ├── extrair.ts               # extrairCorDoTexto(textos[]) → cor | null
│   │   └── __tests__/
│   ├── redis/                       # NOVO — cliente Upstash + helpers
│   │   ├── client.ts
│   │   └── cache-cor.ts
│   ├── queue.ts                     # já existe
│   ├── supabase.ts                  # já existe
│   └── ...
├── process-familia/                 # REESCRITO — deixa de ser stub
│   └── index.ts
├── ingest-lote/                     # já existe
└── upload-imagens-lote/             # NOVO
    └── index.ts

src/
├── pages/Revisao/                   # consome dados reais; ganha badges + drop zone
└── components/revisao/
    ├── DropZoneImagensExistente.tsx # NOVO
    └── BotaoTrocarFoto.tsx          # NOVO (ícone câmera por variação)
```

### Boundaries

- **IA fica só no backend.** Frontend nunca chama OpenRouter direto. Motivação: `OPENROUTER_API_KEY` é secret, e o copy precisa do contexto carregado nas Edge Functions.
- **`_shared/cor/extrair`** é puro (zero I/O) → fácil de testar.
- **`_shared/ai/*`** chama OpenRouter via SDK OpenAI; isolado pra trocar provedor com mínimo refactor.
- **`_shared/redis/cache-cor`** abstrai Upstash REST; código consumidor não conhece detalhes do cliente.
- **`upload-imagens-lote`** separado de `ingest-lote` porque não cria família/variação — só atualiza `imagem_path`.

---

## 4. Pipeline interno do `process-familia`

```
async function handle(job: { familia_id, lote_id }):

  1. Verificar assinatura QStash (RESTAURADA — sem bypass)
     - Falhou → 401 imediato
     - Passou → continua

  2. Claim atômico
     UPDATE familias SET status='processando'
     WHERE id = familia_id AND status = 'pendente'
     - Retornou 0 linhas → 200 "Already processed", sai cedo
     - Retornou 1 linha → continua

  3. Carregar contexto (família + variações + paths de imagem)

  4. Resolver cor de cada variação (pool máx 5 paralelas, p-limit)
     Para cada variação SEM cor:
       a. Camada 1 — dicionário PT-BR em NOME + DESCRICAO_DETALHADO
          → match? cor_origem = 'descricao', segue
          → não match? continua
       b. Cache Redis — cache:cor:{user_id}:{codigo}
          → hit? usa cor cacheada, cor_origem = origem cacheada
          → miss? continua
       c. Camada 2 — Vision (gpt-4o)
          - Se variação tem imagem → chama Vision com signed URL
          - Vision OK → cor = resposta, cor_origem = 'vision'
                       grava cache com TTL 90d
          - Vision falhou OU sem imagem → cor = NULL, cor_origem = NULL

  5. Persistir cores resolvidas (1 UPDATE batch nas variações)

  6. Chamar copywriter UMA vez por família
     input  = { nome, descricao_detalhado, variacoes (com cor) }
     output = { titulo, descricao, usage }

  7. Persistir título + descrição + tokens + custo + status='pronto'

  8. Erros no caminho:
     - 4xx OpenRouter → 200 + status='erro' + erro_mensagem (não retenta)
     - 5xx/timeout OpenRouter → 5xx → QStash retenta (até 3x)
     - Outras exceções → 500 (mesma rota)
```

### Constantes

- **Pool de concorrência:** 5 chamadas Vision simultâneas por família
- **Timeout por chamada externa:** 30 s (`AbortSignal.timeout(30_000)`)
- **TTL do cache de cor:** 90 dias

---

## 5. Camada de extração de cor

### Camada 1 — Parser textual

**Entrada:** array de strings (`NOME` da variação, `DESCRICAO_DETALHADO` da família, `NOME` da família) — concatena e busca.

**Algoritmo:**
1. Lê dicionário (`DICIONARIO_CORES`) com pares `{ canonica, sinonimos[] }`
2. Ordena todos os sinônimos do longest → shortest (evita "azul" casar antes de "azul royal")
3. Para cada sinônimo, testa regex `\b{sinonimo}\b` case-insensitive
4. Primeiro match → retorna `canonica`
5. Sem match → retorna `null`

**Dicionário inicial (~50 cores):**

```
Preto, Branco, Vermelho, Vermelho Escuro, Vinho, Azul Royal, Azul Marinho,
Azul Claro, Azul Bebê, Verde Bandeira, Verde Musgo, Verde Claro, Verde Limão,
Amarelo, Amarelo Ouro, Laranja, Rosa, Rosa Claro, Rosa Choque, Pink, Roxo,
Lilás, Marrom, Marrom Café, Bege, Cru, Natural, Cinza, Cinza Claro, Cinza Escuro,
Prata, Dourado, Caqui, Mostarda, Ferrugem, Salmão, Coral, Turquesa, Petróleo,
Rosa Neon, Verde Neon, Amarelo Neon, Pink Neon, Multicolor
```

Lista cresce manualmente conforme novas cores aparecem em lotes reais.

**Output:** sempre na forma canônica (capitalizada, normalizada). Nunca devolve "preto", só "Preto".

### Camada 2 — Vision

**Quando entra:** somente se Camada 1 falhou E não há hit no cache.

**Modelo:** `openai/gpt-4o` (Vision-capable), slug configurável via env `AI_MODEL_VISION`.

**Prompt:**

```
Você é um identificador de cor de produto. Recebe a foto de um produto têxtil
(linha de costura, botão, fita ou similar).

Responda APENAS com o nome da cor predominante, em português, escolhendo entre
estas opções canônicas:
[Preto, Branco, Vermelho, Azul Royal, Azul Marinho, Azul Claro, Verde Bandeira,
 Verde Musgo, Verde Claro, Amarelo, Laranja, Rosa, Pink, Roxo, Marrom, Bege,
 Cru, Cinza, Prata, Dourado, Rosa Neon, Verde Neon, Outra]

Se não conseguir identificar, responda "Outra".
Não explique, não adicione contexto, devolva apenas o nome da cor.
```

**Validação:** se a resposta não estiver na lista, salva como "Outra" e marca `cor_origem='vision'`. Operador valida na revisão.

**Custo estimado:** ~$0.005 por chamada (low-detail). Pior caso 290 variações sem cor textual = ~$1.45 no primeiro lote, $0 nos subsequentes (cache).

### Cache Redis (`cache:cor:*`)

```
Chave:   cache:cor:{user_id}:{codigo}
Valor:   { cor: "Vermelho", origem: "vision", criado_em: "2026-05-28T..." }
TTL:     90 dias (7_776_000 s)
```

**Invalidação:** quando operador edita cor manualmente na tela de Revisão, o `onBlur` da edição:
1. Atualiza variação no banco (`cor`, `cor_origem='manual'`, `cor_editada_pelo_operador=true`)
2. Chama edge function helper (ou o próprio update já dispara via trigger) que faz `DEL cache:cor:{user_id}:{codigo}`

Política de invalidação implementada via chamada explícita do frontend pós-save (mais simples que trigger DB → função externa).

---

## 6. Camada do copywriter

### Interface

```ts
// supabase/functions/_shared/ai/copywriter.ts
export interface InputCopy {
  nome: string;
  descricao_detalhado: string;
  variacoes: Array<{
    codigo: string;
    cor: string | null;
    preco: number;
  }>;
  categoria_hint?: 'linhas' | 'botoes' | 'fitas';
}

export interface OutputCopy {
  titulo: string;       // <= 60 chars
  descricao: string;    // <= ~5000 chars
  usage: {
    tokens_input: number;
    tokens_output: number;
    custo_centavos: number;
  };
}

export async function gerarCopy(input: InputCopy): Promise<OutputCopy>;
```

### Prompt v0 (vai iterar com Diego)

```
Você é um copywriter especializado em anúncios de aviamentos (linhas de costura,
botões, fitas) no Mercado Livre Brasil.

Sua tarefa: gerar título e descrição para UM anúncio agrupado que contém várias
variações de cor do mesmo produto.

REGRAS INEGOCIÁVEIS:
1. NUNCA invente especificações que não estão no input (composição, gramatura,
   dimensões, marca, certificações). Use APENAS o que está em "DESCRICAO_DETALHADO".
2. Título: até 60 caracteres, frase comercial, idealmente menciona a quantidade
   de cores disponíveis no final.
3. Descrição: use os dados de DESCRICAO_DETALHADO como verdade absoluta. Pode
   reorganizar, formatar em parágrafos, adicionar separadores, mas NÃO acrescentar
   informações novas.
4. Tom: profissional, direto, focado em utilidade do produto.
5. Liste as cores disponíveis em uma seção da descrição.

FORMATO DE SAÍDA: JSON conforme schema fornecido.

INPUT:
- Nome do produto: {{nome}}
- Descrição detalhada (fonte de verdade): {{descricao_detalhado}}
- Variações disponíveis ({{n_variacoes}} cores): {{lista_cor_e_codigo}}
- Categoria sugerida: {{categoria_hint}}
```

### Configuração técnica

- **Modelo:** `openai/gpt-4o-mini` via OpenRouter (ADR-0010). Slug em env `AI_MODEL_COPY`.
- **Structured output:** `response_format: { type: 'json_schema', json_schema: {...} }` garantindo `{titulo, descricao}`.
- **Sem retry interno:** erro propaga pro catch do `process-familia`.
- **Anti-alucinação:** regra #1 do prompt + revisão humana na tela. Sem validação programática "a descrição só usa info do input" (custo > benefício).

### Custo estimado

~500 tokens input + ~300 tokens output = ~$0.0005 por família via `gpt-4o-mini`. Lote de 10 famílias do bug bash = ~$0.005. Negligível.

### Estratégia de validação do prompt (manual)

1. Implementar pipeline + prompt v0
2. Diego importa lote real com 5 famílias diversas (linhas, botões, fitas)
3. Diego lê os 5 títulos + descrições na tela de Revisão
4. Marca cada uma: aprovado / pequeno ajuste / refazer
5. Claude refina o prompt (ex: "descrição muito longa", "tom comercial demais")
6. Repete até 5 famílias aprovadas em sequência sem grandes correções
7. Bug bash final do M3: lote com 10 famílias diversas → ≥8 aprovadas sem edição

---

## 7. Captura de custo

Cada chamada IA retorna `usage.prompt_tokens` + `usage.completion_tokens` (formato OpenAI). Convertemos pra centavos via tabela determinística em `_shared/ai/tokens.ts`:

```ts
const PRECOS: Record<string, { input: number; output: number }> = {
  'openai/gpt-4o-mini': { input: 0.015, output: 0.06 },   // $/1k tokens
  'openai/gpt-4o':      { input: 2.50,  output: 10.00 },
};

export function custoCentavos(
  modelo: string,
  usage: { prompt_tokens: number; completion_tokens: number }
): number {
  const p = PRECOS[modelo];
  if (!p) return 0;
  const dolares =
    (usage.prompt_tokens / 1000) * p.input +
    (usage.completion_tokens / 1000) * p.output;
  return Math.ceil(dolares * 100); // centavos $, arredonda pra cima
}
```

Persistido em colunas novas na `familias`:
- `tokens_input integer`
- `tokens_output integer`
- `custo_centavos integer`

UI do custo somado por lote fica pro M4. Captura é agora.

---

## 8. Schema — Migration 0007

Aditiva. Sem `DROP COLUMN`.

```sql
-- 0007_m3_ia_fields.sql
ALTER TABLE familias
  ADD COLUMN tokens_input integer,
  ADD COLUMN tokens_output integer,
  ADD COLUMN custo_centavos integer,
  ADD COLUMN titulo_editado_pelo_operador boolean DEFAULT false,
  ADD COLUMN descricao_editada_pelo_operador boolean DEFAULT false;

ALTER TABLE variacoes
  ADD COLUMN cor_editada_pelo_operador boolean DEFAULT false,
  ADD COLUMN preco_editado_pelo_operador boolean DEFAULT false;

CREATE INDEX familias_lote_status_idx ON familias(lote_id, status);
```

**Flags `*_editado_pelo_operador`:** marcadas pelo `onBlur` da edição inline quando valor difere do retornado pela IA. Servem como métrica futura (M5) de "% editado" — sinal pra ajustar prompt.

**Regenerar tipos TS:** `supabase gen types typescript` via MCP após aplicar a migration.

---

## 9. Tela de Revisão — mudanças

Já existe desde o M1/M2. Mudanças no M3:

### 9.1. Consumir dados reais

`useFamilias(loteId)` já consulta o banco. Apenas garantir que mostre `titulo`, `descricao`, `cor`, `cor_origem` reais (hoje o stub deixa esses campos vazios).

### 9.2. Badge de origem da cor (por variação)

| `cor_origem` | Cor do chip | Label |
|---|---|---|
| `descricao` | cinza claro | 📝 descrição |
| `vision` | azul claro | 👁 IA Vision |
| `manual` | verde | ✓ manual |
| `NULL` | vermelho | ⚠ sem cor — preencha |

### 9.3. Edição inline (estende M2)

Quando o operador edita um campo:
1. UPDATE no banco (já funciona desde M2 com feedback `Salvando…` / `✓ Salvo`)
2. **Novo:** se valor diferente do que veio da IA, marca a flag correspondente (`titulo_editado_pelo_operador`, etc.)
3. **Novo (cor):** ao editar cor, marca `cor_origem='manual'` E invalida cache `cache:cor:{user_id}:{codigo}` no Redis

### 9.4. Drop zone em massa (acima da lista)

```
┌──────────────────────────────────────────────────────┐
│  📷 Arraste imagens para atribuir às variações       │
│     (aceita 00CODIGO.jpeg ou 00CODIGO.jpg/.png)      │
└──────────────────────────────────────────────────────┘
```

Fluxo:
1. Frontend chama Edge `upload-imagens-lote` com lista de arquivos
2. Edge faz match por nome → sobe pro Storage `{user_id}/{codigo}.jpeg` → UPDATE `imagem_path`
3. Devolve `{ ok: 28, ja_tinha: 2, sem_match: 1, erros: [] }`
4. Frontend mostra toast resumo + invalida query `useFamilias`

### 9.5. Ícone câmera por VariacaoCard

Pequeno botão `📷` ao lado de cada variação. Click abre seletor (`<input type="file" hidden>`); sobe 1 arquivo só → mesma Edge `upload-imagens-lote` com flag `single=true` → atualiza imagem só daquela variação.

### 9.6. Alerta no FamiliaRow

Se `count(variacoes WHERE cor IS NULL) > 0`, mostra badge: "⚠ N variações sem cor".

---

## 10. `upload-imagens-lote` (Edge Function nova)

```
POST /functions/v1/upload-imagens-lote
Auth: Supabase JWT (operador) — NÃO QStash signature (chamada do frontend)

Body (multipart/form-data):
  - lote_id: string
  - files: File[]   (1 ou N arquivos com nome 00CODIGO.jpeg/jpg/png)

Comportamento:
  1. Valida JWT → user_id
  2. Para cada arquivo:
     a. Extrai codigo do nome (8 dígitos, zero-padded)
     b. SELECT variação WHERE lote_id=? AND codigo=? AND user_id=?
        → não achou → adiciona a sem_match[]
     c. Achou:
        - Já tem imagem_path? → adiciona a ja_tinha[]
        - Não tem? Sobe pro Storage {user_id}/{codigo}.{ext}, UPDATE imagem_path
        - Erro? adiciona a erros[]
  3. Retorna { ok: N, ja_tinha: N, sem_match: N, erros: [...] }
```

**Nota sobre `ja_tinha`:** comportamento default é **sobrescrever** (operador subiu de novo = quer substituir). `ja_tinha[]` é apenas log informativo, NÃO bloqueia.

---

## 11. Restauração da verificação QStash

Passos (na ordem):

1. **Console Upstash → QStash → Signing Keys:** rotacionar `current_signing_key` e `next_signing_key`. Anotar novos valores.
2. **Atualizar secrets do Supabase** (apenas — Render só hospeda o frontend e não usa estas chaves):
   ```bash
   supabase secrets set \
     QSTASH_CURRENT_SIGNING_KEY=... \
     QSTASH_NEXT_SIGNING_KEY=...
   ```
3. **Remover bypass** em `supabase/functions/process-familia/index.ts` (linhas 14-18). Restaurar:
   ```ts
   const ok = await verificarAssinatura(req, body);
   if (!ok) return new Response('Invalid signature', { status: 401, headers: corsHeaders });
   ```
4. Deploy + smoke test: chamar manual via `qstash_publish_message` MCP → confirmar 200; mandar request direto (sem signature) → 401.

`upload-imagens-lote` **não** usa QStash signature (é chamado do frontend autenticado); usa Supabase JWT validation via `_shared/auth.ts`.

---

## 12. Error handling consolidado

| Fonte de erro | Comportamento | Status final da família |
|---|---|---|
| Assinatura QStash inválida | 401, nada gravado | (não chega ao banco) |
| Race condition (claim falhou) | 200 "Already processed" | mantém status existente |
| Vision falha (timeout/4xx/5xx) | Variação fica `cor=NULL`, processamento segue | `pronto` (com alerta UI) |
| OpenRouter timeout/5xx | 5xx → QStash retenta (até 3x); na 3ª, `erro` | `erro` com `erro_mensagem` |
| OpenRouter 4xx (payload) | 200 → `status='erro'` (sem retry) | `erro` |
| Redis indisponível | Log warning, prossegue sem cache | igual ao caminho normal |
| Storage signed URL falha | Pula Vision para essa variação | `cor=NULL` |
| `upload-imagens-lote` parcial | Retorna `{ ok, ja_tinha, sem_match, erros }` | varia por arquivo |

**Princípio:** falhas locais (1 variação sem cor) NÃO derrubam a família. Revisão humana lida com lacunas. Falhas globais (OpenRouter inteiro fora) refletem como `erro`.

---

## 13. Testes

| Componente | Tipo | Onde |
|---|---|---|
| `_shared/cor/extrair` | Unit puro | `__tests__/extrair.test.ts` |
| `_shared/cor/dicionario` | Smoke | `__tests__/dicionario.test.ts` |
| `_shared/ai/copywriter` | Unit + mock OpenAI SDK | `__tests__/copywriter.test.ts` |
| `_shared/ai/vision` | Unit + mock | `__tests__/vision.test.ts` |
| `_shared/ai/tokens` | Unit determinístico | `__tests__/tokens.test.ts` |
| `_shared/redis/cache-cor` | Unit + mock Upstash REST | `__tests__/cache-cor.test.ts` |
| `process-familia` (orquestração) | Integration via curl + bug bash | manual |
| `DropZoneImagensExistente` | Component test | `DropZoneImagensExistente.test.tsx` |
| `upload-imagens-lote` | Integration manual | bug bash |

**Sem teste pro prompt** — validação é semântica/manual com Diego.

**Meta:** chegar ao final do M3 com `pnpm test` ≥ 75 testes passando (61 hoje + ~14 novos).

---

## 14. Critérios objetivos de "M3 entregue"

Em ordem cronológica:

1. ✅ Migration 0007 aplicada; tipos TS regenerados
2. ✅ `_shared/cor/extrair` + dicionário com testes passando
3. ✅ Cache Redis lendo/escrevendo `cache:cor:*` (validar via MCP Upstash)
4. ✅ Vision mocked em testes; chamada real validada em 5 imagens
5. ✅ Copywriter mocked em testes; chamada real validada em 1 família
6. ✅ `process-familia` reescrito; assinatura QStash restaurada
7. ✅ `upload-imagens-lote` deployada e validada via curl
8. ✅ Tela de Revisão consumindo dados reais (substituindo placeholders)
9. ✅ Badges de origem + alerta cor faltando + drop zone + ícone câmera funcionando
10. ✅ Bug bash do M3: lote real de 10 famílias diversas → ≥8 com copy aprovado sem edição

---

## 15. Referências

- [ADR-0004 — Atribuição de cor (descrição primeiro, Vision como fallback)](../../decisions/0004-atribuicao-de-cor.md)
- [ADR-0006 — QStash em vez de Postgres queue (idempotência mandatória)](../../decisions/0006-qstash-em-vez-de-postgres-queue.md)
- [ADR-0007 — Modelo de dados (4 tabelas)](../../decisions/0007-modelo-de-dados-4-tabelas.md)
- [ADR-0010 — OpenRouter em vez de OpenAI direto](../../decisions/0010-openrouter-em-vez-de-openai-direto.md)
- Bug bash do M2 (2026-05-27): origem dos requisitos de upload posterior e polling fallback
- Gaps deferidos da revisão crítica do spec mestre (TASKS.md §⚠ Gaps conhecidos)
