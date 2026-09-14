// services/ride/comprobantes/retencion.js
'use strict';
const PDFDocument = require('pdfkit');
const { PassThrough } = require('stream');
const { toArray, fmtNum, DOCS_SUSTENTO } = require('../helpers');

// ── Catálogos ATS para el RIDE ───────────────────────────────────────────────
const TIPOS_RETENCION = {
    '1': 'Renta',
    '2': 'IVA',
    '6': 'ISD',
};

async function renderRetencion(comprobante, emisor, estadoFactura, fechaAuth, formato) {
    const infoTrib = comprobante.infoTributaria;
    const infoRet  = comprobante.infoCompRetencion;
    const infoAdc  = toArray(comprobante.infoAdicional?.campoAdicional);

    // ── Detectar versión: v2.0.0 tiene docsSustento, v1.0.0 tiene impuestos ──
    const esV2        = !!comprobante.docsSustento;
    const docSustento = esV2 ? (comprobante.docsSustento?.docSustento || {}) : null;

    // Extraer retenciones según versión
    let retenciones;
    if (esV2) {
        retenciones = toArray(docSustento?.retenciones?.retencion);
    } else {
        retenciones = toArray(comprobante.impuestos?.impuesto);
    }

    const docOpts = _getPdfOpts(formato);
    const doc     = new PDFDocument(docOpts);
    const stream  = new PassThrough();
    doc.pipe(stream);

    // 1. Cabecera
    let y = await formato.dibujarCabecera(
        doc, infoTrib,
        'C O M P R O B A N T E   D E   R E T E N C I Ó N',
        {
            dirEstablecimiento:    infoRet.dirEstablecimiento,
            obligadoContabilidad:  infoRet.obligadoContabilidad,
            contribuyenteEspecial: infoRet.contribuyenteEspecial,
        },
        estadoFactura, fechaAuth, emisor
    );

    // 2. Datos del sujeto retenido
    const extraFilas = [
        { label: 'Período Fiscal', valor: infoRet.periodoFiscal || '-', labelW: 75 },
    ];

    y = formato.dibujarDatosComprador(
        doc,
        {
            razonSocial:    infoRet.razonSocialSujetoRetenido,
            identificacion: infoRet.identificacionSujetoRetenido,
            fechaEmision:   infoRet.fechaEmision,
            direccion:      null,
        },
        extraFilas,
        y
    );

    // 3. Datos del documento sustento (solo v2)
    if (esV2 && docSustento) {
        y = _dibujarDocSustento(doc, docSustento, y, formato);
    }

    // 4. Tabla de retenciones
    y = _dibujarRetenciones(doc, retenciones, esV2, y, formato);

    // 5. Total retenido
    const yPie     = _yPie(formato, y);
    const totalRet = retenciones.reduce((s, i) => {
        return s + parseFloat(i.valorRetenido || i.valor || 0);
    }, 0);

    const yPostInfo = formato.dibujarInfoAdicional(doc, infoAdc, yPie);
    _dibujarTotalRetencion(doc, totalRet, yPostInfo, formato);

    if (formato.dibujarPieFinal) {
        formato.dibujarPieFinal(doc, yPostInfo + 30);
    }

    doc.end();
    return stream;
}

