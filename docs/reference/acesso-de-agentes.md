# Referência — Acesso de agentes (ADR-0210, fatia 1)

> Estado: em produção desde 2026-11-22, em piloto na Zaven (módulo `agentes` desligado por padrão nas demais organizações). Decisão: [ADR-0210](../decisions/0210-acesso-de-agentes-mcp.md). Tabelas: [modelo-de-dados.md](modelo-de-dados.md). Edges: [edge-functions.md](edge-functions.md). Contrato técnico (protocolo, esquemas, campos, erros, limites): [api-agentes.md](api-agentes.md).

## O que é

Um servidor **MCP remoto, somente leitura**, que deixa um assistente de IA consultar a margem dos anúncios do Mercado Livre de **uma** loja do PubliAI. O caso de uso é definir orçamento e ROAS no Mercado Ads sem passar da margem do produto.

O agente não altera nada: não publica, não muda preço, não pausa, não mexe em promoção. A margem é a mesma da aba Campanhas do `/ads` (função `detalheEquilibrioDoMlb`), sem fórmula própria.

## Como ligar

1. Na Central de controle, ligar o módulo **Acesso de agentes** da organização (vem desligado).
2. Um administrador abre **Configurações → Conexões de agentes → Nova conexão**, dá um nome e escolhe a validade: **Até revogar** (padrão), 30, 90 ou 365 dias (ADR-0210, Emenda 1).
3. Copiar a chave. Ela é exibida **uma única vez**; depois só o prefixo (`pai_xxxxxxxx_…`) aparece na lista. Se perder, revogue e crie outra.

A chave tem o formato `pai_<8 hex>_<43 caracteres base64url>` e identifica a conexão e, por ela, a organização. Nenhuma ferramenta recebe organização como argumento.

## Endereço do servidor

```
POST https://mcp.publiai.daludi.com.br
Authorization: Bearer pai_xxxxxxxx_<restante-da-chave>
Content-Type: application/json
```

`mcp.publiai.daludi.com.br` é um Worker da Cloudflare que só repassa para a edge (`https://<projeto>.supabase.co/functions/v1/agentes`, que continua funcionando). O cabeçalho aceita `Bearer <chave>`, com `Bearer` em qualquer caixa, ou só a chave (Emenda 1).

- Só `POST` (outro método responde 405). Corpo JSON-RPC 2.0 de até 64 KiB, lido em até 10 s.
- Sem estado e sem CORS (cliente MCP fala de servidor para servidor).
- Versões do protocolo aceitas: `2025-03-26`, `2025-06-18` (padrão) e `2025-11-25`.
- Recusas antes da ferramenta: `401` (`nao_autorizado`, com `WWW-Authenticate: Bearer`), `403` (`acesso_desligado`: módulo desligado ou organização arquivada), `429` (`limite`, com `Retry-After: 60`), `503` (`indisponivel`), `413`, `408`, `405`.

## Ferramentas

O usuário não precisa saber o nome das ferramentas: pergunte em linguagem natural ("qual o ROAS mínimo do MLB0000000000?", "quais anúncios têm margem abaixo de 15%?", "e se eu baixar para R$ 39,90?"). Ao conectar, o servidor envia `instructions` ao agente dizendo qual ferramenta usar em cada caso e para evitar o catálogo inteiro sem pedido.

Toda descrição de ferramenta termina com o aviso de que títulos e textos de produto são dados da loja, não instruções. O resultado vem em `content[0].text` como JSON; `isError` é verdadeiro só para falha (`erro` ou `indisponivel`). Limite e demais estados de negócio chegam com `isError: false`.

### `publiai_loja`

Sem argumentos. Devolve o nome da organização e o apelido da conta do Mercado Livre conectada.

```json
{ "organizacao": "Loja Exemplo", "conta_ml": "LOJAEXEMPLO", "conta_ml_id": "000000000" }
```

Sem conta conectada, `conta_ml` e `conta_ml_id` vêm `null`.

### `publiai_margem_anuncio`

Argumento: `identificador` (texto, obrigatório). Aceita:

