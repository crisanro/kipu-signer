const { SignedXml } = require('xml-crypto');
const crypto = require('crypto');
const forge = require('node-forge');

const DEBUG_SIGNER = process.env.DEBUG_SIGNER === 'true';

function _seleccionarCertDeFirma(p12) {
    const bags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
    let targetBag = bags.find(b => {
        if (!b.cert || b.cert.cA) return false;
        const ku = b.cert.getExtension('keyUsage');
        return ku && ku.digitalSignature === true && ku.nonRepudiation === true;
    });
    if (!targetBag) {
        targetBag = bags.find(b => {
            if (!b.cert || b.cert.cA) return false;
            const ku = b.cert.getExtension('keyUsage');
            return ku && ku.digitalSignature === true;
        });
    }
    if (!targetBag) targetBag = bags.find(b => b.cert && !b.cert.cA);
    if (!targetBag) throw new Error("[Signer] No se encontró certificado de firma digital en el P12.");

    const localKeyId = targetBag.attributes?.localKeyId ? targetBag.attributes.localKeyId[0] : null;
    return { cert: targetBag.cert, localKeyId };
}

function _seleccionarLlaveDeFirma(p12, localKeyIdCert) {
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
    if (keyBags.length === 0) throw new Error("[Signer] No se encontraron llaves privadas en el P12.");
    if (keyBags.length === 1) return keyBags[0].key;

    if (localKeyIdCert) {
        const certKeyIdHex = Buffer.from(localKeyIdCert).toString('hex');
        const matchById = keyBags.find(bag => {
            const keyId = bag.attributes?.localKeyId?.[0];
            if (!keyId) return false;
            return Buffer.from(keyId).toString('hex') === certKeyIdHex;
        });
        if (matchById) return matchById.key;
    }
    return keyBags[keyBags.length - 1].key;
}

