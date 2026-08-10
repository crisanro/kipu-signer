// services/ride/formatos/t80.js
//
// Layout para impresora térmica de 80mm (ancho papel ~80mm, área imprimible ~72mm = 204px a 72dpi)
// Uso típico: punto de venta, restaurantes, tiendas.
// Formato vertical, sin columnas, todo en una sola columna.

'use strict';

const QRCode = require('qrcode');
const {
    fmtNum,
    fmtMoney,
    toArray,
    FORMAS_PAGO,
    calcularImpuestos,
    parsearCampoAdicional,
    getAmbiente,
    getUrlConsulta,
} = require('../helpers');

// ── Dimensiones 80mm ───────────────────────────────────────────────────────────
const T80 = {
    margin:      8,
    pageWidth:   204,   // ~72mm a 72dpi
    fontSmall:   6,
    fontNormal:  7,
    fontMedium:  8,
    fontLarge:   9,
    fontTitle:   10,
    rowH:        12,
    lineGap:     2,
    colorGris:   '#eeeeee',
    separador:   '------------------------------------------------',
};

// ── Helpers internos ───────────────────────────────────────────────────────────

// Línea separadora punteada
function sep(doc, y) {
    doc.fontSize(T80.fontSmall).font('Helvetica').fillColor('#999999')
        .text(T80.separador, T80.margin, y, { width: T80.pageWidth - T80.margin * 2 });
    doc.fillColor('black');
}

// Fila label + valor en la misma línea
function fila(doc, label, valor, y, opts = {}) {
    const { bold = false, align = 'right' } = opts;
    const w     = T80.pageWidth - T80.margin * 2;
    const labelW = opts.labelW || Math.floor(w * 0.55);
    const valorW = w - labelW;
    doc.fontSize(T80.fontNormal).font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .text(label, T80.margin, y, { width: labelW });
    doc.text(String(valor || '-'), T80.margin + labelW, y, { width: valorW, align });
}

// Texto centrado
function centrado(doc, texto, y, opts = {}) {
    const { fontSize = T80.fontNormal, bold = false } = opts;
    doc.fontSize(fontSize).font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .text(texto, T80.margin, y, { width: T80.pageWidth - T80.margin * 2, align: 'center' });
}

// Altura de texto
function textoH(doc, texto, width, fontSize = T80.fontNormal) {
    doc.fontSize(fontSize);
    return doc.heightOfString(texto, { width }) + T80.lineGap;
}

