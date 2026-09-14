// services/ride/comprobantes/liquidacionCompra.js
'use strict';
const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');
const { toArray, calcularImpuestos } = require('../helpers');

async function renderLiquidacionCompra(comprobante, emisor, estadoFactura, fechaAuth, formato) {
    const infoTrib  = comprobante.infoTributaria;
    const infoLiq   = comprobante.infoLiquidacionCompra;
    const detalles  = toArray(comprobante.detalles?.detalle);
    const pagos     = toArray(infoLiq.pagos?.pago);
    const impuestos = toArray(infoLiq.totalConImpuestos?.totalImpuesto);
    const infoAdc   = toArray(comprobante.infoAdicional?.campoAdicional);

    const impCalc = calcularImpuestos(impuestos);
    const resumen = {
        totalSinImpuestos: parseFloat(infoLiq.totalSinImpuestos || 0),
        totalDescuento:    parseFloat(infoLiq.totalDescuento    || 0),
        importeTotal:      parseFloat(infoLiq.importeTotal      || 0),
        propina:           0,
        noObjetoIVA:       impCalc.noObjetoIVA || 0,
        exentoIVA:         impCalc.exentoIVA   || 0,
    };

    const esTermica = !!(formato.T80 || formato.T58);

    if (esTermica) {
        return _renderTermica(
            formato, infoTrib, infoLiq, detalles, pagos, impuestos, infoAdc,
            resumen, emisor, estadoFactura, fechaAuth
        );
    } else {
        return _renderA4(
            formato, infoTrib, infoLiq, detalles, pagos, impuestos, infoAdc,
            resumen, emisor, estadoFactura, fechaAuth
        );
    }
}

// =============================================================================
// RENDER TÉRMICO — doble pasada (medir + renderizar)
// =============================================================================
async function _renderTermica(
    formato, infoTrib, infoLiq, detalles, pagos, impuestos, infoAdc,
    resumen, emisor, estadoFactura, fechaAuth
) {
    const dims = formato.T80 || formato.T58;

    // Primera pasada: medir
    const yFinal = await _medirContenidoTermico(
        formato, dims, infoTrib, infoLiq, detalles, pagos, impuestos, infoAdc,
        resumen, estadoFactura, fechaAuth
    );

    const alturaDoc = Math.ceil(yFinal) + 20;

    // Segunda pasada: render real
    const doc    = new PDFDocument({ size: [dims.pageWidth, alturaDoc], margin: 0, autoFirstPage: true });
    const stream = new PassThrough();
    doc.pipe(stream);

    await _dibujarContenidoTermico(
        doc, formato, infoTrib, infoLiq, detalles, pagos, impuestos, infoAdc,
        resumen, estadoFactura, fechaAuth
    );

    doc.end();
    return stream;
}

async function _medirContenidoTermico(
    formato, dims, infoTrib, infoLiq, detalles, pagos, impuestos, infoAdc,
    resumen, estadoFactura, fechaAuth
) {
    const docMed = new PDFDocument({ size: [dims.pageWidth, 9999], margin: 0, autoFirstPage: true });
    docMed.pipe(require('stream').PassThrough());

    const y = await _dibujarContenidoTermico(
        docMed, formato, infoTrib, infoLiq, detalles, pagos, impuestos, infoAdc,
        resumen, estadoFactura, fechaAuth
    );
    docMed.end();
    return y;
}

async function _dibujarContenidoTermico(
    doc, formato, infoTrib, infoLiq, detalles, pagos, impuestos, infoAdc,
    resumen, estadoFactura, fechaAuth
) {
    // 1. Cabecera
    let y = await formato.dibujarCabecera(
        doc, infoTrib, 'L I Q U I D A C I Ó N   D E   C O M P R A',
        {
            dirEstablecimiento:    infoLiq.dirEstablecimiento,
            obligadoContabilidad:  infoLiq.obligadoContabilidad,
            contribuyenteEspecial: infoLiq.contribuyenteEspecial,
        },
        estadoFactura, fechaAuth
    );

    // 2. Datos proveedor
    y = formato.dibujarDatosComprador(
        doc,
        {
            razonSocial:    infoLiq.razonSocialProveedor,
            identificacion: infoLiq.identificacionProveedor,
            fechaEmision:   infoLiq.fechaEmision,
            direccion:      null,
        },
        [],
        y
    );

    // 3. Ítems
    y = formato.dibujarItems(doc, detalles, y);

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
    formato, infoTrib, infoLiq, detalles, pagos, impuestos, infoAdc,
    resumen, emisor, estadoFactura, fechaAuth
) {
    const doc    = new PDFDocument({ size: 'A4', margin: 30 });
    const stream = new PassThrough();
    doc.pipe(stream);

    // 1. Cabecera
    let y = await formato.dibujarCabecera(
        doc, infoTrib, 'L I Q U I D A C I Ó N   D E   C O M P R A',
        {
            dirEstablecimiento:    infoLiq.dirEstablecimiento,
            obligadoContabilidad:  infoLiq.obligadoContabilidad,
            contribuyenteEspecial: infoLiq.contribuyenteEspecial,
        },
        estadoFactura, fechaAuth, emisor
    );

    // 2. Datos proveedor
    y = formato.dibujarDatosComprador(
        doc,
        {
            razonSocial:    infoLiq.razonSocialProveedor,
            identificacion: infoLiq.identificacionProveedor,
            fechaEmision:   infoLiq.fechaEmision,
            direccion:      infoLiq.dirEstablecimiento,
        },
        [],
        y
    );

    // 3. Ítems
    y = formato.dibujarItems(doc, detalles, y);

    // 4. Pie — dos columnas
    const yPie = y + 15;

    let yIzq = formato.dibujarInfoAdicional(doc, infoAdc, yPie);
    formato.dibujarFormasPago(doc, pagos, yIzq);
    formato.dibujarTotales(doc, impuestos, resumen, 'VALOR TOTAL', yPie);

    doc.end();
    return stream;
}

module.exports = { renderLiquidacionCompra };