# ADR-0007: Modelo de dados — 4 tabelas principais, sem catalogo_interno separado

**Status:** Aceito
**Data:** 2026-05-26
**Decisores:** Diego (recomendação aceita)

## Contexto

Precisamos modelar no banco:

- Lotes de importação (cada upload de planilha)
- Famílias de produto (PAIs que viram anúncios no ML)
- Variações (filhos = cores)
- Credenciais OAuth do Mercado Livre por usuário
- Cache de buscas de concorrência
- (Opcional) Cache cross-lote para reuso de copy gerada por IA
- (Opcional) Log de auditoria de jobs do QStash

A primeira versão do modelo (durante o brainstorming) tinha 6 tabelas, incluindo `catalogo_interno` (cache cross-lote) e `jobs_log` (auditoria QStash). Após discussão, decidimos simplificar.

## Decisão

**4 tabelas principais no Supabase Postgres:**

1. `lotes` — cada upload de planilha + imagens
2. `familias` — cada PAI = futuro anúncio no ML
3. `variacoes` — cada filho = variação no ML
4. `ml_credentials` — tokens OAuth Meli por usuário

**Cache externo:**
- Upstash Redis para `cache:concorrencia:{gtin}` (TTL 6h) e `cache:cor:{codigo}` (TTL 30d)

**Storage:**
- Supabase Storage bucket `imagens` com RLS por user_id

**Removidos do MVP:**
- ❌ `catalogo_interno` (cache cross-lote para reuso de copy IA) → substituível por `SELECT FROM familias WHERE codigo_pai = X AND ml_item_id IS NOT NULL ORDER BY publicado_em DESC LIMIT 1`
- ❌ `jobs_log` (auditoria de jobs QStash) → dashboard do Upstash + logs do Supabase Edge Functions já cobrem 95% dos casos; só guardamos `qstash_message_id` na própria `familias` para correlação

## Alternativas consideradas

- **Opção A: 6+ tabelas com catalogo_interno e jobs_log dedicados**
  - Pros: separação de responsabilidades; performance teórica em queries de cache; auditoria explícita
  - Cons: duplicação de dados (catalogo_interno espelha familias); sync overhead; ~2× código para tela e migrations; resolve problema que não temos ainda
  - Rejeitada como overengineering pro MVP (volume ~500 produtos/mês não justifica)

- **Opção B: Tabela única "produtos" sem separação família/variação**
  - Pros: schema mais plano
  - Cons: viola normalização; dados do PAI duplicados em cada filho; queries de "agrupar variações" ficam frágeis (`GROUP BY pai_codigo`); difícil escalar para outros tipos de produto
  - Rejeitada — perde a estrutura natural do domínio

- **Opção C: 4 tabelas + cache externo (escolhida)**
  - Pros: schema mínimo viável; fluxo "1 PAI = 1 anúncio com N variações" mapeado naturalmente; cache em Redis evita poluir o Postgres; simples de manter
  - Cons: precisa lembrar que detecção de duplicata é via query em familias (não tabela dedicada); se volume crescer 100×, pode precisar denormalizar para VIEW materializada
  - Aceita

## Consequências

**Boas:**
- Schema mínimo que cobre 100% do MVP
- Menos código de sync, menos pontos de bug
- Migrations futuras são aditivas (acrescentar colunas), não estruturais
- Cache em Redis tem TTL nativo, expira sozinho — sem GC de tabelas crescendo

**Tradeoffs aceitos:**
- Detecção de duplicata depende de uma query (vs lookup direto numa tabela cache) — irrelevante no volume previsto
- Auditoria de jobs depende do dashboard Upstash — perdemos correlação fina com user_id, mas o `qstash_message_id` na familia permite navegar do banco para o dashboard

**Decisões internas do modelo:**

| Aspecto | Decisão | Por quê |
|---|---|---|
| RLS por user_id | Sim, em todas as tabelas de domínio | Multi-tenancy preventivo + isolamento de testes |
| Atributos ML como `jsonb` | Sim, em `familias.atributos_ml` | Categorias do ML têm atributos diferentes; jsonb evita migration para cada nova categoria |
| Tokens OAuth criptografados | Sim, via Supabase Vault (pgsodium) | Tokens são sensíveis; Vault gerencia chave |
| Status como enum Postgres | Sim, em vez de string livre | Erro de digitação vira erro de migration, não bug runtime |
| Coluna `qstash_message_id` em `familias` | Sim, para correlação com dashboard Upstash | Substitui jobs_log com 1 coluna |

**Campos de auditoria de edição IA (acrescidos depois da decisão):**

A tabela `familias` ganha 3 campos extras:
- `titulo_editado_pelo_operador` (boolean)
- `descricao_editada_pelo_operador` (boolean)
- `editado_em` (timestamptz)

Permite, no futuro, medir "qualidade da IA" — se o operador edita demais, sinal de ajustar o prompt.

**Campo de notas internas:**

`familias.observacao_operador text NULL` — espaço livre para notas do operador durante a revisão (não vai para o ML).

**Como reverter:**
- Adicionar tabela `catalogo_interno` no futuro: migration aditiva + população por job único pulando os IDs já existentes em `familias` — fácil
- Adicionar `jobs_log`: migration aditiva + começar a popular a partir do momento que existir — sem perda de dados históricos (porque Upstash dashboard mantém histórico próprio)
