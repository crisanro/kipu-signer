// services/ride/comprobantes/retencion.js
'use strict';
const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');
const { toArray } = require('../helpers');

async function renderRetencion(comprobante, emisor, estadoFactura, fechaAuth, formato) {
    const infoTrib  = comprobante.infoTributaria;
    const infoRet   = comprobante.infoCompRetencion;
    const impuestos = toArray(comprobante.impuestos?.impuesto);
    const infoAdc   = toArray(comprobante.infoAdicional?.campoAdicional);

    const docOpts = _getPdfOpts(formato);
    const doc     = new PDFDocument(docOpts);
    const stream  = new PassThrough();
    doc.pipe(stream);

    // 1. Cabecera
    let y = await formato.dibujarCabecera(
        doc, infoTrib,
        'C O M P R O B A N T E   D E   R E T E N C I Ó N',
        {
            dirEstablecimiento:    infoRet.dirEstablecimiento,
            obligadoContabilidad:  infoRet.obligadoContabilidad,
            contribuyenteEspecial: infoRet.contribuyenteEspecial,
        },
        estadoFactura, fechaAuth, emisor
    );

    // 2. Datos del sujeto retenido
    const extraFilas = [
        {
            label:  'Período Fiscal',
            valor:  infoRet.periodoFiscal || '-',
            labelW: 75,
        },
    ];

    y = formato.dibujarDatosComprador(
        doc,
        {
            razonSocial:    infoRet.razonSocialSujetoRetenido,
            identificacion: infoRet.identificacionSujetoRetenido,
            fechaEmision:   infoRet.fechaEmision,
            direccion:      null,
        },
        extraFilas,
        y
    );

    // 3. Tabla de impuestos retenidos
    y = _dibujarImpuestosRetencion(doc, impuestos, y, formato);

    // 4. Totales retencion
    const yPie     = _yPie(formato, y);
    const totalRet = impuestos.reduce((s, i) => s + parseFloat(i.valor || 0), 0);

    _dibujarTotalRetencion(doc, totalRet, yPie, formato);
    formato.dibujarInfoAdicional(doc, infoAdc, yPie);

    if (formato.dibujarPieFinal) {
        formato.dibujarPieFinal(doc, yPie + 60);
    }

    doc.end();
    return stream;
}

function _dibujarImpuestosRetencion(doc, impuestos, yActual, formato) {
    if (!impuestos.length) return yActual;

    const isTermico = formato.T80 || formato.T58;
    const dims      = formato.A4 || formato.T80 || formato.T58;
    const x         = dims?.margin || 30;
    const ancho     = dims ? (dims.pageWidth || 595) - 2 * (dims.margin || 30) : 535;
    const rowH      = dims?.rowH || 14;
    const fontSize  = isTermico ? 6.5 : 7.5;

    let y = yActual + (isTermico ? 4 : 10);

    // Encabezados
    const cols = isTermico
        ? [
            { label: 'Cód.',       w: ancho * 0.10, align: 'left'  },
            { label: 'Doc. Sust.', w: ancho * 0.20, align: 'left'  },
            { label: 'Núm. Doc.',  w: ancho * 0.25, align: 'left'  },
            { label: 'Base Imp.',  w: ancho * 0.22, align: 'right' },
            { label: '%',          w: ancho * 0.10, align: 'right' },
            { label: 'Valor',      w: ancho * 0.13, align: 'right' },
          ]
        : [
            { label: 'Cód. Retención', w: ancho * 0.12, align: 'left'  },
            { label: 'Doc. Sustento',  w: ancho * 0.18, align: 'left'  },
            { label: 'Núm. Comprobante Sustento', w: ancho * 0.25, align: 'left'  },
            { label: 'Fecha Emisión Sustento',    w: ancho * 0.15, align: 'left'  },
            { label: 'Base Imponible', w: ancho * 0.13, align: 'right' },
            { label: '% Ret.',         w: ancho * 0.07, align: 'right' },
            { label: 'Valor Ret.',     w: ancho * 0.10, align: 'right' },
          ];

    doc.fontSize(fontSize).fillColor('#555555');
    let xCol = x;
    cols.forEach(col => {
        doc.text(col.label, xCol, y, { width: col.w, align: col.align });
        xCol += col.w;
    });
    y += rowH;

    doc.moveTo(x, y).lineTo(x + ancho, y).strokeColor('#cccccc').lineWidth(0.5).stroke();
    y += 2;

    // Filas
    doc.fillColor('#000000');
    impuestos.forEach(imp => {
        xCol = x;
        const fila = isTermico
            ? [
                { val: imp.codigoPorcentaje || '-', w: cols[0].w, align: 'left'  },
                { val: imp.codDocSustento   || '-', w: cols[1].w, align: 'left'  },
                { val: imp.numDocSustento   || '-', w: cols[2].w, align: 'left'  },
                { val: `$${parseFloat(imp.baseImponible || 0).toFixed(2)}`, w: cols[3].w, align: 'right' },
                { val: `${imp.tarifa || 0}%`,                               w: cols[4].w, align: 'right' },
                { val: `$${parseFloat(imp.valor || 0).toFixed(2)}`,         w: cols[5].w, align: 'right' },
              ]
            : [
                { val: imp.codigoPorcentaje        || '-', w: cols[0].w, align: 'left'  },
                { val: imp.codDocSustento           || '-', w: cols[1].w, align: 'left'  },
                { val: imp.numDocSustento           || '-', w: cols[2].w, align: 'left'  },
                { val: imp.fechaEmisionDocSustento  || '-', w: cols[3].w, align: 'left'  },
                { val: `$${parseFloat(imp.baseImponible || 0).toFixed(2)}`, w: cols[4].w, align: 'right' },
                { val: `${imp.tarifa || 0}%`,                               w: cols[5].w, align: 'right' },
                { val: `$${parseFloat(imp.valor || 0).toFixed(2)}`,         w: cols[6].w, align: 'right' },
              ];

        fila.forEach(cel => {
            doc.fontSize(fontSize).text(cel.val, xCol, y, { width: cel.w, align: cel.align });
            xCol += cel.w;
        });
        y += rowH;
    });

    return y + (isTermico ? 4 : 10);
}

function _dibujarTotalRetencion(doc, totalRet, yPie, formato) {
    const isTermico = formato.T80 || formato.T58;
    const dims      = formato.A4 || formato.T80 || formato.T58;
    const x         = dims?.margin || 30;
    const ancho     = dims ? (dims.pageWidth || 595) - 2 * (dims.margin || 30) : 535;
    const fontSize  = isTermico ? 8 : 9;

    const yTot = isTermico ? yPie + 4 : yPie + 10;
    doc.fontSize(fontSize).fillColor('#000000');
    doc.text('TOTAL RETENIDO:', x, yTot, { width: ancho * 0.7 });
    doc.text(
        `$${totalRet.toFixed(2)}`,
        x + ancho * 0.7, yTot,
        { width: ancho * 0.3, align: 'right' }
    );
}

function _getPdfOpts(formato) {
    const dims = formato.A4 || formato.T80 || formato.T58;
    if (!dims) return { size: 'A4', margin: 30 };
    if (formato.T80 || formato.T58) {
        return { size: [dims.pageWidth, 2000], margin: dims.margin, autoFirstPage: true };
    }
    return { size: 'A4', margin: 30 };
}

function _yPie(formato, yActual) {
    if (formato.A4) return Math.max(yActual + 15, 540);
    return yActual + 8;
}

module.exports = { renderRetencion };