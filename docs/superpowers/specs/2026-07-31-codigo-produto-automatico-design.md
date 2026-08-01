# Código de produto automático no cadastro manual

**Data:** 2026-07-31
**Decisor:** Diego
**Relacionado:** ADR-0094 (D-3, D-4, D-13, D-15, D-17), convenção de fotos do CLAUDE.md
**Revisão adversarial:** Fable 5, 2026-07-31 — achados B-1, I-1, I-2, I-3, M-1..M-4 incorporados

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
| **D-1** | **Código gerado pelo sistema, oito dígitos com zeros à esquerda** (`00000001`). | É a convenção real do projeto — 2.088 dos 2.089 SKUs da Avil têm exatamente oito dígitos — e é o contrato do upload de foto (`^\d{8}`). Número puro (`1`, `2`) manteria o upload de foto quebrado nos produtos novos. |
| **D-2** | **Sequência única para PAI e SKU:** o PAI consome um número e cada variação consome o seguinte. **O PAI é o menor número da faixa reservada.** | Foi o pedido explícito. Um contador só significa que nenhum número se repete dentro da org, então PAI e SKU nunca se confundem em log, busca ou conversa com o operador. A ordem é fixada aqui porque é indiferente funcionalmente e divergiria entre implementadores. |
| **D-3** | **Sequência por org**, em `organizations.produto_seq`, reservada por RPC `SECURITY DEFINER` atômica. A RPC **rejeita `p_qtd <= 0`**. | Espelha o padrão que já existe no repo (`organizations.lote_seq` + `proximo_numero_lote`). Gerar no front colidiria entre duas abas; gerar por `max(codigo)+1` colidiria sob concorrência. `p_qtd` negativo rebobinaria a sequência, e sequência rebobinada é colisão silenciosa no futuro — uma linha de trava, mesma filosofia LOUD do resto. |
| **D-4** | **A sequência é inicializada, por org, com o maior código numérico de até oito dígitos que já existe lá** (considerando `familias.codigo_pai` e `variacoes.codigo`). Valores apurados hoje: DSA → `1`, Avil → `31327733` — a Avil foi depois deslocada para `99000000` por decisão explícita (D-4.2), o que não altera o mecanismo descrito aqui. **A comparação é numérica, nunca de string.** | Sem isso, uma org que já tem códigos numéricos receberia um código gerado igual a um existente. E a comparação precisa ser numérica por um canal que nenhum guard cobre: `subirCapaFamilia` faz `padStart(8,'0')` no `codigo_pai` (`src/lib/upload-imagens.ts:43`), então o `codigo_pai='1'` da DSA e um gerado `00000001` são strings distintas no banco mas produzem **o mesmo arquivo de capa** `CAPA_00000001.jpg` — a capa de um sobrescreveria a do outro no storage. |
| **D-4.1** | **A inicialização não é suficiente sozinha: colisão sobre código gerado dispara ressincronização e uma nova tentativa.** Se ainda colidir, é erro de sistema (500), não erro do operador. | A init da migration é uma foto de um alvo em movimento. Uma org sem o módulo hoje continua importando planilha e seus códigos crescem; ao habilitar o módulo meses depois, `produto_seq` estaria congelado no valor que a migration gravou e o primeiro cadastro colidiria. Nada impede também uma org de ter o módulo **e** continuar importando planilha (D-13/D-14 são opt-in, não exclusão) — aí a dessincronização é permanente. O resync no caminho da colisão cobre os dois casos sem pagar um scan no caminho feliz. Para a Avil, esse primeiro gatilho foi afastado pela D-4.2 (a faixa alta deixa a sequência muito acima do que o ERP dela produz), mas **o mecanismo permanece obrigatório**: vale para as demais orgs e para o caso módulo+planilha simultâneos. |
| **D-4.2** | **A Avil inicia em `99000000`**, e não no maior código existente. Ajuste **pontual desta org**, decidido pelo Diego (2026-07-31): não é regra geral, não é piso para outras orgs e não vira coluna de configuração. A DSA permanece em `1`. | Cria uma faixa alta reservada: na Avil, `99xxxxxx` passa a significar "código gerado pelo PubliAI", visivelmente separado da numeração que o ERP dela produz (maior código do ERP hoje: 31.327.733). Também afasta o risco de o ERP crescer até alcançar a numeração gerada — os dois deixam de disputar o mesmo espaço. Consequência aceita: restam 999.999 códigos. No perfil atual da Avil (12,58 variações por família, ~13,6 números por produto) isso comporta **~73 mil produtos**, contra 166 famílias hoje; se os produtos fossem de 3 variações, ~250 mil. De todo modo o esgotamento não é silencioso — falha LOUD pela D-5. **A reserva é convenção, não trava:** este trabalho não toca o `ingest-lote` (D-7), então nada impede um código `99xxxxxx` entrar por planilha — e se entrar, o resync da D-4.1 eleva `produto_seq` até ele num único passo, consumindo a folga da faixa de uma vez. Isso **não quebra a correção** (o resync só sobe, então segue sem colisão e sem rebobinar); encurta a reserva, só. Aceito porque a garantia estrutural exigiria restringir o `ingest-lote` por faixa — regra nova, em outro caminho, para orgs que não pediram nada — enquanto a correção já está coberta pelo guard cruzado da D-6 e pelo próprio resync. |
| **D-5** | **Estouro de `99999999` falha LOUD**, com erro explícito, em vez de truncar ou seguir com nove dígitos. | Os oito dígitos são contrato com o upload de foto, não formatação. Truncar geraria código duplicado silencioso; passar a nove quebraria a foto de novo. Mesma classe de trava do `origem` no `validarProdutoNovo`. |
| **D-6** | **Os guards D-4 (PAI duplicado) e de SKU do ADR-0094 permanecem, e passam a cruzar as duas tabelas:** o PAI gerado é conferido contra `familias.codigo_pai` **e** `variacoes.codigo`; cada SKU gerado, contra as duas também. | Defesa em profundidade. Hoje o guard de PAI só olha `familias` (`cadastrar-produto/index.ts:48-50`) e o de SKU só olha `variacoes` (`index.ts:66-68`). Com sequência dessincronizada, um PAI gerado igual a um SKU existente passa pelos dois — e a resolução de estoque por `(org_id, codigo)` não distingue os dois campos. É o gatilho de D-4.1. |
| **D-7** | **Vale só para quem tem o módulo `estoque` habilitado.** | Já é consequência do gate existente (`exigirModulo(admin, orgId, 'estoque')` em `index.ts:66`, ADR-0094 D-13), não um `if` novo: a geração vive dentro do cadastro manual, que só existe para org com o módulo ligado. O `ingest-lote` não é tocado — org de planilha continua com os códigos dela. |
| **D-8** | **Os campos "Código do produto (PAI)" e "SKU" saem da tela.** | O operador nunca digita código. Menos campo para errar, e impede recriar o problema de origem (colar o EAN no SKU). O EAN continua no campo GTIN, que é o lugar dele. |
| **D-9** | **Chave de idempotência por submissão:** o front gera um uuid ao abrir o diálogo e o envia; a edge grava em `familias.chave_cadastro` com unique parcial `(org_id, chave_cadastro)`. Reenvio com a mesma chave devolve o resultado do cadastro original, não cria um segundo. | **Sem isto a geração de código destrói uma propriedade de segurança que a edge documenta.** O cabeçalho declara "re-executar o cadastro do mesmo produto para no guard 409" (`index.ts:6-8`), o que só funciona porque `codigo_pai` vem do operador e é estável entre tentativas. Com código gerado, cada chamada produz códigos novos e **os guards nunca disparam num retry, por construção**. Um timeout depois do insert (o form continua preenchido, `dialog-cadastro-produto.tsx:109-119`) e um segundo clique criariam duas famílias, com o estoque inicial aplicado duas vezes — as refs `cadastro:{familiaId}:{codigo}` do D-17 mudam junto com a família, então a idempotência do ledger não salva. "Edge Functions idempotentes" é regra inegociável do CLAUDE.md. O padrão já existe no projeto: `dialog-entrada.tsx:33-45` gera o uuid ao abrir e só troca após sucesso confirmado. |
| **D-10** | **Erro sobre código gerado é erro de sistema, não instrução ao operador.** As mensagens atuais dos guards ("renomeie ou use o produto existente", "use Entrada de estoque") só valem para código digitado. | Com D-8 o operador não tem código para renomear e não escolheu nada — a mensagem antiga seria uma instrução impossível. O caminho de `ProdutoJaExisteError` no front (`src/lib/produtos-saldo.ts:96-101`, `dialog-cadastro-produto.tsx:110-113`) pressupõe o 409 de código digitado e **não deve** ser reusado para colisão de código gerado. |