// ── CABECERA ───────────────────────────────────────────────────────────────────
async function dibujarCabecera(doc, infoTrib, labelTipo, datosExtra, estadoFactura, fechaAuth) {
    const w = T80.pageWidth - T80.margin * 2;
    let y   = 10;

    // Razón social
    doc.fontSize(T80.fontLarge).font('Helvetica-Bold')
        .text(infoTrib.razonSocial, T80.margin, y, { width: w, align: 'center' });
    y += textoH(doc, infoTrib.razonSocial, w, T80.fontLarge);

    // Nombre comercial
    if (infoTrib.nombreComercial && infoTrib.nombreComercial !== infoTrib.razonSocial) {
        doc.fontSize(T80.fontNormal).font('Helvetica').fillColor('#555555')
            .text(infoTrib.nombreComercial, T80.margin, y, { width: w, align: 'center' });
        doc.fillColor('black');
        y += textoH(doc, infoTrib.nombreComercial, w);
    }

    // RUC
    centrado(doc, `RUC: ${infoTrib.ruc}`, y, { bold: true }); y += T80.rowH;

    // Dirección
    doc.fontSize(T80.fontSmall).font('Helvetica').fillColor('#555555')
        .text(datosExtra.dirEstablecimiento || infoTrib.dirMatriz, T80.margin, y, { width: w, align: 'center' });
    doc.fillColor('black');
    y += textoH(doc, datosExtra.dirEstablecimiento || infoTrib.dirMatriz, w, T80.fontSmall);

    // Contribuyente especial
    if (datosExtra.contribuyenteEspecial) {
        centrado(doc, `Contribuyente Especial: ${datosExtra.contribuyenteEspecial}`, y, { fontSize: T80.fontSmall });
        y += T80.rowH - 2;
    }

    sep(doc, y); y += T80.rowH;

    // Tipo de comprobante
    centrado(doc, labelTipo, y, { fontSize: T80.fontTitle, bold: true }); y += T80.rowH + 2;

    // Número
    centrado(doc, `${infoTrib.estab}-${infoTrib.ptoEmi}-${infoTrib.secuencial}`, y, { bold: true });
    y += T80.rowH;

    sep(doc, y); y += T80.rowH;

    // Estado autorización
    if (estadoFactura === 'AUTORIZADO' && fechaAuth) {
        doc.fontSize(T80.fontSmall).font('Helvetica')
            .text(`Autorizado: ${fechaAuth}`, T80.margin, y, { width: w, align: 'center' });
    } else {
        doc.fontSize(T80.fontSmall).font('Helvetica-Bold').fillColor('#cc0000')
            .text('PENDIENTE DE AUTORIZACIÓN', T80.margin, y, { width: w, align: 'center' });
        doc.fillColor('black');
    }
    y += T80.rowH;

    // Ambiente
    doc.fontSize(T80.fontSmall).font('Helvetica').fillColor('#777777')
        .text(`Ambiente: ${getAmbiente(infoTrib.ambiente)}`, T80.margin, y, { width: w, align: 'center' });
    doc.fillColor('black');
    y += T80.rowH;

    // Clave de acceso
    sep(doc, y); y += T80.rowH - 2;
    doc.fontSize(T80.fontSmall).font('Helvetica-Bold')
        .text('Clave de Acceso:', T80.margin, y, { width: w });
    y += T80.rowH - 2;
    doc.fontSize(5).font('Helvetica')
        .text(String(infoTrib.claveAcceso).trim(), T80.margin, y, { width: w, align: 'center' });
    y += T80.rowH;

    // QR pequeño centrado
    try {
        const qrBuffer = await QRCode.toBuffer(
            getUrlConsulta(infoTrib.claveAcceso),
            { margin: 1, width: 80, errorCorrectionLevel: 'M' }
        );
        doc.image(qrBuffer, T80.pageWidth / 2 - 40, y, { width: 80 });
        y += 88;
    } catch (e) {
        console.warn('[RIDE 80mm] Error QR:', e.message);
    }

    sep(doc, y); y += T80.rowH;
    return y;
}

// ── DATOS COMPRADOR ────────────────────────────────────────────────────────────
function dibujarDatosComprador(doc, datos, extraFilas, currentY) {
    const w = T80.pageWidth - T80.margin * 2;
    let y   = currentY;

    fila(doc, 'Cliente:', datos.razonSocial || '', y, { bold: false, labelW: 45 }); y += T80.rowH;
    fila(doc, 'ID:',      datos.identificacion || '', y, { labelW: 20 });           y += T80.rowH;
    fila(doc, 'Fecha:',   datos.fechaEmision || '', y, { labelW: 35 });             y += T80.rowH;

    if (datos.direccion) {
        doc.fontSize(T80.fontSmall).font('Helvetica').fillColor('#555555')
            .text(`Dir: ${datos.direccion}`, T80.margin, y, { width: w });
        doc.fillColor('black');
        y += textoH(doc, datos.direccion, w, T80.fontSmall);
    }

    if (extraFilas && extraFilas.length > 0) {
        extraFilas.forEach(ef => {
            fila(doc, ef.label + ':', ef.valor, y, { labelW: ef.labelW || 80 });
            y += T80.rowH;
        });
    }

    sep(doc, y); y += T80.rowH;
    return y;
}

