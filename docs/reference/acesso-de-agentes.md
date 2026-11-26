# Referência — Acesso de agentes (ADR-0210, fatia 1)

> Estado: em produção desde 2026-11-22, em piloto na Zaven (módulo `agentes` desligado por padrão nas demais organizações). Decisão: [ADR-0210](../decisions/0210-acesso-de-agentes-mcp.md). Tabelas: [modelo-de-dados.md](modelo-de-dados.md). Edges: [edge-functions.md](edge-functions.md). Contrato técnico (protocolo, esquemas, campos, erros, limites): [api-agentes.md](api-agentes.md).

## O que é

Um servidor **MCP remoto, somente leitura**, que deixa um assistente de IA consultar a margem dos anúncios do Mercado Livre de **uma** loja do PubliAI. O caso de uso é definir orçamento e ROAS no Mercado Ads sem passar da margem do produto.

O agente não altera nada: não publica, não muda preço, não pausa, não mexe em promoção. A margem é a mesma da aba Campanhas do `/ads` (função `detalheEquilibrioDoMlb`), sem fórmula própria.

## Como ligar

1. Na Central de controle, ligar o módulo **Acesso de agentes** da organização (vem desligado).
2. Um administrador abre **Configurações → Conexões de agentes → Nova conexão**, dá um nome e escolhe a validade: **Até revogar** (padrão), 30, 90 ou 365 dias (ADR-0210, Emenda 1).
3. Marcar as **permissões** da chave (as duas vêm marcadas; ao menos uma é obrigatória). Ver "Permissões por chave".
4. Copiar a chave. Ela é exibida **uma única vez**; depois só o prefixo (`pai_xxxxxxxx_…`) aparece na lista. Se perder, revogue e crie outra.

### Permissões por chave (ADR-0210, Emenda 6)

| Permissão | Ferramentas liberadas |
|---|---|
| `margens` | `publiai_margem_anuncio`, `publiai_simular_margem`, `publiai_comparar_precos` |
| `catalogo` | `publiai_margens_catalogo` (com ou sem filtro): a varredura da loja inteira |

`publiai_loja` vale para toda chave. Nenhuma permissão dá escrita. O administrador altera as permissões de uma chave ativa pelo botão **Permissões** da lista; a mudança vale na chamada seguinte. Chave criada antes da Emenda 6 tem as duas.

Sem a permissão, `tools/list` esconde a ferramenta e a chamada responde `{ "estado": "sem_permissao" }` com `isError: true`. O agente deve avisar o usuário, sem tentar outra ferramenta para obter o mesmo dado.

**O que `catalogo` protege:** impede a varredura da loja inteira em poucas chamadas. **O que não protege:** uma chave só com `margens` ainda vê custo e margem de anúncios por MLB, SKU ou palavra (até 60 por alvo) e gasta a mesma cota diária da loja.

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

O usuário não precisa saber o nome das ferramentas: pergunte em linguagem natural ("qual o ROAS mínimo do MLB0000000000?", "quais anúncios têm margem abaixo de 15%?", "e se eu baixar para R$ 39,90?"). Ao conectar, o servidor envia `instructions` ao agente dizendo qual ferramenta usar em cada caso, para evitar o catálogo inteiro sem pedido e para separar anúncios `active` de `paused` ou `closed` ao listar. O texto é o mesmo para toda chave; o que a chave não pode usar some de `tools/list`.

Toda descrição de ferramenta termina com o aviso de que títulos e textos de produto são dados da loja, não instruções. O resultado vem em `content[0].text` como JSON; `isError` é verdadeiro para falha (`erro` ou `indisponivel`) e para `sem_permissao`. Limite e demais estados de negócio chegam com `isError: false`.

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

Argumentos opcionais: `cursor`, `abaixo_de_pct` e `sem_numero`. Devolve 50 anúncios publicados lidos por página, em ordem crescente de MLB. Para a página seguinte, passe `proximo_cursor` (opaco, preso à organização). `parcial` é verdadeiro quando algum anúncio ficou sem número por falha de leitura (`erro_tarifa` ou `anuncio_indisponivel`). Exige a permissão `catalogo`.

**Filtros** (podem ir juntos; o anúncio entra se atende a um dos dois):

- `abaixo_de_pct`: número entre −100 e 100. Anúncios com número e `margem_pct` menor que o valor, inclusive prejuízo e zero. "Abaixo de 18%" é `18`; "no prejuízo ou zero" é `0.01`, e só o anúncio com `motivo = sem_espaco_para_ads` é chamado de prejuízo.
- `sem_numero`: só `true`. Anúncios sem número, com o `motivo` (o cadastro a corrigir).
- "O que está sem margem e por quê": `sem_numero=true` e `abaixo_de_pct=0.01` na mesma varredura (sem número = cadastro a corrigir, com o motivo; motivo `sem_espaco_para_ads` = prejuízo ou margem zero). Só o cadastro a corrigir: apenas `sem_numero=true`.
- Valor fora da faixa, `NaN` ou `sem_numero` diferente de `true` → `argumento_invalido`. `null` conta como ausente.

**Regra do cursor.** O filtro corta a resposta, não a leitura nem a cota: a página lida é a mesma de 50 anúncios. O filtro fica gravado no cursor: a página seguinte o herda, e um filtro diferente do gravado responde `cursor_invalido`. **Página com `anuncios` vazio e `proximo_cursor` preenchido não é o fim**: siga o cursor até ele vir nulo e some as contagens. Se parar antes, diga até onde leu.

