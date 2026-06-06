# Spec — Desconto de marketing ("de/para") nos anúncios ML

**Data:** 2026-06-06
**Status:** aprovado (brainstorming) — aguardando plano de implementação
**Relacionado:** ADR-0008 (estratégia de preço), ADR-0016 (publicação UPDATE), ADR-0007 (modelo de dados)

---

## 1. Problema / objetivo

Diego quer que seus anúncios exibam o selo **"X% OFF"** com o preço cheio riscado (ex.: ~~R$ 14,46~~ **R$ 12,29 · 15% OFF**), como gatilho de conversão. Como a Daludi vende mais barato que o mercado (estratégia PRÓPRIO), o desconto é de **marketing**: o preço de venda ("para") continua sendo o `preco_publicacao`; o preço cheio ("de") é **inflado** a partir dele.

No Mercado Livre, o selo é gerado setando `original_price` (o "de") acima de `price` (o "para") no payload do item; o ML calcula e exibe a porcentagem.

Hoje o payload (`_shared/ml/publicar.ts`) manda apenas `price: preco_publicacao` por variação — **não existe `original_price`**.

## 2. Requisitos (decididos no brainstorming)

1. **% de marketing**: padrão/sugestão global **15%**, **editável**.
2. **Ajuste por produto**: cada família pode ter um **% próprio** (override); sem override, usa o global.
3. **Opt-in por produto**: flag **"Exibir com desconto"** por família, **default desmarcado** — o operador escolhe quais produtos recebem o selo.
4. **Toggle por lote**: botão que liga/desliga o desconto em **todas** as famílias do lote de uma vez.
5. **Alcance**: vale para **CREATE** (anúncios novos) e **UPDATE** (anúncios já publicados).
6. **Cálculo do "de"**: `original_price = arredonda(preco_publicacao ÷ (1 − pct/100), 2)`.
7. Revisão humana: o operador vê a prévia do de/para antes de publicar.

## 3. Abordagem escolhida (A — calcular na publicação)

O `original_price` **não é persistido por variação**. É calculado on-the-fly:
- nos workers de publicação, ao montar o payload (fonte da verdade para o ML);
- na Revisão, apenas para **exibir** a prévia.

Vantagem: zero coluna nova por variação; se o preço de publicação mudar (edição na Revisão, estratégia COMPETITIVO), o "de" recalcula sozinho; um único lugar de verdade (o par flag + pct).

## 4. Modelo de dados

### 4.1 Tabela nova `configuracoes` (ADR novo)
1 linha por usuário, guarda preferências globais do operador.

| coluna | tipo | nota |
|---|---|---|
| `user_id` | uuid PK/FK | RLS por user_id |
| `desconto_pct` | numeric(5,2) not null default 15 | % de marketing global |
| `criado_em` / `atualizado_em` | timestamptz | padrão |

- RLS: policy por `user_id` (igual às demais tabelas de domínio).
- Acesso/criação: upsert sob demanda (1ª leitura cria a linha com default 15).

### 4.2 Coluna nova em `familias`
| coluna | tipo | nota |
|---|---|---|
| `exibir_com_desconto` | boolean not null default false | opt-in por família |
| `desconto_pct` | numeric(5,2) null | override do global; `null` = usa o global |

Migrations **aditivas** (sem DROP).

## 5. Cálculo (função pura, TDD)

`calcularPrecoDe(preco: number, pct: number): number | null`
- `pct <= 0` ou `pct >= 100` ou `preco <= 0` → `null` (sem selo).
- senão → `Math.round((preco / (1 - pct/100)) * 100) / 100`.

`pctEfetivo(familiaPct: number | null, globalPct: number): number` → `familiaPct ?? globalPct`.

A **% exibida** pelo ML é derivada por ele de `price`/`original_price`; pode arredondar 1 ponto vs. o `pct` nominal — comportamento aceitável.

## 6. UI

### 6.1 Configurações
- Campo **"Desconto de marketing (%)"**, valor inicial **15**, edição com **auto-save inline** (`Salvando… / ✓ Salvo`).
- Persiste em `configuracoes.desconto_pct`.

### 6.2 Revisão — por produto (`FamiliaRow`)
- Checkbox **"Exibir com desconto"** (default off) → persiste `familias.exibir_com_desconto`.
- Ao marcar: aparece campo **"%"** sugerindo o global (15) e editável → persiste `familias.desconto_pct` (null se igual ao global / não tocado).
- Prévia inline: ~~de~~ **para · N% OFF**, calculada do `preco_publicacao` representativo da família.

### 6.3 Revisão — por lote
- Botão **toggle "Ativar/Desativar desconto no lote"** no topo: marca/desmarca `exibir_com_desconto` de todas as famílias do lote (um update em lote).
- Reflete o estado atual (se todas ligadas → mostra "Desativar").

## 7. Publicação (workers)

`montarPayloadItem` / `montarVariacaoNova` / `montarVariacoesUpdate` recebem o par `{ exibirComDesconto, pctEfetivo }`:
- se `exibirComDesconto` e `calcularPrecoDe(preco, pct)` não-nulo → adiciona `original_price` na variação (e no item, conforme o ML exigir — ver §8);
- senão → **omite** `original_price` (sem selo).

Vale para `publish-familia-ml` (CREATE) e `update-familia-ml` (UPDATE) — **adendo ao ADR-0016** (UPDATE deixa de tocar só estoque e passa a enviar `original_price` quando o flag estiver ligado; demais campos seguem preservados).

## 8. Risco técnico a validar (antes do rollout)

O ML pode **ocultar o selo** ou rejeitar `original_price` por regra de "preço de referência" (anti-desconto-falso / CDC). Além disso, em itens **com variações**, é preciso confirmar **onde** o `original_price` é aceito (nível do item, da variação, ou ambos).

**Plano de validação:** publicar **1 anúncio real** (token AVILBV) com o flag ligado e:
- confirmar que o anúncio sobe sem erro;
- confirmar que o selo "X% OFF" aparece na página;
- ajustar o payload (item vs. variação) conforme o resultado.

Só depois aplicar em massa.

## 9. Edge cases

- Família sem `preco_publicacao` → sem selo (guard do `calcularPrecoDe`).
- `desconto_pct` global ausente → trata como 15 (default da coluna) / ou sem selo se a linha não existir; upsert garante a linha.
- Estratégia COMPETITIVO (preço já abaixado) → o "de" infla sobre o preço competitivo; consistente.
- Edição do preço na Revisão → prévia e publicação recalculam (nada congelado).
- Toggle de lote em lote grande → 1 update em massa por `lote_id`.

## 10. Testes

- `calcularPrecoDe` e `pctEfetivo` — TDD (arredondamento, pct 0/100, preço 0/null, override vs global).
- Adapters/preview no front (riscado, % exibida).
- Montagem do payload com/sem `original_price`.

## 11. Fora de escopo

- Programas de "Oferta do dia"/Deals do ML (mecanismo separado).
- Histórico de preço real para legitimar o "de".
- Agendamento/expiração do desconto.

## 12. ADRs decorrentes

- **ADR novo**: tabela `configuracoes` (preferências do operador; abre espaço para futuras configs).
- **Adendo ADR-0016**: UPDATE envia `original_price` quando `exibir_com_desconto`.
- (Opcional) Adendo ADR-0008: o de/para é camada de marketing sobre o `preco_publicacao`, não altera a estratégia de preço.
