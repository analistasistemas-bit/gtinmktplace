# ADR-0181 — Entrada de mercadoria por nota de compra (XML) e pacote do contador

**Data:** 2026-10-15
**Status:** aceito — **Plano 1 EM PRODUÇÃO desde 2026-10-16** (main `4c2ca2a1`; 8 edges deployadas; 5 migrations aplicadas). **Plano 2a (pacote do contador: vendas) EM PRODUÇÃO desde 2026-10-16** (main `8694964e`). **Plano 2b-1 (pacote do contador: compras) implementado na branch `worktree-plano2b-compras-inventario`, aguardando revisão final, merge e redeploy da edge `baixar-notas-venda`.** Plano 2b-2 (inventário, D-12) pendente.
Design fechado em grilling com o Diego, revisado pelo Codex (lacunas respondidas abaixo e validadas pelo
Diego). D-12 e D-13 (pacote do contador) ficam no Plano 2.
**Desenha:** V2 #2 do [ADR-0135](0135-cadastro-fiscal-e-faturador-do-ml.md) (entrada por XML do fornecedor)
e parte da V2 #1 (consumo da nota emitida, só para exportação).
**Emenda:** ADR-0135 D-5 (origem passa a aceitar sugestão confirmada vinda da nota).
**Relacionado:** [0094](0094-estoque-unico-cadastro-manual.md) (ledger e entrada),
[0110](0110-ajuste-de-estoque-so-reduz.md) (ajuste), [0055](0055-imposto-por-origem-nacional-importado.md)
/ [0107](0107-origem-obrigatoria-na-planilha.md) (origem binária), [0026](0026-generalizacao-categorizacao-atributos-por-ia.md)
(sugere, humano decide).

## Contexto

Uma org nova (PJ, Simples Nacional, comércio, PE, sem ERP, emissão pelo Faturador do ML) quer
importar as NF-e de compra para adiantar o cadastro e dar entrada no estoque. Também precisa
repassar à contabilidade o que um ERP entregaria. O XML de exemplo (`NFe 2626…0320`, fornecedor
Distribuidora Magazine 1) mostra os pontos que o desenho precisa cobrir:

- o item da nota **não traz a grade** (`REF 06 · Short masculino - DIV - DIV · 35 PC`);
- CSOSN 102 e CFOP 5102 são do **fornecedor**;
- o arquivo é uma **exportação do ERP do fornecedor**, não o XML original da SEFAZ: sem
  `<Signature>` e com `<nItem>` como elemento em vez de atributo de `<det>`.

Termos no [glossário](../reference/glossario.md): Nota de compra, Item da nota, Vínculo de
fornecedor, Distribuição na grade, Custo de aquisição, Custo de precificação, Descrição fiscal.

## Decisões

**D-1 — Onde e quem.** Assistente "Importar nota de compra" dentro de `/estoque`, sem menu novo.
Gate: módulo `estoque` + `tipo_pessoa = pj` + CNPJ na `empresa_fiscal`. A etapa fiscal só aparece com o
módulo `fiscal` ligado. Notas, vínculos, arquivos e exportações são org-scoped: chaves
`(org_id, chave)` e `(org_id, cnpj_fornecedor, cprod)`, XML em storage privado e autorização
também nos workers.

**D-2 — Aceitação da nota.** Aceita os dois formatos, o XML da SEFAZ (`nfeProc` assinado) e a exportação
de ERP. **O servidor lê o próprio XML** com um leitor textual (`_shared/nfe/ler-nfe.ts`, sem parser XML
genérico); do navegador só vêm as decisões do operador (distribuição, fator, aceites). Valida:
- o dígito verificador da chave;
- o destinatário = CNPJ da org;
- `cStat = 100` quando houver protocolo;
- a coerência entre a soma dos itens e o total da nota. Soma dos itens ≠ total de cada componente é
  recusada. Já a divergência só entre `vNF` e a composição dos totais exige **aceite ativo** do operador
  (gravado em `notas_compra.divergencia_total_aceita`), porque há componentes de leiaute específico
  (`vICMSDeson`, ISSQN) que não entram na composição verificada. Revisão do plano, 2026-10-15.

Nota sem assinatura entra com o aviso "cópia sem assinatura". O risco de fraude é baixo, porque quem
envia é a própria org. Só entram CFOPs de **venda/revenda do fornecedor** (`51xx`/`61xx`, ST
`54xx`/`64xx`); bonificação, remessa, devolução e demais naturezas são recusadas com o motivo. A
chave já importada não é recusada às cegas: reabre a importação para conferir ou retomar.

