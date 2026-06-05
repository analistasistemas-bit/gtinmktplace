# Código da cor nas variações — Design

**Data:** 2026-06-05
**Status:** Aprovado (brainstorming) — pronto para plano
**Branch:** separada (worktree criado na execução)
**Relacionado:** ADR-0004 (atribuição de cor) · `_shared/cor/extrair.ts` · `process-familia`

## Objetivo

Em alguns produtos, cada cor tem um **código** que aparece no campo NOME **antes** do nome da cor (ex.: `FITA CETIM PROGRESSO N.1 1354 VERMELHO TOMATE 10MT` → código `1354`, cor `Vermelho Tomate`). Esse código é importante para o cliente. Queremos extraí-lo e exibi-lo junto da cor, no formato **`{Cor} {código}`** (ex.: `Vermelho Tomate 1354`, `Azul Tiffany 247`, `Azul Bebê 212`), tanto na Revisão quanto no atributo **COLOR** do anúncio no Mercado Livre.

## Decisões (do brainstorming)

| Tema | Decisão |
|---|---|
| Detecção do código | **Qualquer número solto imediatamente antes do nome da cor** (de qualquer tamanho). Falsos positivos (ex.: `10 BCA` → `Branco 10`) são corrigidos pelo operador na Revisão. |
| Armazenamento | **Embutir na cor** (`variacoes.cor = "Azul Tiffany 247"`). Sem coluna nova. A cor já alimenta a tela e o ML. |
| Formato | `{Cor canônica} {código}` — o código, que no NOME vem **antes**, é exibido **depois** da cor. |
| Escopo | **CREATE** (onde o `process-familia` resolve a cor). UPDATE herda a cor já com o código. |

**Fora de escopo (YAGNI):** filtro por nº de dígitos; toggle por família; coluna separada para o código.

## Arquitetura

### 1. Extração — `_shared/cor/extrair.ts`

Hoje `extrairCorDoTexto(textos)` devolve só a cor canônica (sem posição). Adicionamos uma função que também devolve o código:

- `extrairCorECodigo(nome: string): { cor: string; codigo: string | null } | null`
  - Reusa `DICIONARIO_CORES`/`TERMOS` (já ordenado do sinônimo **mais longo** para o mais curto).
  - Acha o **primeiro** sinônimo que casa em `nome` (o mais longo vence) e captura sua **posição** (índice do match).
  - A partir do início do match, olha **para trás**: pula espaços e captura um **token numérico solto** (`\d+` precedido por espaço/início e seguido por espaço) imediatamente antes da cor → esse é o `codigo`.
  - Sem número solto imediatamente antes → `codigo: null`.
  - Nenhum sinônimo casa → retorna `null`.
  - Usar o sinônimo mais longo é o que evita ancorar no `AZ` de `AZ TIFFANY`: casa `az tiffany` inteiro, então o token anterior é `247` (e não o `AZ`). Requer que o dicionário tenha o sinônimo composto; quando só houver o sinônimo curto, o número pode não ser capturado (cai em `codigo: null`) — aceitável, o operador edita.

Para obter a posição do match sem duplicar a lista de termos, a implementação expõe internamente o `regex` de cada termo (já existe em `TERMOS`) e usa `String.prototype.search`/`match` para o índice. `extrairCorDoTexto` permanece inalterada (consumidores atuais não mudam).

### 2. Integração — `process-familia` (resolução de cor, Camada 1)

No `pool` que resolve a cor de cada variação sem cor (`if (v.cor) return v;` continua barrando cor já definida/editada):

```ts
// Camada 1 — dicionário, agora com código da cor quando o NOME tem "{número} {cor}".
const m = extrairCorECodigo(v.nome ?? '');
if (m) {
  const cor = m.codigo ? `${m.cor} ${m.codigo}` : m.cor;
  return { ...v, cor, cor_origem: 'descricao' as OrigemCor };
}
// Fallback: cor (sem código) a partir do pai/descrição — o código é por variação e vem do v.nome.
const corTexto = extrairCorDoTexto([claimed.nome_pai, claimed.descricao_pai]);
if (corTexto) return { ...v, cor: corTexto, cor_origem: 'descricao' as OrigemCor };
```

Os caminhos de **cache Redis** e **Vision** seguem como estão (a cor resolvida por Vision não tem código, pois o código depende do texto do `v.nome`).

### 3. Exibição + ML (sem mudança adicional)

- `variacoes.cor` já é renderizada no campo editável da Revisão (`VariacaoCard`) e usada como `value_name` do atributo **COLOR** na publicação (`montarPayloadItem`/`montarVariacaoNova`).
- Logo, `"Azul Tiffany 247"` aparece na Revisão (editável — corrige falso positivo) e vai ao anúncio. **Sem migração, sem mudança de frontend.**

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

- **Número depois da cor** (ex.: `10MT`) é ignorado — só conta o token imediatamente **antes** do match.
- **Sem número antes** → cor sem código (comportamento atual).
- **Falso positivo** (`10 BCA` → `Branco 10`) → operador edita o campo de cor na Revisão.
- **Cor resolvida só por descrição/Vision** (não está no `v.nome`) → sem código (anchor é o `v.nome`).
- **Token numérico colado em outro** (`N.07`, `2000J`, `10MT`) → não é token solto de dígitos puros, não é capturado como código.
- **Cor já definida/editada pelo operador** → não é sobrescrita (`if (v.cor) return v`).

## Testes (TDD)

`extrairCorECodigo`:
- `"FITA CETIM PROGRESSO N.1 1354 VERMELHO TOMATE 10MT"` → `{ cor: 'Vermelho Tomate', codigo: '1354' }`
- `"FITA CETIM PROGRESSO N.07 247 AZ TIFFANY 10MT"` → `{ cor: 'Azul Tiffany', codigo: '247' }`
- cor sem número antes (`"FITA CETIM PROGRESSO N.3 PRETO 10MT"`) → `{ cor: 'Preto', codigo: null }`
- nenhum sinônimo de cor → `null`
- número só depois da cor → `codigo: null`

## Documentação

- **Adendo ao ADR-0004:** quando o NOME traz `{número} {cor}`, o número (qualquer tamanho) é extraído como **código da cor** e embutido na cor (`"{Cor} {código}"`), exibido na Revisão e enviado ao ML; falsos positivos são corrigidos pelo operador.
- Atualizar o histórico do `CLAUDE.md` ao concluir.
