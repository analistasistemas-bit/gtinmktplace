---
title: PubliAI — Spec de Design
data: 2026-05-26
versao: 1.0
status: Aprovado pelo cliente (Diego), pronto para writing-plans
autores: Diego (cliente + desenvolvedor) + Claude Code (facilitador do brainstorming)
substitui: Proposta comercial v1.1 de Leonardo Freitas (21/05/2026)
---

# PubliAI — Spec de Design

## Sumário Executivo

**O que é:** sistema web interno que transforma planilhas de produtos (exportadas do sistema interno da empresa) em anúncios publicados no Mercado Livre, usando IA como copywriter especializado em aviamentos, com inteligência de concorrência e revisão humana em lote.

**Por que existe:** publicar manualmente dezenas de milhares de produtos no marketplace é lento, repetitivo e produz anúncios de baixa qualidade. Uma proposta comercial externa (Leonardo Freitas) foi inviável financeiramente; este projeto é o desenvolvimento interno equivalente, com escopo enxuto e stack moderno.

**MVP foca em:** aviamentos (linha de costura, botões, fitas), publicados no Mercado Livre, com variações nativas agrupadas por código PAI, e detecção de famílias já publicadas para atualização de estoque/preço.

**Prazo:** 8-10 semanas de desenvolvimento (com 3-4 semanas de buffer dentro do limite de 3 meses).

**Stack:** React + TypeScript + Vite + shadcn/ui no frontend; Supabase (DB + Auth + Storage + Edge Functions) para backend; Upstash QStash (fila) + Redis (cache); OpenAI GPT-4o-mini (copywriting) + Vision (atribuição de cor); Render para hospedagem do frontend.

**Custo operacional estimado:** $3–28/mês para o volume previsto.

---

## 1. Contexto e Problema

### A empresa
Empresa de tecidos e aviamentos com **dezenas de milhares de produtos** em catálogo interno. Vende em loja física, e quer entrar agressivamente no Mercado Livre. Tem **conta de vendedor aprovada** no ML.

### O processo manual atual
1. Operador escolhe família de produto a publicar (~50 itens)
2. Para cada produto, pesquisa manualmente o EAN na internet
3. Redige título e descrição do zero
4. Verifica concorrência manualmente
5. Cadastra um a um no painel do ML
6. Resultado: leva **dias** por lote, com anúncios de qualidade variável

### A dor
- **Tempo:** processo manual não escala para o catálogo total
- **Qualidade:** copywriting feito sob pressão produz títulos curtos, descrições genéricas, atributos faltantes
- **Receita:** muitos produtos nunca são anunciados — receita ficando na mesa

### O contexto que muda o jogo
A empresa já tem:
- ✅ Catálogo digital organizado em **sistema interno próprio** (com nome, atributos técnicos, peso, dimensões)
- ✅ Banco de **fotos profissionais** em servidor de arquivos Windows, organizadas por código de produto

O que falta é a **copy de vendas persuasiva** que transforma especificação técnica em desejo de compra. Essa é a hipótese central que reposiciona o projeto: **não é um sistema de enriquecimento de dados — é um copywriter automatizado.**

---

## 2. Solução

### Arquitetura conceitual

```
Sistema interno da empresa
   │
   │ (operador exporta planilha + seleciona pasta de imagens)
   ▼
PubliAI (web)
   │
   ├─► Importa planilha + imagens (drag & drop)
   ├─► Agrupa famílias por código PAI
   ├─► Detecta famílias já publicadas (CREATE vs UPDATE)
   ├─► Para famílias novas:
   │    ├─► IA copywriter: gera título + descrição + atributos ML
   │    ├─► IA Vision: identifica cor quando ausente da descrição
   │    └─► Busca concorrência no ML + sugere preço (PRÓPRIO ou COMPETITIVO)
   ├─► Para famílias atualizando: prepara payload de estoque/preço
   ├─► Apresenta tudo em tela de revisão em lote (edição inline)
   └─► Após aprovação: publica via API ML
        │
        ▼
   Anúncio único no ML com N variações (cores)
```

### Por que essa abordagem ganha
- **IA como copywriter** (não como inventor de dados) — direção mais previsível e mais barata
- **Variações agrupadas por PAI** — anúncio único acumula reputação, alinhado com recomendação da Meli para esses segmentos
- **Operador como rede de segurança** — IA gera, operador valida; auditoria captura onde IA erra
- **Stack via MCPs já configurados** — zero infra fixa, dia 1 produtivo

---

## 3. Usuários e Stakeholders

