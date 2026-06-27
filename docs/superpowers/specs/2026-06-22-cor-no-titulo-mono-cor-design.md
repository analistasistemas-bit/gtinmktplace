# Cor no título de anúncios mono-cor — design

**Data:** 2026-06-22
**Status:** aprovado (aguardando review da spec)
**Origem:** incidente alfinetes (3 anúncios Prata baixados pelo ML como duplicado — ver [[reference_ml_duplicado_titulo_cor]])

## Problema

Quando duas famílias diferem **apenas na cor** mas têm `codigo_pai` distinto na planilha (ex.: "ALFINETE N.0 PRATA" e "ALFINETE N.0 DOURADO"), elas viram **anúncios separados**. A IA do copywriter gera o `titulo_ml` a partir do nome, mas é instruída a tratar o anúncio como agrupado multi-cor e **remove a cor do título**. Resultado: Prata e Dourado ficam com **título 100% idêntico** → o Mercado Livre trata como anúncio duplicado e baixa o segundo (`under_review` + `forbidden`, "Era igual a outro anúncio"). Item nesse estado **não é editável por API** — só recriando como item novo.

No incidente, os 3 anúncios baixados (N.0, N.02, N.04) eram justamente os de título idêntico ao par Dourado; o N.03 Prata, cujo título já continha "PRATA", permaneceu ativo. Isso confirma que **título diferenciado basta** para evitar a duplicação.

## Objetivo

Garantir, de forma determinística, que **anúncios de cor única** tenham a cor cravada no título — eliminando a colisão de títulos entre famílias-irmãs de cores diferentes. Apenas prevenção daqui pra frente (sem varredura retroativa dos já publicados).

## Não-objetivos

- Não unificar Prata+Dourado num único anúncio com variação de cor (mudaria o agrupamento por PAI, ADR-0003 — invasivo).
- Não corrigir retroativamente anúncios já publicados.
- Não alterar o comportamento de anúncios **multi-cor** (que corretamente não levam cor no título).

## Solução

Espelhar o padrão já existente de `garantirMetragemTitulo()` em `supabase/functions/_shared/ai/titulo.ts`: uma **rede de segurança determinística** aplicada depois da geração da IA, à prova do modelo descartar o dado sob o teto de 60 chars.

### Nova função: `garantirCorTitulo(titulo, cor, nCores)`

`titulo.ts`:

```
export function garantirCorTitulo(titulo: string, cor: string | null, nCores: number): string
```

Regras:
1. **Gatilho:** só atua quando `nCores === 1` e `cor` é não-vazia e não é o placeholder "(sem cor identificada)". Caso contrário, retorna o título inalterado (já passou por `clampTitulo`/`garantirMetragemTitulo` antes).
2. **Idempotência:** se a cor já aparece no título como palavra inteira (case-insensitive, com normalização de acentos), não duplica.
3. **Inserção:** anexa a cor ao fim do **1º segmento** (antes do primeiro `" | "`), igual à metragem. Ex.: `ALFINETE DE SEGURANÇA N.0 100UND | 100% FERRO` → `ALFINETE DE SEGURANÇA N.0 100UND PRATA | 100% FERRO`.
4. **Teto de 60 chars:** para caber a cor, derruba primeiro os segmentos de "diferencial" (após `" | "`); se ainda não couber, apara o texto-base do 1º segmento **preservando a cor** (a cor é dado diferenciador prioritário, como a metragem). Reusa a mesma mecânica de `garantirMetragemTitulo`.
5. **Caps:** a cor entra em CAPS (título é todo em CAPS).

### Pontos de chamada (encadeado após `garantirMetragemTitulo`)

Dois locais, ambos já chamam `garantirMetragemTitulo`:

- `supabase/functions/process-familia/index.ts:238` — geração inicial. As variações incluídas já estão no escopo (usadas para montar o copy); contar cores únicas não-nulas e passar `(cor única, nCores)`.
- `supabase/functions/regenerar-copy-familia/index.ts:50` — regeneração manual. Buscar as cores das variações da família.

Encadeamento: `garantirCorTitulo(garantirMetragemTitulo(copy.titulo, nome_pai), corUnica, nCores)`.

### Contagem de cores

`nCores` = quantidade de cores **únicas e não-nulas** entre as variações **incluídas na publicação** (`excluida_da_publicacao = false`). `corUnica` = essa cor quando `nCores === 1`.

## Edge cases

- **Cor nula / "(sem cor identificada)":** não crava (não há o que cravar).
- **Multi-cor:** `nCores > 1` → inalterado.
- **Cor já no título:** idempotente, não duplica.
- **Metragem + cor competindo por 60 chars:** ambas são dados diferenciadores; a ordem é metragem (1º) depois cor. Se não couber, derruba diferencial; em último caso apara base preservando ambas. Cenário raro (produto por metro + cor única).
- **UPDATE que adiciona 2ª cor a uma família antes mono-cor:** o título não é regenerado no fluxo de UPDATE, então pode ficar com a cor antiga cravada. Aceito como fora de escopo (operador pode regenerar a copy); documentado no ADR.

## Testes

Unitários de `garantirCorTitulo` em `_shared/ai/__tests__/`:
- mono-cor sem cor no título → crava no 1º segmento;
- mono-cor com cor já presente → idempotente (não duplica);
- multi-cor → inalterado;
- cor nula / placeholder → inalterado;
- cor + título no limite de 60 → derruba diferencial, preserva cor, ≤ 60;
- interação com metragem (encadeamento) → ambos presentes, ≤ 60;
- normalização de acento ("Prata"/"PRATA").

## Entrega

- ADR-0044 (regra do projeto: decisão nova não-trivial).
- Branch isolada (worktree `prevencao-titulo-cor`); Diego valida; merge sob comando.
- Deploy: `process-familia` e `regenerar-copy-familia` (ambas importam `_shared/ai/titulo.ts`).