**D-3 — A nota de compra é documento à parte.** Ela guarda o XML original, o cabeçalho e os itens,
com **valores exatos da nota**, sem arredondar por unidade: `vProd`, `vFrete`, `vSeg`, `vDesc`,
`vOutro`, `vIPI`, `vST` por item. Depois de concluída, não muda. O ledger
(`estoque_movimentos`) segue como hoje: guarda quantidade e **custo de precificação**. Por isso **`registrar_entrada`
não muda de semântica**. O custo de aquisição (e o médio do inventário) vive nas notas; o custo de precificação vive no SKU e no ledger.
O pacote do contador lê das notas, nunca do ledger.

**D-4 — Importação atômica.** Uma RPC nova aplica a nota inteira numa transação, ou nada. Ela chama
`registrar_entrada` por SKU com `ref = chave:nItem:SKU`, o que torna a reexecução idempotente e evita a
colisão entre SKUs do mesmo item. Produto **cadastrado a partir da nota nasce com saldo 0**, porque o saldo
vem só da nota e o estoque inicial do `cadastrar-produto` não pode duplicar a entrada. A distribuição
confirmada é congelada; corrigir depois é ação explícita (D-10).

**D-5 — Descrição fiscal é campo próprio da família.** Nasce pré-preenchida com o `xProd`, é
editável e é o que vai no `title` do `fiscal_information`. `nome_pai` continua alimentando a IA do
título; família sem descrição fiscal usa `nome_pai`, como hoje.
*Rejeitado:* reusar `nome_pai`, porque a mesma frase serviria à nota e à IA. *Rejeitado:* `xProd` literal,
porque o `DIV - DIV` sairia na nota de venda.

**D-6 — Vínculo de fornecedor, com conversão de unidade.**
- **Chave:** `(CNPJ emitente + cProd) → código do PAI`. O código do PAI é estável entre lotes; o SKU é
  resolvido na família mais recente, como no estoque canônico.
- **Criação e uso:** nasce na primeira importação ("cadastrar novo" ou "vincular a existente"), casa
  sozinho nas seguintes e pode ser trocado.
- **Conversão de unidade:** o vínculo guarda o fator `uCom → peça` (ex.: `1 CX = 12 PC`). É perguntado
  uma vez e a distribuição é sempre em unidades de estoque inteiras.
- **GTIN:** casa quando presente e válido; `SEM GTIN` nunca casa; GTIN em conflito exige escolha.
- **Código do produto:** produto novo usa o código sequencial do `cadastrar-produto`; o `cProd` nunca
  vira código. Recompra não sobrescreve cadastro já confirmado.

**D-7 — Distribuição na grade fecha exata, em qualquer SKU.** A quantidade do item (já convertida)
é repartida entre variações, e a soma tem que fechar exata. O vínculo só pré-seleciona o produto: uma
REF genérica pode ser distribuída entre SKUs de **produtos diferentes**, sem conceito novo. Produto
sem grade recebe direto. **Falta física** vira ajuste depois (ADR-0110). **Sobra física** é entrada
manual separada.
*Rejeitado:* aceitar divergência ou "saldo a distribuir", porque a entrada deixaria de espelhar o
documento.

**D-8 — Variação faltante entra pelo fluxo existente, com a referência da nota** *(revisado 2026-10-15,
OK do Diego após 2 rodadas de revisão do Codex)*. Quando a nota traz tamanho ou cor que o produto não tem:
- **produto publicado:** o assistente abre o "adicionar variação/estender grade" (ADR-0129, admin), com o
  estoque inicial = as peças da nota para aquele SKU e a **referência de ledger da nota**
  (`nfe:{chave}:{nItem}:{codigo}`). A variação é publicada por ação explícita do operador. Na confirmação
  da importação, `registrar_entrada` reconhece a mesma referência e **não soma de novo**. Se a quantidade
  já lançada divergir da nota, a importação é recusada;
- **produto não publicado:** v1 recusa o item e orienta a cadastrar a grade completa (não existe edição de
  composição de produto não publicado).

*Rejeitado:* variação "local, não publicada", porque `excluida_da_publicacao` não significa "fora do
anúncio" e uma variação local numa família publicada não tem caminho até a Revisão. *Rejeitado:* abrir o
fluxo existente sem a referência, porque ele exige estoque inicial > 0 e somaria em dobro com a nota.

