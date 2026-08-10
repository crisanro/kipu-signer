// services/ride/formatos/t58.js
//
// Layout para impresora térmica de 58mm (ancho papel ~58mm, área imprimible ~48mm = 164px a 72dpi)
// Uso típico: impresoras móviles, miniprinters Bluetooth, taxis, delivery.
// Formato ultra compacto — solo lo esencial.

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

// ── Dimensiones 58mm ───────────────────────────────────────────────────────────
const T58 = {
    margin:     5,
    pageWidth:  164,   // ~48mm a 72dpi
    fontTiny:   5,
    fontSmall:  6,
    fontNormal: 7,
    fontMedium: 8,
    fontTitle:  9,
    rowH:       11,
    lineGap:    1,
    colorGris:  '#eeeeee',
    separador:  '--------------------------------',
};

// ── Helpers internos ───────────────────────────────────────────────────────────
function sep(doc, y) {
    doc.fontSize(T58.fontTiny).font('Helvetica').fillColor('#aaaaaa')
        .text(T58.separador, T58.margin, y, { width: T58.pageWidth - T58.margin * 2 });
    doc.fillColor('black');
}

function centrado(doc, texto, y, opts = {}) {
    const { fontSize = T58.fontNormal, bold = false } = opts;
    doc.fontSize(fontSize).font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .text(texto, T58.margin, y, { width: T58.pageWidth - T58.margin * 2, align: 'center' });
}

function textoH(doc, texto, width, fontSize = T58.fontNormal) {
    doc.fontSize(fontSize);
    return doc.heightOfString(texto, { width }) + T58.lineGap;
}

// ── CABECERA ───────────────────────────────────────────────────────────────────
async function dibujarCabecera(doc, infoTrib, labelTipo, datosExtra, estadoFactura, fechaAuth) {
    const w = T58.pageWidth - T58.margin * 2;
    let y   = 8;

    // Razón social
    doc.fontSize(T58.fontMedium).font('Helvetica-Bold')
        .text(infoTrib.razonSocial, T58.margin, y, { width: w, align: 'center' });
    y += textoH(doc, infoTrib.razonSocial, w, T58.fontMedium);

    // RUC
    centrado(doc, `RUC: ${infoTrib.ruc}`, y, { fontSize: T58.fontSmall, bold: true });
    y += T58.rowH - 1;

    // Dirección — solo si cabe en 2 líneas
    const dir = datosExtra.dirEstablecimiento || infoTrib.dirMatriz || '';
    if (dir) {
        doc.fontSize(T58.fontTiny).font('Helvetica').fillColor('#666666')
            .text(dir, T58.margin, y, { width: w, align: 'center', lineBreak: true });
        doc.fillColor('black');
        y += textoH(doc, dir, w, T58.fontTiny);
    }

    sep(doc, y); y += T58.rowH;

    // Tipo comprobante
    centrado(doc, labelTipo, y, { fontSize: T58.fontTitle, bold: true });
    y += T58.rowH + 1;

    // Número
    centrado(doc, `${infoTrib.estab}-${infoTrib.ptoEmi}-${infoTrib.secuencial}`, y, { bold: true });
    y += T58.rowH;

    sep(doc, y); y += T58.rowH - 2;

    // Estado
    if (estadoFactura === 'AUTORIZADO' && fechaAuth) {
        doc.fontSize(T58.fontTiny).font('Helvetica').fillColor('#333333')
            .text(`Auth: ${fechaAuth}`, T58.margin, y, { width: w, align: 'center' });
    } else {
        doc.fontSize(T58.fontSmall).font('Helvetica-Bold').fillColor('#cc0000')
            .text('PENDIENTE', T58.margin, y, { width: w, align: 'center' });
    }
    doc.fillColor('black');
    y += T58.rowH;

    // Clave de acceso — muy compacta
    doc.fontSize(T58.fontTiny).font('Helvetica').fillColor('#888888')
        .text(String(infoTrib.claveAcceso).trim(), T58.margin, y, { width: w, align: 'center' });
    doc.fillColor('black');
    y += T58.rowH;

    // QR pequeño — solo si está autorizado, ya que es para verificar
    if (estadoFactura === 'AUTORIZADO') {
        try {
            const qrBuffer = await QRCode.toBuffer(
                getUrlConsulta(infoTrib.claveAcceso),
                { margin: 1, width: 60, errorCorrectionLevel: 'L' }
            );
            doc.image(qrBuffer, T58.pageWidth / 2 - 30, y, { width: 60 });
            y += 66;
        } catch (e) {
            console.warn('[RIDE 58mm] Error QR:', e.message);
        }
    }

    sep(doc, y); y += T58.rowH;
    return y;
}

