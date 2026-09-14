// services/ride/formatos/t58.js
//
// Layout para impresora térmica de 58mm (ancho papel ~58mm, área imprimible ~48mm = 164px a 72dpi)
// Uso típico: impresoras móviles, miniprinters Bluetooth, delivery.
// Estructura idéntica a t80 pero adaptada al ancho menor.

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
    margin:      5,
    pageWidth:   164,   // ~48mm a 72dpi
    fontSmall:   5,
    fontNormal:  6,
    fontMedium:  7,
    fontLarge:   8,
    fontTitle:   9,
    rowH:        10,
    lineGap:     1,
    colorGris:   '#eeeeee',
    separador:   '--------------------------------',
};

// ── Helpers internos ───────────────────────────────────────────────────────────

function sep(doc, y) {
    doc.fontSize(T58.fontSmall).font('Helvetica').fillColor('#999999')
        .text(T58.separador, T58.margin, y, { width: T58.pageWidth - T58.margin * 2 });
    doc.fillColor('black');
}

function fila(doc, label, valor, y, opts = {}) {
    const { bold = false, align = 'right' } = opts;
    const w      = T58.pageWidth - T58.margin * 2;
    const labelW = opts.labelW || Math.floor(w * 0.5);
    const valorW = w - labelW;
    doc.fontSize(T58.fontNormal).font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .text(label, T58.margin, y, { width: labelW });
    doc.text(String(valor || '-'), T58.margin + labelW, y, { width: valorW, align });
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
    doc.fontSize(T58.fontLarge).font('Helvetica-Bold')
        .text(infoTrib.razonSocial, T58.margin, y, { width: w, align: 'center' });
    y += textoH(doc, infoTrib.razonSocial, w, T58.fontLarge);

    // Nombre comercial
    if (infoTrib.nombreComercial && infoTrib.nombreComercial !== infoTrib.razonSocial) {
        doc.fontSize(T58.fontSmall).font('Helvetica').fillColor('#555555')
            .text(infoTrib.nombreComercial, T58.margin, y, { width: w, align: 'center' });
        doc.fillColor('black');
        y += textoH(doc, infoTrib.nombreComercial, w, T58.fontSmall);
    }

    // RUC
    centrado(doc, `RUC: ${infoTrib.ruc}`, y, { bold: true }); y += T58.rowH;

    // Dirección
    const dir = datosExtra.dirEstablecimiento || infoTrib.dirMatriz || '';
    if (dir) {
        doc.fontSize(T58.fontSmall).font('Helvetica').fillColor('#555555')
            .text(dir, T58.margin, y, { width: w, align: 'center' });
        doc.fillColor('black');
        y += textoH(doc, dir, w, T58.fontSmall);
    }

    // Contribuyente especial
    if (datosExtra.contribuyenteEspecial) {
        centrado(doc, `Contrib. Esp: ${datosExtra.contribuyenteEspecial}`, y, { fontSize: T58.fontSmall });
        y += T58.rowH - 1;
    }

    // ── Leyendas SRI — Ficha Técnica v2.34 ─────────────────────────────────
    if (infoTrib.agenteRetencion) {
        centrado(doc, `Agente de Ret. Res. No: ${infoTrib.agenteRetencion}`, y, { fontSize: T58.fontSmall });
        y += T58.rowH - 1;
    }
    if (infoTrib.contribuyenteRimpe) {
        centrado(doc, infoTrib.contribuyenteRimpe, y, { fontSize: T58.fontSmall, bold: true });
        y += T58.rowH - 1;
    }

    sep(doc, y); y += T58.rowH;

    // Tipo de comprobante
    centrado(doc, labelTipo, y, { fontSize: T58.fontTitle, bold: true }); y += T58.rowH + 2;

    // Número
    centrado(doc, `${infoTrib.estab}-${infoTrib.ptoEmi}-${infoTrib.secuencial}`, y, { bold: true });
    y += T58.rowH;

    sep(doc, y); y += T58.rowH;

    // Estado autorización
    if (estadoFactura === 'AUTORIZADO' && fechaAuth) {
        doc.fontSize(T58.fontSmall).font('Helvetica')
            .text(`Autorizado: ${fechaAuth}`, T58.margin, y, { width: w, align: 'center' });
    } else {
        doc.fontSize(T58.fontSmall).font('Helvetica-Bold').fillColor('#cc0000')
            .text('PENDIENTE DE AUTORIZACIÓN', T58.margin, y, { width: w, align: 'center' });
        doc.fillColor('black');
    }
    y += T58.rowH;

    // Ambiente
    doc.fontSize(T58.fontSmall).font('Helvetica').fillColor('#777777')
        .text(`Ambiente: ${getAmbiente(infoTrib.ambiente)}`, T58.margin, y, { width: w, align: 'center' });
    doc.fillColor('black');
    y += T58.rowH;

    // Clave de acceso
    sep(doc, y); y += T58.rowH - 2;
    doc.fontSize(T58.fontSmall).font('Helvetica-Bold')
        .text('Clave de Acceso:', T58.margin, y, { width: w });
    y += T58.rowH - 2;
    doc.fontSize(4).font('Helvetica')
        .text(String(infoTrib.claveAcceso).trim(), T58.margin, y, { width: w, align: 'center' });
    y += T58.rowH;

    // QR pequeño centrado
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

    fila(doc, 'Cliente:', datos.razonSocial || '', y, { bold: false, labelW: 38 }); y += T58.rowH;
    fila(doc, 'ID:',      datos.identificacion || '', y, { labelW: 16 });            y += T58.rowH;
    fila(doc, 'Fecha:',   datos.fechaEmision || '', y, { labelW: 30 });             y += T58.rowH;

    if (datos.direccion) {
        doc.fontSize(T58.fontSmall).font('Helvetica').fillColor('#555555')
            .text(`Dir: ${datos.direccion}`, T58.margin, y, { width: w });
        doc.fillColor('black');
        y += textoH(doc, datos.direccion, w, T58.fontSmall);
    }

    if (extraFilas && extraFilas.length > 0) {
        extraFilas.forEach(ef => {
            fila(doc, ef.label + ':', ef.valor, y, { labelW: ef.labelW || 60 });
            y += T58.rowH;
        });
    }

    sep(doc, y); y += T58.rowH;
    return y;
}