**D-9 — Custo documentado, custos adicionais e custo de precificação.**
- **Custo da nota:** `vProd` mais frete, seguro, IPI, ST e outras despesas, menos o desconto. Usa os
  valores **discriminados por item** do XML; o rateio proporcional (por valor, fechando os centavos com
  o total) só cobre o que vier apenas no total.
- **Custos adicionais documentados:** CT-e de frete de compra, seguro e guias pagas à parte. São
  vinculados à nota e aos itens beneficiados e rateados. **Integram o custo de aquisição**, conforme o
  parecer (CPC 16 itens 11/16/18, NBC TG 1002 13.2).
- **Custo de precificação:** `variacoes.custo`, um custo **gerencial**. Nasce igual ao custo de
  aquisição, é editável pelo operador e alimenta markup e preço (ADR-0055 intocado). Não integra o
  pacote contábil, que reflete só os documentos fiscais e o custo de aquisição deles.

*Decisão do Diego (2026-10-15), contra a recomendação do parecer simulado (item 5):* o parecer pedia
que, quando o custo de precificação refletir valor efetivamente pago acima do documentado, a
diferença fosse informada à contabilidade com comprovante. O Diego manteve o custo de precificação
fora do pacote. A orientação contábil desse caso fica com a empresa e o contador dela.

A tela mostra lado a lado o custo de aquisição e o custo de precificação.

**D-10 — Fiscal da nota é sugestão confirmada (emenda o D-5 do ADR-0135).**
- **NCM, `origem_nfe` e `familias.origem`:** chegam pré-preenchidos e marcados "veio da nota do
  fornecedor". Só são gravados com confirmação ativa, item a item.
- **Origem:** a do fornecedor é traduzida para a operação da revenda. Compra no mercado interno de
  mercadoria importada é diferente de importação direta, então o valor documental é preservado e a
  origem de saída é confirmada.
- **CSOSN/CST e CFOP do fornecedor:** nunca são copiados. O CSOSN de saída vem de um **"CSOSN padrão
  de revenda" da `empresa_fiscal`**, informado com o contador, que aparece no produto para confirmar
  e nunca é aplicado em silêncio.

**D-11 — Desfazer e cancelamento.** **Desfazer importação** é só para admin: reduz o saldo via
`ajustar_estoque`, marca a nota como `desfeita` (não apaga) e é recusado listando os SKUs quando parte já
foi vendida (saldo insuficiente). O **cancelamento fiscal** da nota pelo fornecedor não é detectável sem
certificado: o operador marca a nota como cancelada e o caminho é o mesmo do desfazer.

**D-12 — Inventário é foto, não reconstrução.** O sistema não reconstrói inventário de data passada
pelo ledger: o ledger é apagável por `limpar_movimentos_orfaos`, e o saldo vindo da planilha não passa
por ele. Entrega:
- **"inventário de hoje"**: saldo × custo médio de aquisição;
- **foto automática em 31/12**: gravada e imutável, para o **Livro Registro de Inventário (modelo 7)**,
  obrigatório (CGSN 140 art. 63, II). Campos: data-base, CNPJ/IE, código, descrição, NCM, unidade,
  quantidade, custo unitário, valor total, cor/tamanho.

O **critério de avaliação** é o **custo médio ponderado móvel** por variação, recalculado a cada entrada a
partir do custo de aquisição (nota + adicionais) e guardado nas notas. Nunca o último custo, que é só de
precificação (NBC TG 1002 13.1/13.5).

A foto separa:
- estoque próprio no estabelecimento;
- estoque próprio **em terceiros (Full)**;
- mercadoria de terceiros.

A empresa **confirma a contagem física**; diferenças justificadas viram ajuste. SKU sem nenhuma nota
importada aparece marcado "sem nota de compra", nunca com custo inventado.

**D-13 — Pacote do contador, mensal, em `/estoque`.** É um zip com:
- **compras:** XMLs originais e planilha de entradas (data, fornecedor, CNPJ, número, chave, CFOP,
  NCM, CSOSN, quantidade e valores da nota);
