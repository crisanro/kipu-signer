// services/ride/comprobantes/notaCredito.js
//
// Render del RIDE de Nota de Crédito Electrónica (codDoc: 04)
// Compatible con formatos A4, 80mm y 58mm.
// Diferencias vs Factura según ficha técnica SRI versión 2.26:
//   - Label: "NOTA DE CRÉDITO"
//   - Bloque comprador incluye: doc que modifica, fecha sustento, motivo
//   - No tiene formas de pago
//   - Total = "VALOR DE MODIFICACIÓN"

'use strict';

const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');
const { toArray, DOCS_SUSTENTO } = require('../helpers');

// ── Render principal ───────────────────────────────────────────────────────────
async function renderNotaCredito(comprobante, emisor, estadoFactura, fechaAuth, formato) {
    const {
        dibujarCabecera,
        dibujarDatosComprador,
        dibujarItems,
        dibujarTotales,
        dibujarInfoAdicional,
    } = formato;

    // ── Extraer datos del XML ──────────────────────────────────────────────────
    const infoTrib  = comprobante.infoTributaria;
    const infoNC    = comprobante.infoNotaCredito;
    const detalles  = toArray(comprobante.detalles?.detalle);
    const impuestos = toArray(infoNC.totalConImpuestos?.totalImpuesto);
    const infoAdc   = toArray(comprobante.infoAdicional?.campoAdicional);

    // Tipo del documento que modifica — ej: "FACTURA Nro. 001-001-000000001"
    const tipoDocMod = DOCS_SUSTENTO[infoNC.codDocModificado] || infoNC.codDocModificado || '-';
    const numDocMod  = infoNC.numDocModificado ? `Nro. ${infoNC.numDocModificado}` : '';

    // ── Configurar PDF ─────────────────────────────────────────────────────────
    const docOpts = _getPdfOpts(formato);
    const doc     = new PDFDocument(docOpts);
    const stream  = new PassThrough();
    doc.pipe(stream);

    // ── 1. Cabecera ────────────────────────────────────────────────────────────
    let y = await dibujarCabecera(
        doc,
        infoTrib,
        'N O T A   D E   C R É D I T O',
        {
            dirEstablecimiento:   infoNC.dirEstablecimiento,
            obligadoContabilidad: infoNC.obligadoContabilidad,
            contribuyenteEspecial: infoNC.contribuyenteEspecial,
        },
        estadoFactura,
        fechaAuth,
        emisor
    );

    // ── 2. Datos del comprador + referencia al doc original ────────────────────
    // Filas extra específicas de NC:
    // - Comprobante que modifica
    // - Fecha doc sustento
    // - Motivo
    const extraFilas = [
        {
            label:  'Doc. que Modifica',
            valor:  `${tipoDocMod} ${numDocMod}`.trim(),
            labelW: 90,
        },
        {
            label:  'Fecha Doc. Sustento',
            valor:  infoNC.fechaEmisionDocSustento || '-',
            labelW: 100,
        },
        {
            label:  'Motivo',
            valor:  infoNC.motivo || '-',
            labelW: 42,
        },
    ];

    y = dibujarDatosComprador(
        doc,
        {
            razonSocial:    infoNC.razonSocialComprador,
            identificacion: infoNC.identificacionComprador,
            fechaEmision:   infoNC.fechaEmision,
            direccion:      null, // NC no muestra dirección en bloque comprador
        },
        extraFilas,
        y
    );

    // ── 3. Ítems ───────────────────────────────────────────────────────────────
    y = dibujarItems(doc, detalles, y);

    // ── 4. Pie ─────────────────────────────────────────────────────────────────
    const yPie = _yPie(formato, y);

    const resumen = {
        totalSinImpuestos: infoNC.totalSinImpuestos,
        totalDescuento:    0,               // NC no tiene totalDescuento
        importeTotal:      infoNC.valorModificacion, // ← en NC es valorModificacion
        propina:           0,               // NC no tiene propina
        noObjetoIVA:       0,
        exentoIVA:         0,
    };

    // Info adicional (columna izquierda en A4)
    // NC no tiene formas de pago — la columna izquierda solo muestra info adicional
    dibujarInfoAdicional(doc, infoAdc, yPie);

    // Totales (columna derecha en A4)
    // Label diferente: "VALOR DE MODIFICACIÓN" en vez de "VALOR TOTAL"
    dibujarTotales(
        doc,
        impuestos,
        resumen,
        'VALOR DE MODIFICACIÓN',
        yPie
    );

    // Pie final en térmico
    if (formato.dibujarPieFinal) {
        const yFinal = yPie + _altTotales(impuestos, formato);
        formato.dibujarPieFinal(doc, yFinal);
    }

    doc.end();
    return stream;
}

// ── Helpers privados ───────────────────────────────────────────────────────────
function _getPdfOpts(formato) {
    const dims = formato.A4 || formato.T80 || formato.T58;
    if (!dims) return { size: 'A4', margin: 30 };
    if (formato.T80 || formato.T58) {
        return {
            size:          [dims.pageWidth, 2000],
            margin:        dims.margin,
            autoFirstPage: true,
        };
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

module.exports = { renderNotaCredito };