// ── Bloque datos documento sustento (v2.0.0) ─────────────────────────────────
function _dibujarDocSustento(doc, docSust, yActual, formato) {
    const isTermico = formato.T80 || formato.T58;
    const dims      = formato.A4 || formato.T80 || formato.T58;
    const x         = dims?.margin || 30;
    const ancho     = dims ? (dims.pageWidth || 595) - 2 * (dims.margin || 30) : 535;
    const fontSize  = isTermico ? 6.5 : 7.5;
    const rowH      = isTermico ? 10 : 12;

    let y = yActual + (isTermico ? 4 : 8);

    // Título
    doc.fontSize(isTermico ? 7 : 8).font('Helvetica-Bold').fillColor('#000000')
        .text('Documento Sustento', x, y);
    y += rowH + 2;

    // Separador
    doc.moveTo(x, y).lineTo(x + ancho, y).strokeColor('#cccccc').lineWidth(0.5).stroke();
    y += 3;

    doc.fontSize(fontSize).font('Helvetica').fillColor('#000000');

    // Tipo y número
    const tipoDoc = DOCS_SUSTENTO[docSust.codDocSustento] || docSust.codDocSustento || '-';
    const numDoc  = docSust.numDocSustento
        ? `${docSust.numDocSustento.substring(0,3)}-${docSust.numDocSustento.substring(3,6)}-${docSust.numDocSustento.substring(6)}`
        : '-';

    doc.font('Helvetica-Bold').text('Tipo:', x, y);
    doc.font('Helvetica').text(`${docSust.codDocSustento} - ${tipoDoc}`, x + 50, y);
    y += rowH;

    doc.font('Helvetica-Bold').text('Número:', x, y);
    doc.font('Helvetica').text(numDoc, x + 50, y);

    if (!isTermico) {
        doc.font('Helvetica-Bold').text('Fecha Emisión:', x + 220, y);
        doc.font('Helvetica').text(docSust.fechaEmisionDocSustento || '-', x + 295, y);
    } else {
        y += rowH;
        doc.font('Helvetica-Bold').text('Fecha:', x, y);
        doc.font('Helvetica').text(docSust.fechaEmisionDocSustento || '-', x + 50, y);
    }
    y += rowH;

    // Autorización
    if (docSust.numAutDocSustento) {
        doc.font('Helvetica-Bold').text('Autorización:', x, y);
        doc.font('Helvetica').fontSize(isTermico ? 5 : 6)
            .text(docSust.numAutDocSustento, x + 60, y, { width: ancho - 65 });
        doc.fontSize(fontSize);
        y += rowH + (isTermico ? 2 : 4);
    }

    // Totales
    doc.font('Helvetica-Bold').text('Total sin impuestos:', x, y);
    doc.font('Helvetica').text(`$${fmtNum(docSust.totalSinImpuestos)}`, x + (isTermico ? 90 : 100), y);

    if (!isTermico) {
        doc.font('Helvetica-Bold').text('Importe total:', x + 220, y);
        doc.font('Helvetica').text(`$${fmtNum(docSust.importeTotal)}`, x + 295, y);
    } else {
        y += rowH;
        doc.font('Helvetica-Bold').text('Importe total:', x, y);
        doc.font('Helvetica').text(`$${fmtNum(docSust.importeTotal)}`, x + 90, y);
    }
    y += rowH;

    // Impuestos del doc sustento
    const impDocSust = toArray(docSust.impuestosDocSustento?.impuestoDocSustento);
    if (impDocSust.length > 0) {
        y += 2;
        doc.font('Helvetica-Bold').text('Impuestos del sustento:', x, y);
        y += rowH;

        impDocSust.forEach(imp => {
            const codImp = imp.codImpuestoDocSustento || '2';
            const tipoImp = codImp === '2' ? 'IVA' : codImp === '3' ? 'ICE' : codImp;
            doc.font('Helvetica')
                .text(
                    `  ${tipoImp} ${imp.tarifa || '0'}%: Base $${fmtNum(imp.baseImponible)} = $${fmtNum(imp.valorImpuesto)}`,
                    x, y, { width: ancho }
                );
            y += rowH;
        });
    }

    // Separador final
    y += 2;
    doc.moveTo(x, y).lineTo(x + ancho, y).strokeColor('#cccccc').lineWidth(0.5).stroke();

    return y + (isTermico ? 4 : 6);
}

