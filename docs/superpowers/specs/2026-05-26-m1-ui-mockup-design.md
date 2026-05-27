# M1 — UI Mockup com dados fake (Design)

> Spec da fase M1 do PubliAI. Foco: validar UX das 6 telas do produto com dados mockados, sem investir em backend. Saída do M1 alimenta o Plano 02.

**Data:** 2026-05-26
**Status:** aprovado (brainstorming concluído com Diego)
**Plano de implementação:** será gerado em seguida via `superpowers:writing-plans` → `docs/superpowers/plans/`
**Spec relacionado:** [docs/superpowers/specs/2026-05-26-publiai-design.md](./2026-05-26-publiai-design.md)

---

## 1. Goal & non-goals

### Goal
Diego (ou outro operador) consegue percorrer as 6 telas do produto em produção (Render), navegar entre elas com dados realistas mockados, e validar fluxo/UX antes da gente investir no backend.

### Critérios de saída do M1
- [ ] 6 telas navegáveis em produção (Render)
- [ ] Dashboard lista 6+ lotes em estados variados
- [ ] Novo Lote aceita drop visual (sem upload real)
- [ ] Progresso simula execução em ~10s
- [ ] Revisão renderiza 50+ famílias com expansão accordion editável
- [ ] Relatório mostra resumo + erros mockados
- [ ] Configurações exibe ML "conectado" estático
- [ ] Walkthrough ao vivo com Diego: aprovação ou lista de ajustes

### Non-goals (explicitamente fora)
Auth real (Supabase Auth), upload real (Storage), Edge Functions, IA, integração ML, Realtime, persistência, PDF export, toast notifications, atalhos de teclado (J/K/A/R), TanStack Query (mocks são síncronos). Zustand entra **só se** seleção em massa exigir state global; caso contrário, useState local.

---

## 2. Decisões de UX (brainstormadas)

| Decisão | Escolha | Por quê |
|---|---|---|
| Layout shell | **Sidebar persistente + topbar fina** | Clássico dashboard interno. Nav sempre visível pra alternar telas. |
| Auth no M1 | **Skip total** (hardcoded `diego@empresa`) | M1 valida UX do produto, não de auth. Auth chega no M2. |
| Densidade da Revisão | **Tabela densa** (linha por família) | Operador revisa 50+ famílias/sessão em ~30 min. Tabela maximiza famílias por viewport e habilita ações em massa. |
| Expansão de família | **Accordion inline** (várias podem ficar abertas) | Mantém contexto da lista. Familiar (estilo planilha). Mais natural pra editar várias variações em sequência. |
| Tema | **Nova/neutral** (default shadcn 4.8 atual) | Já está configurado. Coerente com ADR-0001. |

---

## 3. App Shell

### Componentes
- `<AppShell>` — wrapper com layout 2-col (sidebar + main)
- `<Sidebar>` — nav vertical fixa
- `<Topbar>` — header fino com breadcrumb + slot de ações
- `<MainArea>` — content area que recebe `<Outlet />` do React Router

### Estrutura visual
```
┌────────────┬──────────────────────────────────────┐
│            │  Breadcrumb         [Action] [Action]│ ← Topbar (~44px)
│            ├──────────────────────────────────────┤
│            │                                      │
│  Sidebar   │                                      │
│  (~180px)  │           Main content               │
│            │           (Outlet de rotas)          │
│  - Dashb.  │                                      │
│  - Novo    │                                      │
│  - Revisão │                                      │
│  - Config. │                                      │
│            │                                      │
│  diego@... │                                      │
└────────────┴──────────────────────────────────────┘
```

### Rotas
```
/                       → Dashboard
/novo-lote              → NovoLote
/progresso/:loteId      → Progresso
/revisao/:loteId        → Revisao
/relatorio/:loteId      → Relatorio
/configuracoes          → Configuracoes
*                       → NotFound (já existe)
```

> Mantém **HashRouter** já implementado no M0 (workaround do bug de rewrite do Render). URLs ficam `/#/revisao/abc-123`.

### Item ativo da sidebar
Detectar via `useLocation()` + comparação por prefixo. Item ativo recebe `bg-accent text-accent-foreground`.

---

## 4. Telas

### 4.1 Dashboard (`/`)
**Conteúdo:**
- Header da página: título "Lotes" + botão `[+ Novo lote]` (CTA primária, direita)
- Lista vertical de `<LoteCard>` em ordem cronológica decrescente
- Estado vazio: empty state com CTA "Importar primeiro lote" (não vai ser usado no M1 porque mock sempre tem itens)