### Usuário-operador (único no MVP)
- 1 funcionário interno da empresa
- Perfil: escritório, familiarizado com Excel, **não-técnico**
- Frequência: lotes recorrentes de ~50 produtos por família de produto
- Objetivo: publicar produtos rápido, sem ter que pensar em copy ou checagem manual

### Desenvolvedor (também único)
- Diego: funcionário interno da empresa
- Perfil: AI-assisted developer (vibe coder), confortável com Python/JS/TS/React, prefere ferramentas integradas via MCP
- Esse spec foi co-criado por Diego — não é "vendido" para um terceiro

### Stakeholders adicionais (não diretamente envolvidos)
- Gerente da loja / dono — recebe relatórios mensais agregados
- Equipe de marketing — pode consumir copy gerada para outros canais (futuro)

---

## 4. Escopo do MVP

### Dentro do escopo
- Pipeline completo: importar → IA → revisar → publicar
- Foco em **aviamentos** (linha de costura, botões, fitas)
- Único marketplace: **Mercado Livre**
- Variações agrupadas por código PAI ([ADR-0003](../../decisions/0003-variacoes-agrupadas-por-pai.md))
- Atribuição de cor via parser de texto + Vision como fallback ([ADR-0004](../../decisions/0004-atribuicao-de-cor.md))
- Detecção CREATE vs UPDATE ([ADR-0005](../../decisions/0005-lifecycle-publish-and-update.md))
- Estratégia de preço condicional (PRÓPRIO se sem concorrência, COMPETITIVO se houver) ([ADR-0008](../../decisions/0008-estrategia-de-preco-condicional.md))
- Tela de revisão em lote com edição inline
- Relatório do lote com links pros anúncios publicados
- Auditoria de edição da IA (`editado_pelo_operador`)

### Fora do escopo (diferido para v2+)
- Tecidos ([ADR-0002](../../decisions/0002-mvp-aviamentos-primeiro.md))
- Outros marketplaces (Shopee, Magalu, Amazon)
- Sincronização contínua com sistema interno (CDC/webhook/polling)
- Multi-usuário com permissões
- Dashboard analítico de vendas
- Bot/IA respondendo perguntas dos compradores
- Tabela de-para fornecedor → cor
- Estratégias de preço configuráveis por lote

---

## 5. Arquitetura Técnica

Decisão completa: [ADR-0001 — Stack Tecnológico](../../decisions/0001-stack-tecnologico.md)

### Componentes principais
- **Frontend (Render Static Site):** React 18 + TypeScript + Vite + shadcn/ui + Tailwind + TanStack Query
- **Supabase:** Auth + Postgres + Storage + Edge Functions + Realtime + Vault
- **Upstash QStash:** fila assíncrona ([ADR-0006](../../decisions/0006-qstash-em-vez-de-postgres-queue.md))
- **Upstash Redis:** cache (concorrência TTL 6h, cor TTL 30d)
- **OpenAI:** GPT-4o-mini (copy) + GPT-4o Vision (cor)
- **API Mercado Livre:** OAuth 2.0 + endpoints de itens

### Fluxo de dados (alto nível)
```
[Browser] --upload--> [Supabase Storage]
[Browser] --POST------> [Edge: ingest-lote] --parse + persist--> [Postgres]
                                        |
                                        |--enqueue--> [QStash]
                                                          |
                                                          v
                                    [Edge: process-familia] (paralelo)
                                          |
                                          ├──> [OpenAI Copy + Vision]
                                          ├──> [ML API: buscar concorrência]
                                          └──> [Postgres: ready_for_review]
                                                  |
                                                  v Realtime
                                          [Browser: tela revisão]
                                                  |
                                                  v aprovação
                                          [Edge: publish-lote] --enqueue--> [QStash]
                                                                                  |
                                                                                  v
                                                              [Edge: publish-familia-ml]
                                                                                  |
                                                                                  ├──> [ML API: POST/PUT /items]
                                                                                  └──> [Postgres: published]
```

---

## 6. Modelo de Dados

Decisão completa: [ADR-0007 — Modelo de Dados 4 Tabelas](../../decisions/0007-modelo-de-dados-4-tabelas.md)

### Tabelas
1. `lotes` — cada upload de planilha + imagens
2. `familias` — cada PAI = futuro anúncio no ML
3. `variacoes` — cada filho (cor) = variação no ML
4. `ml_credentials` — tokens OAuth Meli por usuário (criptografados via Vault)

### Campos adicionais (após ADR-0009)

Para suportar todos os campos obrigatórios do payload da API ML:

