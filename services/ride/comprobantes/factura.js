// services/ride/comprobantes/factura.js
'use strict';
const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');
const { toArray, calcularImpuestos } = require('../helpers');

async function renderFactura(comprobante, emisor, estadoFactura, fechaAuth, formato) {
    const infoTrib  = comprobante.infoTributaria;
    const infoFac   = comprobante.infoFactura;
    const detalles  = toArray(comprobante.detalles?.detalle);
    const pagos     = toArray(infoFac.pagos?.pago);
    const impuestos = toArray(infoFac.totalConImpuestos?.totalImpuesto);
    const infoAdc   = toArray(comprobante.infoAdicional?.campoAdicional);

    const docOpts = _getPdfOpts(formato);
    const doc     = new PDFDocument(docOpts);
    const stream  = new PassThrough();
    doc.pipe(stream);

    // ── 1. Cabecera ────────────────────────────────────────────────────────────
    let y = await formato.dibujarCabecera(
        doc, infoTrib, 'F A C T U R A',
        {
            dirEstablecimiento:    infoFac.dirEstablecimiento,
            obligadoContabilidad:  infoFac.obligadoContabilidad,
            contribuyenteEspecial: infoFac.contribuyenteEspecial,
        },
        estadoFactura, fechaAuth, emisor
    );

    // ── 2. Datos del comprador ─────────────────────────────────────────────────
    y = formato.dibujarDatosComprador(
        doc,
        {
            razonSocial:    infoFac.razonSocialComprador,
            identificacion: infoFac.identificacionComprador,
            fechaEmision:   infoFac.fechaEmision,
            direccion:      infoFac.dirEstablecimiento,
        },
        infoFac.guiaRemision ? [{
            label: 'Guía Remisión', valor: infoFac.guiaRemision, labelW: 75,
        }] : [],
        y
    );

    // ── 3. Ítems ───────────────────────────────────────────────────────────────
    y = formato.dibujarItems(doc, detalles, y);

    // ── 4. Pie ─────────────────────────────────────────────────────────────────
    const yPie    = _yPie(formato, y);
    const impCalc = calcularImpuestos(impuestos);

    const resumen = {
        totalSinImpuestos:       parseFloat(infoFac.totalSinImpuestos || 0),
        totalDescuento:          parseFloat(infoFac.totalDescuento    || 0),
        importeTotal:            parseFloat(infoFac.importeTotal      || 0),
        propina:                 parseFloat(infoFac.propina           || 0),
        noObjetoIVA:             impCalc.noObjetoIVA || 0,
        exentoIVA:               impCalc.exentoIVA   || 0,
        importeTotalSinSubsidio: infoFac.importeTotalSinSubsidio || null,
        ahorroSubsidio:          parseFloat(infoFac.ahorroSubsidio || 0),
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

module.exports = { renderFactura };