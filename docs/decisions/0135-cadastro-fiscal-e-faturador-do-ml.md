# ADR-0135 — Cadastro fiscal e emissão via Faturador do Mercado Livre

**Data:** 2026-08-25
**Status:** aceito
**Supersede parcialmente:** [ADR-0114](0114-emissao-de-nf-e-modelo-55.md) — caem D-3 (transmissão via
Focus NFe), D-6 (certificado passthrough) e D-8 (série dedicada do PubliAI); permanecem e são absorvidas
as decisões de dado (D-2 "transmite, não calcula", D-10 campos por família/org, D-11 comprador sob
demanda, D-14 Simples-only na v1).
**Relacionado:** [0024](0024-camada-de-abstracao-de-canais.md) (porta de canal),
[0055](0055-imposto-por-origem-nacional-importado.md) / [0107](0107-origem-obrigatoria-na-planilha.md)
(origem binária e imposto), [0086](0086-configuracao-org-scoped.md) (config por org),
[0094](0094-estoque-unico-cadastro-manual.md) (módulo gated, cadastro manual),
[0112](0112-aliquota-interna-por-uf-da-empresa.md) (`uf_empresa`),
[0026](0026-ia-para-atributos.md) (IA sugere, humano decide).

## Contexto

O ADR-0114 desenhou o PubliAI **transmitindo** NF-e via provider SaaS (Focus NFe) e ficou pausado
aguardando o CNPJ do cliente da org DSA. Ao retomar (2026-08-25), a pesquisa da documentação oficial
do ML mudou a premissa central: o **Faturador do Mercado Livre é grátis**, cobre Simples Nacional e
Regime Normal, emite automaticamente no Full e em um clique nas demais logísticas, emite nota de
devolução, já calcula IBS/CBS — e expõe **API de escrita** para os dados fiscais:

| Recurso | Endpoint |
|---|---|
| Dados fiscais por SKU | `POST/PUT/PATCH/GET /items/fiscal_information[/{sku}]` |
| Vínculo SKU → anúncio | `POST /items/fiscal_information/items` (`{sku, item_id, variation_id}`) |
| Prontidão para emitir | `GET /can_invoice/items/{item_id}[/variations/{variation_id}]` |
| IE por UF | `POST/PUT/DELETE /users/{id}/invoices/state_registry/{cnpj}/{uf}` |
| Regras tributárias (Regime Normal) | `POST/GET/PUT /users/{id}/invoices/tax_rules[/{id}]` |
| Nota emitida | `GET /users/{id}/invoices/orders/{order_id}` (chave, número, série, XML, DANFE) |

Fontes: developers.mercadolivre.com.br — `api-fiscal-faturamento-de-venda`, `envio-dos-dados-fiscais`,
`envio-regras-tributarias`, `envio-de-inscricoes-estaduais`, `obtendo-nota-fiscal`,
`configuracoesibscbs`; landing oficial `mercadolivre.com.br/emitir-nota-fiscal`.

**Sem API** (só painel do ML): opt-in do faturador, upload do certificado A1, configuração da série.

Com isso, transmissão, certificado, série, rejeição da SEFAZ e manutenção de layout (reforma
tributária) saem do PubliAI e ficam com o ML. O que sobra — e é o que multiplica o que o PubliAI já
faz — é o **cadastro**: empresa e produto fiscalmente completos, empurrados para o canal, com
prontidão visível. O cadastro é também o que sobrevive a qualquer troca de emissor futura.

O gatilho concreto continua o mesmo do ADR-0114: o cliente da org DSA está abrindo CNPJ para migrar
a operação de PF para PJ e passar a emitir nota de venda.

## Decisões

### D-1 — Emissão pelo Faturador do ML; o PubliAI cadastra, empurra e monitora

O PubliAI **não transmite NF-e** na v1. Ele: (a) coleta e guarda os dados fiscais de empresa e
produto (fonte da verdade local, portável); (b) empurra os dados de produto para o ML via
`fiscal_information` na publicação; (c) exibe a prontidão real via `can_invoice`. A emissão em si é
do faturador do ML — automática no Full, um clique nas demais.

Nasce a porta `DadosFiscaisCanal` (padrão ADR-0024) com um único adaptador (ML). O adaptador de
emissor externo (Focus ou outro) **não** nasce agora — a porta existe para ele caber depois.

### D-2 — `tipo_pessoa` na org; PF jamais liga o módulo fiscal