- **inventário:** D-12;
- **vendas:** XMLs de venda, eventos (cancelamento, CC-e) e devoluções do Faturador do ML, obtidos **ao vivo** pelo
  **download por período** da API na hora da exportação, **sem gravar** no PubliAI. O download por
  período é preferido à busca pedido a pedido, que perde devolução emitida para pedido antigo.
  *Decisão do Diego (2026-10-15):* as notas de venda ficam sempre disponíveis no portal do ML, e guardar
  cópia só inflaria o banco. A **conservação legal** (LC 123 art. 26, II) é da empresa, apoiada no
  repositório do ML e no pacote exportado que ela entrega ao contador.
  - Vai em lotes retomáveis com manifesto de documentos e falhas.
  - API indisponível ≠ ausência de nota; pacote parcial é declarado como parcial.
  - **Relatório de vendas detalhado** (pedido do contador real, 2026-10-15): uma linha por venda e por
    nota, **em ordem crescente de data**, com data da venda, pedido ML, data de emissão, número, série,
    chave, valor dos produtos, frete, desconto, valor total e status (autorizada, cancelada, devolução).
    Venda sem nota autorizada aparece na mesma lista, sinalizada, nunca omitida.
  - Devolução entra no mês de emissão da nota de devolução.
- **devoluções emitidas fora do ML:** a devolução **ao fornecedor** é emitida pela própria org (CFOP
  5.202/6.202), por emissor externo, como o Emissor gratuito do Sebrae. O PubliAI **importa** esse XML,
  vincula à nota de compra e baixa o estoque. Reembolso de venda sem retorno físico **não** volta ao
  estoque.

O PubliAI **não classifica** ST nem monofásico. O contador apura a partir dos XMLs. O contador real
confirmou que o essencial para ele são **os XMLs de todas as vendas + o relatório detalhado**. A
planilha item a item com CSOSN/NCM e a coluna de "tratamento fiscal" do parecer simulado saíram do
escopo.

O pacote **não substitui** livro Caixa, DEFIS nem escrituração.

**Fora desta entrega (fase futura nomeada):** dados de Mercado Livre e Mercado Pago (vendas brutas,
tarifas, fretes, publicidade, estornos, repasses) para o livro Caixa. O PubliAI já tem esses dados no
Financeiro, e o contador precisa deles todo mês. Repasse líquido **não** é faturamento: a base do Simples é a
venda bruta (LC 123 art. 3º, §1º).

**Emendas de 2026-10-16 (Diego, após o spike da API):**
1. "Vendas sem nota" sai do Plano 2a e fica pendente até a primeira venda faturada pelo Faturador mostrar onde o
   pedido ML aparece no XML (o prefixo do nome do arquivo não é pedido, pack nem envio).
2. 1 lote = 1 mês: a API aceita no máximo ~1 mês por chamada e devolve 429 após 3–4 chamadas em poucos minutos,
   sem `Retry-After`. "Retomar" = baixar o mês de novo; o manifesto é a aba Conferência.
