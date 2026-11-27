//index.js
const crypto = require('crypto');
const express = require('express');
const { create } = require('xmlbuilder2');
const { decrypt } = require('./utils/cryptoUtils');
const { signInvoiceXmlCustom, validarP12, leerP12 } = require('./services/signer');
const { generarPDFStream, streamToBuffer } = require('./services/ride');

const app = express();

// ─── Clave compartida con kipu-core1 (cabecera X-Signer-Key) ─────────────────
// El firmador solo debe atender al backend: sin clave, cualquier contenedor de
// la red interna podía pedirle firmas o PDFs. Se exige solo si SIGNER_API_KEY
// está definida, así se activa poniendo el mismo valor en el .env de los dos
// servicios. Va antes del parseo del body: no se leen 15 MB de quien no tiene clave.
const SIGNER_API_KEY = process.env.SIGNER_API_KEY || '';
if (SIGNER_API_KEY) {
    const esperada = Buffer.from(SIGNER_API_KEY);
    app.use('/api', (req, res, next) => {
        const recibida = Buffer.from(String(req.get('x-signer-key') || ''));
        if (recibida.length !== esperada.length || !crypto.timingSafeEqual(recibida, esperada)) {
            return res.status(401).json({ ok: false, error: 'No autorizado.' });
        }
        next();
    });
}

// Aumentamos el límite para recibir XMLs y Firmas pesadas
app.use(express.json({ limit: '15mb' })); 

// ─── ENDPOINT PRINCIPAL: FIRMA DE COMPROBANTES ──────────────────────────────

app.post('/api/firmar', async (req, res) => {
    let xmlString;
    try {
        const { xmlObj, emisor, p12Base64 } = req.body;
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
    //console.log(`[Firmar] tipoDoc=${tipoDoc} version=${xmlObj[tipoDoc]["@version"]}`);
}

        // 2. CONSTRUCCIÓN DEL STRING XML
        xmlString = create(xmlObj).end({ prettyPrint: false });

        // 3. PROCESAMIENTO DE FIRMA P12
        const password  = decrypt(emisor.p12_pass);
        const p12       = leerP12(Buffer.from(p12Base64, 'base64'), password);

        // 4. FIRMA DIGITAL (XAdES-BES)
        const xmlFirmado = signInvoiceXmlCustom(xmlString, p12);

        // El RIDE (PDF) no se arma aquí: Kipu lo pide aparte a /api/pdf cuando
        // hace falta. Armarlo en cada firma gastaba CPU en un PDF que nadie usaba.
        res.json({
            ok:        true,
            xmlFirmado: xmlFirmado
        });
    } catch (error) {
        console.error("[Microservicio Error]:", error.message);
        res.status(500).json({ ok: false, error: error.message });
    }
});

// ─── ENDPOINT PARA GENERAR RIDE (PDF) ───────────────────────────────────────
//
// Soporta dos modos:
//   - AUTORIZADO (default): RIDE oficial con fecha y número de autorización.
//   - PROVISIONAL: PDF desde el XML firmado, sin fecha de autorización.
//     El render del RIDE muestra "PENDIENTE DE AUTORIZACIÓN" en el campo
//     de autorización porque recibe estadoFactura='FIRMADO' y fechaAuth=null.
//
// Parámetros:
//   xmlAutorizado       — XML del comprobante (firmado o autorizado)
//   emisor              — { contribuyente_especial, marca_kipu?, ... }
//                         marca_kipu: true = plan gratis ("Facturado con Kipu"),
//                         false = Pro / Al Día (sin marca), ausente = como siempre
//   fechaAutorizacion   — string fecha/hora (null si provisional)
//   formato             — 'a4' | 't80' | 't58'
//   provisional         — true si el doc aún no está autorizado (optional, default false)

app.post('/api/pdf', async (req, res) => {
    try {
        const {
            xmlAutorizado,
            emisor,
            fechaAutorizacion,
            formato = 'a4',
            provisional = false,
        } = req.body;

        if (!xmlAutorizado || !emisor) {
            return res.status(400).json({ ok: false, error: "Faltan parámetros (xmlAutorizado, emisor)" });
        }

        // Si es provisional, el estado es FIRMADO y no hay fecha de autorización
        const estado    = provisional ? 'FIRMADO' : 'AUTORIZADO';
        const fechaAuth = provisional ? null      : (fechaAutorizacion || null);

        const pdfStream = await generarPDFStream(
            xmlAutorizado,
            emisor,
            estado,
            fechaAuth,
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
    console.log(`[Microservicio Firmador] Clave compartida (X-Signer-Key): ${SIGNER_API_KEY ? 'exigida' : 'NO configurada (SIGNER_API_KEY)'}`);
});