`organizations.tipo_pessoa` (`pf` | `pj`), default `pf` — o default seguro: PF não emite. O módulo
fiscal entra em `modulos_habilitados` como `fiscal`, no mecanismo de gate que já existe (UI cosmética
+ 403 real na edge).

**Constraint no banco**, não só na UI: `'fiscal' = ANY(modulos_habilitados)` exige
`tipo_pessoa = 'pj'`. A matriz:

| tipo_pessoa | módulo fiscal | comportamento |
|---|---|---|
| pf | off | estado atual — publica normal, nenhum campo fiscal (DSA hoje) |
| pf | on | **impossível por constraint** — a ativação recusa e diz por quê |
| pj | off | publica normal; cadastro de empresa disponível, nada obrigatório (AVIL — emite pelo ERP) |
| pj | on | cadastro de empresa e campos fiscais de produto **obrigatórios** (DSA pós-CNPJ) |

A obrigatoriedade nasce **no ato de ligar o módulo** — ponto único de validação. Marcar uma org como
PJ, sozinho, não exige nada.

### D-3 — Tabela `empresa_fiscal`, superconjunto mínimo portável

Tabela própria (PK `org_id`, RLS por org), não colunas em `configuracoes`: a obrigatoriedade é
condicional ao módulo e as constraints são dela. Campos:

- **Identidade:** `cnpj`, `razao_social`, `nome_fantasia`, `inscricao_estadual`,
  `regime_tributario` (`simples` | `normal`)
- **Endereço fiscal completo:** `cep`, `logradouro`, `numero`, `complemento`, `bairro`,
  `municipio`, `municipio_ibge`, `uf`
- **Operação (portabilidade — o que faltaria na troca de emissor):** `natureza_operacao`,
  `cfop_dentro_uf`, `cfop_fora_uf_nao_contribuinte`, `cfop_fora_uf_contribuinte` (opcional),
  `cst_pis`, `cst_cofins` — semântica do par de CFOP herdada do D-10 do ADR-0114 (exemplo correto
  `5102`/`6108`; o slot de contribuinte cobre PJ com IE)
- **ML:** `origin_type` (`manufacturer` | `reseller` | `imported`) — papel da empresa, exigido pelo
  `fiscal_information`; é da org, não do produto
- **Corte temporal:** `emissao_a_partir_de` (D-8)

`configuracoes.uf_empresa` (ADR-0112) **não é tocado** — segue governando a alíquota interna. Trava
LOUD: se `empresa_fiscal.uf` divergir de `configuracoes.uf_empresa`, a ativação do módulo falha
nomeando as duas.

Certificado A1 e opt-in do faturador não têm API: o PubliAI **não pergunta nem registra**
auto-declaração — mostra a instrução do painel do ML e verifica o estado real por `can_invoice`.

### D-4 — Fiscal por família, empurrado por SKU

Mantém o D-10 do ADR-0114: NCM, CSOSN/CST, CEST e origem não mudam com a cor. Campos novos em
`familias`:

- `ncm` (obrigatório para emitir) · `cest` (opcional, só com ST) · `origem_nfe` (0–8, obrigatório)
  · `fci` (condicional a origem 3/5/8) · `ex_tipi` (opcional)
- `tributacao_icms` (obrigatório) + `tributacao_icms_regime` (`simples` | `normal`) — o valor é
  CSOSN quando gravado sob Simples, CST quando sob Regime Normal, e o campo-irmão registra **qual
  regime gerou o valor**

**Troca de regime detectada, não adivinhada:** org cuja `empresa_fiscal.regime_tributario` divirja
do `tributacao_icms_regime` de uma família não emite por ela — falha LOUD listando as famílias
afetadas, exigindo recadastro (semântica do D-10/ADR-0114 preservada com detecção mecânica).

O payload por SKU do ML é montado na hora do push: fiscal da família + `ean` (= `variacoes.gtin`),
`measurement_unit` (= `unidade`, que passa a ser lista controlada em vez de texto livre) e pesos que
já existem em `variacoes`. O vínculo SKU→anúncio usa `variacoes.codigo`, que já é o
`seller_custom_field` publicado — confirmado no código (`_shared/update/reconciliar.ts`,
`_shared/canais/mapeamento.ts`).

### D-5 — Dois campos de origem, sem derivação

`familias.origem` (binário nacional/importado) **continua intocado** governando o imposto 8%/16%
(ADR-0055/0107). `origem_nfe` (0–8) é digitado explicitamente, nunca derivado. Trava de coerência
LOUD recusa combinação impossível (ex.: `origem = nacional` com `origem_nfe = 1` importação direta;
`origem = importado` com `origem_nfe = 0`). Nenhum dos dois defaulta — regra financeira inviolável
do projeto (incidente ORIGEM de 2026-07-14).