CT-e fica fora do download (`others=correction_letter`): documento de transporte, não de venda.
**Plano 2b-1 — compras no pacote (D-13, parte "compras"; EM PRODUÇÃO desde 2026-10-16 (main `ff67a7e6`; edge `baixar-notas-venda` v2)).** Validado em produção (2026-10-16), org de teste descartável: nota importada pela tela → pacote do mês da emissão com `compras/xmls/<chave>.xml` byte a byte igual ao importado, 2 linhas (CSOSN 102, CFOP 5102, NCM e quantidades do XML), total R$ 700 = vNF, diferença 0; vendas "indisponíveis" (org sem conexão ML) → PARCIAL nos 4 relatórios; nota desfeita → `compras/xmls-desfeitas/`, fora da planilha e dos totais, rotulada na Conferência; tudo limpo depois. Spec: `docs/superpowers/specs/2026-10-16-pacote-contador-compras-design.md`; plano: `docs/superpowers/plans/2026-10-16-pacote-contador-compras.md`. O mesmo `pacote-AAAA-MM.zip` passa a levar `relatorio-compras.xlsx`/`.pdf` (uma linha por item, com CSOSN/CST do XML) e os XMLs das notas de compra importadas (`compras/xmls/<chave>.xml`). Tudo no navegador: sem migration, sem edge nova; só `baixar-notas-venda` muda (alvo de auditoria `pacote_contador_mes`, falha de auditoria responde `codigo: 'auditoria'`). Decisões do Diego (2026-10-16):
1. Competência = data de emissão (`emitida_em`, mês em America/Sao_Paulo); a planilha mostra também a data de importação.
2. Mesmo pacote das vendas, com fallback "vendas indisponíveis" (selo PARCIAL nos quatro relatórios) quando o ML falha fora do suporte.
3. Uma linha por item, com o cabeçalho da nota repetido e CSOSN/CST lido do XML.
4. Notas desfeitas e marcadas canceladas vão no zip em pastas próprias (`compras/xmls-desfeitas/`, `compras/xmls-canceladas/`), listadas na Conferência com o rótulo "desfeita no PubliAI em <data>" / "marcada cancelada no PubliAI em <data>" (data = `desfeita_em`) e fora da planilha e dos totais ("desfazer" é operação de estoque; "cancelada" é marcação do operador, não evento SEFAZ verificado).
5. Em sessão de suporte não há fallback: falha na parte de vendas aborta o pacote; a edge audita o pacote inteiro (vendas + compras).
Ruling R1: a diferença por nota é `vNF − (vProd − vDesc + vFrete + vSeg + vOutro + vII + vIPI + vIPIDevol + vST + vFCPST)`, pois `vII` e `vIPIDevol` integram o `vNF` no leiaute. XML vai com os mesmos bytes baixados do bucket (hash SHA-256 conferido contra o da importação; fila de 4 downloads, 30 s cada). Cobertura: só notas importadas; quantidade, unidade e CFOP são os do fornecedor. Falha ao listar aborta; falha de uma nota vai para a Conferência e marca PARCIAL. Inventário (D-12) fica no Plano 2b-2.
Plano 2a: spec `docs/superpowers/specs/2026-10-16-pacote-contador-vendas-design.md`. Validado em produção (2026-10-16): mês sem nota na org PF → pacote só com relatórios (TTFB 2,3 s); zip real de setembro de uma loja com ~1.400 vendas/mês (emissão por ERP), filtro de produção: 1.351 NF-e, 6,2 MB, 30 s (com `others=all` vinham as mesmas 1.351 NF-e + 1.347 CT-e: o filtro não perde documento fiscal); leitura 1,9 s + relatórios 1,0 s; 1.337 vendas autorizadas + 14 remessas em comodato (CFOP 6908) em "outros", sem PARCIAL; soma e 4 notas conferidas contra o XML por leitura independente; segundo clique durante a trava recebe a mensagem local.

## Parecer do contador (simulado)

> Gerado em 2026-10-15 pelo Codex `gpt-6-astra` **no papel de contador** da empresa (Simples, comércio,
> Recife/PE). Serve para destravar o desenho e **não substitui o contador real**. Cada "não verificado"
> abaixo segue pendente.

1. **Inventário:** custo médio ponderado móvel (PEPS também é admitido; o último custo não serve).
   O inventário em 31/12 é obrigatório no Livro Registro de Inventário mod. 7 (CGSN 140 art. 63, II;
   Convênio SINIEF s/nº 1970 art. 76). → D-12.
2. **Custo de aquisição:** inclui frete de compra mesmo em CT-e separado, seguro, manuseio, e ICMS-ST
   e IPI suportados; desconto comercial reduz. Ficam **fora**: juros, multa, desconto financeiro
   condicionado, comissão ML, publicidade e frete de entrega ao comprador (CPC 16; LC 123 art. 23). → D-9.
3. **PGDAS-D:** revenda de confecção = Anexo I, normal. ST/antecipação **com encerramento** é segregada;
   antecipação de PE **sem encerramento** é recolhida fora do DAS e não sai da receita (LC 123 art. 13
   §1º XIII; art. 18 §4º-A I; RICMS/PE Dec. 44.650/2017 arts. 328, 338–340, 363). → D-13 (coluna de
   tratamento validado).
4. **Devolução ao fornecedor:** a PUBLIAI emite (RICMS/PE arts. 530–531), por exemplo pelo Emissor
   Sebrae (gratuito); CFOP 5.202/6.202. A **devolução de venda** o Faturador do ML emite. → D-13.
5. **Custo pago acima do documentado:** informar à contabilidade com comprovante; custo gerencial é
   permitido (Lei 8.137/1990 arts. 1º II/IV, 2º V). → **Não adotado** (D-9, decisão do Diego).
6. **O que o contador recebe:**
   - **todo mês:** vendas (XMLs, eventos, devoluções, conciliação); compras e estoque (XMLs, CT-e,
     divergências); ML/MP (bruto, tarifas, repasses), que é fase futura; extratos, despesas e tributos
     pagos, que ficam com a empresa;
   - **todo ano:** inventário confirmado, movimento anual, fechamento financeiro e sócios.
   - **Obrigações:** PGDAS-D (dia 20), DEFIS (31/03), livros Caixa/Entradas/Inventário (CGSN 140
     art. 63), DeSTDA em PE (dia 28; dispensa do CNPJ não verificada). SEF/EFD só acima do sublimite
     (não verificado).

