// services/ride/comprobantes/notaDebito.js
'use strict';
const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');
const { toArray, DOCS_SUSTENTO } = require('../helpers');

async function renderNotaDebito(comprobante, emisor, estadoFactura, fechaAuth, formato) {
    const infoTrib  = comprobante.infoTributaria;
    const infoND    = comprobante.infoNotaDebito;
    const motivos   = toArray(comprobante.motivos?.motivo);
    const impuestos = toArray(infoND.totalConImpuestos?.totalImpuesto);
    const infoAdc   = toArray(comprobante.infoAdicional?.campoAdicional);

    const tipoDocMod = DOCS_SUSTENTO[infoND.codDocModificado] || infoND.codDocModificado || '-';
    const numDocMod  = infoND.numDocModificado ? `Nro. ${infoND.numDocModificado}` : '';

    const docOpts = _getPdfOpts(formato);
    const doc     = new PDFDocument(docOpts);
    const stream  = new PassThrough();
    doc.pipe(stream);

    // 1. Cabecera
    let y = await formato.dibujarCabecera(
        doc, infoTrib,
        'N O T A   D E   D É B I T O',
        {
            dirEstablecimiento:    infoND.dirEstablecimiento,
            obligadoContabilidad:  infoND.obligadoContabilidad,
            contribuyenteEspecial: infoND.contribuyenteEspecial,
        },
        estadoFactura, fechaAuth, emisor
    );

    // 2. Datos comprador + referencia doc original
    const extraFilas = [
        {
            label:  'Doc. que Modifica',
            valor:  `${tipoDocMod} ${numDocMod}`.trim(),
            labelW: 90,
        },
        {
            label:  'Fecha Doc. Sustento',
            valor:  infoND.fechaEmisionDocSustento || '-',
            labelW: 100,
        },
    ];

    y = formato.dibujarDatosComprador(
        doc,
        {
            razonSocial:    infoND.razonSocialComprador,
            identificacion: infoND.identificacionComprador,
            fechaEmision:   infoND.fechaEmision,
            direccion:      null,
        },
        extraFilas,
        y
    );

    // 3. Motivos (en NDB en vez de ítems hay motivos con valor)
    y = _dibujarMotivos(doc, motivos, y, formato);

    // 4. Pie
    const yPie = _yPie(formato, y);
    const totalND = parseFloat(infoND.valorTotal || infoND.totalSinImpuestos || 0);
    const resumen = {
        totalSinImpuestos: parseFloat(infoND.totalSinImpuestos || 0),
        totalDescuento:    0,
        importeTotal:      totalND,
        propina:           0,
        noObjetoIVA:       0,
        exentoIVA:         0,
    };

    formato.dibujarInfoAdicional(doc, infoAdc, yPie);
    formato.dibujarTotales(doc, impuestos, resumen, 'VALOR TOTAL', yPie);

    if (formato.dibujarPieFinal) {
        const yFinal = yPie + _altTotales(impuestos, formato);
        formato.dibujarPieFinal(doc, yFinal);
    }

    doc.end();
    return stream;
}

function _dibujarMotivos(doc, motivos, yActual, formato) {
    if (!motivos.length) return yActual;

    const isTermico = formato.T80 || formato.T58;
    const dims      = formato.A4 || formato.T80 || formato.T58;
    const x         = dims?.margin || 30;
    const ancho     = dims ? (dims.pageWidth || 595) - 2 * (dims.margin || 30) : 535;
    const rowH      = dims?.rowH || 14;
    const fontSize  = isTermico ? 7 : 8;

    let y = yActual + (isTermico ? 4 : 10);

    // Header
    doc.fontSize(fontSize).fillColor('#555555');
    doc.text('MOTIVOS', x, y, { width: ancho * 0.7 });
    doc.text('VALOR', x + ancho * 0.7, y, { width: ancho * 0.3, align: 'right' });
    y += rowH;

    // Línea
    doc.moveTo(x, y).lineTo(x + ancho, y).strokeColor('#cccccc').lineWidth(0.5).stroke();
    y += 2;

    // Filas
    doc.fillColor('#000000');
    motivos.forEach(m => {
        const razon = m.razon || '';
        const valor = parseFloat(m.valor || 0).toFixed(2);
        doc.fontSize(fontSize).text(razon, x, y, { width: ancho * 0.7 });
        doc.text(`$${valor}`, x + ancho * 0.7, y, { width: ancho * 0.3, align: 'right' });
        y += rowH;
    });

    return y + (isTermico ? 4 : 10);
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

function _altTotales(impuestos, formato) {
    const rowH  = (formato.T80 || formato.T58)?.rowH || 14;
    const filas = toArray(impuestos).length + 6;
    return filas * rowH + 20;
}

module.exports = { renderNotaDebito };