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

    const esTermica = !!(formato.T80 || formato.T58);

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

    if (esTermica) {
        return _renderTermica(
            formato, infoTrib, infoFac, detalles, pagos, impuestos, infoAdc,
            resumen, emisor, estadoFactura, fechaAuth
        );
    } else {
        return _renderA4(
            formato, infoTrib, infoFac, detalles, pagos, impuestos, infoAdc,
            resumen, emisor, estadoFactura, fechaAuth
        );
    }
}

// =============================================================================
// RENDER TÉRMICO — contenido secuencial, altura dinámica
// =============================================================================
async function _renderTermica(
    formato, infoTrib, infoFac, detalles, pagos, impuestos, infoAdc,
    resumen, emisor, estadoFactura, fechaAuth
) {
    const dims = formato.T80 || formato.T58;

    // ── Primera pasada: calcular altura total ─────────────────────────────────
    // Creamos un doc temporal invisible solo para medir el Y final
    const yFinal = await _medirContenidoTermico(
        formato, dims, infoTrib, infoFac, detalles, pagos, impuestos, infoAdc,
        resumen, estadoFactura, fechaAuth
    );

    // Altura real + margen inferior
    const alturaDoc = Math.ceil(yFinal) + 20;

    // ── Segunda pasada: render real con tamaño exacto ─────────────────────────
    const doc    = new PDFDocument({ size: [dims.pageWidth, alturaDoc], margin: 0, autoFirstPage: true });
    const stream = new PassThrough();
    doc.pipe(stream);

    await _dibujarContenidoTermico(
        doc, formato, infoTrib, infoFac, detalles, pagos, impuestos, infoAdc,
        resumen, estadoFactura, fechaAuth
    );

    doc.end();
    return stream;
}

// Mide el Y final sin renderizar visualmente (doc desechable)
async function _medirContenidoTermico(
    formato, dims, infoTrib, infoFac, detalles, pagos, impuestos, infoAdc,
    resumen, estadoFactura, fechaAuth
) {
    const docMed = new PDFDocument({ size: [dims.pageWidth, 9999], margin: 0, autoFirstPage: true });
    // No hay stream — solo medimos
    docMed.pipe(require('stream').PassThrough());

    const y = await _dibujarContenidoTermico(
        docMed, formato, infoTrib, infoFac, detalles, pagos, impuestos, infoAdc,
        resumen, estadoFactura, fechaAuth
    );
    docMed.end();
    return y;
}

// Dibuja todo el contenido térmico en secuencia y retorna el Y final
async function _dibujarContenidoTermico(
    doc, formato, infoTrib, infoFac, detalles, pagos, impuestos, infoAdc,
    resumen, estadoFactura, fechaAuth
) {
    // 1. Cabecera
    let y = await formato.dibujarCabecera(
        doc, infoTrib, 'F A C T U R A',
        {
            dirEstablecimiento:    infoFac.dirEstablecimiento,
            obligadoContabilidad:  infoFac.obligadoContabilidad,
            contribuyenteEspecial: infoFac.contribuyenteEspecial,
        },
        estadoFactura, fechaAuth
    );

    // 2. Datos comprador
    y = formato.dibujarDatosComprador(
        doc,
        {
            razonSocial:    infoFac.razonSocialComprador,
            identificacion: infoFac.identificacionComprador,
            fechaEmision:   infoFac.fechaEmision,
            direccion:      null, // en térmica no mostramos dirección para ahorrar espacio
        },
        infoFac.guiaRemision ? [{
            label: 'Guía Remisión', valor: infoFac.guiaRemision, labelW: 75,
        }] : [],
        y
    );

    // 3. Ítems
    y = formato.dibujarItems(doc, detalles, y);

    // 4. Totales — PRIMERO (columna derecha en A4, secuencial en térmica)
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
// RENDER A4 — dos columnas en el pie, altura fija
// =============================================================================
async function _renderA4(
    formato, infoTrib, infoFac, detalles, pagos, impuestos, infoAdc,
    resumen, emisor, estadoFactura, fechaAuth
) {
    const doc    = new PDFDocument({ size: 'A4', margin: 30 });
    const stream = new PassThrough();
    doc.pipe(stream);

    // 1. Cabecera
    let y = await formato.dibujarCabecera(
        doc, infoTrib, 'F A C T U R A',
        {
            dirEstablecimiento:    infoFac.dirEstablecimiento,
            obligadoContabilidad:  infoFac.obligadoContabilidad,
            contribuyenteEspecial: infoFac.contribuyenteEspecial,
        },
        estadoFactura, fechaAuth, emisor
    );

    // 2. Datos comprador
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

    // 3. Ítems
    y = formato.dibujarItems(doc, detalles, y);

    // 4. Pie — dos columnas (izq: info adicional + pagos | der: totales)
    const yPie = y + 15;

    let yIzq = formato.dibujarInfoAdicional(doc, infoAdc, yPie);
    formato.dibujarFormasPago(doc, pagos, yIzq);
    formato.dibujarTotales(doc, impuestos, resumen, 'VALOR TOTAL', yPie);

    doc.end();
    return stream;
}

module.exports = { renderFactura };