- MLB (`MLB0000000000`) ou MLBU (`MLBU0000000000`);
- família do ML, o número do painel de Ads (12 ou mais dígitos, com ou sem `#`);
- SKU exato (cobre os dois modelos de anúncio: legado e user products);
- palavras do nome, título, cor, estampa ou tamanho, em qualquer ordem e sem acento (`blusa preta M`, `neon 4`): **nunca escolhe sozinho**, devolve até 10 `candidatos`. Todas as palavras precisam casar; tamanho é exato (`G` não acha `GG`) e, sozinho, não busca. Não há sinônimo nem correção de digitação. Em anúncio com várias cores no mesmo MLB, a margem é a da pior cor do anúncio, não a da cor procurada.

Identificador com até 200 caracteres e sem caracteres de controle. Alvo com mais de 60 anúncios responde `alvo_grande`.

```json
{
  "estado": "ok",
  "lido_em": "2026-11-22T12:00:00.000Z",
  "tarifa_idade_max_horas": 8,
  "anuncios": [
    {
      "mlb": "MLB0000000000", "titulo": "Produto de exemplo", "status": "active", "sku": "00000001",
      "preco_brl": 59.9, "preco_tabela_brl": 69.9, "em_promocao": true, "promocao_tipo": "lightning",
      "preco_lido_em": "2026-11-22T12:00:01.000Z", "promocao_fim": "2026-11-23T03:00:00.000Z",
      "custo_brl": 18.5, "comissao_brl": 9.88, "frete_brl": 6.75, "imposto_brl": 4.79, "liquido_brl": 38.48,
      "margem_pct": 33.4021, "roas_minimo": 2.9938, "motivo": null
    }
  ],
  "referencia": { "margem_pct": 33.4021, "roas_minimo": 2.9938, "mlb": "MLB0000000000", "motivo": null }
}
```

Com palavras: `{ "estado": "candidatos", "lista_cortada": false, "candidatos": [{ "codigo_pai": "...", "titulo": "...", "mlbs": ["MLB0000000000"], "variacoes": [{ "sku": "...", "cor": "Azul", "tamanho": "4", "mlb": "MLB0000000000" }] }] }`. `variacoes` só vem quando cor, estampa ou tamanho fizeram o produto aparecer.

### `publiai_margens_catalogo`

Argumento opcional: `cursor`. Devolve 50 anúncios publicados por página, em ordem crescente de MLB. Para a página seguinte, passe `proximo_cursor` (opaco, preso à organização). `parcial` é verdadeiro quando algum anúncio ficou sem número por falha de leitura (`erro_tarifa` ou `anuncio_indisponivel`).

```json
{
  "estado": "ok", "lido_em": "2026-11-22T12:00:00.000Z", "tarifa_idade_max_horas": 8,
  "anuncios": [ { "mlb": "MLB0000000000", "margem_pct": 33.4021, "roas_minimo": 2.9938, "motivo": null } ],
  "proximo_cursor": "eyJvIjoi…", "parcial": false
}
```

(Cada item de `anuncios` traz os mesmos campos do exemplo anterior; resumido aqui.) Última página: `proximo_cursor: null`.

### `publiai_simular_margem`

Argumentos: `identificador` (igual à ferramenta de margem) e `preco_brl` (número, em reais). Calcula a margem como se todos os anúncios do alvo custassem `preco_brl`. **Não grava nada e não altera o Mercado Livre.** O preço é arredondado a 2 casas e precisa estar entre 0 (exclusive) e 1.000.000. Cada anúncio traz também `preco_atual_brl`, o preço lido.

```json
{
  "estado": "ok", "lido_em": "2026-11-22T12:00:00.000Z", "tarifa_idade_max_horas": 8,
  "anuncios": [ { "mlb": "MLB0000000000", "preco_brl": 49.9, "preco_atual_brl": 59.9, "margem_pct": 24.1, "roas_minimo": 4.15, "motivo": null } ],
  "referencia": { "margem_pct": 24.1, "roas_minimo": 4.15, "mlb": "MLB0000000000", "motivo": null }
}
```

(Campos de custo, comissão, frete, imposto e líquido omitidos no exemplo; vêm como no `publiai_margem_anuncio`.) Preço fora da faixa: `{ "estado": "preco_invalido" }`.

