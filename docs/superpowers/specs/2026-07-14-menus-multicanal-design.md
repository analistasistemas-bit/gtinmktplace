# Spec — Menus multi-marketplace (UI pronta para receber os demais canais)

**Data:** 2026-07-14
**Decisor:** Diego
**Relaciona:** ADR-0024 (abstração de canais), ADR-0025 (`anuncios_externos`), ADR-0061 (fan-out multicanal), ADR-0027 (multi-tenancy), ADR-0047 (permissão de menu)
**Status:** aprovado em brainstorming (2026-07-14); implementação por outro modelo via plano

---

## Objetivo

Preparar toda a UI do PubliAI para os 5 marketplaces (Mercado Livre — ativo; Shopee, Magazine
Luiza, Amazon, Casas Bahia — em breve), de modo que **adicionar um marketplace novo = 1 entrada
no registry + habilitação por org**, sem retrabalho de tela. O backend já é multicanal
(E6/E7 em produção); esta spec cobre só a camada de UI + 1 migration aditiva.

## Decisões travadas (com Diego)

| # | Decisão |
|---|---------|
| D1 | Escopo completo: Fundação + Operação + Análise + Avançado (blocos A+B+C+D do brainstorming) |
| D2 | Tabs de canal no topo de Dashboard, Publicados, Faturamento e Financeiro: **"Todos"** (unificado) + um tab por canal; canais não lançados aparecem com logo acinzentado + "Em breve" (desabilitado, tooltip) |
| D3 | Seletor de canal **global persistido**: escolha segue o operador entre telas; vive na URL (`?canal=`) + memória de sessão; default "Todos" |
| D4 | **Item "Canais" no sidebar** (página própria `/canais`); OAuth do ML migra de Configurações para lá |
| D5 | Arquitetura **híbrida**: registry estático no frontend (catálogo dos marketplaces) + habilitação por org no banco (`organizations.canais_habilitados`) → rollout piloto por cliente sem deploy |
| D6 | A regra do E6 "esconder UI de canal até existir 2º canal" (`src/lib/canais-ui.ts`) **morre**: tabs e vitrine "Em breve" aparecem sempre (roadmap visível é feature do SaaS) |
| D7 | UI de preço por canal (`preco_override`) fica **desenhada mas gated**: só é construída junto do 2º canal real (backend só aplica override no worker genérico, canais ≠ ML) |

## Arquitetura

### Peça 1 — Registry estático (`src/lib/canais.ts`)

Fonte única que desenha tabs, cards e badges:

```ts
export type CanalId = 'mercado_livre' | 'shopee' | 'magalu' | 'amazon' | 'casas_bahia';
export interface CanalInfo {
  id: CanalId;
  nome: string;            // "Mercado Livre"
  corMarca: string;        // "#FFE600"
  Logo: React.FC<...>;     // SVG local (sem CDN)
  status: 'ativo' | 'em_breve';
  capabilities?: { tituloMax?: number; fotosMax?: number; ... }; // usado na pré-validação da Revisão
}
```

Só `mercado_livre` nasce `ativo`. Lançar canal = mudar `status` (deploy) + habilitar nas orgs.

**Nota:** o enum `canal_externo` do banco não precisa dos valores `em_breve` — canal em breve
não grava nada; o valor entra no enum quando o canal for lançado (migration do épico do canal).

### Peça 2 — Habilitação por org (banco)

- `organizations.canais_habilitados text[] NOT NULL DEFAULT '{mercado_livre}'` (aditiva).
- Editada pelo super-admin em `/admin` (Organizações): checklist de canais por org.
- Semântica na UI da org:

| Situação | Aparência |
|---|---|
| `em_breve` no registry | Logo acinzentado + "Em breve" (sempre, para todas as orgs) |
| `ativo` no registry, fora de `canais_habilitados` da org | Continua "Em breve" para essa org |
| Habilitado, sem conexão OAuth | Card "Conectar" na tela Canais; sem tab de dados |
| Habilitado + conectado (`marketplace_connections`) | Tab funcional, badge colorido, dados |

### Estado global — `useCanalAtivo()`

- Valor: `'todos' | CanalId`. Na URL como `?canal=` (mesmo padrão de URL-state da Publicados,
  Onda 2) + persistência de sessão para seguir o operador entre telas.
- Canal inválido/não habilitado na URL → cai para "Todos" silenciosamente.

### Componentes compartilhados

- **`CanalBadge`** — logo + nome (tamanhos sm/md), cor da marca; usado em linhas, cards, selects.
- **`CanalTabs`** — barra no topo: "Todos" + canais habilitados (conectados com contador opcional)
  + em_breve desabilitados com tooltip "Em breve no PubliAI". Light+dark.
