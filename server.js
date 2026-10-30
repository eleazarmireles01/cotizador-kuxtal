const express = require('express');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.get('/config', (req, res) => {
  res.sendFile(path.join(__dirname, 'config', 'precios.json'));
});

const money = (n) =>
  '$ ' + new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function dataUri(file) {
  const ext = path.extname(file).slice(1);
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(path.join(__dirname, 'assets', file)).toString('base64')}`;
}

function bloqueHospedaje(d, config) {
  const tieneDobleSencilla = d.paxDoble > 0 || d.paxSencilla > 0;
  const tieneTriple = d.paxTriple > 0;
  const tieneDobleSinAlimentos = d.habitacionesDobleSinAlimentos > 0;
  if (!tieneDobleSencilla && !tieneTriple && !tieneDobleSinAlimentos) return ''; // evento de puro día: sin sección de hospedaje

  let filas = '';

  if (tieneDobleSencilla) {
    filas += `
      <tr>
        <td class="hdr col-concepto">HOSPEDAJE</td>
        <td class="hdr-blanco col-a">HAB SENCILLA</td>
        <td class="hdr-blanco col-b">HAB DOBLE</td>
        <td class="col-c"></td>
      </tr>
      <tr>
        <td class="gris-centro">COSTO POR PERSONA, POR NOCHE</td>
        <td class="col-a">${money(config.hospedaje.sencilla.precio)}</td>
        <td class="col-b">${money(config.hospedaje.doble.precio)}</td>
        <td class="col-c"></td>
      </tr>
      <tr>
        <td></td>
        <td class="col-a">${d.paxSencilla > 0 ? esc(d.paxSencilla) : ''}</td>
        <td class="col-b">${d.paxDoble > 0 ? esc(d.paxDoble) : ''}</td>
        <td class="col-c"></td>
      </tr>
      <tr>
        <td class="chico">INCLUYE 3 ALIMENTOS POR NOCHE PAGADA, POR PERSONA</td>
        <td class="col-a">${d.paxSencilla > 0 ? money(d.hospedaje.subSencilla) : '$ -'}</td>
        <td class="col-b">${d.paxDoble > 0 ? money(d.hospedaje.subDoble) : '$ -'}</td>
        <td class="col-c">$ -</td>
      </tr>`;
  } else {
    filas += `
      <tr>
        <td class="hdr" colspan="4">HOSPEDAJE</td>
      </tr>`;
  }

  if (tieneTriple) {
    filas += `
      <tr>
        <td>HOSPEDAJE TRIPLE<br /><span class="chico">${esc(d.paxTriple)} pax × ${esc(d.noches)} noche(s) × ${money(config.hospedaje.triple.precio)} · incluye alimentos</span></td>
        <td class="col-a">${money(d.hospedaje.subTriple)}</td>
        <td class="col-b"></td>
        <td class="col-c"></td>
      </tr>`;
  }

  if (tieneDobleSinAlimentos) {
    filas += `
      <tr>
        <td>HOSPEDAJE DOBLE (SIN ALIMENTOS)<br /><span class="chico">${esc(d.habitacionesDobleSinAlimentos)} habitación(es), ${esc(d.paxDobleSinAlimentos)} pax × ${esc(d.noches)} noche(s) × ${money(config.hospedaje.doble_sin_alimentos.precio)}/habitación</span></td>
        <td class="col-a">${money(d.hospedaje.subDobleSinAlimentos)}</td>
        <td class="col-b"></td>
        <td class="col-c"></td>
      </tr>`;
  }

  filas += `
      <tr>
        <td class="banda">TOTAL HOSPEDAJE</td>
        <td class="banda-val" colspan="3">${money(d.hospedaje.total)}</td>
      </tr>`;

  return filas;
}

function bloqueDescuento(totales) {
  if (!totales.descuento || totales.descuento <= 0) return '';
  const etiqueta =
    totales.descuentoModo === 'porcentaje'
      ? `DESCUENTO (${esc(totales.descuentoPct)}% SOBRE SERVICIOS CASA KUXTAL)`
      : 'DESCUENTO (MONTO FIJO SOBRE SERVICIOS CASA KUXTAL)';
  const motivo = totales.descuentoMotivo
    ? `<br /><span class="desc-extra">${esc(totales.descuentoMotivo)}</span>`
    : '';
  return `
      <tr>
        <td class="durazno">${etiqueta}${motivo}</td>
        <td class="durazno" style="text-align:left;">-$</td>
        <td class="durazno" colspan="2" style="text-align:right;">${money(totales.descuento).replace('$ ', '')}</td>
      </tr>
      <tr>
        <td class="durazno">TOTAL CON DESCUENTO</td>
        <td class="durazno" style="text-align:left;">$</td>
        <td class="durazno" colspan="2" style="text-align:right;">${money(totales.subtotalSinIva).replace('$ ', '')}</td>
      </tr>`;
}

function filaCoffee(coffee, incluye) {
  if (!coffee) return '';
  if (coffee.modo === 'incluido') {
    const lista = incluye.map((i) => `-${esc(i)}`).join('<br />');
    return `
      <tr>
        <td class="coffee-lista">COFFEE BREAK INCLUIDO EN EL COSTO<br />${lista}</td>
        <td class="col-a"></td>
        <td class="col-b"></td>
        <td class="col-c">$ 0.00</td>
      </tr>`;
  }
  // pagado (con o sin cortesía parcial)
  const nota = coffee.cortesiaPct > 0 ? ` (${esc(coffee.cortesiaPct)}% CORTESÍA)` : '';
  return `
    <tr>
      <td>COFFEE BREAK SENCILLO${nota}</td>
      <td class="col-a">${money(coffee.precioUnit)}</td>
      <td class="col-b">${esc(coffee.pax)}</td>
      <td class="col-c">${money(coffee.importe)}</td>
    </tr>`;
}

function filasExtras(extras) {
  return extras
    .map((e) => {
      let nombre = esc(e.nombre).toUpperCase();
      if (e.cortesiaPct === 100) nombre += ' (EN CORTESIA)';
      else if (e.cortesiaPct > 0) nombre += ` (${esc(e.cortesiaPct)}% CORTESÍA)`;
      const desc = e.descripcion ? `<br /><span class="desc-extra">${esc(e.descripcion)}</span>` : '';
      return `
      <tr>
        <td>${nombre}${desc}</td>
        <td class="col-a">${money(e.importe)}</td>
        <td class="col-b"></td>
        <td class="col-c"></td>
      </tr>`;
    })
    .join('\n');
}

let browserPromise = null;
async function getBrowser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b && b.isConnected()) return b;
    browserPromise = null;
  }
  browserPromise = chromium.launch();
  return browserPromise;
}

app.post('/pdf', async (req, res) => {
  try {
    const d = req.body;
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'precios.json'), 'utf8'));

    let html = fs.readFileSync(path.join(__dirname, 'templates', 'cotizacion.html'), 'utf8');

    const hoy = new Date();
    const fechaEmision = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`;

    const valores = {
      LOGO: dataUri('logo.png'),
      FOTO_1: dataUri('collage1.jpg'),
      FOTO_2: dataUri('collage2.jpg'),
      FOTO_3: dataUri('collage3.jpg'),
      FOTO_4: dataUri('collage4.jpg'),
      FOTO_5: dataUri('collage5.jpg'),
      FOTO_6: dataUri('collage6.jpg'),
      FECHA_EMISION: esc(fechaEmision),
      FECHA_INGRESO: esc(d.fechaIngreso || ''),
      FECHA_SALIDA: esc(d.fechaSalida || ''),
      PARTICIPANTES: esc(d.participantes),
      BLOQUE_HOSPEDAJE: bloqueHospedaje(d, config),
      PRECIO_DESAYUNO: money(config.comidas_extra.desayuno.precio),
      PRECIO_COMIDA: money(config.comidas_extra.comida.precio),
      PRECIO_CENA: money(config.comidas_extra.cena.precio),
      CANT_DESAYUNO: d.alimentos.desayuno.cant > 0 ? esc(d.alimentos.desayuno.cant) : '',
      CANT_COMIDA: d.alimentos.comida.cant > 0 ? esc(d.alimentos.comida.cant) : '',
      CANT_CENA: d.alimentos.cena.cant > 0 ? esc(d.alimentos.cena.cant) : '',
      IMP_DESAYUNO: money(d.alimentos.desayuno.importe),
      IMP_COMIDA: money(d.alimentos.comida.importe),
      IMP_CENA: money(d.alimentos.cena.importe),
      FILA_COFFEE: filaCoffee(d.alimentos.coffee, config.coffee_break_incluye),
      TOTAL_ALIMENTOS: money(d.alimentos.total),
      TOTAL_EXTRAS: money(d.extrasTotal).replace('$ ', ''),
      FILAS_EXTRAS: filasExtras(d.extras || []),
      NOCHES: esc(d.noches),
      TOTAL_POR_PERSONA: money(d.totales.totalPorPersona).replace('$ ', ''),
      TOTAL_MAS_EXTRAS: money(d.totales.totalMasExtras).replace('$ ', ''),
      FILAS_DESCUENTO: bloqueDescuento(d.totales),
      IVA: money(d.totales.iva).replace('$ ', ''),
      SUB_TOTAL: money(d.totales.subTotal).replace('$ ', ''),
      ANTICIPO_SIGNO: d.totales.anticipo != null ? '$' : '',
      ANTICIPO: d.totales.anticipo != null ? money(d.totales.anticipo).replace('$ ', '') : '',
      TOTAL_POR_PAGAR: money(d.totales.totalPorPagar).replace('$ ', ''),
    };

    for (const [k, v] of Object.entries(valores)) {
      html = html.split(`{{${k}}}`).join(v);
    }

    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;text-align:center;font-size:9px;font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;"><span class="pageNumber"></span></div>',
      margin: { top: '14px', bottom: '30px', left: '0', right: '0' },
    });
    await page.close();

    const slug = (d.cliente || 'cotizacion').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cotizacion';
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="presupuesto-kuxtal-${slug}.pdf"`,
    });
    res.send(pdf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error generando el PDF: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Cotizador Casa Kuxtal corriendo en http://localhost:${PORT}`);
});