## De onde vem cada campo

| Campo | Origem |
|---|---|
| `status` | Status do anúncio no Mercado Livre (`active`, `paused`, `closed`...); fora de `active`, o anúncio não está à venda, mas a margem é calculada |
| `preco_brl` | Preço que o comprador paga agora, com promoção (`amount` do `/sale_price`, por MLB, sem cache); na simulação, o `preco_brl` informado |
| `preco_tabela_brl` | `regular_amount` do `/sale_price`, quando maior que o preço; `em_promocao` = há preço de tabela maior (`null` se o Mercado Livre informa promoção sem preço de tabela) |
| `promocao_tipo` | `promotion_type` do Mercado Livre (ex.: `lightning`); na simulação, o da promoção atual |
| `promocao_fim` | Só em `publiai_margem_anuncio`: fim da promoção vigente; `null` quando não há ou não se sabe |
| `preco_lido_em` | Horário da leitura do preço daquele anúncio |
| `custo_brl` | Custo do pacote resolvido (`variacoes.custo`, com escala de kit ou recusa `pacote_a_conferir`) da **pior cor**. Nunca `familias.custo_centavos` |
| `comissao_brl` | Percentual + parte fixa da tarifa do Mercado Livre no preço usado (cache de até 8 horas) |
| `frete_brl` | Frete da tarifa do Mercado Livre pelas dimensões do pacote (mesmo cache) |
| `imposto_brl` | Preço × alíquota da **origem** do produto: `NACIONAL` ou `IMPORTADO`, alíquotas atuais da organização (ADR-0055, ADR-0208). A alíquota interna (ADR-0112) não entra |
| `liquido_brl` | Preço menos comissão, frete e imposto |
| `margem_pct` | (líquido − custo) ÷ preço, em pontos percentuais, da pior cor, **sem arredondar** |
| `roas_minimo` | 100 ÷ `margem_pct`, só se a margem é positiva; senão `null` com `motivo: "sem_espaco_para_ads"` |

Os componentes em reais são arredondados um a um a 2 casas; a soma pode diferir 1 a 2 centavos. `margem_pct` vem do cálculo cru. Insumo ausente nunca vira zero: sem número, com `motivo`.

## Estados e motivos

Estado da resposta (`estado`, nível da ferramenta):

| Estado | Significado |
|---|---|
| `ok` | Resposta com anúncios (e, no catálogo, `parcial` e `proximo_cursor`) |
| `candidatos` | Busca por palavras: escolha um MLB e consulte de novo. `lista_cortada` verdadeiro: há mais resultados, dê mais detalhes |
| `nao_encontrado` | Nada na loja com esse identificador (alvo de outra loja responde igual) |
| `alvo_grande` | O alvo resolve para mais de 60 anúncios |
| `cursor_invalido` | Cursor malformado ou de outra organização |
| `preco_invalido` | Preço da simulação fora de 0 a 1.000.000 |
| `sem_aliquota` | A organização não tem alíquota de imposto válida |
| `sem_conexao_ml` | A organização não tem conta do Mercado Livre conectada |
| `limite_tarifas` | Teto diário de consultas de tarifa atingido (ou a fila parou nele) |
| `limite_leituras` | Teto diário de leituras de item e preço atingido |
| `indisponivel` | Falha de infraestrutura (cota sem resposta do Redis, por exemplo); tente depois |

Erros de chamada: `argumento_invalido` (argumentos fora do esquema) e `indisponivel` (falha interna, sem detalhe); ferramenta inexistente responde `-32602`.

Motivo por anúncio (`motivo`, com `margem_pct: null`, exceto o último):