## 3. Arquitetura

### Migration

```sql
alter table public.organizations
  add column produto_seq bigint not null default 0;

alter table public.familias
  add column chave_cadastro uuid;

-- D-9: idempotência por submissão. Parcial porque só o cadastro manual preenche.
create unique index familias_org_chave_cadastro_key
  on public.familias (org_id, chave_cadastro) where chave_cadastro is not null;

-- D-4: inicializa acima do que já existe, por org, comparando NUMERICAMENTE.
update public.organizations o set produto_seq = greatest(
  coalesce((select max(f.codigo_pai::bigint) from public.familias f
            where f.org_id = o.id and f.codigo_pai ~ '^[0-9]{1,8}$'), 0),
  coalesce((select max(v.codigo::bigint) from public.variacoes v
            where v.org_id = o.id and v.codigo ~ '^[0-9]{1,8}$'), 0)
);
```

A RPC `proximo_codigo_produto(p_org uuid, p_qtd int, p_resync boolean default false)`:

- rejeita `p_qtd <= 0` com exceção (D-3);
- quando `p_resync`, eleva `produto_seq` para o maior código existente antes de reservar (D-4.1);
- reserva a faixa num `update … returning` atômico e devolve o **último** número dela.

`SECURITY DEFINER`, `search_path` vazio, revogada de `public`/`anon`/`authenticated` e concedida
ao `service_role` — D-15 do ADR-0094: o browser nunca chama a RPC, só a edge.

