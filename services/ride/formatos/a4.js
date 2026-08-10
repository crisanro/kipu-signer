// services/ride/formatos/a4.js
//
// Layout A4 para todos los comprobantes electrónicos SRI Ecuador.
// Define las dimensiones, posiciones y funciones de dibujo compartidas.
// Los comprobantes específicos llaman a estas funciones pasando sus datos.

'use strict';

const QRCode = require('qrcode');
const bwipjs = require('bwip-js');
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

// ── Dimensiones A4 ─────────────────────────────────────────────────────────────
const A4 = {
    margin:       30,
    pageWidth:    535,
    pageHeight:   792,

    // Columnas cabecera
    leftColW:     220,
    get rightColX()  { return this.margin + this.leftColW + 10; },
    get rightColW()  { return this.pageWidth - this.leftColW - 10; },

    // Columnas pie
    leftFooterW:  300,
    get rightFtrX()  { return this.margin + this.leftFooterW + 10; },
    get rightFtrW()  { return this.pageWidth - this.leftFooterW - 10; },

    // Alturas estándar
    rowH:         14,
    headerH:      18,
    cabeceraH:    178,

    // Fuentes
    fontNormal:   7,
    fontMedium:   8,
    fontLarge:    9,
    fontTitle:    11,

    // Colores
    colorGrisClaro:  '#f5f5f5',
    colorGrisMedio:  '#e0e0e0',
    colorGrisOscuro: '#d0d0d0',
    colorTextoGris:  '#555555',

    // Columnas tabla de ítems
    get cols() {
        return {
            cod:   { x: this.margin + 2,   w: 60  },
            cant:  { x: this.margin + 64,  w: 28  },
            desc:  { x: this.margin + 94,  w: 210 },
            pu:    { x: this.margin + 306, w: 65  },
            dsc:   { x: this.margin + 373, w: 55  },
            total: { x: this.margin + 430, w: 105 },
        };
    },
};

