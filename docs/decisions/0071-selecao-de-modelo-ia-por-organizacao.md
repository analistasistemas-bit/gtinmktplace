# ADR-0071: Seleção de modelo de IA (texto e imagem) por organização, via tela Configurações

**Status:** Aceito
**Data:** 2026-07-13
**Decisores:** Diego
**Relacionado:** ADR-0010 (OpenRouter em vez de OpenAI direto); ADR-0026 (generalização categorização/atributos por IA); ADR-0060 (padrão admin-only, `requireAdmin`/RLS)

## Contexto

Hoje o modelo de IA usado em todas as chamadas de texto (`atributos-llm.ts`, `categoria-llm.ts`,
`copywriter.ts`, `resposta-pergunta.ts`) é uma única constante de módulo, fixada por env var e
compartilhada por todas as organizações:

```ts
// supabase/functions/_shared/ai/modelos.ts
export const MODELO_COPY = Deno.env.get('AI_MODEL_COPY') ?? 'openai/gpt-4o-mini';
export const MODELO_VISION = Deno.env.get('AI_MODEL_VISION') ?? 'openai/gpt-4o';
```

Trocar de modelo hoje exige alterar a env var e reimplantar (ADR-0010 já previa isso como
"drop-in", mas sempre app-wide, nunca por organização). `MODELO_VISION` é usado só para **ler**
foto de produto (extrair cor em `vision.ts`) — não tem relação com geração de imagem.

Diego quer:
1. Escolher o modelo de texto por organização, direto na tela Configurações — incluindo uma opção
   nova, `deepseek/deepseek-v4-flash` (OpenRouter), além do padrão atual.
2. Reservar, na mesma tela, um seletor de **modelo de imagem** (`google/gemini-2.5-flash-image`,
   "Nano Banana", via OpenRouter) para uma feature de geração de imagem ainda não implementada.
3. Restringir a troca a admin da organização.

A tabela `configuracoes` (1 linha por `org_id`, upsert por `org_id`) já existe e já guarda
desconto, alíquotas, config do Telegram etc. — e sua RLS **já restringe insert/update a admin da
org** (`configuracoes: insert admin org` / `update admin org`, migration
`20260705165828_e7_rls_org.sql`), então qualquer coluna nova nessa tabela já nasce admin-only sem
código extra.

### Verificação do plumbing (org_id nos 4 pontos de chamada de IA-texto)

As 4 funções (`gerarCopy`, `desempatarAtributosLLM`, `desempatarCategoriaLLM`, `sugerirResposta`)
são hoje agnósticas de organização — nenhuma recebe `org_id`. Rastreando os callers:

| Entry point | `org_id` já disponível? | Ajuste necessário |
|---|---|---|
| `process-familia/index.ts` | Sim (`orgId`, linha 72) + `adminClient()` | Nenhum — só resolver e passar |
| `definir-categoria-familia/index.ts` | Sim (`requireUserOrg`) + `adminClient()` | Nenhum |
| `regenerar-copy-familia/index.ts` | Não — falta no `.select()` de `familias` | Adicionar `org_id` ao select |
| `sugerir-resposta-pergunta/index.ts` | Não — usa só `requireUser` (sem org), zero client | Trocar p/ `requireUserOrg` + pegar `adminClient()` |
| `publicar-split-ml/index.ts` → `titulo-particao.ts` | `familia.org_id` no entry point, mas não chega em `gerarTituloParticao` | Adicionar campo à interface `OpcoesTituloParticao` e passar no caller |

Nenhum caso exige mecanismo novo — todos reaproveitam padrões já existentes no projeto
(`requireUserOrg`, `adminClient()`, threading de um campo a mais numa interface).

## Decisão

**Escopo:** por organização, gravado na tabela `configuracoes` (mesmo padrão de desconto/alíquotas/
Telegram). Admin-only via RLS já existente — sem enforcement novo.

**Colunas novas em `configuracoes`:**
- `ai_model_texto` (text, nullable) — slug OpenRouter do modelo de texto.
- `ai_model_imagem` (text, nullable) — slug OpenRouter do modelo de imagem (dormente: nenhuma
  edge function consome ainda; a coluna só fica pronta pra quando a geração de imagem for
  implementada).

**Fallback:** `null` (caso mais comum, inclusive todas as orgs hoje em produção) → usa o valor
atual de `AI_MODEL_COPY`/`MODELO_COPY`, sem gravar nada no banco. Trocar o padrão global continua
sendo 1 env var.

