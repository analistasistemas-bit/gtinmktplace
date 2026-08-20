# CHECKLIST ATUALIZADO DO PEDIDO DE REGISTRO DE PROGRAMA DE COMPUTADOR

**Programa:** PubliAI
**Revisão:** 20/08/2026
**Sistema:** e-INPI / e-Software

## 1. Itens necessários para protocolar

Marque cada item somente depois da conferência:

- [ ] Cadastro e acesso ao e-INPI/e-Software.
- [ ] Certificado digital qualificado emitido por autoridade certificadora credenciada na ICP-Brasil.
- [ ] GRU do pedido emitida e paga antes do protocolo.
- [ ] **Código de serviço da GRU: 730 - Pedido de Registro de Programas de Computador (RPC).**
- [ ] Número da GRU/“Nosso Número” guardado para iniciar o formulário.
- [ ] Documento técnico definitivo preservado pelo titular e hash calculado sobre esse mesmo arquivo ou conjunto de arquivos.
- [ ] Algoritmo e resumo digital hash preenchidos no formulário e-Software.
- [ ] Declaração de Veracidade (DV) oficial baixada do sistema, assinada digitalmente e mantida em PDF sem edição.
- [ ] Dados completos do titular, autores, programa, criação/publicação, linguagens, campo de aplicação e tipo de programa.
- [ ] Procuração digital assinada pelo titular, **somente se** o pedido for protocolado por procurador.

## 2. Documentos que precisam ser anexados no e-Software

De acordo com a FAQ atual do INPI, os únicos documentos que precisam ser anexados ao pedido são:

1. **Declaração de Veracidade (DV) oficial**, específica para o serviço e relacionada ao número da GRU;
2. **Procuração**, quando houver procurador.

Não anexe, como se fossem obrigatórios do pedido, a petição-modelo, o relatório descritivo, esta declaração complementar, o código-fonte, o ZIP, o comprovante bancário ou atos societários. Esses materiais devem ser mantidos sob a guarda do titular para controle, auditoria e eventual prova judicial. O sistema pode exigir informações adicionais em fluxos distintos; em caso de mensagem específica do INPI, siga a instrução exibida no próprio sistema.

## 3. Declaração de Veracidade e assinatura digital

- [ ] Baixar a DV no módulo de geração da GRU ou no formulário e-Software.
- [ ] Conferir se a DV está vinculada à GRU deste pedido.
- [ ] Não copiar, reescrever, imprimir, editar ou gerar uma nova DV manualmente.
- [ ] Sem procurador: titular pessoa física assina com e-CPF; titular pessoa jurídica assina com e-CNPJ.
- [ ] Com procurador: titular assina digitalmente a procuração; o procurador assina a DV com seu e-CPF.
- [ ] Não usar assinatura avançada Gov.br ou ACOAB, pois o INPI informa que elas não são aceitas no sistema.
- [ ] Validar a assinatura pelo serviço oficial do ITI, quando necessário: [validar.iti.gov.br](https://validar.iti.gov.br/).

## 4. Código-fonte, arquivo técnico e hash

O INPI não recebe o código-fonte no protocolo eletrônico. O titular deve guardar a documentação técnica que permita, se necessário, demonstrar o objeto protegido e sua integridade. O arquivo abaixo é mantido na raiz do projeto, fora desta pasta de modelos.

### Arquivo técnico atualmente conferido

- Arquivo: `publiai_codigofonte.zip`
- Algoritmo: `SHA-512`
- Hash conferido em 20/08/2026:

```text
0dbfb4e3d171220ccec0cc218d4d6f32fd57a9d60f96f9b2fd8d9142f92af527dd97d2e60ea82ed7d9e6444d8dc56a594ff47983ea1c7d636443a560a23abcca
```

### macOS/Linux

```bash
shasum -a 512 publiai_codigofonte.zip
```

### Windows PowerShell

```powershell
Get-FileHash -Algorithm SHA512 .\publiai_codigofonte.zip
```

Se o ZIP ou qualquer arquivo contido nele mudar, o hash anterior deixa de identificar o conjunto técnico e deve ser substituído no formulário e nos controles internos. Mantenha pelo menos duas cópias íntegras, com data e identificação da versão.

## 5. GRU e valor de referência

- [ ] Emitir a GRU em [meu.inpi.gov.br](https://meu.inpi.gov.br/) ou pelo acesso oficial do INPI.
- [ ] Selecionar o serviço `730 - Pedido de Registro de Programas de Computador - RPC`.
- [ ] Pagar a guia e guardar o comprovante bancário definitivo. Agendamento não é pagamento.
- [ ] Confirmar o valor exibido no sistema no momento da emissão.

A tabela oficial consultada para esta revisão indica **R$ 210,00** para o código 730, vigente na tabela publicada em 2025. O valor pode ser atualizado ou ter desconto conforme o perfil do requerente; prevalece sempre o valor apresentado no sistema oficial no momento da emissão.

## 6. Sequência de protocolo

1. Gerar e pagar a GRU 730.
2. Baixar a DV vinculada à GRU.
3. Assinar a DV com certificado digital qualificado; assinar também a procuração se houver procurador.
4. Acessar o e-Software e informar o “Nosso Número”.
5. Cadastrar titular(es), autor(es), dados do programa, linguagens, campo de aplicação, tipo de programa, derivação autorizada se aplicável, algoritmo e hash.
6. Anexar somente a DV oficial e, se aplicável, a procuração.
7. Conferir todos os dados e protocolar.
8. Guardar o recibo, o número do pedido, a GRU, a DV assinada, o arquivo técnico, o hash, este dossiê e os instrumentos de titularidade.

## 7. Após o protocolo

- [ ] Guardar o recibo de peticionamento e o número do processo.
- [ ] Acompanhar a publicação na Revista da Propriedade Industrial, publicada às terças-feiras.
- [ ] Consultar a disponibilização do certificado no portal do INPI; o guia atual informa prazo de até 10 dias corridos após o depósito e a confirmação do pagamento.
- [ ] Registrar internamente a versão e o hash do programa efetivamente depositado.

## 8. Fontes oficiais

- [Guia Básico do INPI](https://www.gov.br/inpi/pt-br/servicos/programas-de-computador/guia-basico/guia-basico)
- [Perguntas frequentes do INPI](https://www.gov.br/inpi/pt-br/acesso-a-informacao/perguntas-frequentes/programas-de-computador)
- [Guia completo: hash, DV e procuração](https://www.gov.br/inpi/pt-br/assuntos/programas-de-computador/guia-completo-de-programa-de-computador)
- [Tabela oficial de retribuições](https://www.gov.br/inpi/pt-br/servicos/custos-e-pagamento/TabeladeRetribuiesINPI_PortariaMDICn110_2025ePortariaINPIn10_2025.pdf)

> Este checklist é operacional e não substitui a conferência dos dados reais do titular, dos autores, da titularidade patrimonial e das licenças de terceiros.