// ── CABECERA ───────────────────────────────────────────────────────────────────
// Dibuja la cabecera completa del RIDE:
// Izquierda: logo + datos del emisor
// Derecha:   tipo comprobante + número + clave acceso + QR + código barras
//
// Parámetros:
//   doc              — instancia PDFDocument
//   infoTrib         — objeto infoTributaria del XML
//   labelTipo        — ej: "F A C T U R A"
//   datosExtra       — { dirEstablecimiento, obligadoContabilidad, contribuyenteEspecial }
//   estadoFactura    — 'FIRMADO' | 'AUTORIZADO'
//   fechaAuth        — string fecha/hora autorización SRI
//   emisor           — objeto emisor del backend (para contribuyente_especial)
//
// Retorna el Y donde termina la cabecera.
async function dibujarCabecera(doc, infoTrib, labelTipo, datosExtra, estadoFactura, fechaAuth, emisor) {
    const { margin, leftColW, rightColX, rightColW, cabeceraH } = A4;
    const startY = 30;

    // ── Columna izquierda ──────────────────────────────────────────────────────
    doc.rect(margin, startY, leftColW, cabeceraH).stroke();

    // Espacio logo
    doc.rect(margin + 5, startY + 5, leftColW - 10, 55)
        .fillAndStroke('#fafafa', '#cccccc');
    doc.fontSize(7).font('Helvetica').fillColor('#bbbbbb')
        .text('LOGO', margin + 5, startY + 28, { width: leftColW - 10, align: 'center' });
    doc.fillColor('black');

    // Razón social
    doc.fontSize(A4.fontLarge).font('Helvetica-Bold')
        .text(
            infoTrib.razonSocial,
            margin + 5, startY + 66,
            { width: leftColW - 10, align: 'center' }
        );

    // Nombre comercial
    if (infoTrib.nombreComercial && infoTrib.nombreComercial !== infoTrib.razonSocial) {
        doc.fontSize(A4.fontNormal).font('Helvetica').fillColor(A4.colorTextoGris)
            .text(
                infoTrib.nombreComercial,
                margin + 5, startY + 80,
                { width: leftColW - 10, align: 'center' }
            );
        doc.fillColor('black');
    }

    // Dirección matriz
    _labelValor(doc, 'Dirección Matriz:', infoTrib.dirMatriz, margin + 5, startY + 95, leftColW - 10);

    // Dirección establecimiento
    _labelValor(doc,
        'Dirección Establecimiento:',
        datosExtra.dirEstablecimiento || infoTrib.dirMatriz,
        margin + 5, startY + 118, leftColW - 10
    );

    // Obligado a contabilidad
    doc.fontSize(A4.fontNormal).font('Helvetica-Bold')
        .text('Obligado a llevar contabilidad:', margin + 5, startY + 148);
    doc.font('Helvetica')
        .text(datosExtra.obligadoContabilidad || 'NO', margin + 157, startY + 148);

    // Contribuyente especial
    const contribEsp = datosExtra.contribuyenteEspecial ||
                       (emisor && emisor.contribuyente_especial) || '-';
    doc.font('Helvetica-Bold')
        .text('Contribuyente Especial Nro:', margin + 5, startY + 160);
    doc.font('Helvetica').text(contribEsp, margin + 137, startY + 160);

    // ── Columna derecha ────────────────────────────────────────────────────────
    doc.rect(rightColX, startY, rightColW, cabeceraH).stroke();

    // RUC
    doc.fontSize(A4.fontMedium).font('Helvetica-Bold')
        .text('R.U.C.:', rightColX + 5, startY + 8);
    doc.font('Helvetica').text(infoTrib.ruc, rightColX + 42, startY + 8);

    // Tipo de comprobante
    doc.fontSize(A4.fontTitle).font('Helvetica-Bold')
        .text(labelTipo, rightColX, startY + 26, { width: rightColW, align: 'center' });

    // Número secuencial
    doc.fontSize(A4.fontMedium).font('Helvetica-Bold')
        .text('No.', rightColX + 5, startY + 44);
    doc.font('Helvetica')
        .text(
            `${infoTrib.estab}-${infoTrib.ptoEmi}-${infoTrib.secuencial}`,
            rightColX + 22, startY + 44
        );

    // Separador
    doc.moveTo(rightColX, startY + 57)
        .lineTo(rightColX + rightColW, startY + 57)
        .stroke();

    // Número de autorización
    doc.fontSize(A4.fontNormal).font('Helvetica-Bold')
        .text('NÚMERO DE AUTORIZACIÓN', rightColX + 5, startY + 61);
    doc.font('Helvetica')
        .text(
            String(infoTrib.claveAcceso).trim(),
            rightColX + 5, startY + 71,
            { width: rightColW - 68, lineBreak: true }
        );

    // Fecha y hora de autorización
    doc.font('Helvetica-Bold')
        .text('FECHA Y HORA DE AUTORIZACIÓN:', rightColX + 5, startY + 91);
    if (estadoFactura === 'AUTORIZADO' && fechaAuth) {
        doc.font('Helvetica').fillColor('black')
            .text(String(fechaAuth), rightColX + 5, startY + 101);
    } else {
        doc.font('Helvetica-Bold').fillColor('#cc0000')
            .text('PENDIENTE DE AUTORIZACIÓN', rightColX + 5, startY + 101);
    }
    doc.fillColor('black');

    // Ambiente y tipo emisión
    doc.fontSize(A4.fontNormal).font('Helvetica-Bold')
        .text('AMBIENTE:', rightColX + 5, startY + 114);
    doc.font('Helvetica')
        .text(getAmbiente(infoTrib.ambiente), rightColX + 52, startY + 114);

    doc.font('Helvetica-Bold').text('EMISIÓN:', rightColX + 5, startY + 124);
    doc.font('Helvetica').text('NORMAL', rightColX + 44, startY + 124);

    // QR — esquina superior derecha de la columna derecha
    try {
        const qrBuffer = await QRCode.toBuffer(
            getUrlConsulta(infoTrib.claveAcceso),
            { margin: 1, width: 65, errorCorrectionLevel: 'M' }
        );
        doc.image(qrBuffer, rightColX + rightColW - 68, startY + 57, { width: 64 });
    } catch (e) {
        console.warn('[RIDE] Error generando QR:', e.message);
    }

    // Código de barras lineal — clave de acceso
    doc.font('Helvetica-Bold').fontSize(A4.fontNormal)
        .text('CLAVE DE ACCESO:', rightColX + 5, startY + 135);
    try {
        const barcodeBuffer = await bwipjs.toBuffer({
            bcid:        'code128',
            text:        String(infoTrib.claveAcceso).trim(),
            scale:       1,
            height:      10,
            includetext: false,
        });
        doc.image(barcodeBuffer, rightColX + 5, startY + 145, {
            width:  rightColW - 10,
            height: 18,
        });
    } catch (e) {
        console.warn('[RIDE] Error generando código de barras:', e.message);
        doc.fontSize(5).font('Helvetica')
            .text(
                String(infoTrib.claveAcceso).trim(),
                rightColX + 5, startY + 145,
                { width: rightColW - 10 }
            );
    }

    // Clave en texto bajo el código de barras
    doc.fontSize(5).font('Helvetica')
        .text(
            String(infoTrib.claveAcceso).trim(),
            rightColX + 5, startY + 165,
            { width: rightColW - 10, align: 'center' }
        );

    return startY + cabeceraH + 8; // Y donde continúa el contenido
}

