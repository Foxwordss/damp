"use strict";

// =================================================================================================
// OCRUPLOAD.JS — Painel de anexo de documentos (RG, CPF, carteira de trabalho, cadastro CAIXA,
// Espelho da Proposta SIOPI) com extração automática via OCR (parser.js) e preenchimento dos
// campos da DAMP. Não toca na estrutura do documento oficial (form#damp_form / #print_area):
// só lê/escreve pelos ids e classes que já existem nele. Não duplica nada que o projeto já tem
// pronto (registros salvos, autocompletar, escala de impressão, anos de IRPF — tudo isso continua
// em scripts.js/dataBaseFunctions.js/publicFunctions.js, sem mudanças).
// =================================================================================================

import { analisarFilaDeArquivos, CAMPOS_REGRA_FIXA } from './parser.js';

// -------------------------------------------------------------------------------------------
// FILA DE DOCUMENTOS: acumula arquivos anexados em momentos diferentes (nunca substitui a
// seleção anterior) e desenha a lista visual com botão de remover por arquivo.
// -------------------------------------------------------------------------------------------
function criarFilaDeArquivos({ elementoLista, textoVazio }) {
  let arquivos = [];

  function renderizar() {
    elementoLista.innerHTML = '';

    if (arquivos.length === 0) {
      const item = document.createElement('li');
      item.className = 'list-group-item text-muted';
      item.textContent = textoVazio;
      elementoLista.appendChild(item);
      return;
    }

    arquivos.forEach((arquivo, indice) => {
      const item = document.createElement('li');
      item.className = 'list-group-item d-flex justify-content-between align-items-center';

      const nome = document.createElement('span');
      nome.textContent = arquivo.name;
      item.appendChild(nome);

      const remover = document.createElement('button');
      remover.type = 'button';
      remover.className = 'btn btn-sm btn-outline-danger';
      remover.setAttribute('aria-label', `Remover ${arquivo.name} da fila`);
      remover.textContent = '×';
      remover.addEventListener('click', () => {
        arquivos.splice(indice, 1);
        renderizar();
      });
      item.appendChild(remover);

      elementoLista.appendChild(item);
    });
  }

  function adicionar(novosArquivos) {
    const listaNovos = Array.from(novosArquivos || []);
    if (listaNovos.length === 0) return;
    arquivos = arquivos.concat(listaNovos); // acumula, nunca sobrescreve
    renderizar();
  }

  function obterArquivos() {
    return arquivos.slice();
  }

  renderizar();
  return { adicionar, obterArquivos };
}

// -------------------------------------------------------------------------------------------
// PREENCHIMENTO DO DOCUMENTO
// -------------------------------------------------------------------------------------------
// Campos sem id próprio de elemento de formulário (tratados à parte, ver preencherDocumento):
// - "editableDiv"  -> a <div class="editableDiv"> (contenteditable) dentro de #print_area
// - "dia_assin"    -> o campo do dia da assinatura tem id="end_camp" (não "dia_assin")
// - "mes_assin"/"ano_assin" já batem 1:1 com o id do elemento, não precisam de caso especial
const IDS_ESPECIAIS = { dia_assin: 'end_camp' };

// Os checkboxes de grupo (modalidade, enquadramento, residência, usufruto, união estável, IR e os
// pares SIM/NÃO "sn_N") são geridos por um handler de CLIQUE já existente em scripts.js (não um
// handler de "change"), que cuida de exclusividade e mostrar/ocultar os blocos relacionados.
// Setar ".checked = true" direto NÃO dispara esse handler — por isso, para esses ids, simulamos um
// clique real (uma única vez, só se ainda não estiver marcado) em vez de só atribuir o valor.
function marcarCheckboxComoOMouse(elemento) {
  if (elemento.checked) return; // já marcado (ou marcado por um documento anterior da fila) — não mexe
  elemento.click();
}

function preencherDocumento(encontrados) {
  const chkYears = document.getElementById('chk_years');

  Object.entries(encontrados).forEach(([chave, valor]) => {
    if (valor === undefined || valor === null || valor === '') return;

    // "Preencher ano base e referência de IRPF" desligado = não mexe nesses 4 campos
    if (chkYears && !chkYears.checked && ['text_irano1', 'text_irexerc1', 'text_irano2', 'text_irexerc2'].includes(chave)) {
      return;
    }

    if (chave === 'editableDiv') {
      const el = document.querySelector('#print_area .editableDiv');
      if (el) {
        el.textContent = valor;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }

    const idReal = IDS_ESPECIAIS[chave] || chave;
    const elemento = document.getElementById(idReal);
    if (!elemento) return;

    if (elemento.type === 'checkbox') {
      if (valor) marcarCheckboxComoOMouse(elemento);
    } else {
      elemento.value = valor;
      elemento.dispatchEvent(new Event('input', { bubbles: true }));
      elemento.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

function montarResumo(encontrados) {
  const total = Object.keys(encontrados).length;
  return `Extração concluída: ${total} campo(s) identificado(s) e preenchido(s).\nConfira os dados antes de imprimir — o que não foi encontrado ficou em branco para preenchimento manual.`;
}

// -------------------------------------------------------------------------------------------
// Inicialização
// -------------------------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  const filaDocumentos = criarFilaDeArquivos({
    elementoLista: document.getElementById('lista-arquivos'),
    textoVazio: 'Nenhum documento anexado ainda.',
  });

  const inputArquivos = document.getElementById('input-arquivos');
  const botaoAnexar = document.getElementById('botao-anexar');
  const botaoExtrair = document.getElementById('botao-extrair');
  const statusExtracao = document.getElementById('status-extracao');

  if (!inputArquivos || !botaoAnexar || !botaoExtrair || !statusExtracao) return;

  botaoAnexar.addEventListener('click', () => inputArquivos.click());

  inputArquivos.addEventListener('change', (evento) => {
    filaDocumentos.adicionar(evento.target.files);
    evento.target.value = '';
  });

  botaoExtrair.addEventListener('click', async () => {
    const arquivos = filaDocumentos.obterArquivos();
    if (arquivos.length === 0) {
      alert('Anexe ao menos um documento (PDF ou foto — RG, CPF, carteira de trabalho, cadastro ou Espelho da Proposta) antes de clicar em "Extrair e Preencher".');
      return;
    }

    botaoExtrair.disabled = true;
    botaoAnexar.disabled = true;

    try {
      const encontrados = await analisarFilaDeArquivos(arquivos, (mensagem) => {
        statusExtracao.textContent = mensagem;
      });

      const encontrouAlgo = Object.keys(encontrados).some((chave) => !CAMPOS_REGRA_FIXA.includes(chave));
      if (!encontrouAlgo) {
        statusExtracao.textContent = '';
        alert('Não foi possível identificar automaticamente nenhum dado nos documentos anexados. Tente fotos/PDFs mais nítidos, bem enquadrados e com boa iluminação.');
        return;
      }

      preencherDocumento(encontrados);
      statusExtracao.textContent = '';
      alert(montarResumo(encontrados));
    } catch (erro) {
      console.log('Erro ao processar OCR dos documentos: %s', erro);
      statusExtracao.textContent = '';
      alert('Não foi possível ler os documentos automaticamente. Verifique sua conexão (necessária só na 1ª vez, para baixar a biblioteca de OCR) e tente novamente.');
    } finally {
      botaoExtrair.disabled = false;
      botaoAnexar.disabled = false;
    }
  });
});