**Buraco na sequência é esperado, não defeito.** Um cadastro que reserva a faixa e depois falha
(guard, insert, rede) deixa aqueles números queimados. A alternativa — devolver o contador —
exigiria transação sobre três caminhos de escrita diferentes, que é justamente o que o ADR-0094
já declarou inviável aqui. Código de produto não precisa ser contíguo, precisa ser único.

### Edge `cadastrar-produto`

```
requireUserOrg(write) → exigirModulo('estoque')          [inalterado, D-7]
  ↓
chave_cadastro presente? → já existe família com ela?     [D-9]
  └─ sim → devolve o resultado original, 200, sem criar nada
  ↓
validarProdutoNovo(produto)              [não exige mais codigoPai/codigo]
  ↓
proximo_codigo_produto(org, 1 + N)  →  derivarCodigos()   [D-1, D-2, D-5]
  ↓
guards cruzados sobre os códigos GERADOS                  [D-6]
  └─ colidiu → proximo_codigo_produto(org, 1 + N, resync=true) → derivar → conferir de novo
       └─ colidiu de novo → 500 "falha de numeração"      [D-4.1, D-10]
  ↓
lote → familia (com chave_cadastro) → variacoes → estoque inicial → fila   [inalterado]
```

A reserva acontece **antes** dos inserts, para que o estouro de D-5 falhe sem estado parcial.

### Ponto de injeção dos códigos (fixado para não divergir)

`validarProdutoNovo` deixa de validar código. `derivarCodigos(ultimoDaFaixa, qtd)` é função pura
em `_shared/produto/` e devolve `{ codigoPai, codigos[] }`. `montarLinhasProduto` passa a
**receber os códigos como parâmetro** — o payload da request nunca é mutado, porque mutar
objeto de request é a variante que gera bug seis meses depois.

### Contrato de tipos

Existem **duas** definições de `ProdutoEntrada`: a da edge (`_shared/produto/validar.ts:18`) e a
do front (`src/lib/produto-entrada.ts`). Nas duas, `codigoPai` e `VariacaoEntrada.codigo` saem do
payload; a do front ganha `chaveCadastro: string`.

### Front `dialog-cadastro-produto.tsx`

- Remove o input "Código do produto (PAI)" e a coluna SKU da tabela de variações.
- `podeSalvar` deixa de exigir código; passa a exigir nome, origem e preço > 0 por linha.
- Aviso na etapa 1: "Códigos gerados automaticamente ao salvar".
- `chaveCadastro` nasce com `crypto.randomUUID()` ao abrir e só troca após sucesso confirmado —
  cópia do padrão de `dialog-entrada.tsx:33-45`.
- Etapa 2 (fotos) exibe o código **gerado**, que já vem em `resultado.variacoes[].codigo`.

## 4. Testes

Não existe teste de `validarProdutoNovo` hoje. Este trabalho adiciona testes para a função pura
de derivação:

- `N` números reservados → um PAI e `N-1` SKUs, todos com oito dígitos e zeros à esquerda
- PAI é o menor número da faixa (D-2)
- sequência contígua e sem repetição entre PAI e SKUs
- faixa que ultrapassa `99999999` → lança, não trunca (D-5)

## 5. Fora de escopo

| Item | Por quê |
|---|---|
| Corrigir o produto já cadastrado na DSA (SKU `4005800241901`) | Decisão do Diego nesta sessão. Continua sem foto até ser recadastrado ou corrigido à parte. |
| Corrigir o silêncio de erro do `lidarTrocaFoto` | Bug real e confirmado (`variacao-card.tsx:64` ignora `erros`/`sem_match`), mas separado deste trabalho. Registrado para depois. |
| Numeração automática no caminho de planilha (`ingest-lote`) | Org de planilha tem ERP e códigos próprios — é exatamente o caso que este trabalho não atende (D-7). |
| Ressincronizar a sequência ao habilitar o módulo (`set_modulos_org`) | Seria otimização do primeiro cadastro, não correção: D-4.1 já cobre o caso pelo caminho da colisão. Não vale uma segunda cópia da regra. |
| Formato configurável (prefixo, largura, por org) | YAGNI. Oito dígitos é contrato com o upload de foto; um segundo formato reabriria o bug que este trabalho fecha. |

## 6. Casos conhecidos, sem ação

**Códigos com zeros à esquerda e mais de oito caracteres** (ex.: `0000000042`, valor 42) escapam
do regex `^[0-9]{1,8}$` da inicialização. Verificado que não há canal de colisão real: a string
difere no banco, o match de foto compara string exata de oito dígitos
(`upload-imagens-lote/processar.ts:115`) e `padStart(8)` não encolhe string maior. Registrado
para não ser reinvestigado.

## 7. Efeito colateral esperado

Produto cadastrado por este caminho passa a aceitar foto pelo ícone de câmera na Revisão,
porque o código gerado casa com o `^\d{8}` do match. Não é o objetivo do trabalho, mas é a
razão de D-1 não ser negociável.