// ── BLOQUE DATOS COMPRADOR ─────────────────────────────────────────────────────
// Dibuja los datos del comprador/cliente.
// extraFilas: array de { label, valor } para filas adicionales según tipo de comprobante
// Retorna el Y donde termina el bloque.
function dibujarDatosComprador(doc, datos, extraFilas, currentY) {
    const { margin, pageWidth } = A4;

    // Calcular altura: 3 filas base + filas extra
    const filasBase = 3;
    const totalFilas = filasBase + (extraFilas ? extraFilas.length : 0);
    const blockH = totalFilas * 14 + 6;

    doc.rect(margin, currentY, pageWidth, blockH).stroke();

    // Fila 1 — Razón social
    doc.fontSize(A4.fontMedium).font('Helvetica-Bold')
        .text('Razón Social / Nombres y Apellidos:', margin + 5, currentY + 5);
    doc.font('Helvetica')
        .text(datos.razonSocial || '', margin + 178, currentY + 5, { width: 220 });

    // Fila 2 — Identificación + Fecha emisión
    let y2 = currentY + 18;
    doc.font('Helvetica-Bold').text('Identificación:', margin + 5, y2);
    doc.font('Helvetica').text(datos.identificacion || '', margin + 72, y2);
    doc.font('Helvetica-Bold').text('Fecha Emisión:', margin + 220, y2);
    doc.font('Helvetica').text(datos.fechaEmision || '', margin + 295, y2);

    // Fila 3 — Dirección (si aplica)
    if (datos.direccion) {
        let y3 = currentY + 31;
        doc.font('Helvetica-Bold').text('Dirección:', margin + 5, y3);
        doc.font('Helvetica').text(datos.direccion, margin + 55, y3, { width: 350 });
    }

    // Filas extra — específicas de cada comprobante
    if (extraFilas && extraFilas.length > 0) {
        let yExtra = currentY + (datos.direccion ? 44 : 31);
        extraFilas.forEach(fila => {
            doc.font('Helvetica-Bold').text(fila.label + ':', margin + 5, yExtra);
            doc.font('Helvetica').text(String(fila.valor || '-'), margin + fila.labelW + 5, yExtra, {
                width: pageWidth - fila.labelW - 15,
            });
            yExtra += 14;
        });
    }

    return currentY + blockH + 5;
}