// ── TABLA DE ÍTEMS ─────────────────────────────────────────────────────────────
// En 80mm no hay columnas — cada ítem ocupa múltiples líneas
function dibujarItems(doc, detalles, currentY) {
    const w = T80.pageWidth - T80.margin * 2;
    let y   = currentY;

    // Encabezado simplificado
    doc.fontSize(T80.fontNormal).font('Helvetica-Bold')
        .text('CANT  DESCRIPCIÓN', T80.margin, y, { width: w });
    y += T80.rowH;

    doc.fontSize(T80.fontSmall).font('Helvetica-Bold')
        .text('P.Unit    Desc    Subtotal', T80.margin, y, { width: w, align: 'right' });
    y += T80.rowH;

    sep(doc, y); y += T80.rowH - 2;

    toArray(detalles).forEach((item, i) => {
        // Línea 1: cantidad + descripción
        const cant    = parseFloat(item.cantidad || 0);
        const cantStr = cant % 1 === 0 ? cant.toFixed(0) : cant.toFixed(2);
        const desc    = item.descripcion || '';

        const descW   = w - 28;
        doc.fontSize(T80.fontNormal).font('Helvetica-Bold')
            .text(cantStr, T80.margin, y, { width: 24 });
        doc.font('Helvetica')
            .text(desc, T80.margin + 28, y, { width: descW });
        y += Math.max(textoH(doc, desc, descW), T80.rowH);

        // Línea 2: precio unitario + descuento + total
        const pu   = fmtNum(item.precioUnitario, 4);
        const dsc  = parseFloat(item.descuento || 0);
        const tot  = fmtNum(item.precioTotalSinImpuesto);
        const linea2 = dsc > 0
            ? `${pu}  -${fmtNum(dsc)}  ${tot}`
            : `${pu}            ${tot}`;

        doc.fontSize(T80.fontSmall).font('Helvetica').fillColor('#444444')
            .text(linea2, T80.margin, y, { width: w, align: 'right' });
        doc.fillColor('black');
        y += T80.rowH - 1;

        // Separador ligero entre ítems (excepto el último)
        if (i < toArray(detalles).length - 1) {
            doc.moveTo(T80.margin, y)
                .lineTo(T80.pageWidth - T80.margin, y)
                .dash(2, { space: 2 }).stroke().undash();
            y += 3;
        }
    });

    sep(doc, y); y += T80.rowH;
    return y;
}

// ── TOTALES ────────────────────────────────────────────────────────────────────
function dibujarTotales(doc, totalConImpuestos, resumen, labelTotal, currentY) {
    const w   = T80.pageWidth - T80.margin * 2;
    const imp = calcularImpuestos(totalConImpuestos);
    let y     = currentY;

    const rowTot = (label, valor, bold = false) => {
        doc.fontSize(T80.fontNormal).font(bold ? 'Helvetica-Bold' : 'Helvetica');
        const lw = Math.floor(w * 0.62);
        doc.text(label, T80.margin, y, { width: lw });
        doc.text(fmtNum(valor), T80.margin + lw, y, { width: w - lw, align: 'right' });
        y += T80.rowH;
    };

    // Subtotales dinámicos
    Object.entries(imp.porTarifa)
        .sort(([a], [b]) => parseFloat(b) - parseFloat(a))
        .forEach(([tarifa, datos]) => {
            rowTot(parseFloat(tarifa) > 0 ? `Subtotal ${tarifa}%` : 'Subtotal 0%', datos.base);
        });

    rowTot('Subtotal sin impuestos', resumen.totalSinImpuestos || 0);
    if (parseFloat(resumen.totalDescuento || 0) > 0) {
        rowTot('Descuento', resumen.totalDescuento);
    }

    // IVA por tarifa
    Object.entries(imp.porTarifa)
        .filter(([t, d]) => parseFloat(t) > 0 && d.valor > 0)
        .sort(([a], [b]) => parseFloat(b) - parseFloat(a))
        .forEach(([tarifa, datos]) => {
            rowTot(`IVA ${tarifa}%`, datos.valor);
        });

    if (imp.totalICE > 0)     rowTot('ICE',     imp.totalICE);
    if (imp.totalIRBPNR > 0)  rowTot('IRBPNR',  imp.totalIRBPNR);
    if (parseFloat(resumen.propina || 0) > 0) rowTot('Propina', resumen.propina);

    // Total destacado
    sep(doc, y); y += T80.rowH - 2;
    doc.fontSize(T80.fontLarge).font('Helvetica-Bold')
        .text(labelTotal, T80.margin, y, { width: Math.floor(w * 0.55) });
    doc.text(fmtNum(resumen.importeTotal || 0), T80.margin, y, { width: w, align: 'right' });
    y += T80.rowH + 2;

    return y;
}