// ── Tabla de retenciones ─────────────────────────────────────────────────────
function _dibujarRetenciones(doc, retenciones, esV2, yActual, formato) {
    if (!retenciones.length) return yActual;

    const isTermico = formato.T80 || formato.T58;
    const dims      = formato.A4 || formato.T80 || formato.T58;
    const x         = dims?.margin || 30;
    const ancho     = dims ? (dims.pageWidth || 595) - 2 * (dims.margin || 30) : 535;
    const rowH      = dims?.rowH || 14;
    const fontSize  = isTermico ? 6.5 : 7.5;

    let y = yActual + (isTermico ? 4 : 10);

    // Encabezados — v2 no necesita doc sustento en cada fila (ya se mostró arriba)
    const cols = isTermico
        ? (esV2
            ? [
                { label: 'Tipo',      w: ancho * 0.15, align: 'left'  },
                { label: 'Cód.',      w: ancho * 0.15, align: 'left'  },
                { label: 'Base Imp.', w: ancho * 0.30, align: 'right' },
                { label: '%',         w: ancho * 0.15, align: 'right' },
                { label: 'Valor',     w: ancho * 0.25, align: 'right' },
              ]
            : [
                { label: 'Cód.',       w: ancho * 0.10, align: 'left'  },
                { label: 'Doc. Sust.', w: ancho * 0.20, align: 'left'  },
                { label: 'Núm. Doc.',  w: ancho * 0.25, align: 'left'  },
                { label: 'Base Imp.',  w: ancho * 0.22, align: 'right' },
                { label: '%',          w: ancho * 0.10, align: 'right' },
                { label: 'Valor',      w: ancho * 0.13, align: 'right' },
              ])
        : (esV2
            ? [
                { label: 'Tipo Impuesto',   w: ancho * 0.15, align: 'left'  },
                { label: 'Cód. Retención',  w: ancho * 0.15, align: 'left'  },
                { label: 'Base Imponible',  w: ancho * 0.25, align: 'right' },
                { label: '% Retener',       w: ancho * 0.15, align: 'right' },
                { label: 'Valor Retenido',  w: ancho * 0.30, align: 'right' },
              ]
            : [
                { label: 'Cód. Retención', w: ancho * 0.12, align: 'left'  },
                { label: 'Doc. Sustento',  w: ancho * 0.18, align: 'left'  },
                { label: 'Núm. Comprobante Sustento', w: ancho * 0.25, align: 'left'  },
                { label: 'Fecha Emisión Sustento',    w: ancho * 0.15, align: 'left'  },
                { label: 'Base Imponible', w: ancho * 0.13, align: 'right' },
                { label: '% Ret.',         w: ancho * 0.07, align: 'right' },
                { label: 'Valor Ret.',     w: ancho * 0.10, align: 'right' },
              ]);

    doc.fontSize(fontSize).fillColor('#555555');
    let xCol = x;
    cols.forEach(col => {
        doc.text(col.label, xCol, y, { width: col.w, align: col.align });
        xCol += col.w;
    });
    y += rowH;

    doc.moveTo(x, y).lineTo(x + ancho, y).strokeColor('#cccccc').lineWidth(0.5).stroke();
    y += 2;

    // Filas
    doc.fillColor('#000000');
    retenciones.forEach(imp => {
        xCol = x;
        let fila;

        if (esV2) {
            // v2.0.0 — retenciones dentro de docSustento
            const tipoImp = TIPOS_RETENCION[imp.codigo] || imp.codigo || '-';
            fila = isTermico
                ? [
                    { val: tipoImp,                                                    w: cols[0].w, align: 'left'  },
                    { val: imp.codigoRetencion || '-',                                 w: cols[1].w, align: 'left'  },
                    { val: `$${fmtNum(imp.baseImponible)}`,                            w: cols[2].w, align: 'right' },
                    { val: `${imp.porcentajeRetener || 0}%`,                           w: cols[3].w, align: 'right' },
                    { val: `$${fmtNum(imp.valorRetenido)}`,                            w: cols[4].w, align: 'right' },
                  ]
                : [
                    { val: tipoImp,                                                    w: cols[0].w, align: 'left'  },
                    { val: imp.codigoRetencion || '-',                                 w: cols[1].w, align: 'left'  },
                    { val: `$${fmtNum(imp.baseImponible)}`,                            w: cols[2].w, align: 'right' },
                    { val: `${imp.porcentajeRetener || 0}%`,                           w: cols[3].w, align: 'right' },
                    { val: `$${fmtNum(imp.valorRetenido)}`,                            w: cols[4].w, align: 'right' },
                  ];
        } else {
            // v1.0.0 — impuestos con doc sustento en cada fila
            fila = isTermico
                ? [
                    { val: imp.codigoPorcentaje || '-',                                w: cols[0].w, align: 'left'  },
                    { val: imp.codDocSustento   || '-',                                w: cols[1].w, align: 'left'  },
                    { val: imp.numDocSustento   || '-',                                w: cols[2].w, align: 'left'  },
                    { val: `$${fmtNum(imp.baseImponible)}`,                            w: cols[3].w, align: 'right' },
                    { val: `${imp.tarifa || 0}%`,                                      w: cols[4].w, align: 'right' },
                    { val: `$${fmtNum(imp.valor)}`,                                    w: cols[5].w, align: 'right' },
                  ]
                : [
                    { val: imp.codigoPorcentaje        || '-',                         w: cols[0].w, align: 'left'  },
                    { val: imp.codDocSustento           || '-',                        w: cols[1].w, align: 'left'  },
                    { val: imp.numDocSustento           || '-',                        w: cols[2].w, align: 'left'  },
                    { val: imp.fechaEmisionDocSustento  || '-',                        w: cols[3].w, align: 'left'  },
                    { val: `$${fmtNum(imp.baseImponible)}`,                            w: cols[4].w, align: 'right' },
                    { val: `${imp.tarifa || 0}%`,                                      w: cols[5].w, align: 'right' },
                    { val: `$${fmtNum(imp.valor)}`,                                    w: cols[6].w, align: 'right' },
                  ];
        }

        fila.forEach(cel => {
            doc.fontSize(fontSize).text(cel.val, xCol, y, { width: cel.w, align: cel.align });
            xCol += cel.w;
        });
        y += rowH;
    });

    return y + (isTermico ? 4 : 10);
}

function _dibujarTotalRetencion(doc, totalRet, yPie, formato) {
    const isTermico = formato.T80 || formato.T58;
    const dims      = formato.A4 || formato.T80 || formato.T58;
    const x         = dims?.margin || 30;
    const ancho     = dims ? (dims.pageWidth || 595) - 2 * (dims.margin || 30) : 535;
    const fontSize  = isTermico ? 8 : 9;

    const yTot = isTermico ? yPie + 4 : yPie + 10;
    doc.fontSize(fontSize).fillColor('#000000');
    doc.text('TOTAL RETENIDO:', x, yTot, { width: ancho * 0.7 });
    doc.text(
        `$${totalRet.toFixed(2)}`,
        x + ancho * 0.7, yTot,
        { width: ancho * 0.3, align: 'right' }
    );
}

function _getPdfOpts(formato) {
    const dims = formato.A4 || formato.T80 || formato.T58;
    if (!dims) return { size: 'A4', margin: 30 };
    if (formato.T80 || formato.T58) {
        return { size: [dims.pageWidth, 2000], margin: dims.margin, autoFirstPage: true };
    }
    return { size: 'A4', margin: 30 };
}

function _yPie(formato, yActual) {
    if (formato.A4) return yActual + 15;
    return yActual + 8;
}

module.exports = { renderRetencion };