function signInvoiceXmlCustom(xml, p12) {
    const { cert: certificate, localKeyId } = _seleccionarCertDeFirma(p12);
    const privateKey = _seleccionarLlaveDeFirma(p12, localKeyId);
    const keyPem = forge.pki.privateKeyToPem(privateKey);

    // 1. Quitar la cabecera XML
    const xmlSinHeader = xml.replace(/<\?xml.*?\?>/g, '').trim();

    // --- DATOS PARA XADES ---
    const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();
    const certHash = crypto.createHash('sha256').update(certDer, 'binary').digest('base64');
    const issuerName = certificate.issuer.attributes.map(attr => `${attr.shortName}=${attr.value}`).join(', ');
    const serialNumberDec = BigInt('0x' + certificate.serialNumber).toString();

    const signedPropsId = 'SignedProperties-' + crypto.randomBytes(4).toString('hex');

    // Bloque SignedProperties
    const signedPropertiesXml = `<xades:SignedProperties Id="${signedPropsId}" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><xades:SignedSignatureProperties><xades:SigningTime>${new Date().toISOString()}</xades:SigningTime><xades:SigningCertificate><xades:Cert><xades:CertDigest><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>${certHash}</ds:DigestValue></xades:CertDigest><xades:IssuerSerial><ds:X509IssuerName>${issuerName}</ds:X509IssuerName><ds:X509SerialNumber>${serialNumberDec}</ds:X509SerialNumber></xades:IssuerSerial></xades:Cert></xades:SigningCertificate></xades:SignedSignatureProperties><xades:SignedDataObjectProperties><xades:DataObjectFormat ObjectReference="#comprobante"><xades:Description>Comprobante de Facturacion</xades:Description><xades:MimeType>text/xml</xades:MimeType></xades:DataObjectFormat></xades:SignedDataObjectProperties></xades:SignedProperties>`;

    // 2. Envolver en <root>
    const rootXml = `<root>${xmlSinHeader}<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><Object>${signedPropertiesXml}</Object></Signature></root>`;

    const sig = new SignedXml();
    sig.signingKey = keyPem;
    sig.signatureAlgorithm = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
    sig.canonicalizationAlgorithm = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";

    // ✅ CORRECCIÓN: Argumentos posicionales separados por coma (Sin llaves {})
    // Referencia 1: La Factura
    sig.addReference(
        "//*[@*[local-name()='id']='comprobante']",
        ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"],
        "http://www.w3.org/2001/04/xmlenc#sha256",
        "#comprobante"
    );

    // ✅ Referencia 2: Propiedades XAdES
    sig.addReference(
        `//*[@*[local-name()='Id']='${signedPropsId}']`,
        ["http://www.w3.org/TR/2001/REC-xml-c14n-20010315"],
        "http://www.w3.org/2001/04/xmlenc#sha256",
        `#${signedPropsId}`
    );

    // 🔥 EL TRUCO MAGISTRAL PARA FORZAR EL ATRIBUTO "TYPE" 🔥
    const originalCreateReferences = sig.createReferences.bind(sig);
    sig.createReferences = function (params) {
        let references = originalCreateReferences(params);
        return references.replace(
            `URI="#${signedPropsId}">`,
            `URI="#${signedPropsId}" Type="http://uri.etsi.org/01903#SignedProperties">`
        );
    };

    // 3. COMPUTAR FIRMA
    sig.computeSignature(rootXml);
    let signedRootXml = sig.getSignedXml();

    // 4. ENSAMBLAJE FINAL
    const signatureBlockMatch = signedRootXml.match(/<(\w+:)?Signature[\s\S]*?<\/\1Signature>/g);
    let signatureBlock = signatureBlockMatch[signatureBlockMatch.length - 1];

    const prefix = (signatureBlock.match(/<(\w+:)?Signature /) || [])[1] || '';
    const modulus = Buffer.from(privateKey.n.toString(16), 'hex').toString('base64');
    const exponent = Buffer.from(privateKey.e.toString(16), 'hex').toString('base64');

    const mainPem = forge.pki.certificateToPem(certificate).replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/[\r\n]/g, '');
    const x509CertsXml = `<${prefix}X509Certificate>${mainPem}</${prefix}X509Certificate>`;

    const keyInfoXml = `<${prefix}KeyInfo><${prefix}X509Data>${x509CertsXml}</${prefix}X509Data><${prefix}KeyValue><${prefix}RSAKeyValue><${prefix}Modulus>${modulus}</${prefix}Modulus><${prefix}Exponent>${exponent}</${prefix}Exponent></${prefix}RSAKeyValue></${prefix}KeyValue></${prefix}KeyInfo>`;

    signatureBlock = signatureBlock.replace(
        new RegExp(`</(${prefix})?SignatureValue>`),
        `</${prefix}SignatureValue>${keyInfoXml}`
    );
    signatureBlock = signatureBlock.replace(/<(\w+:)?Signature /, `<$1Signature Id="Signature" `);

    const finalObject = `<${prefix}Object><xades:QualifyingProperties Target="#Signature" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#">${signedPropertiesXml}</xades:QualifyingProperties></${prefix}Object>`;
    signatureBlock = signatureBlock.replace(
        new RegExp(`</(${prefix})?Signature>`),
        `${finalObject}</${prefix}Signature>`
    );

    return `<?xml version="1.0" encoding="UTF-8"?>\n${xmlSinHeader.replace('</factura>', `${signatureBlock}</factura>`)}`;
}

function validarP12(p12Buffer, password, rucEmisor) {
    try {
        const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
        const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);
        const { cert } = _seleccionarCertDeFirma(p12);

        let rucDetectado = '';
        const OIDS_RUC = ['1.3.6.1.4.1.37947.3.11', '1.3.6.1.4.1.37746.3.11'];
        for (const oid of OIDS_RUC) {
            const ext = cert.getExtension({ id: oid });
            if (ext) {
                const match = JSON.stringify(forge.asn1.fromDer(ext.value)).match(/\d{13}/);
                if (match) { rucDetectado = match[0]; break; }
            }
        }

        if (!rucDetectado) {
            const match = cert.subject.attributes.find(a => a.name === 'serialNumber' || a.shortName === 'SN')?.value.match(/\d{13}/);
            rucDetectado = match ? match[0] : '';
        }

        if (!rucDetectado) return { ok: false, mensaje: "No se pudo extraer RUC." };
        if (rucEmisor && rucDetectado !== rucEmisor) return { ok: false, mensaje: "RUC no coincide." };

        return {
            ok: true,
            datos: { ruc: rucDetectado, vence: cert.validity.notAfter }
        };
    } catch (e) {
        return { ok: false, mensaje: "P12 Inválido o contraseña incorrecta." };
    }
}

module.exports = { signInvoiceXmlCustom, validarP12 };