// ── DATOS COMPRADOR ────────────────────────────────────────────────────────────
function dibujarDatosComprador(doc, datos, extraFilas, currentY) {
    const w = T58.pageWidth - T58.margin * 2;
    let y   = currentY;

    // En 58mm es muy compacto — solo lo esencial
    doc.fontSize(T58.fontSmall).font('Helvetica-Bold')
        .text(datos.razonSocial || '', T58.margin, y, { width: w }); y += T58.rowH - 1;
    doc.fontSize(T58.fontSmall).font('Helvetica').fillColor('#444444')
        .text(`ID: ${datos.identificacion || ''} | ${datos.fechaEmision || ''}`,
            T58.margin, y, { width: w });
    doc.fillColor('black'); y += T58.rowH;

    if (extraFilas && extraFilas.length > 0) {
        extraFilas.forEach(ef => {
            doc.fontSize(T58.fontTiny).font('Helvetica')
                .text(`${ef.label}: ${ef.valor || '-'}`, T58.margin, y, { width: w });
            y += T58.rowH - 2;
        });
    }

    sep(doc, y); y += T58.rowH;
    return y;
}

// ── TABLA DE ÍTEMS ─────────────────────────────────────────────────────────────
// En 58mm es ultra compacto — 3 líneas por ítem máximo
function dibujarItems(doc, detalles, currentY) {
    const w = T58.pageWidth - T58.margin * 2;
    let y   = currentY;

    doc.fontSize(T58.fontSmall).font('Helvetica-Bold')
        .text('ÍTEMS', T58.margin, y, { width: w }); y += T58.rowH;

    toArray(detalles).forEach((item, i) => {
        const cant    = parseFloat(item.cantidad || 0);
        const cantStr = cant % 1 === 0 ? cant.toFixed(0) : cant.toFixed(2);

        // Descripción
        doc.fontSize(T58.fontNormal).font('Helvetica')
            .text(`${cantStr}x ${item.descripcion || ''}`, T58.margin, y, { width: w });
        y += textoH(doc, `${cantStr}x ${item.descripcion || ''}`, w);

        // Precio unitario y total en la misma línea
        const pu  = fmtNum(item.precioUnitario, 4);
        const tot = fmtNum(item.precioTotalSinImpuesto);
        doc.fontSize(T58.fontTiny).font('Helvetica').fillColor('#555555')
            .text(`@${pu}`, T58.margin, y, { width: Math.floor(w * 0.5) });
        doc.font('Helvetica-Bold').fillColor('black')
            .text(tot, T58.margin, y, { width: w, align: 'right' });
        y += T58.rowH - 1;

        // Descuento si aplica
        if (parseFloat(item.descuento || 0) > 0) {
            doc.fontSize(T58.fontTiny).font('Helvetica').fillColor('#888888')
                .text(`Desc: -${fmtNum(item.descuento)}`, T58.margin, y, { width: w });
            doc.fillColor('black');
            y += T58.rowH - 2;
        }

        if (i < toArray(detalles).length - 1) {
            doc.moveTo(T58.margin, y)
                .lineTo(T58.pageWidth - T58.margin, y)
                .dash(1, { space: 2 }).stroke().undash();
            y += 3;
        }
    });

    sep(doc, y); y += T58.rowH;
    return y;
}