// ── TABLA DE ÍTEMS ─────────────────────────────────────────────────────────────
// Dibuja la tabla de productos/servicios.
// Es igual para factura, NC, ND y liquidación de compra.
// Retorna el Y donde termina la tabla.
function dibujarItems(doc, detalles, currentY) {
    const { margin, pageWidth, headerH, colorGrisMedio, colorGrisClaro } = A4;
    const C = A4.cols;

    // Encabezado con fondo gris
    doc.rect(margin, currentY, pageWidth, headerH)
        .fillAndStroke(colorGrisMedio, colorGrisMedio);
    doc.fillColor('black').font('Helvetica-Bold').fontSize(A4.fontNormal);
    doc.text('Cód. Principal', C.cod.x,   currentY + 6, { width: C.cod.w });
    doc.text('Cant',           C.cant.x,  currentY + 6, { width: C.cant.w,  align: 'center' });
    doc.text('Descripción',    C.desc.x,  currentY + 6, { width: C.desc.w });
    doc.text('P. Unitario',    C.pu.x,    currentY + 6, { width: C.pu.w,    align: 'right' });
    doc.text('Descuento',      C.dsc.x,   currentY + 6, { width: C.dsc.w,   align: 'right' });
    doc.text('Precio Total',   C.total.x, currentY + 6, { width: C.total.w, align: 'right' });
    currentY += headerH;

    // Filas de ítems con altura dinámica según largo de descripción
    doc.font('Helvetica').fontSize(A4.fontNormal);
    toArray(detalles).forEach((item, i) => {
        const descH = doc.heightOfString(item.descripcion || '', { width: C.desc.w });
        const rowH  = Math.max(descH + 6, 16);

        // Filas alternadas gris/blanco
        const fillColor = i % 2 === 0 ? colorGrisClaro : 'white';
        doc.rect(margin, currentY, pageWidth, rowH)
            .fillAndStroke(fillColor, '#cccccc');
        doc.fillColor('black');

        // Código — prefiere codigoPrincipal, fallback a codigoInterno
        const codigo = item.codigoPrincipal || item.codigoInterno || '';
        doc.text(codigo !== 'S/C' ? codigo : '', C.cod.x, currentY + 3, { width: C.cod.w });

        doc.text(
            parseFloat(item.cantidad || 0).toFixed(4).replace(/\.?0+$/, '') || '0',
            C.cant.x, currentY + 3, { width: C.cant.w, align: 'center' }
        );
        doc.text(item.descripcion || '', C.desc.x, currentY + 3, { width: C.desc.w });
        doc.text(fmtNum(item.precioUnitario, 4), C.pu.x,    currentY + 3, { width: C.pu.w,    align: 'right' });
        doc.text(fmtNum(item.descuento),         C.dsc.x,   currentY + 3, { width: C.dsc.w,   align: 'right' });
        doc.text(fmtNum(item.precioTotalSinImpuesto), C.total.x, currentY + 3, { width: C.total.w, align: 'right' });

        // Detalles adicionales del ítem si existen
        const detsAdc = toArray(item.detallesAdicionales?.detAdicional);
        if (detsAdc.length > 0) {
            currentY += rowH;
            detsAdc.forEach(det => {
                const nombre = det['@_nombre'] || det['@nombre'] || '';
                const valor  = det['@_valor']  || det['@valor']  || '';
                doc.fontSize(6).fillColor('#666666')
                    .text(`  ${nombre}: ${valor}`, C.desc.x, currentY + 2, { width: C.desc.w + C.pu.w + C.dsc.w + C.total.w });
                doc.fillColor('black').fontSize(A4.fontNormal);
                currentY += 10;
            });
            return; // ya sumamos currentY
        }

        currentY += rowH;
    });

    return currentY;
}

