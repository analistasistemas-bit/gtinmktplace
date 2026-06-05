# Código da cor nas variações — Design

**Data:** 2026-06-05
**Status:** Aprovado (brainstorming) — pronto para plano
**Branch:** `feat/codigo-da-cor`
**Relacionado:** ADR-0004 (atribuição de cor) · `_shared/cor/extrair.ts` · `process-familia`

## Objetivo

Em alguns produtos, cada cor tem um **código** no campo NOME, **antes** do nome da cor (ex.: `FITA CETIM PROGRESSO N.1 1354 VERMELHO TOMATE 10MT` → código `1354`, cor `Vermelho Tomate`). Esse código é importante para o cliente. Queremos extrair o código **e** o nome comercial exato da cor e exibi-los como **`{Cor} {código}`** (ex.: `Vermelho Tomate 1354`, `Azul Tiffany 247`), na Revisão e no atributo **COLOR** do anúncio no Mercado Livre.

## Achado da checagem do dicionário (motiva o desenho)

O dicionário atual (`DICIONARIO_CORES`, ~40 cores genéricas) **não cobre** os nomes comerciais e os **achata**: `1354 VERMELHO TOMATE` → "Vermelho" (perde "Tomate"); `247 AZ TIFFANY`, `MARSALA`, `AREIA`, `AVEIA` → sem match. Logo, para os produtos com código, **não usamos o dicionário** — extraímos o **texto literal** da cor do próprio NOME.

## Decisões (do brainstorming)

| Tema | Decisão |
|---|---|
| Detecção do código | **Número (dígitos puros) imediatamente antes das palavras de cor.** Falsos positivos (ex.: `10 BCA` → `Branco 10`) são corrigidos pelo operador. |
| Nome da cor | **Texto literal do NOME** (palavras só-letras após o código, até o tamanho), não o dicionário. |
| Abreviações | **Expandir as comuns** via mapa pequeno: `AZ→Azul, VD→Verde, AMA→Amarelo, CL→Claro, ESC→Escuro, BCA→Branco, PTO→Preto`. Depois title-case. |
| Armazenamento | **Embutir na cor** (`variacoes.cor = "Azul Tiffany 247"`). Sem coluna nova. |
| Escopo | **CREATE** (onde o `process-familia` resolve a cor). UPDATE herda a cor já com código. |
| Sem código | Mantém o comportamento atual (dicionário). |

**Fora de escopo (YAGNI):** filtro por nº de dígitos; toggle por família; coluna separada para o código; expandir abreviações além do mapa básico.

## Arquitetura

### 1. Extração — `_shared/cor/extrair.ts`

Nova função pura, independente do dicionário:

```
extrairCorECodigo(nome: string): { cor: string; codigo: string } | null
```

Algoritmo (tokeniza `nome` por espaços):
1. Acha o **último** índice `i` em que `token[i]` é **dígitos puros** (`/^\d+$/`) **e** `token[i+1]` existe e é **só-letras** (`/^\p{L}+$/u`). "Último" porque a cor fica perto do fim (antes do tamanho), o que evita pegar números do tipo-de-produto.
2. Sem candidato → retorna `null` (o chamador cai no dicionário).
3. `codigo = token[i]`.
4. **Palavras de cor**: a partir de `i+1`, pega tokens consecutivos **só-letras**; para no primeiro token que **não** é só-letras (ex.: `10MT`, `2000J`) ou no fim. (Isso descarta o tamanho.)
5. Para cada palavra: se a versão maiúscula está no mapa de abreviações, substitui (`AZ→Azul`…); senão mantém. Depois aplica **title-case** (1ª maiúscula, resto minúsculo, por palavra).
6. `cor = palavras.join(' ')`; retorna `{ cor, codigo }`.

Mapa de abreviações (chave em maiúsculas): `AZ→Azul, VD→Verde, AMA→Amarelo, CL→Claro, ESC→Escuro, BCA→Branco, PTO→Preto`. Extensível.

`extrairCorDoTexto` (dicionário) permanece inalterada — é o fallback.

