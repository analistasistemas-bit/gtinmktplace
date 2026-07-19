# 05 · Modelo de Dados Simplificado

**Tipo Archify:** `architecture` (usado como pseudo-ERD) · **Status:** AS-IS

## Especificação (antes da geração)

- **Mensagem principal:** 8 entidades centrais do domínio, todas isoladas por `org_id`.
- **Público:** novo desenvolvedor, arquiteto.
- **Elementos:** organizations, profiles, marketplace_connections, lotes, familias, variacoes, anuncios_externos, ml_vendas.
- **Relações:** organizations→profiles/marketplace_connections (tenant); lotes→familias→variacoes (núcleo de publicação); familias→anuncios_externos (espelho multicanal); variacoes→ml_vendas (match de venda).
- **Direção de leitura:** topo (tenant/acesso) → meio (núcleo de publicação) → baixo (espelho multicanal e vendas).
- **Omitido:** todas as colunas de cada tabela, tabelas técnicas (ml_perguntas, ml_devolucoes, ml_moderacao, configuracoes, ml_credentials deprecada).
- **Fontes principais:** `docs/reference/modelo-de-dados.md` (fonte única, gerado a partir de `supabase/migrations/`).

## O que mostra

As entidades de negócio que um desenvolvedor precisa conhecer primeiro: quem é o tenant (organizations), como o usuário se conecta a ele (profiles) e ao marketplace (marketplace_connections), e o núcleo do produto — um upload (lotes) vira famílias (1 PAI = 1 anúncio) e variações (1 SKU/cor), que se espelham por canal (anuncios_externos) e casam com vendas reais (ml_vendas).

## Como ler

De cima para baixo: uma organização tem N usuários e N conexões de marketplace (1 por canal). Um lote gera N famílias, cada família tem N variações. Cada família é espelhada em `anuncios_externos` por canal (linha tracejada = escrita assíncrona/dual-write); cada variação pode casar com uma venda real por GTIN.

## Fontes

- `docs/reference/modelo-de-dados.md` (fonte única — gerado de `supabase/migrations/`, ADR-0043)
- `docs/decisions/0027-multi-tenancy-organizations.md` (organizations, marketplace_connections)
- `docs/decisions/0025-anuncios-externos.md` / ADR-0048 (anuncios_externos, split por partição)

## Limitações

- Não é um ERD completo — nenhuma coluna, tipo ou constraint é mostrado; ver `docs/reference/modelo-de-dados.md` para o schema real.
- Omite tabelas de faturamento/pós-venda (`ml_perguntas`, `ml_devolucoes`, `ml_moderacao`, `ml_mensagens`) e configuração (`configuracoes`) — são detalhe, não núcleo.
- `ml_credentials` (deprecada, remoção pendente — Task 17 do E7) não aparece — ver [08](../08-to-be/).
- Os "cards" de contexto (org_id, simplificação) existem no HTML canônico mas **não aparecem no PNG/SVG exportado** — são HTML abaixo do `<svg>`, não parte do desenho. Ver `docs/architecture/archify-usage.md`.

## Atualização

- **Última revisão:** 2026-07-19.
- **Regenerar quando:** uma nova entidade central for criada; o modelo de tenant mudar; `ml_credentials` for removida (Task 17).
- **Como regenerar:**
  ```bash
  node bin/archify.mjs validate architecture <caminho>/diagram.architecture.json --json
  node bin/archify.mjs render architecture <caminho>/diagram.architecture.json <caminho>/diagram.html
  ```
  Exportar SVG/PNG: ver `docs/architecture/archify-usage.md`.
