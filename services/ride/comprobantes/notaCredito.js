// services/ride/comprobantes/notaCredito.js
'use strict';

const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');
const { toArray, DOCS_SUSTENTO } = require('../helpers');

async function renderNotaCredito(comprobante, emisor, estadoFactura, fechaAuth, formato) {
    const infoTrib  = comprobante.infoTributaria;
    const infoNC    = comprobante.infoNotaCredito;
    const detalles  = toArray(comprobante.detalles?.detalle);
    const impuestos = toArray(infoNC.totalConImpuestos?.totalImpuesto);
    const infoAdc   = toArray(comprobante.infoAdicional?.campoAdicional);

    const tipoDocMod = DOCS_SUSTENTO[infoNC.codDocModificado] || infoNC.codDocModificado || '-';
    const numDocMod  = infoNC.numDocModificado ? `Nro. ${infoNC.numDocModificado}` : '';

    const resumen = {
        totalSinImpuestos: infoNC.totalSinImpuestos,
        totalDescuento:    0,
        importeTotal:      infoNC.valorModificacion,
        propina:           0,
        noObjetoIVA:       0,
        exentoIVA:         0,
    };

    const extraFilas = [
        { label: 'Doc. que Modifica',   valor: `${tipoDocMod} ${numDocMod}`.trim(), labelW: 90  },
        { label: 'Fecha Doc. Sustento', valor: infoNC.fechaEmisionDocSustento || '-', labelW: 100 },
        { label: 'Motivo',              valor: infoNC.motivo || '-',                  labelW: 42  },
    ];

    const esTermica = !!(formato.T80 || formato.T58);

    if (esTermica) {
        return _renderTermica(
            formato, infoTrib, infoNC, detalles, impuestos, infoAdc,
            resumen, extraFilas, emisor, estadoFactura, fechaAuth
        );
    } else {
        return _renderA4(
            formato, infoTrib, infoNC, detalles, impuestos, infoAdc,
            resumen, extraFilas, emisor, estadoFactura, fechaAuth
        );
    }
}

// =============================================================================
// RENDER TÉRMICO — doble pasada (medir + renderizar)
// =============================================================================
async function _renderTermica(
    formato, infoTrib, infoNC, detalles, impuestos, infoAdc,
    resumen, extraFilas, emisor, estadoFactura, fechaAuth
) {
    const dims = formato.T80 || formato.T58;

    // Primera pasada: medir
    const yFinal = await _medirContenidoTermico(
        formato, dims, infoTrib, infoNC, detalles, impuestos, infoAdc,
        resumen, extraFilas, estadoFactura, fechaAuth
    );

    const alturaDoc = Math.ceil(yFinal) + 20;

    // Segunda pasada: render real
    const doc    = new PDFDocument({ size: [dims.pageWidth, alturaDoc], margin: 0, autoFirstPage: true });
    const stream = new PassThrough();
    doc.pipe(stream);

    await _dibujarContenidoTermico(
        doc, formato, infoTrib, infoNC, detalles, impuestos, infoAdc,
        resumen, extraFilas, estadoFactura, fechaAuth
    );

    doc.end();
    return stream;
}

async function _medirContenidoTermico(
    formato, dims, infoTrib, infoNC, detalles, impuestos, infoAdc,
    resumen, extraFilas, estadoFactura, fechaAuth
) {
    const docMed = new PDFDocument({ size: [dims.pageWidth, 9999], margin: 0, autoFirstPage: true });
    docMed.pipe(require('stream').PassThrough());

    const y = await _dibujarContenidoTermico(
        docMed, formato, infoTrib, infoNC, detalles, impuestos, infoAdc,
        resumen, extraFilas, estadoFactura, fechaAuth
    );
    docMed.end();
    return y;
}

async function _dibujarContenidoTermico(
    doc, formato, infoTrib, infoNC, detalles, impuestos, infoAdc,
    resumen, extraFilas, estadoFactura, fechaAuth
) {
    // 1. Cabecera
    let y = await formato.dibujarCabecera(
        doc, infoTrib, 'N O T A   D E   C R É D I T O',
        {
            dirEstablecimiento:    infoNC.dirEstablecimiento,
            obligadoContabilidad:  infoNC.obligadoContabilidad,
            contribuyenteEspecial: infoNC.contribuyenteEspecial,
        },
        estadoFactura, fechaAuth
    );

    // 2. Datos comprador
    y = formato.dibujarDatosComprador(
        doc,
        {
            razonSocial:    infoNC.razonSocialComprador,
            identificacion: infoNC.identificacionComprador,
            fechaEmision:   infoNC.fechaEmision,
            direccion:      null,
        },
        extraFilas,
        y
    );

    // 3. Ítems
    y = formato.dibujarItems(doc, detalles, y);

    // 4. Totales
    y = formato.dibujarTotales(doc, impuestos, resumen, 'VALOR DE MODIFICACIÓN', y);

    // 5. Info adicional
    y = formato.dibujarInfoAdicional(doc, infoAdc, y);

    // 6. Pie final
    if (formato.dibujarPieFinal) {
        y = formato.dibujarPieFinal(doc, y);
    }

    return y;
}

// =============================================================================
// RENDER A4 — dos columnas en el pie
// =============================================================================
async function _renderA4(
    formato, infoTrib, infoNC, detalles, impuestos, infoAdc,
    resumen, extraFilas, emisor, estadoFactura, fechaAuth
) {
    const doc    = new PDFDocument({ size: 'A4', margin: 30 });
    const stream = new PassThrough();
    doc.pipe(stream);

    // 1. Cabecera
    let y = await formato.dibujarCabecera(
        doc, infoTrib, 'N O T A   D E   C R É D I T O',
        {
            dirEstablecimiento:    infoNC.dirEstablecimiento,
            obligadoContabilidad:  infoNC.obligadoContabilidad,
            contribuyenteEspecial: infoNC.contribuyenteEspecial,
        },
        estadoFactura, fechaAuth, emisor
    );

    // 2. Datos comprador
    y = formato.dibujarDatosComprador(
        doc,
        {
            razonSocial:    infoNC.razonSocialComprador,
            identificacion: infoNC.identificacionComprador,
            fechaEmision:   infoNC.fechaEmision,
            direccion:      null,
        },
        extraFilas,
        y
    );

    // 3. Ítems
    y = formato.dibujarItems(doc, detalles, y);

    // 4. Pie — dos columnas
    const yPie = y + 15;

    formato.dibujarInfoAdicional(doc, infoAdc, yPie);
    formato.dibujarTotales(doc, impuestos, resumen, 'VALOR DE MODIFICACIÓN', yPie);

    doc.end();
    return stream;
}

module.exports = { renderNotaCredito };