// ── TOTALES ────────────────────────────────────────────────────────────────────
// En 58mm solo mostramos los totales más importantes
function dibujarTotales(doc, totalConImpuestos, resumen, labelTotal, currentY) {
    const w   = T58.pageWidth - T58.margin * 2;
    const imp = calcularImpuestos(totalConImpuestos);
    let y     = currentY;

    const rowTot = (label, valor, bold = false, big = false) => {
        const fs = big ? T58.fontMedium : T58.fontSmall;
        doc.fontSize(fs).font(bold ? 'Helvetica-Bold' : 'Helvetica');
        const lw = Math.floor(w * 0.6);
        doc.text(label, T58.margin, y, { width: lw });
        doc.text(fmtNum(valor), T58.margin + lw, y, { width: w - lw, align: 'right' });
        y += (big ? T58.rowH + 1 : T58.rowH - 1);
    };

    // Subtotales simplificados
    if (imp.base0 > 0) rowTot('Subtotal 0%', imp.base0);
    if (imp.baseIVA > 0) {
        Object.entries(imp.porTarifa)
            .filter(([t]) => parseFloat(t) > 0)
            .forEach(([t, d]) => rowTot(`Subtotal ${t}%`, d.base));
    }

    rowTot('Subtotal sin imp.', resumen.totalSinImpuestos || 0);

    if (parseFloat(resumen.totalDescuento || 0) > 0) {
        rowTot('Descuento', resumen.totalDescuento);
    }

    // IVA
    Object.entries(imp.porTarifa)
        .filter(([t, d]) => parseFloat(t) > 0 && d.valor > 0)
        .forEach(([t, d]) => rowTot(`IVA ${t}%`, d.valor));

    if (imp.totalICE > 0)    rowTot('ICE', imp.totalICE);
    if (imp.totalIRBPNR > 0) rowTot('IRBPNR', imp.totalIRBPNR);
    if (parseFloat(resumen.propina || 0) > 0) rowTot('Propina', resumen.propina);

    // Total grande y destacado
    sep(doc, y); y += T58.rowH - 2;
    doc.rect(T58.margin, y, w, T58.rowH + 4).fill('#eeeeee');
    doc.fillColor('black');
    rowTot(labelTotal, resumen.importeTotal || 0, true, true);

    return y;
}

// ── INFO ADICIONAL ─────────────────────────────────────────────────────────────
function dibujarInfoAdicional(doc, camposAdicionales, currentY) {
    const w      = T58.pageWidth - T58.margin * 2;
    const campos = toArray(camposAdicionales)
        .map(parsearCampoAdicional)
        .filter(c => c.nombre &&
            c.nombre.toUpperCase() !== 'PROVEEDOR' &&
            c.nombre !== 'PROVEEDOR_SISTEMA_INFORMATICO'
        );

    if (campos.length === 0) return currentY;

    let y = currentY;
    sep(doc, y); y += T58.rowH - 2;

    campos.forEach(campo => {
        doc.fontSize(T58.fontTiny).font('Helvetica')
            .text(`${campo.nombre}: ${campo.valor}`, T58.margin, y, { width: w });
        y += T58.rowH - 2;
    });

    return y;
}

// ── FORMAS DE PAGO ─────────────────────────────────────────────────────────────
function dibujarFormasPago(doc, pagosArr, currentY) {
    const w     = T58.pageWidth - T58.margin * 2;
    const pagos = toArray(pagosArr);
    if (pagos.length === 0) return currentY;

    let y = currentY;
    sep(doc, y); y += T58.rowH - 2;

    pagos.forEach(pago => {
        const desc = FORMAS_PAGO[pago.formaPago] || pago.formaPago || '-';
        const lw   = Math.floor(w * 0.62);
        doc.fontSize(T58.fontSmall).font('Helvetica')
            .text(desc, T58.margin, y, { width: lw });
        doc.text(fmtMoney(pago.total), T58.margin + lw, y, { width: w - lw, align: 'right' });
        y += T58.rowH;
    });

    return y;
}

// ── PIE FINAL ──────────────────────────────────────────────────────────────────
function dibujarPieFinal(doc, currentY) {
    const w = T58.pageWidth - T58.margin * 2;
    let y   = currentY + 4;
    sep(doc, y); y += T58.rowH - 2;
    doc.fontSize(T58.fontTiny).font('Helvetica').fillColor('#999999')
        .text('kipu.ec | Facturación Electrónica', T58.margin, y, { width: w, align: 'center' });
    doc.fillColor('black');
    return y + T58.rowH + 8;
}

module.exports = {
    T58,
    dibujarCabecera,
    dibujarDatosComprador,
    dibujarItems,
    dibujarTotales,
    dibujarInfoAdicional,
    dibujarFormasPago,
    dibujarPieFinal,
};