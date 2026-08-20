//index.js
const express = require('express');
const { create } = require('xmlbuilder2');
const forge = require('node-forge');
const { decrypt } = require('./utils/cryptoUtils');
const { signInvoiceXmlCustom, validarP12 } = require('./services/signer');
const { generarPDFStream, streamToBuffer } = require('./services/ride');

const app = express();

// Aumentamos el límite para recibir XMLs y Firmas pesadas
app.use(express.json({ limit: '15mb' })); 

// ─── ENDPOINT PRINCIPAL: FIRMA DE COMPROBANTES ──────────────────────────────

app.post('/api/firmar', async (req, res) => {
    let xmlString;
    try {
        const { xmlObj, emisor, p12Base64, formato = 'a4' } = req.body;
        if (!xmlObj || !emisor || !p12Base64) {
            return res.status(400).json({ ok: false, error: "Faltan parámetros requeridos" });
        }

        // 1. NORMALIZACIÓN DEL OBJETO XML
        const tiposDoc = ["factura", "liquidacionCompra", "notaCredito", "notaDebito", "comprobanteRetencion"];
        const tipoDoc  = tiposDoc.find(t => xmlObj[t]);
if (tipoDoc) {
    delete xmlObj[tipoDoc]["@id"];
    delete xmlObj[tipoDoc]["@Id"];
    delete xmlObj[tipoDoc]["id"];
    delete xmlObj[tipoDoc]["Id"];
    xmlObj[tipoDoc]["@id"] = "comprobante";
    if (!xmlObj[tipoDoc]["@version"]) {
        xmlObj[tipoDoc]["@version"] = "1.1.0";
    }
    console.log(`[Firmar] tipoDoc=${tipoDoc} version=${xmlObj[tipoDoc]["@version"]}`);
}

        // 2. CONSTRUCCIÓN DEL STRING XML
        xmlString = create(xmlObj).end({ prettyPrint: false });

        // 3. PROCESAMIENTO DE FIRMA P12
        const password  = decrypt(emisor.p12_pass);
        const p12Buffer = Buffer.from(p12Base64, 'base64');
        const p12Asn1   = forge.asn1.fromDer(p12Buffer.toString('binary'));
        const p12       = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

        // 4. FIRMA DIGITAL (XAdES-BES)
        const xmlFirmado = signInvoiceXmlCustom(xmlString, p12);

        // 5. GENERACIÓN DE RIDE (PDF)
        const pdfStream = await generarPDFStream(xmlFirmado, emisor, 'FIRMADO', null, formato);
        const pdfBuffer = await streamToBuffer(pdfStream);

        res.json({
            ok:        true,
            xmlFirmado: xmlFirmado,
            pdfBase64:  pdfBuffer.toString('base64')
        });
    } catch (error) {
        console.error("[Microservicio Error]:", error.message);
        res.status(500).json({
            ok:       false,
            error:    error.message,
            debugXml: xmlString ? xmlString.substring(0, 500) : "XML no generado"
        });
    }
});

// ─── ENDPOINT PARA REGENERAR RIDE (PDF AUTORIZADO) ──────────────────────────

app.post('/api/pdf', async (req, res) => {
    try {
        const { xmlAutorizado, emisor, fechaAutorizacion, formato = 'a4' } = req.body;

        if (!xmlAutorizado || !emisor) {
            return res.status(400).json({ ok: false, error: "Faltan parámetros (xmlAutorizado, emisor)" });
        }

        const pdfStream = await generarPDFStream(
            xmlAutorizado,
            emisor,
            'AUTORIZADO',
            fechaAutorizacion,
            formato
        );
        const pdfBuffer = await streamToBuffer(pdfStream);

        res.json({
            ok: true,
            pdfBase64: pdfBuffer.toString('base64')
        });

    } catch (error) {
        console.error("[Microservicio Error PDF]:", error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ─── ENDPOINT VALIDACIÓN DE FIRMA ───────────────────────────────────────────

app.post('/api/validar-p12', (req, res) => {
    try {
        const { p12Base64, password, ruc } = req.body;
        const buffer = Buffer.from(p12Base64, 'base64');
        const val = validarP12(buffer, password, ruc);
        res.json(val);
    } catch(e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[Microservicio Firmador] Corriendo en puerto ${PORT} 🚀`);
});