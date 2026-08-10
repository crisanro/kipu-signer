// services/ride/index.js
//
// Punto de entrada principal del generador de RIDE.
// Detecta el tipo de comprobante y el formato de impresión,
// y delega al render correcto.
//
// Uso desde el microservicio:
//   const { generarPDFStream } = require('./services/ride');
//   const stream = await generarPDFStream(xmlString, emisor, 'AUTORIZADO', fechaAuth, 'a4');

'use strict';

const { XMLParser }    = require('fast-xml-parser');
const { PassThrough }  = require('stream');
const { detectarTipo } = require('./helpers');

// ── Formatos disponibles ───────────────────────────────────────────────────────
const formatoA4  = require('./formatos/a4');
const formatoT80 = require('./formatos/t80');
const formatoT58 = require('./formatos/t58');

const FORMATOS = {
    'a4':  formatoA4,
    't80': formatoT80,
    't58': formatoT58,
};

// ── Comprobantes disponibles ───────────────────────────────────────────────────
const { renderFactura }      = require('./comprobantes/factura');
const { renderNotaCredito }  = require('./comprobantes/notaCredito');

// Mapa codDoc → función render
const RENDERS = {
    '01': renderFactura,
    '04': renderNotaCredito,
    // '05': renderNotaDebito,    ← agregar cuando esté listo
    // '07': renderRetencion,     ← agregar cuando esté listo
    // '03': renderLiquidacion,   ← agregar cuando esté listo
};

// ── Parser XML ─────────────────────────────────────────────────────────────────
const parser = new XMLParser({
    ignoreAttributes:    false,
    attributeNamePrefix: "@_",
    parseTagValue:       false,
    trimValues:          true,
    numberParseOptions:  { leadingZeros: true, skipLike: /\d{10,}/ }
});

// ── FUNCIÓN PRINCIPAL ──────────────────────────────────────────────────────────
// xmlString    — XML del comprobante (firmado o autorizado)
// emisor       — objeto emisor del backend { contribuyente_especial, ... }
// estadoFactura — 'FIRMADO' | 'AUTORIZADO'
// fechaAuth    — string fecha/hora de autorización SRI (null si no autorizado)
// formatoKey   — 'a4' | 't80' | 't58' (default: 'a4')
//
// Retorna un Stream legible con el PDF generado.
async function generarPDFStream(
    xmlString,
    emisor,
    estadoFactura   = 'FIRMADO',
    fechaAuth       = null,
    formatoKey      = 'a4'
) {
    // ── Validar parámetros ─────────────────────────────────────────────────────
    if (!xmlString || typeof xmlString !== 'string') {
        throw new Error('[RIDE] xmlString es requerido y debe ser string.');
    }

    // ── Parsear XML ────────────────────────────────────────────────────────────
    let xmlObj;
    try {
        xmlObj = parser.parse(xmlString);
    } catch (e) {
        throw new Error(`[RIDE] Error parseando XML: ${e.message}`);
    }

    // ── Detectar tipo de comprobante ───────────────────────────────────────────
    let tipoInfo;
    try {
        tipoInfo = detectarTipo(xmlObj);
    } catch (e) {
        throw new Error(`[RIDE] ${e.message}`);
    }

    const { codDoc, comprobante } = tipoInfo;

    // ── Seleccionar render ─────────────────────────────────────────────────────
    const renderFn = RENDERS[codDoc];
    if (!renderFn) {
        throw new Error(
            `[RIDE] Tipo de comprobante '${codDoc}' no soportado aún. ` +
            `Tipos disponibles: ${Object.keys(RENDERS).join(', ')}`
        );
    }

    // ── Seleccionar formato ────────────────────────────────────────────────────
    const fmtKey  = String(formatoKey || 'a4').toLowerCase();
    const formato = FORMATOS[fmtKey];
    if (!formato) {
        throw new Error(
            `[RIDE] Formato '${fmtKey}' no existe. ` +
            `Formatos disponibles: ${Object.keys(FORMATOS).join(', ')}`
        );
    }

    // ── Generar PDF ────────────────────────────────────────────────────────────
    try {
        const stream = await renderFn(comprobante, emisor, estadoFactura, fechaAuth, formato);
        return stream;
    } catch (e) {
        console.error(`[RIDE] ❌ Error generando PDF:`, e.message);
        throw e;
    }
}

// ── Convertir stream a buffer ──────────────────────────────────────────────────
// Utilidad para cuando necesitas el PDF como Buffer en vez de Stream.
function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data',  chunk => chunks.push(chunk));
        stream.on('end',   ()    => resolve(Buffer.concat(chunks)));
        stream.on('error', err   => reject(err));
    });
}

module.exports = { generarPDFStream, streamToBuffer };