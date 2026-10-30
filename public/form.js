let config = null;

const $ = (id) => document.getElementById(id);
const num = (id) => {
  const v = parseFloat($(id).value);
  return Number.isFinite(v) && v > 0 ? v : 0;
};
const money = (n) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 }).format(n);

// Fecha de input date (YYYY-MM-DD) → D/M/YYYY como el formato de referencia
const fechaCorta = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${parseInt(d)}/${parseInt(m)}/${y}`;
};

fetch('/config')
  .then((r) => r.json())
  .then((c) => {
    config = c;
    calcular();
  });

document.querySelectorAll('.subcampos').forEach((div) => {
  const check = $(div.dataset.for);
  const toggle = () => (div.style.display = check.checked ? '' : 'none');
  check.addEventListener('change', toggle);
  toggle();
});

document.querySelectorAll('input, select').forEach((el) => {
  el.addEventListener('input', calcular);
  el.addEventListener('change', calcular);
});

// Servicios personalizados: filas dinámicas
$('btnAgregarPersonalizado').addEventListener('click', () => {
  const fila = document.createElement('div');
  fila.className = 'personalizado';
  fila.innerHTML = `
    <input type="text" class="pers-nombre" placeholder="Nombre del servicio" />
    <input type="number" class="pers-monto" min="0" step="0.01" placeholder="Monto $" />
    <input type="text" class="pers-desc" placeholder="Descripción (opcional)" />
    <label class="pers-check"><input type="checkbox" class="pers-descontable" /> Servicio propio (aplica descuento)</label>
    <button type="button" class="pers-quitar" title="Eliminar fila">✕</button>`;
  fila.querySelectorAll('input').forEach((el) => el.addEventListener('input', calcular));
  fila.querySelectorAll('input[type="checkbox"]').forEach((el) => el.addEventListener('change', calcular));
  fila.querySelector('.pers-quitar').addEventListener('click', () => {
    fila.remove();
    calcular();
  });
  $('personalizados').appendChild(fila);
  fila.querySelector('.pers-nombre').focus();
});

// Descuento: muestra/oculta valor y motivo según el modo
const toggleDescuento = () => {
  const modo = $('descuentoModo').value;
  const mostrar = modo !== 'ninguno';
  $('descuentoValorLabel').style.display = mostrar ? '' : 'none';
  $('descuentoMotivoLabel').style.display = mostrar ? '' : 'none';
  $('descuentoValorTexto').textContent = modo === 'porcentaje' ? 'Porcentaje de descuento (%)' : 'Monto del descuento ($)';
  if (modo === 'porcentaje') $('descuentoValor').setAttribute('max', '100');
  else $('descuentoValor').removeAttribute('max');
};
$('descuentoModo').addEventListener('change', toggleDescuento);
toggleDescuento();

$('btnUsarSugerido').addEventListener('click', () => {
  const { totales } = calcular();
  $('anticipo').value = totales.anticipoSugerido.toFixed(2);
  calcular();
});
$('btnLimpiarAnticipo').addEventListener('click', () => {
  $('anticipo').value = '';
  calcular();
});

// Calcula todo y devuelve el payload que consume POST /pdf.
function calcular() {
  if (!config) return null;

  const errores = [];
  const paxDoble = num('paxDoble');
  const paxSencilla = num('paxSencilla');
  const paxTriple = num('paxTriple');
  const paxDia = num('paxDia');
  const habitacionesDobleSinAlimentos = num('habitacionesDobleSinAlimentos');
  const paxDobleSinAlimentos = num('paxDobleSinAlimentos');
  const paxHospedados = paxDoble + paxSencilla + paxTriple + paxDobleSinAlimentos;
  const participantes = paxHospedados + paxDia;
  $('participantes').value = participantes;

  // Noches auto: fecha_salida − fecha_ingreso en días.
  // 0 noches es válido solo para eventos de puro día (sin hospedados).
  const ingresoIso = $('fechaIngreso').value;
  const salidaIso = $('fechaSalida').value;
  let noches = 0;
  if (ingresoIso && salidaIso) {
    const dias = Math.round((Date.parse(salidaIso) - Date.parse(ingresoIso)) / 86400000);
    if (dias < 0) {
      errores.push('La fecha de salida debe ser igual o posterior a la fecha de ingreso.');
    } else {
      noches = dias;
      if (dias === 0 && (paxHospedados > 0 || habitacionesDobleSinAlimentos > 0)) {
        errores.push('Si hay participantes hospedados, debe haber al menos 1 noche.');
      }
    }
  } else {
    errores.push('Indica las fechas de ingreso y salida (las noches se calculan solas).');
  }
  $('noches').value = noches;

  // Doble y triple son tarifas por persona: cualquier número de pax es válido, sin
  // restricción de paridad ni múltiplos (una habitación física puede ir sub-ocupada).
  if (habitacionesDobleSinAlimentos > 0) {
    const min = habitacionesDobleSinAlimentos;
    const max = habitacionesDobleSinAlimentos * 2;
    if (paxDobleSinAlimentos < min || paxDobleSinAlimentos > max) {
      errores.push('El número de personas no coincide con las habitaciones sin alimentos (mínimo 1, máximo 2 por habitación).');
    }
  }

  // --- Hospedaje mixto: (2500×doble + 3800×sencilla + 2200×triple) × noches + (habitaciones×2500) × noches ---
  const pDoble = config.hospedaje.doble.precio;
  const pSencilla = config.hospedaje.sencilla.precio;
  const pTriple = config.hospedaje.triple.precio;
  const pDobleSinAlimentos = config.hospedaje.doble_sin_alimentos.precio;
  const hospedaje = {
    subDoble: pDoble * paxDoble * noches,
    subSencilla: pSencilla * paxSencilla * noches,
    subTriple: pTriple * paxTriple * noches,
    subDobleSinAlimentos: pDobleSinAlimentos * habitacionesDobleSinAlimentos * noches,
  };
  hospedaje.total = hospedaje.subDoble + hospedaje.subSencilla + hospedaje.subTriple + hospedaje.subDobleSinAlimentos;

  if (participantes <= 0) errores.push('Indica al menos un participante (hospedado o de uso de día).');

  // --- Alimentos extra ---
  const alimentos = {};
  for (const [key, id] of [['desayuno', 'desayunosExtra'], ['comida', 'comidasExtra'], ['cena', 'cenasExtra']]) {
    const cant = num(id);
    alimentos[key] = { cant, importe: config.comidas_extra[key].precio * cant };
  }

  // Coffee break: 100% cortesía → "incluido en el costo"; si no, pagado por pax
  alimentos.coffee = null;
  let coffeeImporte = 0;
  if ($('coffeeCheck').checked) {
    const pct = Math.min(100, Math.max(0, num('coffeeCortesia')));
    if (pct === 100) {
      alimentos.coffee = { modo: 'incluido' };
    } else {
      const cp = num('coffeePax');
      if (cp <= 0) {
        errores.push('Coffee break: indica los pax (o ponlo al 100% de cortesía).');
      } else {
        const precioUnit = config.extras.coffee_break_sencillo.precio;
        coffeeImporte = precioUnit * cp * (1 - pct / 100);
        alimentos.coffee = { modo: 'pagado', pax: cp, cortesiaPct: pct, precioUnit, importe: coffeeImporte };
      }
    }
  }
  alimentos.total = alimentos.desayuno.importe + alimentos.comida.importe + alimentos.cena.importe + coffeeImporte;

  // --- Extras ---
  const extras = [];

  if ($('fogataCheck').checked) {
    const fp = num('fogataPax');
    const f = config.extras.fogata;
    if (fp <= 0) errores.push('Fogata: indica los pax asistentes.');
    else if (fp > f.capacidad_max) errores.push(`Fogata: capacidad máxima ${f.capacidad_max} pax (tienes ${fp}).`);
    else {
      const tier = f.tiers.find((t) => fp <= t.max_pax);
      extras.push({ nombre: `Fogata (${fp} pax, ${f.duracion})`, importe: tier.precio, descontable: true });
    }
  }

  if ($('salonCheck').checked) {
    const base = config.extras.salon_audiovisual.precio_base;
    const pct = Math.min(100, Math.max(0, num('salonCortesia')));
    extras.push({ nombre: 'Salon con audiovisual', cortesiaPct: pct, importe: base * (1 - pct / 100), descontable: true });
  }

  if ($('temazcalCheck').checked) {
    const tp = num('temazcalPax');
    const t = config.extras.temazcal;
    if (tp < t.minimo_pax) errores.push(`Temazcal: mínimo ${t.minimo_pax} pax (tienes ${tp}).`);
    else extras.push({ nombre: `Temazcal (${tp} pax)`, importe: t.precio * tp, descontable: true });
  }

  for (const [check, paxId, key, nombre] of [
    ['pizzaCheck', 'pizzaPax', 'taller_pizza', 'Taller de pizza'],
    ['pinturaCheck', 'pinturaPax', 'taller_pintura', 'Taller de pintura'],
  ]) {
    if ($(check).checked) {
      const tp = num(paxId);
      const t = config.extras[key];
      if (tp < t.minimo_pax) errores.push(`${nombre}: mínimo ${t.minimo_pax} pax (tienes ${tp}).`);
      else extras.push({ nombre: `${nombre} (${tp} pax)`, importe: t.precio * tp, descripcion: `Incluye ${t.incluye}`, descontable: true });
    }
  }

  if ($('gongsCheck').checked) {
    const g = config.extras.noche_gongs;
    if (participantes < g.minimo_pax)
      errores.push(`Noche de Gongs: el evento requiere mínimo ${g.minimo_pax} participantes (tienes ${participantes}).`);
    else extras.push({ nombre: 'Noche de Gongs', importe: g.precio, descontable: true });
  }

  if ($('calderaCheck').checked) {
    extras.push({ nombre: 'Caldera de alberca', importe: config.extras.caldera_alberca.precio, descontable: true });
  }

  document.querySelectorAll('.manual').forEach((div) => {
    const monto = parseFloat(div.querySelector('.manual-monto').value);
    if (Number.isFinite(monto) && monto > 0) {
      extras.push({
        nombre: div.dataset.label,
        importe: monto,
        descripcion: div.querySelector('.manual-desc').value.trim(),
        descontable: div.querySelector('.manual-descontable').checked,
      });
    }
  });

  // Servicios personalizados: con monto y nombre suman; con monto sin nombre bloquean;
  // con nombre sin monto simplemente se ignoran (regla de no mostrar líneas en $0)
  document.querySelectorAll('#personalizados .personalizado').forEach((fila) => {
    const nombre = fila.querySelector('.pers-nombre').value.trim();
    const monto = parseFloat(fila.querySelector('.pers-monto').value);
    const tieneMonto = Number.isFinite(monto) && monto > 0;
    if (tieneMonto && !nombre) {
      errores.push('Falta el nombre del servicio personalizado.');
    } else if (tieneMonto && nombre) {
      extras.push({
        nombre,
        importe: monto,
        descripcion: fila.querySelector('.pers-desc').value.trim(),
        descontable: fila.querySelector('.pers-descontable').checked,
      });
    }
  });

  const extrasTotal = extras.reduce((s, e) => s + e.importe, 0);

  // --- Totales, descuento e IVA ---
  const ivaPct = config.iva_pct / 100;
  const totalMasExtras = hospedaje.total + alimentos.total + extrasTotal; // suma de TODAS las líneas, sin cambios

  // Base descontable: hospedaje (todos los tipos) + alimentos (ya con cortesías) +
  // extras del catálogo marcados descontable:true (manuales/personalizados solo si su casilla está activa)
  const extrasDescontables = extras.filter((e) => e.descontable).reduce((s, e) => s + e.importe, 0);
  const baseDescontable = hospedaje.total + alimentos.total + extrasDescontables;

  const descuentoModo = $('descuentoModo').value; // 'ninguno' | 'porcentaje' | 'monto'
  const descuentoValor = num('descuentoValor');
  let descuento = 0;
  let descuentoPct = null;
  if (descuentoModo === 'porcentaje' && descuentoValor > 0) {
    descuentoPct = Math.min(100, descuentoValor);
    descuento = baseDescontable * (descuentoPct / 100);
  } else if (descuentoModo === 'monto' && descuentoValor > 0) {
    descuento = descuentoValor;
    if (descuento > baseDescontable) {
      errores.push('El descuento no puede ser mayor que el total de servicios propios de Casa Kuxtal.');
    }
  }
  const descuentoMotivo = $('descuentoMotivo').value.trim();

  const aplicarIva = $('aplicarIva').checked;
  const subtotalSinIva = totalMasExtras - descuento;
  const iva = aplicarIva ? subtotalSinIva * ivaPct : 0;
  const totalConIva = subtotalSinIva + iva;
  const totalPorPersona = participantes > 0 ? subtotalSinIva / participantes : 0;
  const anticipoSugerido = totalConIva * (config.anticipo_sugerido_pct / 100);

  const anticipoRaw = $('anticipo').value.trim();
  const anticipo = anticipoRaw === '' ? null : Math.max(0, parseFloat(anticipoRaw) || 0);

  const totales = {
    totalMasExtras,
    descuento,
    descuentoModo,
    descuentoPct,
    descuentoMotivo,
    subtotalSinIva,
    aplicaIva: aplicarIva,
    iva,
    subTotal: totalConIva,
    totalPorPersona,
    anticipo,
    anticipoSugerido,
    totalPorPagar: totalConIva,
  };

  // --- UI en vivo ---
  $('anticipoSugerido').textContent = `Sugerido (${config.anticipo_sugerido_pct}%): ${money(anticipoSugerido)}`;
  const partesDesglose = [];
  if (descuento > 0) {
    partesDesglose.push(`Servicios ${money(totalMasExtras)}`, `Descuento -${money(descuento)}`);
  }
  partesDesglose.push(`Subtotal ${money(subtotalSinIva)}`);
  partesDesglose.push(aplicarIva ? `IVA ${money(iva)}` : 'Sin IVA');
  partesDesglose.push(`${participantes || '—'} participantes`);
  $('desgloseVivo').textContent = partesDesglose.join(' · ');
  $('totalVivo').textContent = money(totalConIva);
  $('errores').innerHTML = errores.map((e) => `<div class="error">⚠ ${e}</div>`).join('');

  return {
    cliente: $('cliente').value.trim(),
    fechaIngreso: fechaCorta($('fechaIngreso').value),
    fechaSalida: fechaCorta($('fechaSalida').value),
    paxDoble,
    paxSencilla,
    paxTriple,
    habitacionesDobleSinAlimentos,
    paxDobleSinAlimentos,
    paxDia,
    noches,
    participantes,
    hospedaje,
    alimentos,
    extras,
    extrasTotal,
    totales,
    errores,
  };
}

$('btnPdf').addEventListener('click', async () => {
  const payload = calcular();
  if (!payload) return;

  if (payload.errores.length > 0) {
    alert('Corrige antes de generar el PDF:\n\n' + payload.errores.join('\n'));
    return;
  }

  const btn = $('btnPdf');
  btn.disabled = true;
  btn.textContent = 'Generando…';
  try {
    const res = await fetch('/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error del servidor');
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const slug = (payload.cliente || 'cotizacion').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    a.download = `presupuesto-kuxtal-${slug}.pdf`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    alert('No se pudo generar el PDF: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generar PDF';
  }
});