**Em `familias`:**
- `tipo_aviamento enum('linha','botao','fita','outro')` — detectado por regex + fallback IA
- `tipo_origem enum('regex','ia','manual')` — auditoria da atribuição
- `categoria_ml_id text` — preenchido via lookup determinístico, não pela IA
- `shipping_mode text default 'me2'` — modo de envio (Mercado Envios 2)
- `frete_gratis boolean default false` — configurável em Configurações
- `sale_terms jsonb` — garantia padrão (30 dias do vendedor)

**Em `variacoes`:**
- `preco_publicacao numeric` — preço após cálculo da estratégia condicional (preserva `preco` original para auditoria)

Defaults e mapeamento completo de campos do payload ML estão em [ADR-0009](../../decisions/0009-campos-payload-ml-e-categoria-deterministica.md).

### Cache (Upstash Redis)
- `cache:concorrencia:{gtin}` — TTL 6h
- `cache:cor:{codigo}` — TTL 30d

### Storage (Supabase)
- Bucket `imagens` privado, RLS por user_id
- Padrão de path: `{user_id}/{codigo_8_digitos}.jpeg`

### RLS
Todas as tabelas têm `user_id` e política `auth.uid() = user_id`. Edge Functions usam service role para bypass quando necessário.

### Schema da planilha de entrada
Colunas esperadas (obrigatórias):

| Coluna | Tipo | Função |
|---|---|---|
| `CODIGO` | numérico | identificador único do produto |
| `PAI` | numérico | código do produto pai; `0` se for ele próprio o pai |
| `NOME` | texto | descrição curta |
| `UNIDADE` | texto | `CN` (cone), `PC` (peça), etc. |
| `GTIN` | texto | EAN/código de barras (pode ser nulo ou interno `3000*`) |
| `PRECO` | decimal | preço de venda da empresa |
| `ESTOQUE` | inteiro | quantidade disponível |
| `DESCRICAO_DETALHADO` | texto | descrição técnica seca |
| `PESO_GRAMAS` | decimal | peso de embalagem |
| `ALTURA_CM`, `LARGURA_CM`, `COMPRIMENTO_CM` | decimal | dimensões de embalagem |

### Convenção de imagens
- Uma única foto por código de produto
- Nome do arquivo: `00CODIGO.jpeg` (8 dígitos com zero à esquerda, ex: `00220566.jpeg`)
- Imagem do anúncio agrupado (capa) = foto do PAI se existir; caso contrário, foto da primeira variação encontrada

---

## 7. Pipeline de Processamento

### Etapa 1: Ingestão (`ingest-lote`)
Frontend faz upload direto ao Storage; chama Edge function que:
- Parse `.xlsx` (SheetJS)
- Valida colunas obrigatórias
- Agrupa por PAI
- Match imagens ↔ códigos
- Detecta CREATE vs UPDATE (query `familias.ml_item_id`)
- Persiste no banco
- Enfileira 1 job QStash por família

### Etapa 2: Processamento da família (`process-familia`)
Disparada por QStash, **idempotente**, em paralelo. Para famílias novas:
- Para cada variação: extrai cor (texto primeiro, Vision fallback)
- Chama OpenAI para gerar título + descrição + atributos ML
- Chama API ML para verificar concorrência (com cache Redis)
- Calcula preço sugerido condicionalmente
- Marca `status = ready_for_review`

Para famílias UPDATE: pula IA + concorrência, só prepara payload de atualização.

### Etapa 3: Revisão (frontend, Realtime)
Operador vê famílias ao vivo conforme processadas; revisa, edita inline, aprova ou rejeita.

### Etapa 4: Publicação (`publish-lote` + `publish-familia-ml`)
- `publish-lote` enfileira famílias aprovadas
- `publish-familia-ml` monta payload com variações + faz POST/PUT na API ML
- Em erro: QStash retry com backoff (até 3 tentativas)
- Em sucesso: salva `ml_item_id`, `ml_permalink`, `ml_variation_id`s

### Idempotência
Toda Edge Function disparada por QStash deve verificar o `status` da família e fazer UPDATE atômico para evitar duplo processamento. Padrão completo: [ADR-0006](../../decisions/0006-qstash-em-vez-de-postgres-queue.md).

---

## 8. Prompts da IA

### Copywriter (GPT-4o-mini)

> ⚠ **Revisado em 2026-05-26** após ADR-0009 — a categoria ML deixou de ser escolhida pela IA (alto risco de alucinação de `MLB####`). Agora vem por lookup determinístico baseado em `tipo_aviamento` e é passada como **input** ao prompt, não pedida como output.

