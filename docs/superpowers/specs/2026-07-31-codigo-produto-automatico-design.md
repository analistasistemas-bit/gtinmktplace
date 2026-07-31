# Código de produto automático no cadastro manual

**Data:** 2026-07-31
**Decisor:** Diego
**Relacionado:** ADR-0094 (D-3, D-4, D-13), convenção de fotos do CLAUDE.md

## 1. Problema

Quem usa o módulo de estoque não tem ERP — por definição não tem código de produto nem SKU.
O `DialogCadastroProduto` exige os dois hoje, então o operador preenche com o que tem à mão.
No primeiro cadastro real da DSA (2026-07-31) o SKU virou `4005800241901`, que é o próprio
EAN do produto — o mesmo valor que já estava no campo GTIN.

A consequência não é só cosmética. O upload de foto pela tela de Revisão renomeia o arquivo
para `{codigo}.{ext}` (`src/components/variacao-card.tsx:61`) e o match exige exatamente oito
dígitos (`supabase/functions/_shared/upload/match.ts:11`):

```ts
const REGEX_VARIACAO = /^(\d{8})\.(jpe?g|png)$/i;
```

Um SKU de 13 dígitos nunca casa. Pior: esse caminho engole o resultado — `lidarTrocaFoto`
ignora `erros`/`sem_match` da resposta da edge, ao contrário de `subirCapaFamilia`
(`src/lib/upload-imagens.ts:48`), que checa `capas_ok !== 1`. A foto não gruda e a tela não
explica o porquê.

Gerar o código pelo sistema resolve a origem do problema: o operador para de inventar código,
e o código inventado pelo sistema já nasce no formato que o resto do projeto espera.

## 2. Decisões travadas

| # | Decisão | Racional |
|---|---|---|
| **D-1** | **Código gerado pelo sistema, oito dígitos com zeros à esquerda** (`00000001`). | É a convenção real do projeto — a Avil tem 346.608 SKUs exatamente nesse formato — e é o contrato do upload de foto (`^\d{8}`). Número puro (`1`, `2`) manteria o upload de foto quebrado nos produtos novos. |
| **D-2** | **Sequência única para PAI e SKU:** o PAI consome um número e cada variação consome o seguinte. | Foi o pedido explícito. Um contador só significa que nenhum número se repete dentro da org, então PAI e SKU nunca se confundem em log, busca ou conversa com o operador. |
| **D-3** | **Sequência por org**, em `organizations.produto_seq`, reservada por RPC `SECURITY DEFINER` atômica. | Espelha o padrão que já existe no repo (`organizations.lote_seq` + `proximo_numero_lote`). Gerar no front colidiria entre duas abas; gerar por `max(codigo)+1` colidiria sob concorrência. |
| **D-4** | **A sequência é inicializada, por org, com o maior código numérico de até oito dígitos que já existe lá** (considerando `familias.codigo_pai` e `variacoes.codigo`). Valores apurados hoje: DSA → `1`, Avil → `31327733`. | Sem isso, uma org que já tem códigos numéricos receberia um código gerado igual a um existente, e o cadastro morreria no guard D-4 do ADR-0094 — com o operador sem ter escolhido o código e sem ação possível. |
| **D-5** | **Estouro de `99999999` falha LOUD**, com erro explícito, em vez de truncar ou seguir com nove dígitos. | Os oito dígitos são contrato com o upload de foto, não formatação. Truncar geraria código duplicado silencioso; passar a nove quebraria a foto de novo. Mesma classe de trava do `origem` no `validarProdutoNovo`. |
| **D-6** | **Os guards D-4 (PAI duplicado) e de SKU do ADR-0094 permanecem.** | Defesa em profundidade. Com a sequência correta eles nunca disparam; se um dia a sequência for reinicializada errado, o cadastro falha alto em vez de criar duas linhas canônicas concorrentes — o risco que o D-4 original existe para impedir. |
| **D-7** | **Vale só para quem tem o módulo `estoque` habilitado.** | Já é consequência do gate existente (`exigirModulo(admin, orgId, 'estoque')` na edge, ADR-0094 D-13), não um `if` novo: a geração vive dentro do cadastro manual, que só existe para org com o módulo ligado. O `ingest-lote` não é tocado — org de planilha continua com os códigos dela. |
| **D-8** | **Os campos "Código do produto (PAI)" e "SKU" saem da tela.** | O operador nunca digita código. Menos campo para errar, e impede recriar o problema de origem (colar o EAN no SKU). O EAN continua no campo GTIN, que é o lugar dele. |

## 3. Arquitetura

### Migration

