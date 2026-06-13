# ADR-0024: Camada de abstração de canais (Ports & Adapters + strangler fig)

**Status:** Proposto (stub — detalhar no início do épico E1)
**Data:** 2026-06-13
**Decisores:** Diego
**Relaciona:** [evolução SaaS multicanal](../superpowers/specs/2026-06-13-evolucao-saas-multicanal-design.md) (E1); refina ADR-0005/0006 (lifecycle/fila)

## Contexto

O PubliAI publica só no Mercado Livre; a lógica de canal vive em `_shared/ml/*` (18 arquivos) e os
workers (`publish-familia-ml`/`update-familia-ml`) apenas orquestram. É um *adapter implícito* — bem
isolado, mas sem uma interface formal na frente. Para suportar Shopee/Amazon/… sem reescrever, precisamos
de uma "porta" (Ports & Adapters) com o ML como 1º conector.

## Decisão (direção)

- Definir `ChannelConnector` (`_shared/canais/contrato.ts`) com `capabilities` declarativas e os métodos
  `criarAnuncio`/`atualizarAnuncio`/`atualizarEstoque`/`atualizarPreco`/`lerStatus`/`mapearCategoria`/`mapearAtributos`/`lerPedidos?`.
- `MercadoLivreConnector` **delega** às funções `_shared/ml/*` existentes (zero reescrita; testes atuais
  viram testes do adapter).
- `getConnector(canal)` (registry); workers resolvem via registry.
- Idiossincrasias do ML (`listing_type_id`, `EMPTY_GTIN_REASON`, catálogo, descrição separada) ficam
  **dentro** do adapter; o núcleo fala só `AnuncioCanonico` + `ResultadoCanal<T>`.
- Taxonomia de erros unificada generalizando `humanizarErroML`/`ehErroRetentavel`.

## Questões em aberto (resolver no spec do E1)

- Forma exata de `AnuncioCanonico`/`VariacaoCanonica` (quais campos sobem do produto canônico).
- Como `ContextoCanal.getToken()` se integra ao `getValidAccessToken` atual.
- Estratégia de migração dos testes sem perder cobertura.

## Consequências

- Custo baixo, ganho de testabilidade imediato; habilita o 2º canal sem tocar o ML.
- Risco: *leaky abstraction* (conceitos do ML subindo ao canônico) — mitigado por capability flags.