// ── TABLA DE ÍTEMS ─────────────────────────────────────────────────────────────
function dibujarItems(doc, detalles, currentY) {
    const w = T58.pageWidth - T58.margin * 2;
    let y   = currentY;

    // Encabezado
    doc.fontSize(T58.fontNormal).font('Helvetica-Bold')
        .text('CANT  DESCRIPCIÓN', T58.margin, y, { width: w });
    y += T58.rowH;

    doc.fontSize(T58.fontSmall).font('Helvetica-Bold')
        .text('P.Unit    Desc    Subtotal', T58.margin, y, { width: w, align: 'right' });
    y += T58.rowH;

    sep(doc, y); y += T58.rowH - 2;

    toArray(detalles).forEach((item, i) => {
        // Línea 1: cantidad + descripción
        const cant    = parseFloat(item.cantidad || 0);
        const cantStr = cant % 1 === 0 ? cant.toFixed(0) : cant.toFixed(2);
        const desc    = item.descripcion || '';

        const descW = w - 22;
        doc.fontSize(T58.fontNormal).font('Helvetica-Bold')
            .text(cantStr, T58.margin, y, { width: 18 });
        doc.font('Helvetica')
            .text(desc, T58.margin + 22, y, { width: descW });
        y += Math.max(textoH(doc, desc, descW), T58.rowH);

        // Línea 2: precio unitario + descuento + total
        const pu   = fmtNum(item.precioUnitario, 4);
        const dsc  = parseFloat(item.descuento || 0);
        const tot  = fmtNum(item.precioTotalSinImpuesto);
        const linea2 = dsc > 0
            ? `${pu}  -${fmtNum(dsc)}  ${tot}`
            : `${pu}       ${tot}`;

        doc.fontSize(T58.fontSmall).font('Helvetica').fillColor('#444444')
            .text(linea2, T58.margin, y, { width: w, align: 'right' });
        doc.fillColor('black');
        y += T58.rowH - 1;

        // Separador ligero entre ítems
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
function dibujarTotales(doc, totalConImpuestos, resumen, labelTotal, currentY) {
    const w   = T58.pageWidth - T58.margin * 2;
    const imp = calcularImpuestos(totalConImpuestos);
    let y     = currentY;

    const rowTot = (label, valor, bold = false) => {
        doc.fontSize(T58.fontNormal).font(bold ? 'Helvetica-Bold' : 'Helvetica');
        const lw = Math.floor(w * 0.6);
        doc.text(label, T58.margin, y, { width: lw });
        doc.text(fmtNum(valor), T58.margin + lw, y, { width: w - lw, align: 'right' });
        y += T58.rowH;
    };

    // Subtotales por tarifa — siempre visibles
    const base15 = imp.porTarifa['15']?.base || 0;
    const base5  = imp.porTarifa['5']?.base  || 0;
    const base0  = imp.porTarifa['0']?.base  || 0;

    rowTot('Subtotal 15%',      base15);
    rowTot('Subtotal 5%',       base5);
    rowTot('Subtotal 0%',       base0);
    rowTot('No objeto IVA',     imp.noObjetoIVA || 0);
    rowTot('Exento IVA',        imp.exentoIVA   || 0);
    rowTot('Subtotal sin imp.', resumen.totalSinImpuestos || 0);
    rowTot('Descuento',         resumen.totalDescuento    || 0);
    rowTot('ICE',               imp.totalICE              || 0);

    // IVA por tarifa — siempre visibles
    const iva15 = imp.porTarifa['15']?.valor || 0;
    const iva5  = imp.porTarifa['5']?.valor  || 0;

    rowTot('IVA 15%',           iva15);
    rowTot('IVA 5%',            iva5);
    rowTot('IRBPNR',            imp.totalIRBPNR || 0);
    rowTot('Propina',           resumen.propina  || 0);

    // Total destacado
    sep(doc, y); y += T58.rowH - 2;
    doc.rect(T58.margin, y, w, T58.rowH + 2).fill(T58.colorGris);
    doc.fillColor('black');
    doc.fontSize(T58.fontLarge).font('Helvetica-Bold')
        .text(labelTotal, T58.margin, y + 1, { width: Math.floor(w * 0.5) });
    doc.text(fmtNum(resumen.importeTotal || 0), T58.margin, y + 1, { width: w, align: 'right' });
    y += T58.rowH + 4;

    return y;
}

// ── INFO ADICIONAL ─────────────────────────────────────────────────────────────
function dibujarInfoAdicional(doc, camposAdicionales, currentY) {
    const w      = T58.pageWidth - T58.margin * 2;
    const campos = toArray(camposAdicionales).map(parsearCampoAdicional)
        .filter(c => c.nombre);

    if (campos.length === 0) return currentY;

    let y = currentY;
    sep(doc, y); y += T58.rowH;

    doc.fontSize(T58.fontNormal).font('Helvetica-Bold')
        .text('Información Adicional', T58.margin, y, { width: w }); y += T58.rowH;

    campos.forEach(campo => {
        const lw = 55;
        const valorW = w - lw - 3;
        const valorStr = String(campo.valor);
        doc.fontSize(T58.fontSmall).font('Helvetica-Bold')
            .text(String(campo.nombre), T58.margin, y, { width: lw });
        doc.font('Helvetica')
            .text(valorStr, T58.margin + lw + 3, y, { width: valorW });
        const h = doc.heightOfString(valorStr, { width: valorW });
        y += Math.max(h + T58.lineGap, T58.rowH - 1);
    });

    return y;
}

// ── FORMAS DE PAGO ─────────────────────────────────────────────────────────────
function dibujarFormasPago(doc, pagosArr, currentY) {
    const w     = T58.pageWidth - T58.margin * 2;
    const pagos = toArray(pagosArr);
    if (pagos.length === 0) return currentY;

    let y = currentY;
    sep(doc, y); y += T58.rowH;

    doc.fontSize(T58.fontNormal).font('Helvetica-Bold')
        .text('Formas de Pago', T58.margin, y, { width: w }); y += T58.rowH;

    pagos.forEach(pago => {
        const desc = FORMAS_PAGO[pago.formaPago] || pago.formaPago || '-';
        const lw   = Math.floor(w * 0.6);
        doc.fontSize(T58.fontNormal).font('Helvetica')
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
    sep(doc, y); y += T58.rowH;
    doc.fontSize(T58.fontSmall).font('Helvetica').fillColor('#777777')
        .text('Documento generado por kipu.ec', T58.margin, y, { width: w, align: 'center' });
    doc.text('Facturación Electrónica Ecuador', T58.margin, y + T58.rowH - 2, { width: w, align: 'center' });
    doc.fillColor('black');
    return y + T58.rowH * 2 + 8;
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