// services/ride/comprobantes/notaDebito.js
'use strict';
const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');
const { toArray, DOCS_SUSTENTO } = require('../helpers');

async function renderNotaDebito(comprobante, emisor, estadoFactura, fechaAuth, formato) {
    const infoTrib  = comprobante.infoTributaria;
    const infoND    = comprobante.infoNotaDebito;
    const motivos   = toArray(comprobante.motivos?.motivo);
    const impuestos = toArray(infoND.impuestos?.impuesto);
    const pagos     = toArray(infoND.pagos?.pago);
    const infoAdc   = toArray(comprobante.infoAdicional?.campoAdicional);

    const tipoDocMod = DOCS_SUSTENTO[infoND.codDocModificado] || infoND.codDocModificado || '-';
    const numDocMod  = infoND.numDocModificado ? `Nro. ${infoND.numDocModificado}` : '';

    const totalND = parseFloat(infoND.valorTotal || infoND.totalSinImpuestos || 0);
    const resumen = {
        totalSinImpuestos: parseFloat(infoND.totalSinImpuestos || 0),
        totalDescuento:    0,
        importeTotal:      totalND,
        propina:           0,
        noObjetoIVA:       0,
        exentoIVA:         0,
    };

    const extraFilas = [
        { label: 'Doc. que Modifica',   valor: `${tipoDocMod} ${numDocMod}`.trim(), labelW: 90  },
        { label: 'Fecha Doc. Sustento', valor: infoND.fechaEmisionDocSustento || '-', labelW: 100 },
    ];

    const esTermica = !!(formato.T80 || formato.T58);

    if (esTermica) {
        return _renderTermica(
            formato, infoTrib, infoND, motivos, impuestos, pagos, infoAdc,
            resumen, extraFilas, emisor, estadoFactura, fechaAuth
        );
    } else {
        return _renderA4(
            formato, infoTrib, infoND, motivos, impuestos, pagos, infoAdc,
            resumen, extraFilas, emisor, estadoFactura, fechaAuth
        );
    }
}

// =============================================================================
// RENDER TÉRMICO — doble pasada (medir + renderizar)
// =============================================================================
async function _renderTermica(
    formato, infoTrib, infoND, motivos, impuestos, pagos, infoAdc,
    resumen, extraFilas, emisor, estadoFactura, fechaAuth
) {
    const dims = formato.T80 || formato.T58;

    // Primera pasada: medir
    const yFinal = await _medirContenidoTermico(
        formato, dims, infoTrib, infoND, motivos, impuestos, pagos, infoAdc,
        resumen, extraFilas, estadoFactura, fechaAuth
    );

    const alturaDoc = Math.ceil(yFinal) + 20;

    // Segunda pasada: render real
    const doc    = new PDFDocument({ size: [dims.pageWidth, alturaDoc], margin: 0, autoFirstPage: true });
    const stream = new PassThrough();
    doc.pipe(stream);

    await _dibujarContenidoTermico(
        doc, formato, infoTrib, infoND, motivos, impuestos, pagos, infoAdc,
        resumen, extraFilas, estadoFactura, fechaAuth
    );

    doc.end();
    return stream;
}

async function _medirContenidoTermico(
    formato, dims, infoTrib, infoND, motivos, impuestos, pagos, infoAdc,
    resumen, extraFilas, estadoFactura, fechaAuth
) {
    const docMed = new PDFDocument({ size: [dims.pageWidth, 9999], margin: 0, autoFirstPage: true });
    docMed.pipe(require('stream').PassThrough());

    const y = await _dibujarContenidoTermico(
        docMed, formato, infoTrib, infoND, motivos, impuestos, pagos, infoAdc,
        resumen, extraFilas, estadoFactura, fechaAuth
    );
    docMed.end();
    return y;
}

async function _dibujarContenidoTermico(
    doc, formato, infoTrib, infoND, motivos, impuestos, pagos, infoAdc,
    resumen, extraFilas, estadoFactura, fechaAuth
) {
    // 1. Cabecera
    let y = await formato.dibujarCabecera(
        doc, infoTrib, 'N O T A   D E   D É B I T O',
        {
            dirEstablecimiento:    infoND.dirEstablecimiento,
            obligadoContabilidad:  infoND.obligadoContabilidad,
            contribuyenteEspecial: infoND.contribuyenteEspecial,
        },
        estadoFactura, fechaAuth
    );

    // 2. Datos comprador
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

    // 3. Motivos
    y = _dibujarMotivos(doc, motivos, y, formato);

    // 4. Totales
    y = formato.dibujarTotales(doc, impuestos, resumen, 'VALOR TOTAL', y);

    // 5. Formas de pago
    y = formato.dibujarFormasPago(doc, pagos, y);

    // 6. Info adicional
    y = formato.dibujarInfoAdicional(doc, infoAdc, y);

    // 7. Pie final
    if (formato.dibujarPieFinal) {
        y = formato.dibujarPieFinal(doc, y);
    }

    return y;
}

// =============================================================================
// RENDER A4 — dos columnas en el pie
// =============================================================================
async function _renderA4(
    formato, infoTrib, infoND, motivos, impuestos, pagos, infoAdc,
    resumen, extraFilas, emisor, estadoFactura, fechaAuth
) {
    const doc    = new PDFDocument({ size: 'A4', margin: 30 });
    const stream = new PassThrough();
    doc.pipe(stream);

    // 1. Cabecera
    let y = await formato.dibujarCabecera(
        doc, infoTrib, 'N O T A   D E   D É B I T O',
        {
            dirEstablecimiento:    infoND.dirEstablecimiento,
            obligadoContabilidad:  infoND.obligadoContabilidad,
            contribuyenteEspecial: infoND.contribuyenteEspecial,
        },
        estadoFactura, fechaAuth, emisor
    );

    // 2. Datos comprador
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

    // 3. Motivos
    y = _dibujarMotivos(doc, motivos, y, formato);

    // 4. Pie — dos columnas
    const yPie = y + 15;

    let yIzq = formato.dibujarInfoAdicional(doc, infoAdc, yPie);
    formato.dibujarFormasPago(doc, pagos, yIzq);
    formato.dibujarTotales(doc, impuestos, resumen, 'VALOR TOTAL', yPie);

    doc.end();
    return stream;
}

// ── Motivos (exclusivo de NDB) ───────────────────────────────────────────────
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

    doc.moveTo(x, y).lineTo(x + ancho, y).strokeColor('#cccccc').lineWidth(0.5).stroke();
    y += 2;

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

module.exports = { renderNotaDebito };