```
SISTEMA: Você é um copywriter especializado em aviamentos para
marketplace brasileiro. Recebe dados técnicos secos e gera anúncio
para Mercado Livre.

REGRAS:
- Título: ≤ 60 caracteres, palavra-chave de busca primeiro, sem caixa alta exagerada
- Descrição: 800-1500 caracteres, persuasiva, com benefícios, instruções de uso, FAQs
- Português brasileiro do varejo (não acadêmico)
- Atributos: gere apenas os listados em `atributos_obrigatorios` (passados como input)
  Para cada atributo, retorne `{id, value_name}` — NÃO use IDs não listados
- NÃO invente especificações ausentes — omita se faltar
- NÃO escolha categoria — você não decide isso

ENTRADA:
- Nome da família (PAI): {pai_nome}
- Descrição técnica (PAI): {pai_descricao}
- Tipo de aviamento: {tipo_aviamento}  // 'linha' | 'botao' | 'fita'
- Categoria ML (já definida): {categoria_ml_id}  // ex: MLB1132
- Atributos obrigatórios da categoria: [{id, descricao, valores_aceitos?}]
- Unidade de venda: {unidade}
- Variações: [{codigo, cor}, ...]

SAÍDA (JSON estrito):
{
  "titulo": "...",
  "descricao": "...",
  "atributos_ml": [{"id": "<id da entrada>", "value_name": "..."}]
}
```

### Classificador de tipo (GPT-4o-mini, prompt mínimo)

Acionado só quando o regex/dicionário de palavras-chave falha (ver ADR-0009):

```
SISTEMA: Você é um classificador. Dado o nome de um produto de aviamento,
responda APENAS com uma das opções: linha | botao | fita | outro.
Não invente categorias. Se não tiver certeza, responda "outro".

ENTRADA: {pai_nome}
SAÍDA: <uma palavra>
```

### Vision para cor
```
SISTEMA: Identifique a cor predominante do objeto na foto.
Responda APENAS com o nome da cor em português, padronizado.

REGRAS:
- Use nomes como "Preto", "Branco", "Vermelho", "Azul Royal", "Verde Bandeira", "Cru", "Bege"
- Identifique a cor do PRODUTO em si (ignore fundo, etiquetas, embalagem)
- Em tons próximos, escolha o mais genérico
- Resposta em uma única linha, sem pontuação adicional

ENTRADA: [imagem]
SAÍDA: <nome da cor>
```

Os prompts são versão inicial — esperar 1-2 ciclos de iteração com lotes reais no M3.

---

## 9. UX e Telas

Telas mapeadas (detalhadas com wireframes ASCII no histórico do brainstorming; reproduzidas aqui em forma condensada):

1. **Login / Cadastro** — Supabase Auth padrão
2. **Dashboard** — lista de lotes com status visual + botão "Novo lote"
3. **Novo Lote** — dropzones para planilha e imagens; valida tipos; preview de quantidade
4. **Progresso** — etapas com checkpoints; barra de progresso; resumo do lote; atualiza ao vivo via Realtime
5. **Revisão em Lote (tela CORE)** — cards de família expansíveis, badge CREATE/UPDATE, copy/preço/concorrência/estratégia, edição inline, atalhos de teclado, seleção em massa, filtros
6. **Relatório Final** — sucesso/erro por família, links pros anúncios publicados, exportar PDF
7. **Configurações** — conexão ML, categorias padrão (a estratégia de preço é automática conforme ADR-0008)

### Princípios de UX
- **Densa de informação** na tela de revisão (50 famílias visíveis sem rolagem excessiva)
- **Edição inline em todo campo** (clique no ✏ vira input)
- **Visualização da decisão automática** sempre (qual estratégia de preço, por quê)
- **Atalhos de teclado** para o operador power-user (J/K para navegar, A/R para aprovar/rejeitar)
- **Realtime de progresso** — operador não precisa recarregar página

### Componentes shadcn/ui
Card, Badge, Button, Input, Tabs, Dialog, Sheet, Table, Progress, Toast (Sonner), Dropdown, Skeleton.

---

## 10. Roadmap e Marcos

Detalhe completo (com critérios de saída e estimativas) em [ROADMAP.md](../../ROADMAP.md).

**Resumo:**

| Marco | Duração | Objetivo |
|---|---|---|
| M0 | 1 sem | Setup de contas, repos, ambiente |
| M1 | 1 sem | UI mockup com dados fake (validação de UX) |
| M2 | 2 sem | Backend core (schema, auth, ingest, Realtime) |
| M3 | 2 sem | IA copywriting + Vision para cor |
| M4 | 2 sem | Integração Mercado Livre (OAuth, publish, busca) |
| M5 | 1 sem | Polimento e bug bash |
| M6 | 1 sem | Lançamento controlado |

