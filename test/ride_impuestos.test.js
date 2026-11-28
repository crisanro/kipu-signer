// Subtotales de impuestos del RIDE según la Tabla 17 de la ficha técnica del SRI.
// Correr con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');

const { calcularImpuestos, tarifasVisibles, lineasDireccion } = require('../services/ride/helpers');
const { generarPDFStream, streamToBuffer } = require('../services/ride');

const iva = (codigoPorcentaje, baseImponible, valor = 0, extra = {}) =>
    ({ codigo: '2', codigoPorcentaje, baseImponible, valor, ...extra });

test('cada codigoPorcentaje cae en su tarifa (Tabla 17)', () => {
    const imp = calcularImpuestos([
        iva('0', 1), iva('2', 2, 0.24), iva('3', 3, 0.42), iva('4', 4, 0.6),
        iva('5', 5, 0.25), iva('8', 8, 0.64), iva('10', 10, 1.3),
    ]);
    assert.deepEqual(
        Object.fromEntries(Object.entries(imp.porTarifa).map(([t, v]) => [t, v.base])),
        { '0': 1, '12': 2, '14': 3, '15': 4, '5': 5, '8': 8, '13': 10 },
    );
    assert.equal(imp.base0, 1);
    assert.equal(imp.baseIVA, 32);
    assert.equal(imp.totalIVA.toFixed(2), '3.45');
});

test('no objeto y exento van aparte, no en el subtotal 0%', () => {
    const imp = calcularImpuestos([iva('0', 4), iva('6', 3), iva('7', 2), iva('4', 20, 3)]);
    assert.equal(imp.porTarifa['0'].base, 4);
    assert.equal(imp.base0, 4);
    assert.equal(imp.noObjetoIVA, 3);
    assert.equal(imp.exentoIVA, 2);
    assert.equal(Object.keys(imp.porTarifa).length, 2);
});

test('la tarifa del XML manda y "15.00" es la misma clave que "15"', () => {
    const imp = calcularImpuestos([iva('4', 10, 1.5, { tarifa: '15.00' }), iva('4', 5, 0.75)]);
    assert.deepEqual(Object.keys(imp.porTarifa), ['15']);
    assert.equal(imp.porTarifa['15'].base, 15);
});

test('ICE e IRBPNR no se mezclan con el IVA', () => {
    const imp = calcularImpuestos([
        { codigo: '3', codigoPorcentaje: '3011', baseImponible: 10, valor: 1.5 },
        { codigo: '5', codigoPorcentaje: '5001', baseImponible: 2, valor: 0.04 },
    ]);
    assert.equal(imp.totalICE, 1.5);
    assert.equal(imp.totalIRBPNR, 0.04);
    assert.deepEqual(imp.porTarifa, {});
});

test('tarifas visibles: 15 y 5 siempre, las otras que vengan, de mayor a menor', () => {
    assert.deepEqual(tarifasVisibles(calcularImpuestos([iva('0', 1)])), ['15', '5']);
    assert.deepEqual(
        tarifasVisibles(calcularImpuestos([iva('8', 1), iva('2', 1), iva('10', 1), iva('4', 1)])),
        ['15', '13', '12', '8', '5'],
    );
});

test('direcciones: matriz y sucursal solo si es otra', () => {
    assert.deepEqual(
        lineasDireccion({ dirMatriz: 'AV. AMAZONAS' }, { dirEstablecimiento: 'LOCAL 5' }),
        ['Matriz: AV. AMAZONAS', 'Sucursal: LOCAL 5'],
    );
    assert.deepEqual(
        lineasDireccion({ dirMatriz: 'AV. AMAZONAS' }, { dirEstablecimiento: ' AV. AMAZONAS ' }),
        ['Matriz: AV. AMAZONAS'],
    );
    assert.deepEqual(lineasDireccion({}, {}), []);
});

const FACTURA = `<?xml version="1.0"?><factura version="1.1.0" id="comprobante">
<infoTributaria><ambiente>1</ambiente><tipoEmision>1</tipoEmision><razonSocial>EMPRESA DE PRUEBA S.A.</razonSocial>
<ruc>1799999999001</ruc><claveAcceso>2611202601179999999900110010020000001231234567811</claveAcceso><codDoc>01</codDoc>
<estab>001</estab><ptoEmi>002</ptoEmi><secuencial>000000123</secuencial><dirMatriz>AV. AMAZONAS</dirMatriz></infoTributaria>
<infoFactura><fechaEmision>26/11/2026</fechaEmision><dirEstablecimiento>LOCAL 5</dirEstablecimiento><obligadoContabilidad>SI</obligadoContabilidad>
<tipoIdentificacionComprador>04</tipoIdentificacionComprador><razonSocialComprador>CLIENTE</razonSocialComprador>
<identificacionComprador>0999999999001</identificacionComprador><direccionComprador>GUAYAQUIL</direccionComprador>
<totalSinImpuestos>27.00</totalSinImpuestos><totalDescuento>0.00</totalDescuento><totalConImpuestos>
<totalImpuesto><codigo>2</codigo><codigoPorcentaje>4</codigoPorcentaje><baseImponible>10.00</baseImponible><valor>1.50</valor></totalImpuesto>
<totalImpuesto><codigo>2</codigo><codigoPorcentaje>10</codigoPorcentaje><baseImponible>10.00</baseImponible><valor>1.30</valor></totalImpuesto>
<totalImpuesto><codigo>2</codigo><codigoPorcentaje>0</codigoPorcentaje><baseImponible>4.00</baseImponible><valor>0.00</valor></totalImpuesto>
<totalImpuesto><codigo>2</codigo><codigoPorcentaje>6</codigoPorcentaje><baseImponible>3.00</baseImponible><valor>0.00</valor></totalImpuesto>
</totalConImpuestos><propina>0.00</propina><importeTotal>29.80</importeTotal><moneda>DOLAR</moneda>
<pagos><pago><formaPago>20</formaPago><total>29.80</total></pago></pagos></infoFactura>
<detalles><detalle><codigoPrincipal>P1</codigoPrincipal><descripcion>PRODUCTO</descripcion><cantidad>1</cantidad>
<precioUnitario>10.00</precioUnitario><descuento>0.00</descuento><precioTotalSinImpuesto>10.00</precioTotalSinImpuesto>
<impuestos><impuesto><codigo>2</codigo><codigoPorcentaje>4</codigoPorcentaje><tarifa>15</tarifa><baseImponible>10.00</baseImponible><valor>1.50</valor></impuesto></impuestos>
</detalle></detalles></factura>`;

for (const formato of ['a4', 't80', 't58']) {
    test(`la factura con varias tarifas genera el PDF en ${formato}`, async () => {
        const stream = await generarPDFStream(FACTURA, { contribuyente_especial: null }, 'AUTORIZADO', '26/11/2026 10:00:00', formato);
        const pdf = await streamToBuffer(stream);
        assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
    });
}