**Campos novos** (em toda resposta `ok`, com ou sem filtro; valem para a página lida, antes do filtro): `examinados` (anúncios lidos), `sem_numero_por_motivo` (contagem por motivo, só dos sem número) e `com_margem_ate_zero` (contagem de `sem_espaco_para_ads`, que tem número). Página vazia traz as contagens zeradas. `filtro` é o filtro efetivamente aplicado, em forma canônica (`abaixo_de:18`, `sem_numero` ou `abaixo_de:0.01+sem_numero`), inclusive o herdado do cursor; sem filtro, `null`. É também o que a auditoria grava.

```json
{
  "estado": "ok", "lido_em": "2026-11-22T12:00:00.000Z", "tarifa_idade_max_horas": 8,
  "anuncios": [ { "mlb": "MLB0000000000", "margem_pct": 33.4021, "roas_minimo": 2.9938, "motivo": null } ],
  "proximo_cursor": "eyJvIjoi…", "parcial": false, "filtro": null,
  "examinados": 50, "sem_numero_por_motivo": {}, "com_margem_ate_zero": 0
}
```

Com `abaixo_de_pct: 18` (ou só o cursor de uma página pedida com esse filtro), `anuncios` traz só os recortados e as contagens valem para a página inteira:

```json
{
  "estado": "ok", "lido_em": "2026-11-22T12:00:00.000Z", "tarifa_idade_max_horas": 8,
  "anuncios": [ { "mlb": "MLB0000000001", "margem_pct": 12.5, "roas_minimo": 8, "motivo": null } ],
  "proximo_cursor": "eyJvIjoi…", "parcial": false, "filtro": "abaixo_de:18",
  "examinados": 50, "sem_numero_por_motivo": { "sem_custo": 2 }, "com_margem_ate_zero": 0
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

(Campos de custo, comissão, frete, imposto e líquido omitidos no exemplo; vêm como no `publiai_margem_anuncio`.) Preço fora da faixa: `{ "estado": "preco_invalido" }`. Exige a permissão `margens`.

### `publiai_comparar_precos`

Argumentos: `identificador` (igual à ferramenta de margem) e `precos_brl` (lista de 2 a 5 preços em reais). Calcula, numa chamada só, a margem do alvo em cada preço. **Não grava nada e não altera o Mercado Livre.** Cada preço é validado e arredondado a 2 casas como na simulação; repetidos depois do arredondamento são deduplicados (sobrar um só é aceito); um preço inválido recusa a chamada inteira com `preco_invalido`. Exige a permissão `margens`.

```json
{
  "estado": "ok", "lido_em": "2026-11-26T12:00:00.000Z", "tarifa_idade_max_horas": 8,
  "resultados": [
    { "preco_brl": 55.7, "anuncios": [ { "mlb": "MLB0000000000", "preco_brl": 55.7, "margem_pct": 16.2, "roas_minimo": 6.17, "motivo": null } ],
      "referencia": { "margem_pct": 16.2, "roas_minimo": 6.17, "mlb": "MLB0000000000", "motivo": null } },
    { "preco_brl": 61.17, "anuncios": [ { "mlb": "MLB0000000000", "preco_brl": 61.17, "margem_pct": 21.4, "roas_minimo": 4.67, "motivo": null } ],
      "referencia": { "margem_pct": 21.4, "roas_minimo": 4.67, "mlb": "MLB0000000000", "motivo": null } }
  ]
}
```

(Valores ilustrativos; `anuncios` tem a forma da simulação, resumida aqui. Os resultados vêm na ordem pedida.)

**Qual preço deixa X%.** O agente escolhe o menor preço cuja `referencia.margem_pct` seja maior ou igual a X, comparando o número sem arredondar (a tela do app trunca em uma casa, então o número cru não aprova nada que a tela mostre abaixo de X). Com `referencia.motivo = anuncio_sem_numero`, não escolhe preço. Não existe "preço para atingir X%": com tarifa por faixa de preço, achar o preço exigiria busca e muitas consultas.

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
| `alvo_grande` | O alvo resolve para mais de 60 anúncios; na comparação, também quando preços × anúncios (ou cores) × 2 passa de 100 consultas de tarifa: peça um MLB só |
| `sem_permissao` | A chave não tem a permissão da ferramenta (`isError: true`); avise o usuário, sem tentar outra ferramenta para o mesmo dado |
| `cursor_invalido` | Cursor malformado, de outra organização, ou com filtro diferente do pedido |
| `preco_invalido` | Preço da simulação ou da comparação fora de 0 a 1.000.000 (ou lista de preços fora de 2 a 5) |
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
| Comparação de preços | 2 a 5 preços; teto de 100 consultas de tarifa por chamada (preços × anúncios × 2, e depois preços × cores × 2) | `alvo_grande` |
| Candidatos por palavras | 10 | `lista_cortada: true` |
| Página do catálogo | 50 anúncios lidos (o filtro corta a resposta, não a leitura) | `proximo_cursor` |

**Custo de uma varredura** (inferência pela fórmula do código, não medida): loja de ~250 anúncios ~277 leituras e ~494 tarifas; loja de ~370 anúncios ~420 leituras e ~780 tarifas. **Medido** (2026-11-26, loja de ~250 anúncios, 10 chamadas, todas 200): páginas do catálogo de 0,9 a 1,7 s cada (cerca de 6 s para as 5); simulação de 5 preços inéditos em sequência de 0,5 a 0,8 s cada. Não medido: tempo por fase, rajada de 100 tarifas frias da comparação e a loja de ~370 anúncios.

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