### D-6 — Schema neutro de regime; v1 Simples-only

O modelo de dados conhece os dois regimes (D-3, D-4), mas a v1 só implementa e libera **Simples
Nacional** (mantém D-14 do ADR-0114). Org de Regime Normal cadastra a empresa e vê o módulo, mas a
ativação é recusada com mensagem dizendo por quê. Regime Normal (grupo `tax_rules` completo do ML:
ICMS/IPI/PIS/COFINS, CFOP com override, DIFAL, GNRE, IBS/CBS por UF) é entrega futura sem migração
de schema.

### D-7 — Gates: publicação bloqueia, planilha aborta, ativação valida

Numa org PJ + módulo fiscal ativo:

1. **Publicar e UPDATE** exigem fiscal completo na família — falha LOUD nomeando o campo faltante.
   Reposição de estoque e ajuste de preço **não** são bloqueados (não são escrita de anúncio novo).
2. **`ingest-lote`**: coluna `NCM` passa a existir; nessa org, ausência **aborta o lote** (mesmo
   contrato do `ORIGEM`, ADR-0107). Em org sem o módulo, a coluna é ignorada — planilhas atuais
   continuam válidas.
3. **Ligar o módulo** exige: `tipo_pessoa = 'pj'` + `empresa_fiscal` completa + regime `simples` +
   coerência de UF (D-3) + `emissao_a_partir_de` preenchida.

Anúncios já publicados não são despublicados: ficam com o semáforo vermelho (D-10) até o backfill.

### D-8 — Transição PF→PJ dentro da própria org DSA; corte por `emissao_a_partir_de`

**Não se cria org nova nem conta ML nova.** O ML permite converter a conta de CPF para CNPJ
mantendo `seller_id`, anúncios, reputação e histórico — e é essa conta convertida que o faturador
pressupõe. Org nova dividiria produtos, estoque e vendas em dois sem ganhar nada.

A fronteira "vendas de quando eu era PF" é **dado, não estrutura**: `emissao_a_partir_de`,
preenchida no ato de ligar o módulo. Venda com `date_created` anterior nunca vira pendência de nota
nem gera alerta (anti-padrão do 1º run já conhecido do projeto). Sequência operacional:

1. Contador: CNPJ + credenciamento SEFAZ + certificado A1
2. Painel ML: conversão da conta CPF → CNPJ
3. PubliAI: super-admin marca DSA como `pj`; cliente preenche `empresa_fiscal` em /configuracoes
4. Painel ML: opt-in do faturador + upload do A1 + série
5. PubliAI: super-admin liga `fiscal` (validação do D-7.3) com `emissao_a_partir_de`
6. Backfill do catálogo pela fila (D-9)

O PubliAI **não detecta** a conversão da conta no ML — a marcação de `tipo_pessoa` é manual do
super-admin. Entre a conversão e a ativação, a assimetria (PJ no ML, PF no PubliAI) é inofensiva.

### D-9 — Backfill: edição de produto + fila + IA que sugere e nunca grava

Hoje não existe edição de produto cadastrado — sem ela não há backfill. Entram na v1:

- O dialog de cadastro (`dialog-cadastro-produto.tsx`) vira **3 etapas** (dados / fiscal /
  variações) e ganha **modo edição** — um componente, não dois.
- `/estoque` ganha filtro **"fiscal pendente"** e o dialog ganha **"Salvar e próximo"** — o custo
  do um-a-um é navegação, não digitação; a fila elimina a navegação.
- **NCM sugerido por IA** (OpenRouter, padrão ADR-0026) a partir de nome, descrição e categoria ML:
  chega pré-preenchido **marcado como sugestão** e só é gravado com confirmação ativa do operador.
  Nunca salva sozinho, nunca aplica em lote. Parâmetro fiscal não defaulta em silêncio — a IA
  transforma "pesquisar e digitar N" em "conferir e confirmar N", sem mover a responsabilidade.

### D-10 — `can_invoice` é o semáforo, com reconciliação

O estado "pronto para faturar" exibido é o **do ML** (`GET /can_invoice/items/{id}`), não o que o
PubliAI acha que empurrou — o operador pode mexer no painel do ML por fora. O badge entra na tela
de Publicados; a leitura entra na **reconciliação horária existente** (nenhum worker novo). Push
fiscal roda via QStash com idempotência, como todo worker do projeto.