**Exemplos:**
| NOME | resultado |
|---|---|
| `... N.1 1354 VERMELHO TOMATE 10MT` | `{ cor:'Vermelho Tomate', codigo:'1354' }` |
| `... N.07 247 AZ TIFFANY 10MT` | `{ cor:'Azul Tiffany', codigo:'247' }` |
| `... N.07 2036 VD LIMA 10MT` | `{ cor:'Verde Lima', codigo:'2036' }` |
| `... N.07 2052 AMA CL 10MT` | `{ cor:'Amarelo Claro', codigo:'2052' }` |
| `LINHA P/COST.XIK 120 2000J 10 BCA` | `{ cor:'Branco', codigo:'10' }` (falso positivo — operador edita) |
| `... N.3 PRETO 10MT` (sem dígito antes da cor) | `null` → dicionário |

### 2. Integração — `process-familia` (resolução de cor, Camada 1)

No `pool` que resolve a cor das variações sem cor (`if (v.cor) return v;` segue barrando cor já definida/editada):

```ts
// Camada 0 — código + nome literal quando o NOME tem "{número} {cor}".
const m = extrairCorECodigo(v.nome ?? '');
if (m) return { ...v, cor: `${m.cor} ${m.codigo}`, cor_origem: 'descricao' as OrigemCor };

// Camada 1 — dicionário (comportamento atual), quando não há código.
const corTexto = extrairCorDoTexto([v.nome, claimed.nome_pai, claimed.descricao_pai]);
if (corTexto) return { ...v, cor: corTexto, cor_origem: 'descricao' as OrigemCor };
```

Cache Redis e Vision seguem como estão (cor via Vision não tem código; o código depende do texto do `v.nome`).

### 3. Exibição + ML (sem mudança adicional)

`variacoes.cor` já é renderizada no campo editável da Revisão (`VariacaoCard`) e usada como `value_name` do **COLOR** na publicação (`montarPayloadItem`/`montarVariacaoNova`). Então `"Azul Tiffany 247"` aparece na Revisão (editável — corrige falso positivo) e vai ao anúncio. **Sem migração, sem mudança de frontend.**

## Fluxo de dados

```
v.nome "FITA ... N.1 1354 VERMELHO TOMATE 10MT"
   │  process-familia (CREATE) → extrairCorECodigo
   ▼
variacoes.cor = "Vermelho Tomate 1354"
   ├─► Revisão (campo cor, editável)
   └─► montarPayloadItem/montarVariacaoNova → ML COLOR = "Vermelho Tomate 1354"
```

## Erros & casos de borda

- **Tamanho** (`10MT`, `2000J`): não é só-letras → encerra a coleta de palavras de cor; nunca entra no nome.
- **Sem dígito antes da cor** → `null` → dicionário (produtos não-codificados seguem como hoje).
- **Falso positivo** (`10 BCA` → `Branco 10`) → operador edita o campo de cor.
- **Vários dígitos** (`120 ... 10 BCA`) → usa o último dígito-puro seguido de letras (o mais próximo da cor).
- **Token misto** (`N.07`, `2000J`, `10MT`) → não é dígito-puro nem só-letras → não vira código nem cor.
- **Cor já definida/editada pelo operador** → não sobrescreve (`if (v.cor) return v`).
- **Acentos** no nome da cor (ex.: `PÉROLA`) → title-case preserva o caractere; `\p{L}` cobre acentuados.

## Testes (TDD)

`extrairCorECodigo` — cobre a tabela de exemplos acima (incl. expansão de abreviações, descarte do tamanho, falso positivo do `10 BCA`, e `null` quando não há código). Checagem de abreviações: `AZ/VD/AMA/CL/ESC/BCA/PTO`.

## Documentação

- **Adendo ao ADR-0004:** quando o NOME traz `{número} {cor}`, extrai-se o **código** e o **nome literal** da cor (expandindo abreviações comuns), embutidos em `variacoes.cor` como `"{Cor} {código}"`, exibidos na Revisão e enviados ao ML; sem código, mantém-se o dicionário; falsos positivos são corrigidos pelo operador.
- Atualizar o histórico do `CLAUDE.md` ao concluir.
