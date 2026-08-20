# Dossiê de apoio ao Registro de Programa de Computador no INPI

Conjunto revisado em **20/08/2026** para apoiar o pedido de registro do **PubliAI - Sistema Inteligente de Automação e Geração de Anúncios para E-commerce**.

## Aviso sobre o procedimento atual

O INPI não aceita uma petição em papel ou um modelo independente como meio de depósito. O pedido é feito exclusivamente pelo formulário eletrônico **e-Software**. Assim, os arquivos desta pasta são modelos de apoio para organizar os dados, revisar a descrição técnica e preservar evidências; não substituem os documentos gerados pelo sistema do INPI.

No protocolo, o formulário exige a **Declaração de Veracidade (DV)** oficial, gerada a partir da GRU e assinada digitalmente. A procuração somente é anexada quando houver procurador. O relatório, o código-fonte, o ZIP, esta petição-modelo e a declaração complementar devem ser mantidos pelo titular, mas não são documentos que precisam ser anexados ao formulário e-Software segundo as orientações atuais do INPI.

## Arquivos

1. **`01_Peticao_Requerimento_Registro_INPI.md`** - texto-base e mapa dos dados que serão transpostos para o e-Software, com campos do titular, autores, responsável legal, programa e hash.
2. **`02_Relatorio_Descritivo_PubliAI.md`** - descrição técnica revisada conforme a implementação atual do projeto.
3. **`03_Declaracao_Autoria_e_Responsabilidade.md`** - declaração complementar para arquivo interno e apoio à comprovação de autoria/titularidade. Não substitui a DV oficial.
4. **`04_Checklist_Anexos_Obrigatorios.md`** - checklist atualizado do fluxo, da assinatura digital, do hash, da GRU e dos documentos que precisam ser anexados.

## Alterações relevantes desta revisão

- Correção do código de serviço da GRU para **730**. O código 375 que constava no material anterior não corresponde ao pedido de registro de programa de computador.
- Inclusão da taxa de referência de **R$ 210,00** conforme a tabela oficial consultada, com orientação para confirmar o valor vigente no momento do pagamento.
- Correção do fluxo: depósito exclusivamente eletrônico pelo e-Software; não há envio de código-fonte, relatório ou petição-modelo como anexo do pedido.
- Inclusão da exigência de certificado digital qualificado ICP-Brasil. Assinaturas avançadas Gov.br e ACOAB não são aceitas pelo sistema do INPI.
- Correção da arquitetura técnica: frontend estático no Render; backend em Supabase Edge Functions/Deno; filas e Redis em Upstash; IA acessada via OpenRouter.
- Correção de erros de redação e de afirmações absolutas que dependem da conferência dos contratos de trabalho, prestação de serviços, cessão de direitos e licenças de terceiros.

## Hash atualmente conferido

O arquivo técnico `publiai_codigofonte.zip`, mantido na raiz do projeto e fora desta pasta de modelos, apresentou, em 20/08/2026, o seguinte resumo SHA-512:

```text
0dbfb4e3d171220ccec0cc218d4d6f32fd57a9d60f96f9b2fd8d9142f92af527dd97d2e60ea82ed7d9e6444d8dc56a594ff47983ea1c7d636443a560a23abcca
```

Esse valor só permanece válido enquanto o arquivo técnico usado para calculá-lo permanecer byte a byte idêntico. Se o ZIP, o código ou o conjunto de arquivos for alterado, gere um novo arquivo técnico e um novo hash antes do protocolo.

Antes de protocolar, substitua todos os campos entre colchetes, confirme a versão e as datas, valide os autores e a titularidade patrimonial e confira novamente o hash contra o arquivo técnico definitivo.

## Fontes oficiais consultadas

- [Guia Básico do INPI para programas de computador](https://www.gov.br/inpi/pt-br/servicos/programas-de-computador/guia-basico/guia-basico)
- [Perguntas frequentes do INPI sobre programas de computador](https://www.gov.br/inpi/pt-br/acesso-a-informacao/perguntas-frequentes/programas-de-computador)
- [Legislação de programas de computador no INPI](https://www.gov.br/inpi/pt-br/assuntos/programas-de-computador/legislacao-programa-de-computador)
- [Tabela de retribuições do INPI](https://www.gov.br/inpi/pt-br/servicos/custos-e-pagamento/TabeladeRetribuiesINPI_PortariaMDICn110_2025ePortariaINPIn10_2025.pdf)

> Os modelos não constituem parecer jurídico. Antes do protocolo, confira a titularidade, a autoria, a data de criação/publicação, as licenças de terceiros e os dados do certificado digital.