**Ressalvas não verificadas:** CNAE, Cacepe, sublimite e regime especial da empresa; ST e benefícios de
PE por mercadoria; formalidades estaduais do livro de inventário; uso de NFA-e; fluxo de devolução na
conta do ML.

## Consequências

**Risco pré-existente herdado (achado na revisão do plano, 2026-10-15):** o "adicionar variação"
(ADR-0129) lê o saldo, cria a família nova e clona as variações com esse retrato, sem lock. Entrada ou
venda que caia nessa janela se perde quando a família nova vira a canônica (ADR-0094). Isso vale para
qualquer origem, não só para a nota. A D-8 usa esse fluxo e herda o risco. A nota em si fica protegida
contra lançamento depois do fechamento (`registrar_entrada_nota_pendente`). Correção: issue próprio sobre o
modelo de família canônica.

O cliente sem ERP sai com cadastro, estoque e um pacote mensal a partir de documentos que já recebe.
Guardar a nota como documento à parte custa uma tabela nova, mas mantém o caminho financeiro
existente intacto e dá ao contador dados exatos. A busca de XML de venda ao vivo não guarda passivo,
mas depende da API do ML no momento da exportação.

## Pendências de verificação (pós-implementação)

- **`fiscal_information.title` -> `xProd`:** a descrição fiscal é gravada e enviada, mas a afirmação "sai
  na nota" segue **não verificada**. Verificar na primeira venda faturada da Zaven:
  `GET /users/3760134495/invoices/orders/{order_id}`, abrir o XML e comparar o `xProd` com a
  `descricao_fiscal` da família. Registrar o resultado aqui.
- **storage-js 2.110.0:** a mensagem de objeto duplicado no upload foi lida do `deno.lock`; confirmar em
  runtime que o reenvio do mesmo XML devolve `ja_existia`.
- Validação em runtime (org Zaven, concorrência em duas abas, desfazer) e deploy: ver
  [deploy-e-migrations](../how-to/deploy-e-migrations.md).

## A verificar antes de codar

1. `fiscal_information.title` é o texto impresso no `xProd` da nota do Faturador. A Zaven foi conectada ao
   ML em 2026-10-15 (seller `3760134495`), ainda sem anúncios nem vendas. Decisão do Diego: codar e
   verificar na **primeira venda faturada** da Zaven.
2. Download por período dos XMLs do Faturador: autenticação, filtros (canceladas e devoluções),
   histórico disponível, volume e bytes por mês, limites, e CPU e memória da montagem do zip (ADR-0173).
   **Resolvido pelo spike de 2026-10-16** (só leitura, duas lojas): endpoint
   `GET /users/{id}/invoices/sites/MLB/batch_request/period/stream` com o token atual do app (sem escopo novo),
   devolvendo `application/zip` direto; intervalo máximo de ~1 mês por chamada (mais que isso → 400); mês sem
   documento → 404 com corpo vazio; 429 após 3–4 chamadas em poucos minutos, sem `Retry-After`; volume de uma loja com
   ~1.400 vendas/mês (emissão por ERP): ~1.350 NF-e, ~6 MB, ~30 s sem CT-e (~12 MB e ~56 s com CT-e). A montagem do
   zip fica no navegador, não na edge (CPU de 2 s, ADR-0173). Não medidos: fuso/inclusividade de `start`/`end`,
   critério temporal dos eventos, TTFB e escopo da cota (conta ou app).
3. O push de estoque ignora o SKU não publicado (D-8).
4. Validar o pacote com o **contador real** do cliente. O parecer acima é simulado. **Adiado para a
   V2 (decisão do Diego, 2026-10-15):** ST/antecipação de PE por mercadoria, formalidades do Livro de
   Inventário em PE, cobertura da devolução de venda no Faturador do ML e emissor da devolução ao
   fornecedor (Sebrae × NFA-e). A v1 segue sem eles: coluna "tratamento fiscal" pendente, inventário em
   planilha, importação de devolução emitida fora.
5. ~~XML original da SEFAZ~~: dispensado pelo Diego em 2026-10-15. Os testes usam a exportação de ERP
   real (forma) e uma fixture no formato SEFAZ.