```sql
alter table public.organizations
  add column produto_seq bigint not null default 0;

-- D-4: inicializa acima do que já existe, por org.
update public.organizations o set produto_seq = greatest(
  coalesce((select max(f.codigo_pai::bigint) from public.familias f
            where f.org_id = o.id and f.codigo_pai ~ '^[0-9]{1,8}$'), 0),
  coalesce((select max(v.codigo::bigint) from public.variacoes v
            where v.org_id = o.id and v.codigo ~ '^[0-9]{1,8}$'), 0)
);

create function public.proximo_codigo_produto(p_org uuid, p_qtd int)
returns bigint language sql security definer set search_path to '' as $$
  update public.organizations set produto_seq = produto_seq + p_qtd, atualizado_em = now()
  where id = p_org returning produto_seq
$$;

revoke all on function public.proximo_codigo_produto(uuid, int) from public, anon, authenticated;
grant execute on function public.proximo_codigo_produto(uuid, int) to service_role;
```

A RPC devolve o **último** número da faixa reservada; a edge deriva os `p_qtd` números para
trás. Uma chamada por cadastro, atômica — duas sessões cadastrando ao mesmo tempo recebem
faixas disjuntas.

O `revoke`/`grant` segue D-15 do ADR-0094: o browser nunca chama a RPC, só a edge com
`service_role`.

**Buraco na sequência é esperado, não defeito.** Um cadastro que reserva a faixa e depois falha
(guard, insert, rede) deixa aqueles números queimados. A alternativa — devolver o contador —
exigiria transação sobre três caminhos de escrita diferentes, que é justamente o que o ADR-0094
já declarou inviável aqui. Código de produto não precisa ser contíguo, precisa ser único.

### Edge `cadastrar-produto`

Ordem das operações (a reserva acontece **antes** dos inserts, para que a falha de estouro
aconteça sem estado parcial):

```
requireUserOrg(write) → exigirModulo('estoque')   [inalterado, D-7]
  ↓
validarProdutoNovo(produto)                       [não exige mais codigoPai/codigo]
  ↓
proximo_codigo_produto(org, 1 + variacoes.length) [D-3]
  ↓
derivarCodigos(ultimo, 1 + N)  →  { codigoPai, codigos[] }   [D-1, D-5]
  ↓
guards D-4 e SKU do ADR-0094 sobre os códigos GERADOS        [D-6]
  ↓
lote → familia → variacoes → estoque inicial → fila          [inalterado]
```

`derivarCodigos` é função pura em `_shared/produto/` — é o que o teste cobre.

### Front `dialog-cadastro-produto.tsx`

- Remove o input "Código do produto (PAI)" e a coluna SKU da tabela de variações.
- `podeSalvar` deixa de exigir código; passa a exigir nome, origem e preço > 0 por linha.
- Aviso na etapa 1: "Códigos gerados automaticamente ao salvar".
- Etapa 2 (fotos) exibe o código **gerado**, que já vem em `resultado.variacoes[].codigo`.

### Contrato de tipos

`ProdutoEntrada.codigoPai` e `VariacaoEntrada.codigo` passam a ser opcionais no payload. A
edge é a única autoridade que os preenche — o front nunca envia código.

## 4. Testes

Não existe teste de `validarProdutoNovo` hoje. Este trabalho adiciona um teste para a função
pura de derivação:

- `N` números reservados → um PAI e `N-1` SKUs, todos com oito dígitos e zeros à esquerda
- sequência contígua e sem repetição entre PAI e SKUs (D-2)
- faixa que ultrapassa `99999999` → lança, não trunca (D-5)

## 5. Fora de escopo

| Item | Por quê |
|---|---|
| Corrigir o produto já cadastrado na DSA (SKU `4005800241901`) | Decisão do Diego nesta sessão. Continua sem foto até ser recadastrado ou corrigido à parte. |
| Corrigir o silêncio de erro do `lidarTrocaFoto` | Bug real e confirmado (`variacao-card.tsx:64` ignora `erros`/`sem_match`), mas separado deste trabalho. Registrado para depois. |
| Numeração automática no caminho de planilha (`ingest-lote`) | Org de planilha tem ERP e códigos próprios — é exatamente o caso que este trabalho não atende (D-7). |
| Formato configurável (prefixo, largura, por org) | YAGNI. Oito dígitos é contrato com o upload de foto; um segundo formato reabriria o bug que este trabalho fecha. |

## 6. Efeito colateral esperado

Produto cadastrado por este caminho passa a aceitar foto pelo ícone de câmera na Revisão,
porque o código gerado casa com o `^\d{8}` do match. Não é o objetivo do trabalho, mas é a
razão de D-1 não ser negociável.