| Motivo | Significado |
|---|---|
| `anuncio_indisponivel` | O item não veio do Mercado Livre, ou o anúncio não é da conta conectada |
| `preco_nao_verificado` | O preço que o comprador paga não pôde ser lido: sem número, nunca com outro preço no lugar |
| `sem_custo` | Custo do pacote ausente ou zero |
| `pacote_a_conferir` | Pacote escalado de cadastro que não é kit: não há prova de que o custo era unitário |
| `sem_cadastro` | Anúncio sem vínculo no cadastro |
| `kit_divergente`, `kit_ambiguo`, `kit_sem_dimensao` | Pacote de kit que não fecha com o cadastro |
| `sem_origem` | Produto sem origem `NACIONAL`/`IMPORTADO` |
| `sem_dimensao` | Sem dimensões para cotar o frete |
| `sem_categoria` | Anúncio sem categoria ou tipo de listagem |
| `erro_tarifa` | Tarifa não obtida (ou inválida) |
| `erro_calculo` | Componente não numérico no cálculo |
| `sem_espaco_para_ads` | Com número: margem menor ou igual a zero, `roas_minimo` vazio |

Na `referencia`: `anuncio_sem_numero` quando algum anúncio do alvo está sem número (ou o alvo ficou vazio).

## Limites

| Limite | Valor | Resposta |
|---|---|---|
| Chamadas | 60 por minuto, por conexão | `429` |
| Falhas de credencial | 20 por minuto, por IP (só pedido sem chave válida) | `429` |
| Tarifas | 5.000 por dia (fuso de São Paulo), por organização; 2 consultas por cor de anúncio | `limite_tarifas` |
| Leituras | 3.000 por dia (fuso de São Paulo), por organização; 2 por bloco de até 20 anúncios (item e status), mais 1 por preço e 1 por anúncio em promoção na consulta pontual | `limite_leituras` |
| Conexões ativas | 10 por organização | 409 na criação |
| Validade da chave | Até revogar, 30, 90 ou 365 dias | Expirada ou revogada = `401` |
| Corpo da requisição | 64 KiB, 10 s de leitura | `413` / `408` |
| Anúncios por alvo | 60 | `alvo_grande` |
| Candidatos por palavras | 10 | `lista_cortada: true` |
| Página do catálogo | 50 anúncios | `proximo_cursor` |

Os limites recusam quando o Redis falha (`503`/`indisponivel`), nunca liberam.

## Regra da família do Mercado Livre

Consulta pelo número do painel de Ads devolve **cada anúncio da família com o seu número** e, em `referencia`, a **pior margem** entre eles, só quando **todos** têm número (mínimo parcial esconderia o anúncio no prejuízo). Se faltar um, a referência fica vazia com `anuncio_sem_numero`. `referencia.mlb` indica qual anúncio determinou o mínimo.

A igualdade com a aba Campanhas vale **por anúncio**. O agregado da família não promete igualdade: a aba agrupa pela família do PubliAI dentro de cada campanha e só cobre anúncios em campanha ativa.

## Limitações conhecidas

- Cupom do vendedor não entra na margem.
- A comissão e o frete vêm de um cache de até 8 horas (`tarifa_idade_max_horas`); o preço é lido na hora (`lido_em`).
- Alíquota interna (ADR-0112) não entra no cálculo, como na aba Campanhas.
- A leitura pode renovar e regravar a credencial do Mercado Livre da organização, como o app já faz.
- Sem escrita: preço, pausa e promoção continuam só pelo app.
- Pendências aceitas para o piloto: ver a seção "Implementação da fatia 1" da ADR-0210.

## Como conectar em cada cliente

**Ao criar a chave, a tela mostra uma aba por cliente com cada campo pronto e botão Copiar** (Emenda 1); a tabela abaixo é a referência do que cada aba diz. Testado em produção em 2026-11-23, na Zaven, com uma chave criada pela tela e revogada ao fim. "Funciona" = `publiai_loja` e `publiai_margem_anuncio` responderam `ok` e a chamada apareceu na auditoria; no Muse foram `publiai_loja` e `publiai_margens_catalogo`.