Total: 10 semanas. Buffer de 3 semanas dentro do limite de 3 meses.

**Trilho paralelo crítico:** aprovação do app no portal Mercado Livre Developers — começar **imediatamente**, não bloqueia desenvolvimento até M4.

---

## 11. Riscos e Mitigações

Detalhe completo em [ROADMAP.md](../../ROADMAP.md#riscos-do-cronograma).

Top 3:
1. **Aprovação ML demora** — começar trilho paralelo hoje; dev em sandbox até liberar
2. **Prompt IA exige iterações** — iterar com lotes pequenos no M3; benchmark "ground truth"
3. **Edge cases da planilha real** — bug bash dedicado no fim do M2

---

## 12. Definição de "MVP entregue"

- [ ] Operador faz login + conecta Mercado Livre do zero
- [ ] Operador importa planilha + imagens reais sem erro
- [ ] Sistema processa lote de 50 famílias em < 10 min
- [ ] Operador revisa e aprova lote em < 30 min (≥ 5× ganho vs manual)
- [ ] ≥ 95% das famílias aprovadas publicam com sucesso na primeira tentativa
- [ ] Reprocessar família com erro em 1 clique
- [ ] UPDATE vs CREATE detectados corretamente
- [ ] Relatório final com links clicáveis pros anúncios
- [ ] Documentação `docs/` atualizada com ADRs de novas decisões durante a implementação
- [ ] Custo operacional < $50/mês

---

## 13. ADRs vinculados

Decisões arquiteturais que cobrem este design:

- [ADR-0001](../../decisions/0001-stack-tecnologico.md) — Stack tecnológico (Supabase + Render + Upstash + React/TS + shadcn)
- [ADR-0002](../../decisions/0002-mvp-aviamentos-primeiro.md) — MVP começa por aviamentos
- [ADR-0003](../../decisions/0003-variacoes-agrupadas-por-pai.md) — Variações agrupadas por PAI
- [ADR-0004](../../decisions/0004-atribuicao-de-cor.md) — Atribuição de cor (texto → Vision)
- [ADR-0005](../../decisions/0005-lifecycle-publish-and-update.md) — Lifecycle publish + update
- [ADR-0006](../../decisions/0006-qstash-em-vez-de-postgres-queue.md) — QStash em vez de Postgres queue
- [ADR-0007](../../decisions/0007-modelo-de-dados-4-tabelas.md) — Modelo de dados 4 tabelas
- [ADR-0008](../../decisions/0008-estrategia-de-preco-condicional.md) — Estratégia de preço condicional
- [ADR-0009](../../decisions/0009-campos-payload-ml-e-categoria-deterministica.md) — Campos obrigatórios do payload ML + categoria via lookup determinístico

---

## 14. Próximos passos

1. **Diego revisa este spec** e indica eventuais ajustes finais
2. **Spec aprovado** → transição para a skill `writing-plans`
3. **Plano de implementação detalhado** é escrito (granularidade fina, próximo de tarefas executáveis)
4. **M0 inicia** com setup do ambiente
5. **Trilho paralelo: app ML Developers** começa imediatamente em paralelo ao M0

---

## Apêndices

### A. Glossário
- **PAI:** código de produto que agrupa variações; tem o campo `PAI = 0` na planilha
- **Filho:** variação concreta (cor) de uma família; tem o campo `PAI = <codigo do pai>`
- **Lote:** uma sessão de importação (1 upload de planilha + imagens)
- **Família:** representação no sistema do PAI; vira 1 anúncio no ML
- **Variação:** representação no sistema de cada filho; vira 1 variação dentro do anúncio
- **CREATE / UPDATE:** operações de publicação no ML (criar anúncio novo ou atualizar existente)

### B. Arquivos relacionados
- [ROADMAP.md](../../ROADMAP.md) — visão estratégica das fases
- [TASKS.md](../../TASKS.md) — checklist operacional
- [decisions/](../../decisions/) — todos os ADRs
- README do projeto (raiz) — visão de alto nível (a criar quando código existir)

### C. Histórico
- 2026-05-25: brainstorming iniciado por Diego, após rejeição da proposta comercial de Leonardo Freitas (v1.1)
- 2026-05-26: design completo aprovado por Diego em 6 seções; criação dos 8 ADRs iniciais; criação de ROADMAP + TASKS + este spec