// ── INFO ADICIONAL ─────────────────────────────────────────────────────────────
function dibujarInfoAdicional(doc, camposAdicionales, currentY) {
    const w      = T80.pageWidth - T80.margin * 2;
    const campos = toArray(camposAdicionales)
        .map(parsearCampoAdicional)
        .filter(c => c.nombre &&
            c.nombre.toUpperCase() !== 'PROVEEDOR' &&
            c.nombre !== 'PROVEEDOR_SISTEMA_INFORMATICO'
        );

    if (campos.length === 0) return currentY;

    let y = currentY;
    sep(doc, y); y += T80.rowH;

    doc.fontSize(T80.fontNormal).font('Helvetica-Bold')
        .text('Información Adicional', T80.margin, y, { width: w }); y += T80.rowH;

    campos.forEach(campo => {
        const lw = 70;
        doc.fontSize(T80.fontSmall).font('Helvetica-Bold')
            .text(String(campo.nombre), T80.margin, y, { width: lw });
        doc.font('Helvetica')
            .text(String(campo.valor), T80.margin + lw + 3, y, { width: w - lw - 3 });
        y += T80.rowH - 1;
    });

    return y;
}

// ── FORMAS DE PAGO ─────────────────────────────────────────────────────────────
function dibujarFormasPago(doc, pagosArr, currentY) {
    const w     = T80.pageWidth - T80.margin * 2;
    const pagos = toArray(pagosArr);
    if (pagos.length === 0) return currentY;

    let y = currentY;
    sep(doc, y); y += T80.rowH;

    doc.fontSize(T80.fontNormal).font('Helvetica-Bold')
        .text('Formas de Pago', T80.margin, y, { width: w }); y += T80.rowH;

    pagos.forEach(pago => {
        const desc = FORMAS_PAGO[pago.formaPago] || pago.formaPago || '-';
        const lw   = Math.floor(w * 0.65);
        doc.fontSize(T80.fontNormal).font('Helvetica')
            .text(desc, T80.margin, y, { width: lw });
        doc.text(fmtMoney(pago.total), T80.margin + lw, y, { width: w - lw, align: 'right' });
        y += T80.rowH;
    });

    return y;
}

// ── PIE FINAL ──────────────────────────────────────────────────────────────────
function dibujarPieFinal(doc, currentY) {
    const w = T80.pageWidth - T80.margin * 2;
    let y   = currentY + 6;
    sep(doc, y); y += T80.rowH;
    doc.fontSize(T80.fontSmall).font('Helvetica').fillColor('#777777')
        .text('Documento generado por kipu.ec', T80.margin, y, { width: w, align: 'center' });
    doc.text('Facturación Electrónica Ecuador', T80.margin, y + T80.rowH - 2, { width: w, align: 'center' });
    doc.fillColor('black');
    return y + T80.rowH * 2 + 10;
}

module.exports = {
    T80,
    dibujarCabecera,
    dibujarDatosComprador,
    dibujarItems,
    dibujarTotales,
    dibujarInfoAdicional,
    dibujarFormasPago,
    dibujarPieFinal,
};