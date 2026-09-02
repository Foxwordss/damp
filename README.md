# Damp

Este projeto é uma adaptação da Declaração para Enquadramento no Programa (DAMP), criada pela Caixa Econômica Federal para uso em processos de aquisição de imóveis e terrenos com a utilização de dinheiro do FGTS. O projeto está disponível para acesso [clicando aqui.][link-projeto]

O projeto foi originalmente criado pela equipe de TI da Caixa e adaptado por **Foxwordss** ([github.com/Foxwordss](https://github.com/Foxwordss)). **Não há coleta ou armazenamento de dados em servidor.** Os dados das DAMPs feitas são armazenadas no próprio navegador do usuário que fez a DAMP e podem ser excluídos a qualquer hora pelo próprio usuário.

O Grau de sigilo da Declaração para Enquadramento no Programa é **Público.**

## Funcionalidades adicionadas

- Armazenamento no navegador dos formulários criados
- Recuperação dos formulários armazenados
- Exclusão dos formulários armazenados
- Preenchimento automático via OCR a partir do Espelho da Proposta (SIOPI) e de outros documentos (RG, CPF, carteira de trabalho, cadastro CAIXA) — ver detalhes abaixo

## Preenchimento automático (OCR)

Anexando o Espelho da Proposta (SIOPI) ou outros documentos, o sistema lê os dados automaticamente e preenche o formulário, sem nada ser enviado a um servidor (toda a leitura acontece no navegador, via [Tesseract.js](https://github.com/naptha/tesseract.js) + [PDF.js](https://mozilla.github.io/pdf.js/)).

**Como usar:**

1. Escolha, no seletor ao lado do botão de extração, se os dados são do **1º Proponente/Comprador** ou do **2º Proponente (Coobrigado)** — cada um lê a seção correspondente do Espelho.
2. Anexe o(s) documento(s) arrastando e soltando na área indicada, ou clicando para escolher o arquivo.
3. Clique em "Extrair e Preencher". Os campos identificados são preenchidos automaticamente; o que não for encontrado fica em branco para preenchimento manual.

**O que é lido automaticamente do Espelho da Proposta:**

- CPF, Nome e Data de Nascimento do proponente selecionado (1º ou 2º)
- Estado Civil e Regime de Bens (quando casado(a)), incluindo a data do regime
- Residência (Município/UF) e Profissão/Situação Ocupacional
- Se possui 36 meses de trabalho sob o regime do FGTS
- Endereço do imóvel objeto do financiamento, no formato `LOGRADOURO ; NÚMERO - COMPLEMENTO - MUNICÍPIO - UF - CEP`
- Modalidade da operação (ex.: Imóvel Novo/Usado, Construção, Reforma) e o Valor de Compra e Venda ou Orçamento Proposto pelo Cliente
- Enquadramento do programa (sempre CCFGTS/PMCMV, regra de negócio fixa)
- Local e data da assinatura (local sempre Goiânia, data sempre a data atual)

**Correções de OCR aplicadas:** o valor de compra e venda é conferido automaticamente contra a relação `Valor Financiamento Negociado ÷ Cota de Financiamento (%)` — se o OCR errar um dígito ou embaralhar o separador de milhar nesse valor (o maior número da tabela, mais sujeito a erro), o sistema recalcula pelo valor correto usando esses dois campos menores, mais fáceis de o OCR acertar. A leitura de PDF também usa resolução mais alta (scale 3, ~216 DPI) para reduzir erros de dígito.

**2º Proponente (Coobrigado):** ao selecionar essa opção, apenas os dados pessoais e de trabalho são alterados (CPF, Nome, Data de Nascimento, Estado Civil, Profissão, Residência, 36 meses de FGTS) — os demais campos da proposta (modalidade, valor, enquadramento, imóvel, local/data) permanecem como já preenchidos, sem serem sobrescritos.

## Neste projeto utilizamos as tecnologias

- HTML, CSS e JS
- jQuery
- Bootstrap
- Tesseract.js e PDF.js (OCR e leitura de PDF, 100% no navegador)

## Teclas de atalho

Implementadas usando o atributo *accesskey*.
Consulte a [página do MDN](https://developer.mozilla.org/pt-BR/docs/Web/HTML/Global_attributes/accesskey) para verificar como usar para o navegador que você usa.

- <kbd>P</kbd> para acionar o botão de impressão (quando for possível)
- <kbd>R</kbd> para acionar o botão de exibir os registros e as ações
- <kbd>E</kbd> para acionar o botão de exportar registros armazenados

[link-projeto]: https://foxwordss.github.io/damp/