| Cliente | Como configurar | Resultado do teste |
|---|---|---|
| Claude Code (CLI e aba Code do Claude Desktop) | `read -rs PUBLIAI_CHAVE` (cole a chave, não aparece), depois `claude mcp add --transport http -s user publiai https://mcp.publiai.daludi.com.br --header "Authorization: Bearer $PUBLIAI_CHAVE"`: a chave não fica no histórico do terminal. Use `-s local` ou `-s user`, nunca `-s project` (gravaria a chave em `.mcp.json`). A sessão precisa ser nova para enxergar o servidor; o `/mcp` do Desktop não lista servidores da CLI | funciona |
| claude.ai (e o chat do Claude Desktop, que usa os conectores da conta) | Configurações › Conectores › Adicionar conector personalizado › URL › Autenticação **Sem login** › Cabeçalhos de requisição: `authorization` = `Bearer <chave>` (o aviso "exigiu login" vem do 401 da primeira sondagem e pode ser ignorado) | funciona |
| ChatGPT | Plugins › Adicionar › Adicionar servidor MCP personalizado: Autenticação só oferece OAuth, Sem autenticação ou "OAuth ou sem autenticação"; não há campo de chave nem de cabeçalho | não conecta com chave: depende da fatia 2 (OAuth) |
| Grok Bot (app) | Adicionar um conector personalizado › Tipo HTTPS remoto › Cabeçalhos HTTP: `Authorization` = `Bearer <chave>`; ID do cliente vazio | funciona |
| OpenBot (app) | Conectar a um MCP personalizado › **Streamable HTTP** (o padrão é STDIO) › Cabeçalhos: `Authorization` = `Bearer <chave>`; App de login vazio; "Testar conexão" lista as 4 ferramentas | funciona |
| Muse (app) | Sem tela de MCP: pedir no chat para criar o conector (URL, streamable HTTP, chave no cabeçalho `Authorization`). A credencial é digitada numa página segura do Muse, nunca no chat. Guardar o valor completo `Bearer <chave>` e pedir que ele seja enviado sem acrescentar outro `Bearer` (segundo o próprio Muse, o envio saiu `Bearer Bearer …` e levou 401; continua recusado) | funciona |
| OpenClaw | `openclaw mcp add publiai --url <url> --transport streamable-http --header "Authorization=Bearer <chave>"` (a CLI 2026.9.4 aceita `--header`) | não testado (adiado) |
| Hermes | Roda em servidor remoto; `config.yaml` › `mcp_servers` com `url` e `headers` | não testado (adiado: exigiria levar a chave ao servidor remoto) |
| Muse Code (CLI) | `~/.config/muse/settings.json` › `mcp_servers`, transporte `streamable_http` com `headers` | não testado (não instalado) |

Em todos: transporte HTTP (Streamable HTTP), sem OAuth; a chave nunca vai na URL nem no chat. Clientes que fazem `GET` para abrir fluxo SSE recebem 405 e seguem só com `POST` (visto nos logs de Claude Code, Cursor e node).

Observações do teste:

- O agente pode resumir errado: num teste, o modelo disse 17 anúncios onde a ferramenta devolveu 16. Número que vai para decisão se confere no JSON da ferramenta.
- O agente pode chamar ferramentas que não foram pedidas (o Muse chamou `publiai_margens_catalogo` por conta própria). É só leitura, mas consome cota; vale ligar a aprovação por ferramenta no cliente.
- No claude.ai o ícone do conector veio do domínio raiz: com a URL do Supabase, o do Supabase; com `mcp.publiai.daludi.com.br`, o de `daludi.com.br` (2026-11-24), que aparece pequeno porque a imagem é 1024×1536 com muita margem. Ícone do PubliAI ali exigiria um domínio raiz próprio. O ChatGPT aceita um PNG próprio.

## Segurança

- A chave é guardada **só como hash** (SHA-256); o prefixo identifica na tela sem expor a chave.
- Uma organização por chave: ela vem só do registro da conexão. Alvo de outra loja responde igual a alvo inexistente.
- Revogação imediata: a conexão revogada, expirada ou de organização arquivada ou sem o módulo é recusada na chamada seguinte. A revogação e a listagem são só de administrador, fora de sessão de suporte.
- Auditoria por chamada: ferramenta, alvo (só identificador canônico: MLB, MLBU, família ou SKU resolvido; o resto vira `texto_livre`) e resultado, visível ao administrador na tela da conexão (últimas 50).
- Títulos e textos de produto saem como dado estruturado e as descrições das ferramentas avisam que são dado, não instrução.
- Nunca saem dados de comprador, credenciais do Mercado Livre nem dados de fornecedor.