// ── BLOQUE DE TOTALES ──────────────────────────────────────────────────────────
// Dibuja el bloque de totales en la columna derecha del pie.
// totalConImpuestos: array de totalImpuesto del XML
// resumenExtra: array de { label, valor } para filas adicionales (propina, etc.)
// labelTotal: texto del total final (ej: "VALOR TOTAL" o "VALOR DE MODIFICACIÓN")
// highlightTotal: si true, fondo gris oscuro en la fila del total
function dibujarTotales(doc, totalConImpuestos, resumen, labelTotal, currentY) {
    const { rightFtrX, rightFtrW, rowH, colorGrisMedio, colorGrisOscuro } = A4;
    const imp = calcularImpuestos(totalConImpuestos);

    const drawRow = (label, val, y, opts = {}) => {
        const { bold = false, highlight = false } = opts;
        const bgColor = highlight ? colorGrisOscuro : 'white';
        doc.rect(rightFtrX, y, rightFtrW, rowH).fillAndStroke(bgColor, '#cccccc');
        doc.fillColor('black');
        const labelW = rightFtrW - 62;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(A4.fontNormal)
            .text(label, rightFtrX + 4, y + 4, { width: labelW });
        doc.text(fmtNum(val), rightFtrX + labelW + 2, y + 4, { width: 56, align: 'right' });
        doc.fillColor('black');
    };

    // ← Solo mostrar si valor > 0
    const drawRowSiTiene = (label, val, y, opts = {}) => {
        if (!val || parseFloat(val) === 0) return y;
        drawRow(label, val, y, opts);
        return y + rowH;
    };

    let ty = currentY;

    // Subtotales por tarifa IVA
    Object.entries(imp.porTarifa)
        .sort(([a], [b]) => parseFloat(b) - parseFloat(a))
        .forEach(([tarifa, datos]) => {
            if (parseFloat(tarifa) > 0) {
                drawRow(`SUBTOTAL ${tarifa}%`, datos.base, ty);
            } else {
                drawRow('SUBTOTAL IVA 0%', datos.base, ty);
            }
            ty += rowH;
        });

    // Solo mostrar si tienen valor
    ty = drawRowSiTiene('SUBTOTAL NO OBJETO IVA', imp.noObjetoIVA,              ty);
    ty = drawRowSiTiene('SUBTOTAL EXENTO IVA',    imp.exentoIVA,                ty);
    
    // Siempre mostrar
    drawRow('SUBTOTAL SIN IMPUESTOS', resumen.totalSinImpuestos || 0, ty); ty += rowH;
    
    // Solo mostrar si tienen valor
    ty = drawRowSiTiene('DESCUENTO', resumen.totalDescuento || 0, ty);
    ty = drawRowSiTiene('ICE',       imp.totalICE            || 0, ty);

    // IVA por tarifa
    Object.entries(imp.porTarifa)
        .filter(([tarifa, datos]) => parseFloat(tarifa) > 0 && datos.valor > 0)
        .sort(([a], [b]) => parseFloat(b) - parseFloat(a))
        .forEach(([tarifa, datos]) => {
            drawRow(`IVA ${tarifa}%`, datos.valor, ty); ty += rowH;
        });

    ty = drawRowSiTiene('IRBPNR',  imp.totalIRBPNR || 0, ty);
    ty = drawRowSiTiene('PROPINA', resumen.propina  || 0, ty);

    // Total siempre destacado
    drawRow(labelTotal, resumen.importeTotal || 0, ty, { bold: true, highlight: true });
    ty += rowH;

    if (resumen.importeTotalSinSubsidio) {
        drawRow('VALOR TOTAL SIN SUBSIDIO', resumen.importeTotalSinSubsidio, ty, { bold: true, highlight: true });
        ty += rowH;
        ty = drawRowSiTiene('AHORRO POR SUBSIDIO', resumen.ahorroSubsidio || 0, ty);
    }

    return ty;
}