**`<LoteCard>` mostra:**
- Número do lote: `Lote #42`
- Data ISO formatada: `2026-05-25 14:32`
- Badge de status (cor): `importando` / `processando` / `revisão` / `publicando` / `concluído` / `erro`
- Contadores: `38 famílias · 12 publicadas · 1 erro`
- Clique no card:
  - status `revisão` → `/revisao/:loteId`
  - status `concluído` ou `erro` → `/relatorio/:loteId`
  - status `importando` / `processando` / `publicando` → `/progresso/:loteId`

### 4.2 Novo Lote (`/novo-lote`)
**Conteúdo:**
- Título "Novo lote"
- Dropzone **empilhado** (planilha em cima, imagens embaixo — mais simples, evita gambiarra responsive em viewports menores):
  - "Planilha (.xlsx)" — aceita 1 arquivo
  - "Imagens" — aceita N arquivos .jpg/.jpeg/.png
- Preview abaixo de cada dropzone: nome do arquivo da planilha, contagem de imagens
- Validação client-side só de extensão (não abre o conteúdo)
- Botão `[Processar]` desabilitado até ter ≥1 planilha selecionada → cria mock loteId e navega para `/progresso/:loteId`

**Lib:** `react-dropzone` (instalar)

### 4.3 Progresso (`/progresso/:loteId`)
**Conteúdo:**
- Título "Processando Lote #N"
- Stepper visual com 6 etapas:
  1. Upload concluído ✓
  2. Parse da planilha
  3. Match de imagens
  4. Detecção CREATE/UPDATE
  5. Busca de concorrência
  6. Geração de copy IA
- Cada etapa: ícone (✓ feito / ⟳ em andamento / ○ pendente) + label + tempo
- Barra de progresso geral
- Caixa "Resumo": "38 famílias detectadas · 142 variações · 137 imagens matched · 5 órfãs"
- **Simulação:** `setTimeout` avança 1 etapa a cada 2s. Ao terminar (10-12s), botão `[Revisar]` aparece e navega para `/revisao/:loteId`.

### 4.4 Revisão (`/revisao/:loteId`) — **tela central**

**Header:**
- Filtros (chips): `Todos (50)` `CREATE (38)` `UPDATE (12)` `⚠ Com avisos (3)`
- Busca: input com debounce 300ms, filtra por código PAI ou nome
- Contador à direita: `3 selecionadas` em destaque (cor primary)

**Tabela (cada linha = 1 família):**
| col | conteúdo |
|---|---|
| 1 | Checkbox |
| 2 | Thumbnail 32×32 (cor de fundo se sem foto) |
| 3 | Nome família + linha pequena com `PAI 1043812 · 12 cores` |
| 4 | Badge `CREATE` ou `UPDATE` |
| 5 | Preço range `R$ 8,90-12,50` (com ⚠ vermelho se -20%) |
| 6 | Chevron ▼/▲ |

**Expansão accordion (clique no chevron OU na linha):**
- Várias famílias podem ficar abertas ao mesmo tempo
- Conteúdo expandido:
  - **Bloco copy:** título editável, descrição editável (textarea), com `<Input>` controlado. Flag `editado_pelo_operador` muda visual (borda lateral roxa)
  - **Bloco estratégia de preço:** badge `PRÓPRIO` ou `COMPETITIVO`, motivo em texto pequeno
  - **Bloco concorrência:** label "Concorrência: Sem / Moderada / Alta"
  - **Bloco variações:** lista (não tabela) de cards mini editáveis: swatch de cor (24×24) + nome cor (editável) + preço (input) + estoque (read-only, vem da planilha). *No M1 não tem upload de foto por variação — fica para M2.*

**Footer fixo** (sticky bottom):
- Esquerda: `3 selecionadas de 50`
- Direita: `[Rejeitar]` `[Aprovar selecionadas]`

### 4.5 Relatório (`/relatorio/:loteId`)
**Conteúdo:**
- Header: "Relatório · Lote #42 · concluído em 2026-05-25 15:18"
- Cards de resumo (3 colunas):
  - Verde: `37 publicadas`
  - Vermelho: `1 com erro`
  - Cinza: `R$ 0,42 custo IA`
- Lista de famílias publicadas: cada linha com nome, badge CREATE/UPDATE, link `Ver no Mercado Livre →` (href mockado `https://produto.mercadolivre.com.br/MLB-mockid`)
- Lista de erros (se houver): cada linha com nome, mensagem do erro, botão `[Editar e tentar de novo]`
- Botão no topo direito: `[Exportar PDF]` (placeholder; não implementa funcionalidade no M1)