**Lista curada e fechada (sem campo livre):**

| Uso | Modelo | Slug OpenRouter | Preço ($/1M in / out) |
|---|---|---|---|
| Texto (padrão) | GPT-4o-mini | `openai/gpt-4o-mini` | $0,15 / $0,60 |
| Texto (opcional, novo) | DeepSeek V4 Flash | `deepseek/deepseek-v4-flash` | $0,09 / $0,18 |
| Imagem (dormente) | Gemini 2.5 Flash Image ("Nano Banana") | `google/gemini-2.5-flash-image` | $0,30 / $2,50 |

Constante curada duplicada entre frontend (label + slug + preço de exibição, só para a UI) e
backend (`_shared/ai/modelos.ts` + `tokens.ts`, fonte de verdade de custo) — sem abstração
compartilhada entre os dois runtimes (Vite/React vs. Deno). Duplicação de 2-3 entradas não
justifica criar um mecanismo de compartilhamento (YAGNI).

**Invariante obrigatória:** todo slug de texto oferecido na UI **deve** ter entrada em
`tokens.ts::PRECOS` — senão `custoCentavos()` retorna 0 silenciosamente (já é um comportamento
existente do arquivo, não uma regressão desta mudança, mas a lista curada fecha a lacuna: só entra
no select o que tem preço cadastrado).
- `deepseek/deepseek-v4-flash` entra em `PRECOS` **agora** (será exercitado assim que uma org
  escolher).
- `google/gemini-2.5-flash-image` **não** entra em `PRECOS` ainda — nada consome geração de
  imagem, seria dead code. Entra junto com a implementação da feature de geração.

**Escopo do seletor de texto:** afeta os 4 usos de uma vez (atributos, categoria, copywriter,
resposta ao comprador) — um único slug por org, mesma abrangência que `MODELO_COPY` já tem hoje.
Sem granularidade por função.

**Resolução em runtime:** novo helper (`resolverModeloTexto(orgId, client)`) centraliza o lookup
em `configuracoes.ai_model_texto` + fallback pro env — cada call site só precisa entregar
`orgId` e um client Supabase.

## Alternativas consideradas

- **Campo livre (colar qualquer slug do OpenRouter):** mais flexível, mas permite escolher modelo
  sem preço cadastrado → custo 0 silencioso na tabela `PRECOS`. Rejeitada.
- **Config global por env var (sem por-org):** já é o comportamento atual; não atende o pedido de
  trocar pela tela de Configurações nem de ter modelos diferentes por cliente. Rejeitada.
- **Nova tabela dedicada a preferências de IA (em vez de reusar `configuracoes`):** infra nova sem
  necessidade — `configuracoes` já resolve armazenamento, RLS e upsert por org. Rejeitada por YAGNI.
- **Modelo de imagem fora de escopo agora (só reservar espaço, sem UI):** avaliada e descartada a
  pedido de Diego — o seletor de imagem fica ativo e salvável desde já, mesmo sem consumidor,
  para não reescrever a UI quando a geração for implementada.

## Consequências

**Boas:**
- Zero infraestrutura nova (tabela, RLS e padrão de upsert já existem).
- Admin-only sai de graça da RLS existente.
- Troca de modelo por org sem deploy/env var.
- Lista curada elimina o risco de custo-fantasma (invariante slug↔preço).

**Tradeoffs aceitos:**
- Plumbing em 3 dos 5 pontos de chamada (regenerar-copy, sugerir-resposta, split/titulo-particao)
  precisa de um ajuste pequeno e localizado (adicionar `org_id` ao select, trocar `requireUser` por
  `requireUserOrg`, ou passar mais um campo numa interface) — nenhum é refactor estrutural.
- Coluna `ai_model_imagem` fica sem consumidor até a feature de geração de imagem existir
  (aceito explicitamente por Diego).
- Duplicação pequena da lista curada entre frontend e backend (aceito por YAGNI).

## Como reverter

Apagar as colunas `ai_model_texto`/`ai_model_imagem` de `configuracoes`, remover o helper
`resolverModeloTexto`, voltar as 4 funções de IA-texto a usar `MODELO_COPY` direto (sem parâmetro),
e remover a seção de seletor de modelo da tela Configurações. Nenhum dado histórico de família é
afetado — `custo_centavos` já gravado permanece correto (é calculado no momento da chamada).