// ── INFORMACIÓN ADICIONAL ──────────────────────────────────────────────────────
// Dibuja la tabla de campos adicionales en la columna izquierda del pie.
// Filtra el campo "Proveedor" que es interno de Kipu — no se muestra al cliente.
// Retorna el Y donde termina el bloque.
function dibujarInfoAdicional(doc, camposAdicionales, currentY) {
    const { margin, leftFooterW, pageWidth } = A4;
    
    // Separar proveedor del resto
    const todos    = toArray(camposAdicionales).map(parsearCampoAdicional);
    const campos   = todos.filter(c => 
        c.nombre && 
        c.nombre.toUpperCase() !== 'PROVEEDOR_SISTEMA_INFORMATICO'
    );
    const proveedor = todos.find(c => 
        c.nombre?.toUpperCase() === 'PROVEEDOR_SISTEMA_INFORMATICO'
    );

    doc.fontSize(A4.fontMedium).font('Helvetica-Bold')
        .text('Información Adicional', margin, currentY - 13);

    if (campos.length > 0) {
        const boxH = campos.length * A4.rowH + 6;
        doc.rect(margin, currentY, leftFooterW, boxH).stroke();
        campos.forEach(campo => {
            doc.fontSize(A4.fontNormal).font('Helvetica-Bold')
                .text(String(campo.nombre), margin + 5, currentY + 4, { width: 88 });
            doc.font('Helvetica')
                .text(String(campo.valor), margin + 98, currentY + 4, { width: leftFooterW - 103 });
            currentY += A4.rowH;
        });
        currentY += 6;
    }

    // Proveedor al pie — separado y en gris
    if (proveedor) {
        doc.fontSize(6).font('Helvetica').fillColor('#888888')
            .text(
                `Proveedor Sistema Facturación Electrónica: ${proveedor.valor}`,
                margin, currentY + 4,
                { width: pageWidth, align: 'center' }
            );
        doc.fillColor('black');
        currentY += 12;
    }

    return currentY;
}

// ── FORMAS DE PAGO ─────────────────────────────────────────────────────────────
// Solo aplica para Factura y Liquidación de Compra.
// NC y ND no tienen formas de pago en el RIDE.
// Retorna el Y donde termina el bloque.
function dibujarFormasPago(doc, pagosArr, currentY) {
    const { margin, leftFooterW, rowH, headerH, colorGrisMedio } = A4;
    const pagos = toArray(pagosArr);
    if (pagos.length === 0) return currentY;

    doc.fontSize(A4.fontMedium).font('Helvetica-Bold')
        .text('Forma de Pago', margin, currentY + 4);
    currentY += 16;

    // Encabezado
    doc.rect(margin, currentY, leftFooterW, headerH)
        .fillAndStroke(colorGrisMedio, colorGrisMedio);
    doc.fillColor('black').fontSize(A4.fontNormal).font('Helvetica-Bold');
    doc.text('Forma de Pago', margin + 5,                currentY + 6, { width: leftFooterW - 72 });
    doc.text('Valor',         margin + leftFooterW - 65, currentY + 6, { width: 60, align: 'right' });
    currentY += headerH;

    // Filas
    pagos.forEach(pago => {
        doc.rect(margin, currentY, leftFooterW, rowH).stroke();
        const desc = FORMAS_PAGO[pago.formaPago] || pago.formaPago || '-';
        doc.fontSize(A4.fontNormal).font('Helvetica')
            .text(desc, margin + 5, currentY + 4, { width: leftFooterW - 72 });
        doc.text(fmtMoney(pago.total), margin + leftFooterW - 65, currentY + 4, { width: 60, align: 'right' });
        currentY += rowH;
    });

    return currentY + 4;
}

// ── HELPER PRIVADO — label + valor en dos líneas ───────────────────────────────
function _labelValor(doc, label, valor, x, y, width) {
    doc.fontSize(A4.fontNormal).font('Helvetica-Bold').text(label, x, y);
    const labelH = doc.heightOfString(label, { width });
    doc.font('Helvetica').text(valor || '-', x, y + labelH, { width });
}

// ── EXPORTS ────────────────────────────────────────────────────────────────────
module.exports = {
    A4,
    dibujarCabecera,
    dibujarDatosComprador,
    dibujarItems,
    dibujarTotales,
    dibujarInfoAdicional,
    dibujarFormasPago,
};