**Anúncios externos/migrados sem família** (`user_products` adotados) não têm de onde herdar
fiscal: aparecem explicitamente como "sem cadastro fiscal — vincular a produto", nunca somem em
silêncio.

**Limitação conhecida da v1 (achado da Task 14):** essa intenção ainda não fecha ponta a ponta —
`fetchPublicados` descarta anúncio externo sem família **antes** dele chegar à tela (`if (!rep)
continue`, comportamento pré-existente da tela Publicados, não introduzido por este ADR). O
`BadgeFiscal` já sabe renderizar o aviso; falta o caminho de dado que produza esse item na lista.
Hoje não há sinal fiscal na UI para esse caso específico — item futuro nomeado, não pendência
silenciosa (ver `docs/reference/modelo-de-dados.md#fiscal-adr-0135`).

## Fora da v1 (V2 nomeadas)

1. **Consumo da nota emitida** — `GET /users/{id}/invoices/orders/{order_id}`, chave/número/XML/
   DANFE na tela de vendas + guarda do XML. Escopo de operação, não de cadastro.
2. **Entrada por XML do fornecedor** — importar NF-e de compra para cadastrar produto (NCM, CEST,
   origem, GTIN, unidade vindos da nota) e dar entrada de mercadoria com custo real. O NCM do
   fornecedor é **sugestão forte, não verdade automática** (classificação errada de fornecedor é
   comum e a responsabilidade da revenda é do emitente): passa pelo mesmo fluxo de confirmação
   ativa do D-9.
3. **Regime Normal** — `tax_rules` completo (D-6).
4. **IE por UF** (`state_registry`) — só quando existir operação que a exija (ST/DIFAL relevante).
5. **Adaptador de emissor externo** — a porta `DadosFiscaisCanal` nasce na v1; o segundo adaptador
   só quando houver cliente que recuse o faturador do ML.

## Consequências

**A favor.** O caminho crítico fiscal (transmissão, certificado, rejeição SEFAZ, reforma
tributária) fica com o ML, de graça — o risco "manutenção fiscal perpétua" que o ADR-0114 admitiu
ter se confirmado é transferido quase inteiro. O PubliAI fica com o que é dele: cadastro, push,
visibilidade. O cadastro é portável por construção (superconjunto mínimo), então "qualquer emissor
no futuro" é promessa lastreada em dado, não em intenção.

**Contra.** Dependência do faturador do ML para emitir: se o ML descontinuar ou degradar o serviço,
o PubliAI volta ao cenário do ADR-0114 (a porta e o cadastro amortecem, o adaptador teria de ser
construído). Opt-in, certificado e série ficam invisíveis à API — o onboarding tem uma perna manual
no painel do ML que o PubliAI só consegue verificar indiretamente (`can_invoice`). E a v1 cobre só
Simples: o primeiro cliente de Lucro Presumido espera a V2.

## A verificar antes de codar

1. **Conversão CPF→CNPJ preservando a conta** — **verificado em 2026-08-25**: o fluxo oficial é a
   "mudança de titularidade" da mesma conta (Meus dados → Dados pessoais → "Alterar a titularidade
   da minha conta"; até 2 dias úteis; `mercadolivre.com.br/ajuda/Como-empresa_4861`). Exigência
   confirmada: o titular do CPF **precisa constar como sócio** no documento societário do CNPJ
   (`mercadopago.com.br/ajuda/pessoa-juridica_511`) — repassar ao contador antes da abertura.
   Após a mudança, as NF-e saem com os dados da PJ (mesma fonte). **Lacuna residual:** nenhuma
   página oficial declara explicitamente a preservação de reputação/anúncios/`seller_id` — o fluxo
   é de alteração da mesma conta (não criação), o que implica preservação, mas é inferência.
   Confirmar com o suporte ML antes de executar a transição; se o `seller_id` mudar, a conexão
   OAuth da org precisa ser refeita (operação conhecida, não mudança de design).
2. **`fiscal_information` em conta de teste** — criar SKU fiscal, vincular a item, ler
   `can_invoice` antes/depois; confirmar que `csosn` só é aceito com conta Simples.
3. **`measurement_unit`** — obter a lista de valores aceitos pelo ML e congelar o vocabulário do
   campo `unidade`.
4. **Replicação em User Products** — a doc diz que dados fiscais replicam para itens irmãos;
   confirmar o efeito em famílias com variações.
