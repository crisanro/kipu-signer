// services/ride/comprobantes/factura.js
//
// Render del RIDE de Factura Electrónica (codDoc: 01)
// Compatible con formatos A4, 80mm y 58mm.
// Basado en la ficha técnica SRI Ecuador versión 2.26 - Anexo 2 y 3.

'use strict';

const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');
const { toArray, calcularImpuestos } = require('../helpers');

// ── Render principal ───────────────────────────────────────────────────────────
// formato: instancia del layout (a4, t80, t58)
// Retorna un stream del PDF generado.
async function renderFactura(comprobante, emisor, estadoFactura, fechaAuth, formato) {
    console.log('[RIDE] formato keys:', Object.keys(formato));
    console.log('[RIDE] dibujarCabecera:', typeof formato.dibujarCabecera);
    // ── Extraer datos del XML ──────────────────────────────────────────────────
    const infoTrib  = comprobante.infoTributaria;
    const infoFac   = comprobante.infoFactura;
    const detalles  = toArray(comprobante.detalles?.detalle);
    const pagos     = toArray(infoFac.pagos?.pago);
    const impuestos = toArray(infoFac.totalConImpuestos?.totalImpuesto);
    const infoAdc   = toArray(comprobante.infoAdicional?.campoAdicional);

    // ── Configurar PDF según formato ───────────────────────────────────────────
    const docOpts = _getPdfOpts(formato);
    const doc     = new PDFDocument(docOpts);
    const stream  = new PassThrough();
    doc.pipe(stream);

    // ── 1. Cabecera ────────────────────────────────────────────────────────────
    let y = await formato.dibujarCabecera(
        doc,
        infoTrib,
        'F A C T U R A',
        {
            dirEstablecimiento:    infoFac.dirEstablecimiento,
            obligadoContabilidad:  infoFac.obligadoContabilidad,
            contribuyenteEspecial: infoFac.contribuyenteEspecial,
        },
        estadoFactura,
        fechaAuth,
        emisor
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
        // Fila extra: guía de remisión (si aplica)
        infoFac.guiaRemision ? [{
            label:  'Guía Remisión',
            valor:  infoFac.guiaRemision,
            labelW: 75,
        }] : [],
        y
    );

    // ── 3. Ítems ───────────────────────────────────────────────────────────────
    y = formato.dibujarItems(doc, detalles, y);

    // ── 4. Pie ─────────────────────────────────────────────────────────────────
    // En A4 el pie va en la parte baja de la página
    const yPie = _yPie(formato, y);

    // Resumen de totales para el bloque de totales
    const impCalc = calcularImpuestos(impuestos);

    const resumen = {
        totalSinImpuestos:       parseFloat(infoFac.totalSinImpuestos || 0),
        totalDescuento:          parseFloat(infoFac.totalDescuento    || 0),
        importeTotal:            parseFloat(infoFac.importeTotal      || 0),
        propina:                 parseFloat(infoFac.propina           || 0),
        noObjetoIVA:             impCalc.noObjetoIVA || 0,
        exentoIVA:               impCalc.exentoIVA   || 0,
        importeTotalSinSubsidio: infoFac.importeTotalSinSubsidio || null,
        ahorroSubsidio:          parseFloat(infoFac.ahorroSubsidio    || 0),
    };

    // Info adicional (columna izquierda en A4, arriba en térmico)
    let yInfoAdc = formato.dibujarInfoAdicional(doc, infoAdc, yPie);

    // Formas de pago (columna izquierda en A4, debajo de info adicional en térmico)
    formato.dibujarFormasPago(doc, pagos, yInfoAdc);

    // Totales (columna derecha en A4, después de formas de pago en térmico)
    formato.dibujarTotales(doc, impuestos, resumen, 'VALOR TOTAL', yPie);

    // Pie final en térmico
    if (formato.dibujarPieFinal) {
        const yFinal = Math.max(yInfoAdc, yPie + _altTotales(impuestos, formato));
        formato.dibujarPieFinal(doc, yFinal);
    }

    doc.end();
    return stream;
}

// ── Helpers privados ───────────────────────────────────────────────────────────

// Opciones del PDFDocument según formato
function _getPdfOpts(formato) {
    // A4 tiene la constante A4, los térmicos tienen T80 o T58
    const dims = formato.A4 || formato.T80 || formato.T58;
    if (!dims) return { size: 'A4', margin: 30 };

    // Para térmicos usamos tamaño custom y documento sin paginación automática
    if (formato.T80 || formato.T58) {
        return {
            size:          [dims.pageWidth, 2000], // alto generoso, se recorta al final
            margin:        dims.margin,
            autoFirstPage: true,
        };
    }

    return { size: 'A4', margin: 30 };
}

// Y mínimo para el pie de página (en A4 va abajo, en térmico va después del contenido)
function _yPie(formato, yActual) {
    if (formato.A4) return Math.max(yActual + 15, 540);
    return yActual + 8;
}

// Estimar altura del bloque de totales para calcular Y final en térmico
function _altTotales(impuestos, formato) {
    const rowH  = (formato.T80 || formato.T58)?.rowH || 14;
    const filas = toArray(impuestos).length + 8; // filas de totales + fijos
    return filas * rowH + 20;
}

module.exports = { renderFactura };