### 4.6 Configurações (`/configuracoes`)
**Conteúdo:**
- Seção "Mercado Livre":
  - Status: badge verde `Conectado como vendedor_mock`
  - Botão `[Desconectar]` (desabilitado — só visual)
- Seção "Estratégia de preço":
  - Radio buttons: ( ) Próprio sempre ( ) Competitivo sempre (•) Condicional (recomendado)
  - Texto explicativo de cada
- Seção "Categorias padrão":
  - 3 dropdowns mockados: Linhas de Costura → MLB1132, Botões → MLB1430, Fitas → MLB1429
  - Texto: "Definidas via ADR-0009"

---

## 5. Estrutura de pastas

```
src/
├── components/
│   ├── ui/                    # shadcn (existente)
│   │   ├── button.tsx         # já existe
│   │   ├── badge.tsx          # novo
│   │   ├── card.tsx           # novo
│   │   ├── checkbox.tsx       # novo
│   │   ├── input.tsx          # novo
│   │   ├── textarea.tsx       # novo
│   │   └── ...                # outros sob demanda
│   ├── app-shell.tsx          # novo
│   ├── sidebar.tsx            # novo
│   ├── topbar.tsx             # novo
│   ├── lote-card.tsx          # novo (Dashboard)
│   ├── dropzone.tsx           # novo (Novo Lote)
│   ├── stepper.tsx            # novo (Progresso)
│   ├── familia-row.tsx        # novo (Revisão — linha colapsada)
│   ├── familia-expanded.tsx   # novo (Revisão — conteúdo accordion)
│   ├── variacao-card.tsx      # novo (Revisão — bloco variação)
│   └── status-badge.tsx       # novo (reutilizado em vários lugares)
├── lib/
│   ├── supabase.ts            # já existe
│   ├── utils.ts               # já existe (shadcn cn)
│   └── mocks/
│       ├── lotes.ts           # novo
│       ├── familias.ts        # novo
│       └── types.ts           # novo (tipos compartilhados)
├── pages/
│   ├── Home.tsx               # já existe → renomear para Dashboard.tsx
│   ├── NotFound.tsx           # já existe
│   ├── NovoLote.tsx           # novo
│   ├── Progresso.tsx          # novo
│   ├── Revisao.tsx            # novo
│   ├── Relatorio.tsx          # novo
│   └── Configuracoes.tsx      # novo
└── ...
```

> `Home.tsx` vira `Dashboard.tsx`. Atualizar import em `App.tsx`.

---

## 6. Mocks

### `src/lib/mocks/types.ts`
Define os tipos compartilhados entre mocks e componentes. **Não** dependem do schema Supabase ainda; são preliminares e serão refinados quando rodarmos `supabase gen types` no M2.

```ts
export type LoteStatus = 'importando' | 'processando' | 'revisao' | 'publicando' | 'concluido' | 'erro';
export type OperacaoML = 'CREATE' | 'UPDATE';
export type EstrategiaPreco = 'PROPRIO' | 'COMPETITIVO';
export type Concorrencia = 'sem' | 'moderada' | 'alta';

export interface Lote {
  id: string;
  numero: number;
  criadoEm: string; // ISO
  status: LoteStatus;
  totalFamilias: number;
  totalPublicadas: number;
  totalErros: number;
}

export interface Variacao {
  codigo: string;
  cor: string;
  corHex: string;
  preco: number;
  estoque: number;
  fotoUrl?: string;
  editadoPeloOperador?: boolean;
}

export interface Familia {
  id: string;
  loteId: string;
  codigoPai: string;
  titulo: string;
  descricao: string;
  operacao: OperacaoML;
  estrategiaPreco: EstrategiaPreco;
  estrategiaMotivo: string;
  concorrencia: Concorrencia;
  precoMin: number;
  precoMax: number;
  precoAbaixo20pc: boolean;
  fotoCapaUrl?: string;
  variacoes: Variacao[];
  editadoPeloOperador?: boolean;
}
```

### `src/lib/mocks/lotes.ts`
6 lotes em estados variados:
1. Lote #42 em `revisao` (50 famílias, 0 publicadas) — alvo principal para testar Revisão
2. Lote #41 em `concluido` (12 famílias, 11 publicadas, 1 erro) — testa Relatório
3. Lote #40 em `concluido` (7 famílias, 7 publicadas) — testa Relatório sem erros
4. Lote #39 em `publicando` (20 famílias, 5 publicadas até agora)
5. Lote #38 em `erro` (estado de falha catastrófica)
6. Lote #37 em `processando` (0 famílias detectadas ainda — testa Progresso)

