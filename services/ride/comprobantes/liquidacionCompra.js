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

    const docOpts = _getPdfOpts(formato);
    const doc     = new PDFDocument(docOpts);
    const stream  = new PassThrough();
    doc.pipe(stream);

    // 1. Cabecera
    let y = await formato.dibujarCabecera(
        doc, infoTrib,
        'L I Q U I D A C I Ó N   D E   C O M P R A',
        {
            dirEstablecimiento:    infoLiq.dirEstablecimiento,
            obligadoContabilidad:  infoLiq.obligadoContabilidad,
            contribuyenteEspecial: infoLiq.contribuyenteEspecial,
        },
        estadoFactura, fechaAuth, emisor
    );

    // 2. Datos del proveedor (en LIQ el "comprador" es el proveedor)
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

    // 4. Pie
    const yPie    = _yPie(formato, y);
    const impCalc = calcularImpuestos(impuestos);
    const resumen = {
        totalSinImpuestos: parseFloat(infoLiq.totalSinImpuestos || 0),
        totalDescuento:    parseFloat(infoLiq.totalDescuento    || 0),
        importeTotal:      parseFloat(infoLiq.importeTotal      || 0),
        propina:           0,
        noObjetoIVA:       impCalc.noObjetoIVA || 0,
        exentoIVA:         impCalc.exentoIVA   || 0,
    };

    let yInfoAdc = formato.dibujarInfoAdicional(doc, infoAdc, yPie);
    formato.dibujarFormasPago(doc, pagos, yInfoAdc);
    formato.dibujarTotales(doc, impuestos, resumen, 'VALOR TOTAL', yPie);

    if (formato.dibujarPieFinal) {
        const yFinal = Math.max(yInfoAdc, yPie + _altTotales(impuestos, formato));
        formato.dibujarPieFinal(doc, yFinal);
    }

    doc.end();
    return stream;
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
    const filas = toArray(impuestos).length + 8;
    return filas * rowH + 20;
}

module.exports = { renderLiquidacionCompra };