- **`useConexoesCanais()`** — generalização de `useMlConnection` (lista `marketplace_connections`
  da org, sem filtro de canal). `useMlConnection` vira wrapper ou é substituído nos call sites.

## Telas

### `/canais` — nova página (sidebar)

- Novo item **Canais** no sidebar; `MenuKey` novo `'canais'` em `src/lib/menus.ts`
  (MENU_KEYS, PREFIX, checklist da tela Usuários). Backfill: perfis com `configuracoes`
  em `allowed_menus` ganham `canais` (migration/script aditivo).
- Grid de cards (um por marketplace do registry), com a cor da marca:
  - **Conectado**: logo colorido, `conta_label`, status da conexão, desconectar.
  - **Disponível** (habilitado sem OAuth): CTA "Conectar" (fluxo OAuth atual do ML, parametrizado).
  - **Em breve**: logo acinzentado + selo.
- OAuth do ML migra de Configurações → Configurações mantém link "Gerenciar canais →".

### Publicados

- `CanalTabs` no topo. Tab de canal = lista filtrada por `anuncios_externos` daquele canal.
- **"Todos"** = visão por produto: linha ganha `CanalBadge`s dos canais onde está publicado,
  cada um com status independente (publicado/erro por canal) e link do anúncio no canal.
- O chip de canal do E6 (gated) vira esse badge, sempre visível.

### Dashboard

- KPIs respeitam o canal ativo; em "Todos": agregado + breakdown por canal nos gráficos
  (empilhado com cor da marca) quando >1 canal tem dados.

### Faturamento e Financeiro

- `CanalTabs` filtram por canal. Estado vazio acionável ("Ainda sem vendas na Shopee →
  Conectar canal").
- Dado: coluna aditiva `ml_vendas.canal text NOT NULL DEFAULT 'mercado_livre'`.
  **Nenhum número muda** com 1 canal; o fluxo que fatura não é tocado.

### Revisão

- Seletor "Publicar em:" passa a ser registry-driven: canais conectados marcáveis;
  `em_breve` visíveis porém desabilitados.
- Pré-validação por capability: ao marcar canal, avisos derivados de `capabilities`
  do registry (ex.: limite de título/fotos) antes de publicar.

## Migration (1, aditiva, reversível)

```sql
alter table organizations add column canais_habilitados text[] not null default '{mercado_livre}';
alter table ml_vendas add column canal text not null default 'mercado_livre';
-- backfill allowed_menus: adicionar 'canais' a quem tem 'configuracoes'
```

Via `supabase migration new` + `supabase db push` (ADR-0043). RLS inalterada (colunas em
tabelas já protegidas).

## Fora de escopo (explícito)

- Conector Shopee/Magalu/Amazon/Casas Bahia (épicos próprios, E5+).
- Estoque por canal (E6b), multi-conta por canal, cutover do ML para o worker genérico.
- UI de `preco_override` (D7: gated, entra com o 2º canal real — desenhada no plano como fase final opcional).
- Webhooks/vendas de outros canais em `ml_vendas` (a coluna `canal` é só preparação).

## Erros e estados

- Conexão com problema de auth → badge de alerta na tab + banner na tela Canais.
- Tab de canal sem dados → estado vazio acionável (CTA conectar/publicar).
- Canal na URL que a org não tem → fallback "Todos".

## Testes e validação

- TDD na lógica: registry helpers, `useCanalAtivo` (URL/sessão/fallback), filtros por canal,
  `visibleMenus` com `canais`, agregação "Todos".
- Testes de `src/lib/canais-ui.ts` reescritos para a regra nova (sempre visível); o arquivo
  antigo é substituído pelo registry.
- Light+dark em tudo; logos SVG locais.
- Gate final: `pnpm lint` + `pnpm test` + validação browser (Dashboard/Publicados/Faturamento/
  Financeiro/Canais idênticos em números com 1 canal; tabs e vitrine visíveis).

## Ordem de implementação (para o plano)

1. Fundação: registry + `CanalBadge`/`CanalTabs` + `useCanalAtivo` + `useConexoesCanais`.
2. Migration + editor de canais por org no `/admin`.
3. Tela `/canais` + menu/permissões + migração do OAuth.
4. Publicados (tabs + visão por produto com badges/status por canal).
5. Dashboard (KPIs + breakdown).
6. Faturamento/Financeiro (tabs + estados vazios).
7. Revisão (seletor registry-driven + pré-validação por capability).
8. *(gated, D7)* UI de preço por canal — só com 2º canal real.
