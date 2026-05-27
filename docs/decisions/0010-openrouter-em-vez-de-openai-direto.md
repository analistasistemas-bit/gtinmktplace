# ADR-0010: OpenRouter em vez de OpenAI direto como provedor da camada de IA

**Status:** Aceito
**Data:** 2026-05-26
**Decisores:** Diego
**Relacionado:** complementa [ADR-0001 (stack)](0001-stack-tecnologico.md); revisa a parte "provedor de IA" originalmente definida como OpenAI direto

## Contexto

Durante a fase de execução do Plano 01, Diego informou que **não vai usar uma chave da OpenAI direta**, e sim **uma API key do OpenRouter** (proxy multi-modelo compatível com a API da OpenAI). A decisão original (ADR-0001) assumia OpenAI direto com GPT-4o-mini + GPT-4o Vision.

OpenRouter (<https://openrouter.ai/>) é um gateway que:
- Expõe **muitos modelos** (OpenAI, Anthropic, Google, Mistral, etc.) através de **uma única chave**
- Mantém **compatibilidade com a SDK da OpenAI** — basta apontar `baseURL` para `https://openrouter.ai/api/v1`
- Cobra um **markup pequeno** sobre o preço do modelo de origem
- Permite **fallback automático** entre modelos quando configurado
- Tem **billing unificado** (uma fatura para vários provedores)

## Decisão

A camada de IA do PubliAI usa **OpenRouter como gateway** em vez de chamar a OpenAI diretamente. O código continua usando a **SDK oficial da OpenAI** (`openai` npm), apenas com `baseURL` apontando para o OpenRouter e header `Authorization: Bearer <OPENROUTER_API_KEY>`.

**Configuração padrão:**

```ts
import OpenAI from 'openai';

const ai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: Deno.env.get('OPENROUTER_API_KEY'),
  defaultHeaders: {
    'HTTP-Referer': 'https://<seu-app>.onrender.com',  // bom-tom OpenRouter
    'X-Title': 'PubliAI',
  },
});
```

**Modelos usados (slugs OpenRouter):**

| Função | Modelo | Slug OpenRouter |
|---|---|---|
| Copywriter (texto) | GPT-4o-mini | `openai/gpt-4o-mini` |
| Vision (cor) | GPT-4o Vision | `openai/gpt-4o` (vision-capable) |
| Classificador de tipo | GPT-4o-mini | `openai/gpt-4o-mini` |

Slugs ficam configuráveis via env var (ex: `AI_MODEL_COPY=openai/gpt-4o-mini`) para permitir troca rápida.

**Secrets:**
- `OPENROUTER_API_KEY` (em vez de `OPENAI_API_KEY`)
- Configurado como secret no Supabase para uso nas Edge Functions
- **Nunca exposto** no frontend (somente edge functions chamam IA)

## Alternativas consideradas

- **Opção A: OpenAI direto (proposta original do ADR-0001)**
  - Pros: integração mais simples; latência um pouco menor; documentação mais ampla
  - Cons: Diego já tem créditos no OpenRouter e prefere uma única plataforma para todos os modelos
  - Rejeitada por preferência do desenvolvedor (justa)

- **Opção B: Anthropic direto (Claude 3.5 Haiku/Sonnet)**
  - Pros: ótima qualidade em PT-BR; melhor em copy persuasiva (subjetivo)
  - Cons: prompts foram pensados para GPT-4o-mini; segundo nível de integração não está ROI para o MVP
  - Diferida para v2 — pode ser experimentada com troca de slug se prompt for compatível

- **Opção C: OpenRouter como gateway (escolhida)**
  - Pros: uma chave para todos os modelos; permite A/B teste fácil entre modelos; billing unificado; SDK da OpenAI funciona com mínima mudança
  - Cons: ~5% markup sobre preço de origem; dependência adicional (OpenRouter como ponto de falha); leve latência extra
  - Aceita

## Consequências

**Boas:**
- Diego usa a chave que já tem, sem provisionar nova conta OpenAI
- Permite trocar modelos por env var sem refactor: `AI_MODEL_COPY=anthropic/claude-3.5-haiku` vira drop-in
- Custo de A/B test entre modelos é praticamente zero (vs. abrir contas separadas)
- Mesmo SDK da OpenAI continua funcionando — não precisa aprender API nova

**Tradeoffs aceitos:**
- ~5% markup do OpenRouter sobre o preço do modelo
- Dependência adicional (OpenRouter como SPOF — se cair, IA não responde)
- Latência ligeiramente maior por um hop a mais

**Impacto operacional:**

| Item | Antes (OpenAI direto) | Depois (OpenRouter) |
|---|---|---|
| Secret env var | `OPENAI_API_KEY` | `OPENROUTER_API_KEY` |
| baseURL do client | (padrão da SDK) | `https://openrouter.ai/api/v1` |
| Slug do modelo | `gpt-4o-mini` | `openai/gpt-4o-mini` |
| Headers extras | (nenhum) | `HTTP-Referer`, `X-Title` (bom-tom) |
| Custo estimado/mês | ~$2.50 | ~$2.60 (+5% markup) |
| Resiliência a outage | Depende OpenAI | Depende OpenRouter + OpenAI a montante |

**Mitigação de SPOF:** se OpenRouter cair, configurar fallback para chamar OpenAI direto via SDK (apenas trocar `baseURL` para padrão). Pode ser feito sem deploy se a edge function ler de um config feature flag.

## Atualizações necessárias em outros documentos

- ✅ Memory `reference_credentials_project_setup.md` (já feito)
- ⬜ Atualizar mentions de "OpenAI" no CLAUDE.md → "OpenAI via OpenRouter"
- ⬜ Atualizar `.env.example` para `OPENROUTER_API_KEY`
- ⬜ Atualizar spec §5 (stack table) e §8 (prompts) mencionando OpenRouter
- ⬜ Atualizar Plano 01 step 2.5/2.6 quando chegar à provisão de secrets

## Como reverter

Trocar de OpenRouter para OpenAI direto:
1. `OPENROUTER_API_KEY` → `OPENAI_API_KEY` no secret
2. Remover `baseURL` e headers extras do client
3. Slugs `openai/gpt-4o-mini` → `gpt-4o-mini`

Refactor de ~30 minutos. Toda a estrutura permanece. Vice-versa também é trivial.