### `src/lib/mocks/familias.ts`
~50 famílias só para o Lote #42 (o lote em revisão), distribuídas:
- **30 linhas de costura** (cores variadas: vermelho, azul royal, verde bandeira, preto, branco, etc.)
- **10 botões** (3-5 cores cada)
- **5 fitas** (cetim e gorgurão, 3-8 cores)
- **5 zíperes** (várias cores)

Dentro das 50:
- 38 com `operacao: CREATE`, 12 com `UPDATE`
- 3 com `precoAbaixo20pc: true` (alerta vermelho)
- 5 com `concorrencia: alta`, 20 `moderada`, 25 `sem`
- 2-3 com `editadoPeloOperador: true` (visual de borda lateral)

Fotos: usar `<div>` com `background` da cor da variação (não precisa imagem real no M1). Para a foto da capa da família, mesma abordagem (cor neutra ou ícone 📦).

### Hooks de acesso
Não usamos TanStack Query no M1. Hooks simples e síncronos:
```ts
// src/hooks/useLotes.ts (novo)
export function useLotes(): Lote[] {
  return MOCK_LOTES;
}
export function useLote(id: string): Lote | undefined {
  return MOCK_LOTES.find(l => l.id === id);
}
export function useFamilias(loteId: string): Familia[] {
  return MOCK_FAMILIAS.filter(f => f.loteId === loteId);
}
```

> Quando o M2 vier, esses hooks são substituídos por `useQuery({ queryKey: [...] })` mantendo a mesma assinatura — código de componentes não precisa mudar.

---

## 7. Componentes shadcn a adicionar

Adicionar via `pnpm dlx shadcn@latest add <nome>`:

| Componente | Usado em | Nota |
|---|---|---|
| `badge` | Sidebar (item ativo), LoteCard (status), Revisão (CREATE/UPDATE, PRÓPRIO/COMPETITIVO) | |
| `card` | Dashboard (LoteCard), Relatório (cards de resumo), Configurações (seções) | |
| `checkbox` | Revisão (seleção) | |
| `input` | Novo Lote (preview nomes), Revisão (preço editável, busca) | |
| `textarea` | Revisão (descrição editável) | |
| `dialog` | Não obrigatório no M1, mas útil pra "tem certeza?" | |
| `sheet` | Não obrigatório no M1 (escolhemos accordion inline) | |
| `progress` | Progresso (barra) | |
| `dropdown-menu` | Configurações (categorias) | |
| `radio-group` | Configurações (estratégia de preço) | |

---

## 8. Dependências novas
```bash
pnpm add react-dropzone
# (TanStack Query e Zustand NÃO entram no M1)
```

---

## 9. Ordem de implementação (alimenta o Plano 02)

| # | Tarefa | Tempo estimado | Risco |
|---|---|---|---|
| 1 | App shell (Sidebar + Topbar + rotas) | 3h | baixo |
| 2 | Mocks: tipos, lotes, famílias | 2h | médio (precisa ser realista) |
| 3 | Dashboard + LoteCard | 2h | baixo |
| 4 | Novo Lote + Dropzone | 2h | baixo |
| 5 | Progresso + Stepper + simulação | 2h | baixo |
| 6 | **Revisão** (esqueleto: tabela + filtros + busca) | 4h | médio |
| 7 | **Revisão** (expansão accordion + edição inline) | 4h | médio |
| 8 | **Revisão** (seleção em massa + ações) | 2h | baixo |
| 9 | Relatório | 2h | baixo |
| 10 | Configurações | 1h | baixo |
| 11 | Walkthrough com Diego + ajustes | 2h | variável |

**Total bruto:** ~26h (≈ 4-5 dias úteis concentrados).

---

## 10. Aceite final do M1

Demo ao vivo: Diego percorre as 6 telas em produção, navega entre elas, testa a expansão de várias famílias em paralelo, edita um título/preço, marca/desmarca famílias, dispara mock "Aprovar selecionadas" → vê navegação fictícia pra Relatório. Lista de ajustes identificados vira tasks no [TASKS.md](../../TASKS.md) e fecha o M1.

---

## Histórico do design
| Data | Mudança |
|---|---|
| 2026-05-26 | Criação inicial após brainstorming (4 perguntas visuais + 1 conceitual) |
