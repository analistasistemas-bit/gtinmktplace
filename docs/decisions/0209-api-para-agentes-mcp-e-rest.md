# ADR-0209 — API do PubliAI para agentes: MCP e REST sobre uma camada única, chave de agente, v1 só leitura de margens

**Status:** Proposta (entrevista grill-with-docs, 2026-11-22; aguarda aprovação do Diego)
**Data:** 2026-11-22
**Decisores:** Diego
**Relaciona:** [0027](0027-multi-tenancy-organizations.md) (organização), [0092](0092-identidade-da-plataforma-e-acesso-super-admin.md) (super-admin), [0170](0170-central-de-promocoes.md) (ACOS de equilíbrio pelo preço), [0055](0055-imposto-por-origem-nacional-importado.md) (imposto por origem), [0189](0189-extensao-publiai-navegador.md) (precedente de cliente fora do app)
**Glossário:** `CONTEXT.md` § Acesso de agentes (Agente, Chave de agente, Chave de plataforma, Pedido de publicação)

---

## Contexto

Não existe API pública: as edge functions são chamadas pelo front com o JWT do usuário. O Diego quer que outros agentes (claude.ai, ChatGPT, Hermes, OpenClaw, Grokbot, Muse e afins) leiam e, depois, escrevam no PubliAI. A necessidade imediata é **custo, margem e limite de gasto com Ads por produto**, para definir orçamento e ROAS no Mercado Ads sem gastar acima da margem.

## Decisão

1. **Quem chama:** agentes de operadores, em nome de **uma organização** (credencial por organização). Terceiros externos com cadastro aberto ficam fora.
2. **Interface:** uma **camada de serviço única**, com duas portas finas e a mesma chave: **servidor MCP remoto** (Streamable HTTP) e **API REST com OpenAPI** (para bots sem MCP e Actions do ChatGPT).
3. **Autenticação:** **chave de agente**, só o hash guardado, revogável, auditada, com escopo `read` ou `write`. Dois tipos: **chave da organização** (uma loja) e **chave de plataforma** (todas as lojas, **somente leitura**, cada consulta informa a organização). OAuth 2.1 não entra no v1; fica como evolução se o conector MCP do ChatGPT for indispensável (a documentação consultada só lista OAuth ou sem autenticação para ele).
4. **Escrita (v2):** o agente **prepara** (produto, lote, rascunho, custo, estoque interno); publicar ou atualizar no marketplace é **Pedido de publicação**, que espera aprovação humana na fila do app. Nunca escreve direto no canal (regra inegociável do projeto).
5. **v1 = leitura de margens e custos**, nada de escrita. Ferramentas: identificar a organização da chave; margem de um produto (aceita MLB, MLBU, SKU, ID do Product Ads ou trecho do título); lista de margens do catálogo; simulação "e se o preço for X"; qualidade dos dados de custo (opcional).
6. **Cálculo:** reutiliza o **ACOS de equilíbrio pelo preço** (ADR-0170) e a margem s/ venda existentes; ROAS mínimo = 1 ÷ ACOS. Sem motor novo. Custo só de `variacoes.custo` (nunca `familias.custo_centavos`); imposto por origem. Valores em reais (`_brl`). Dado ausente → `null` + motivo, sem margem calculada.
7. **Sem ACOS alvo no v1:** não existe "margem desejada" por organização, e o agente calcula a folga em cima do equilíbrio. Vira item do v2 se pedido.

## Alternativas descartadas

- **OAuth 2.1 em nome do usuário desde o início:** o claude.ai aceita chave fixa no cabeçalho do conector; OAuth pesa mais e tem relatos de instabilidade nos clientes.
- **Só MCP:** deixaria de fora clientes sem MCP e o ChatGPT.
- **Superfície completa (122 edge functions):** explode segurança e testes; as fatias seguintes entram como novas ferramentas.
- **Reimplementar as fórmulas da spec original:** a mesma conta já existe e está validada no app.

## Consequências

- Nova tabela de chaves (migration), com RLS e auditoria de chamadas; edge function(s) com `verify_jwt=false` e autenticação própria pela chave.
- Rate limit por chave; nunca expor dados de compradores, credenciais do ML ou dados internos de fornecedor.
- Aceite por cliente: claude.ai, Hermes e OpenClaw (cabeçalho documentado) e ChatGPT (via REST) precisam de teste real; Grokbot, openbot e Muse estão **não verificados**.

## Pendências para investigar antes do código

- Onde mora o **ID numérico do Product Ads** e se já existe vínculo com MLB/MLBU/SKU (tabelas do `coletar-ads-ml`/`ads-campanhas`).
- Fonte da tarifa (comissão e frete) e o preço vivo com promoção, para os `fee_source`.
- Cobertura real de custo nas organizações (Zaven, AVIL, Daludi) para o critério de aceite.
