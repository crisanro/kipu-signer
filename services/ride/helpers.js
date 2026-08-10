// services/ride/helpers.js
//
// Constantes y utilidades compartidas para todos los comprobantes RIDE.
// Basado en la ficha técnica SRI Ecuador versión 2.26.

'use strict';

// ── Formato numérico ───────────────────────────────────────────────────────────
// Siempre 2 decimales, maneja null/undefined/string
const fmtNum = (v, decimals = 2) => parseFloat(v || 0).toFixed(decimals);

// Formato moneda con símbolo
const fmtMoney = (v) => `$${fmtNum(v)}`;

// ── Arrays seguros ─────────────────────────────────────────────────────────────
// El parser XML devuelve objeto si hay 1 elemento, array si hay varios.
// toArray normaliza siempre a array y filtra nulos.
const toArray = (v) => {
    if (!v) return [];
    return Array.isArray(v) ? v.filter(Boolean) : [v];
};

// ── Tipos de comprobante ───────────────────────────────────────────────────────
const TIPOS_COMPROBANTE = {
    "01": { label: "F A C T U R A",                      tag: "factura"                },
    "04": { label: "N O T A   D E   C R É D I T O",      tag: "notaCredito"            },
    "05": { label: "N O T A   D E   D É B I T O",        tag: "notaDebito"             },
    "06": { label: "G U Í A   D E   R E M I S I Ó N",    tag: "guiaRemision"           },
    "07": { label: "C O M P R O B A N T E   D E   R E T E N C I Ó N", tag: "comprobanteRetencion" },
    "03": { label: "L I Q U I D A C I Ó N   D E   C O M P R A",       tag: "liquidacionCompra"    },
};

// ── Formas de pago ─────────────────────────────────────────────────────────────
const FORMAS_PAGO = {
    "01": "Sin utilización del sistema financiero",
    "15": "Compensación de deudas",
    "16": "Tarjeta de débito",
    "17": "Dinero electrónico",
    "18": "Tarjeta prepago",
    "19": "Tarjeta de crédito",
    "20": "Otros con utilización del sistema financiero",
    "21": "Endoso de títulos",
};

// ── Tipos de identificación ────────────────────────────────────────────────────
const TIPOS_ID = {
    "04": "RUC",
    "05": "Cédula",
    "06": "Pasaporte",
    "07": "Consumidor Final",
    "08": "Identificación del Exterior",
};

// ── Tipos de impuesto ──────────────────────────────────────────────────────────
// código 2 = IVA, código 3 = ICE, código 5 = IRBPNR
const TIPOS_IMPUESTO = {
    "2": "IVA",
    "3": "ICE",
    "5": "IRBPNR",
};

// ── Documentos de sustento ─────────────────────────────────────────────────────
const DOCS_SUSTENTO = {
    "01": "Factura",
    "03": "Liquidación de Compra",
    "04": "Nota de Crédito",
    "05": "Nota de Débito",
    "06": "Guía de Remisión",
    "07": "Comprobante de Retención",
};

// ── Detectar tipo de comprobante ───────────────────────────────────────────────
// Recibe el objeto XML parseado y retorna { tipo, codDoc, label, comprobante }
function detectarTipo(xmlObj) {
    for (const [codDoc, info] of Object.entries(TIPOS_COMPROBANTE)) {
        if (xmlObj[info.tag]) {
            return {
                codDoc,
                label:       info.label,
                tag:         info.tag,
                comprobante: xmlObj[info.tag],
            };
        }
    }
    throw new Error("No se pudo detectar el tipo de comprobante en el XML.");
}

// ── Calcular subtotales de impuestos ───────────────────────────────────────────
// Recibe el array de totalImpuesto y retorna un objeto con subtotales por tarifa.
// Maneja múltiples tarifas: 0%, 5%, 8%, 15%, ICE, IRBPNR, etc.
function calcularImpuestos(totalImpuestos) {
    const result = {
        porTarifa: {},   // { "15": { base: 80.59, valor: 12.09 }, "0": { base: 146.63, valor: 0 } }
        base0:     0,    // suma de bases con IVA 0%
        baseIVA:   0,    // suma de bases con IVA > 0%
        totalIVA:  0,    // suma de valores de IVA
        totalICE:  0,
        totalIRBPNR: 0,
    };

    toArray(totalImpuestos).forEach(imp => {
        const codigo  = String(imp.codigo || '2');
        const cp      = String(imp.codigoPorcentaje || '0');
        const tarifa  = String(imp.tarifa || '0');
        const base    = parseFloat(imp.baseImponible || 0);
        const valor   = parseFloat(imp.valor || 0);

        if (codigo === '2') {
            // IVA
            if (!result.porTarifa[tarifa]) {
                result.porTarifa[tarifa] = { base: 0, valor: 0, codigoPorcentaje: cp };
            }
            result.porTarifa[tarifa].base  += base;
            result.porTarifa[tarifa].valor += valor;

            if (cp === '0' || tarifa === '0') {
                result.base0 += base;
            } else {
                result.baseIVA  += base;
                result.totalIVA += valor;
            }
        } else if (codigo === '3') {
            result.totalICE += valor;
        } else if (codigo === '5') {
            result.totalIRBPNR += valor;
        }
    });

    return result;
}

// ── Parsear campo adicional ────────────────────────────────────────────────────
// El parser puede devolver el atributo @nombre como @_nombre
function parsearCampoAdicional(campo) {
    return {
        nombre: campo['@_nombre'] || campo['@nombre'] || campo.nombre || '',
        valor:  campo['#text']    || campo.valor  || String(campo) || '',
    };
}

// ── Ambiente ───────────────────────────────────────────────────────────────────
const getAmbiente = (v) => String(v) === '2' ? 'PRODUCCIÓN' : 'PRUEBAS';

// ── URL de consulta Kipu ───────────────────────────────────────────────────────
const getUrlConsulta = (claveAcceso) =>
    `https://consulta.kipu.ec/?id=${String(claveAcceso).trim()}`;

module.exports = {
    fmtNum,
    fmtMoney,
    toArray,
    TIPOS_COMPROBANTE,
    FORMAS_PAGO,
    TIPOS_ID,
    TIPOS_IMPUESTO,
    DOCS_SUSTENTO,
    detectarTipo,
    calcularImpuestos,
    parsearCampoAdicional,
    getAmbiente,
    getUrlConsulta,
};