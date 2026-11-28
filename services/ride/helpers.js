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
// Maneja múltiples tarifas: 0%, 5%, 8%, 12%, 13%, 14%, 15%, ICE, IRBPNR.
// codigoPorcentaje → tarifa (Tabla 17 de la ficha). El 6 (no objeto) y el 7
// (exento) no son tarifas: van aparte, nunca en el subtotal 0%.
const CP_A_TARIFA = {
    "0":  "0",    // 0%
    "2":  "12",   // 12%
    "3":  "14",   // 14%
    "4":  "15",   // 15%
    "5":  "5",    // 5%
    "8":  "8",    // 8% (tarifa especial de feriados)
    "10": "13",   // 13%
};
const CP_NO_OBJETO = '6';
const CP_EXENTO    = '7';

// "15.00" → "15", "8" → "8": la misma tarifa siempre con la misma clave
const _claveTarifa = (t) => {
    const n = parseFloat(t);
    return Number.isFinite(n) ? String(n) : null;
};

// Tarifas de IVA distintas de 0 que muestra el RIDE: 15% y 5% siempre (como
// hasta ahora) y cualquier otra que traiga el comprobante, de mayor a menor.
function tarifasVisibles(imp) {
    const otras = Object.keys(imp.porTarifa).filter(t => t !== '0' && t !== '15' && t !== '5');
    return ['15', '5', ...otras].sort((a, b) => parseFloat(b) - parseFloat(a));
}

function calcularImpuestos(totalImpuestos) {
    const result = {
        porTarifa:   {},
        base0:       0,
        baseIVA:     0,
        totalIVA:    0,
        totalICE:    0,
        totalIRBPNR: 0,
        noObjetoIVA: 0,
        exentoIVA:   0,
    };

    toArray(totalImpuestos).forEach(imp => {
        const codigo = String(imp.codigo || '2');
        const cp     = String(imp.codigoPorcentaje || '0');
        const base   = parseFloat(imp.baseImponible || 0);
        const valor  = parseFloat(imp.valor || 0);

        if (codigo === '2') {
            if (cp === CP_NO_OBJETO) {
                result.noObjetoIVA += base;
                return;
            }
            if (cp === CP_EXENTO) {
                result.exentoIVA += base;
                return;
            }
            // Tarifa del XML si viene (ND, detalles); si no, la del codigoPorcentaje
            const tarifa = _claveTarifa(imp.tarifa) ?? CP_A_TARIFA[cp] ?? '0';
            if (!result.porTarifa[tarifa]) {
                result.porTarifa[tarifa] = { base: 0, valor: 0, codigoPorcentaje: cp };
            }
            result.porTarifa[tarifa].base  += base;
            result.porTarifa[tarifa].valor += valor;

            if (tarifa === '0') {
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

// ── Direcciones del emisor en los tickets ──────────────────────────────────────
// El RIDE lleva la dirección matriz y, si es otra, la del establecimiento.
function lineasDireccion(infoTrib, datosExtra) {
    const matriz = String(infoTrib?.dirMatriz || '').trim();
    const estab  = String(datosExtra?.dirEstablecimiento || '').trim();
    return [
        matriz && `Matriz: ${matriz}`,
        estab && estab !== matriz && `Sucursal: ${estab}`,
    ].filter(Boolean);
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

// ── Marca de Kipu en el pie del RIDE ───────────────────────────────────────────
// La decide el backend según el plan (emisor.marca_kipu):
//   true      → plan gratis: "Facturado con Kipu"
//   false     → Pro / Al Día: sin marca
//   undefined → como siempre (los tickets dicen "Documento generado por kipu.ec")
const marcaKipu = (emisor) => {
    const m = emisor && emisor.marca_kipu;
    return m === true ? 'GRATIS' : m === false ? 'SIN_MARCA' : 'ANTERIOR';
};
const URL_MARCA = 'https://kipu.ec/?utm_source=ride&utm_medium=pdf&utm_campaign=gratis';

// ── Logo de la empresa ─────────────────────────────────────────────────────────
// emisor.logo: base64 de un PNG o JPG que el backend ya redujo (máx. 300 px,
// ~100 KB): a color para el A4 y en blanco y negro para los tickets. Lo que no
// sea un PNG/JPG chico se ignora y el RIDE sale sin logo, nunca deja de salir.
const LOGO_MAX_BYTES = 150 * 1024;

function logoDelEmisor(emisor) {
    const b64 = emisor && emisor.logo;
    if (typeof b64 !== 'string' || !b64 || b64.length > LOGO_MAX_BYTES * 4 / 3 + 4) return null;
    const buf = Buffer.from(b64, 'base64');
    const esPng = buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;
    const esJpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    return (esPng || esJpg) && buf.length <= LOGO_MAX_BYTES ? buf : null;
}

// Dibuja el logo centrado dentro de la caja (x, y, anchoMax, altoMax), sin
// agrandarlo ni deformarlo. Retorna el alto que ocupó (0 si no hay logo o falla).
function dibujarLogo(doc, logo, x, y, anchoMax, altoMax) {
    if (!logo) return 0;
    try {
        const img    = doc.openImage(logo);
        const escala = Math.min(anchoMax / img.width, altoMax / img.height, 1);
        const ancho  = img.width * escala;
        const alto   = img.height * escala;
        doc.image(img, x + (anchoMax - ancho) / 2, y + (altoMax - alto) / 2, { width: ancho, height: alto });
        return altoMax;
    } catch (e) {
        console.warn('[RIDE] Logo ignorado:', e.message);
        return 0;
    }
}

// Alto real del logo dentro de un ancho máximo (para los tickets, que crecen hacia abajo)
function altoDelLogo(doc, logo, anchoMax, altoMax) {
    if (!logo) return 0;
    try {
        const img = doc.openImage(logo);
        return img.height * Math.min(anchoMax / img.width, altoMax / img.height, 1);
    } catch (e) {
        return 0;
    }
}

module.exports = {
    logoDelEmisor,
    dibujarLogo,
    altoDelLogo,
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
    tarifasVisibles,
    lineasDireccion,
    parsearCampoAdicional,
    getAmbiente,
    getUrlConsulta,
    marcaKipu,
    URL_MARCA,
};