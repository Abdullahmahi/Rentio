-- Rentio — demo data (Mexican Spanish, CDMX).
-- Safe to re-run: it clears the demo tables first.
--
-- Deliberately leaves 4 active leases WITHOUT an invoice for the current
-- month, and their utility charges `pendiente`, so "Generar recibos del mes"
-- has real work to do on a fresh demo.

begin;

truncate table
  public.activity_log, public.documents, public.work_order_photos,
  public.work_order_notes, public.work_orders, public.utility_charges,
  public.payment_allocations, public.payments, public.invoice_lines,
  public.invoices, public.lease_tenants, public.parking_spaces,
  public.leases, public.units, public.tenants, public.properties
  restart identity cascade;

alter sequence public.invoice_number_seq restart with 1;
alter sequence public.work_order_folio_seq restart with 1;

update public.settings set
  company_name   = 'Inmobiliaria Arrendo CDMX',
  bank_name      = 'BBVA México',
  clabe          = '012180001234567895',
  account_holder = 'Inmobiliaria Arrendo CDMX, S.A. de C.V.',
  invoice_prefix = 'REC',
  default_late_fee = 500.00,
  default_grace_days = 5,
  street = 'Av. Insurgentes Sur 1602',
  colonia = 'Crédito Constructor',
  city = 'Ciudad de México',
  state = 'Ciudad de México',
  postal_code = '03940',
  phone = '+52 55 5555 1200',
  email = 'administracion@arrendocdmx.mx';

-- ------------------------------------------------------------ properties

insert into public.properties (name, street, colonia, city, state, postal_code, notes) values
  ('Edificio Roma 214',     'Álvaro Obregón 214', 'Roma Norte',        'Ciudad de México', 'Ciudad de México', '06700', 'Edificio remodelado en 2021. Portero de 7:00 a 22:00.'),
  ('Residencial Del Valle', 'Av. Coyoacán 1523',  'Del Valle Centro',  'Ciudad de México', 'Ciudad de México', '03100', 'Amenidades: roof garden y salón de usos múltiples.'),
  ('Torre Narvarte',        'Dr. Vértiz 842',     'Narvarte Poniente', 'Ciudad de México', 'Ciudad de México', '03020', 'Elevador con mantenimiento mensual programado.');

-- ----------------------------------------------------------------- units
-- 40 units: 14 / 14 / 12. Rent lands between $8,000 and $28,000 MXN.

insert into public.units (property_id, unit_number, floor, bedrooms, bathrooms, sqm, base_rent, status)
select
  p.id,
  (((i - 1) / 4 + 1) * 100 + ((i - 1) % 4 + 1))::text,
  (i - 1) / 4 + 1,
  b.bedrooms,
  case when b.bedrooms = 1 then 1.0 when b.bedrooms = 2 then 1.5 else 2.0 end,
  round((42 + b.bedrooms * 21 + (i % 4) * 3)::numeric, 2),
  round((8000 + (b.bedrooms - 1) * 6500 + cfg.premium + (i % 5) * 500)::numeric, 2),
  'vacante'
from (values
  ('Edificio Roma 214', 14, 3500),
  ('Residencial Del Valle', 14, 2000),
  ('Torre Narvarte', 12, 0)
) as cfg(pname, n, premium)
join public.properties p on p.name = cfg.pname
cross join lateral generate_series(1, cfg.n) as i
cross join lateral (select (i % 3) + 1 as bedrooms) b;

-- -------------------------------------------------------- parking spaces
-- 25 spaces: 10 / 9 / 6.

insert into public.parking_spaces (property_id, label, type, monthly_fee, status)
select
  p.id,
  'E-' || lpad(i::text, 2, '0'),
  case when i % 3 = 0 then 'descubierto' else 'techado' end,
  case when i % 3 = 0 then 800.00 else 1200.00 end,
  'disponible'
from (values ('Edificio Roma 214', 10), ('Residencial Del Valle', 9), ('Torre Narvarte', 6)) as cfg(pname, n)
join public.properties p on p.name = cfg.pname
cross join lateral generate_series(1, cfg.n) as i;

-- --------------------------------------------------------------- tenants

insert into public.tenants (full_name, email, phone, rfc, emergency_contact_name, emergency_contact_phone)
select
  n.full_name,
  lower(
    translate(split_part(n.full_name, ' ', 1), 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN') || '.' ||
    translate(split_part(n.full_name, ' ', 2), 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN')
  ) || '@example.mx',
  '+52 55 ' || lpad((1000 + n.i * 37)::text, 4, '0') || ' ' || lpad((2000 + n.i * 53)::text, 4, '0'),
  case when n.i % 3 = 0 then null else upper(left(translate(n.full_name, ' áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN'), 4)) || '8' || lpad((100000 + n.i * 911)::text, 6, '0') end,
  n.emergency,
  '+52 55 ' || lpad((3000 + n.i * 29)::text, 4, '0') || ' ' || lpad((4000 + n.i * 61)::text, 4, '0')
from (
  select row_number() over () as i, full_name, emergency from (values
    ('María Fernanda Ríos',      'Jorge Ríos Medina'),
    ('Juan Carlos Pérez',        'Laura Pérez Solís'),
    ('Ana Sofía Hernández',      'Miguel Hernández Cruz'),
    ('Luis Enrique Ramírez',     'Patricia Ramírez Ortiz'),
    ('Gabriela Mendoza',         'Raúl Mendoza Lara'),
    ('Ricardo Alonso Vargas',    'Claudia Vargas Nieto'),
    ('Alejandra Castillo',       'Héctor Castillo Ruiz'),
    ('Fernando Gutiérrez',       'Norma Gutiérrez Paz'),
    ('Paola Jiménez Soto',       'Andrés Jiménez Rocha'),
    ('Roberto Núñez Salas',      'Elena Núñez Vega'),
    ('Diana Laura Ortega',       'Sergio Ortega Campos'),
    ('Miguel Ángel Domínguez',   'Rosa Domínguez Islas'),
    ('Carmen Elizabeth Flores',  'Pedro Flores Aguilar'),
    ('José Antonio Reyes',       'Silvia Reyes Cabrera'),
    ('Verónica Salazar',         'Arturo Salazar Peña'),
    ('Héctor Iván Morales',      'Beatriz Morales Luna'),
    ('Claudia Patricia Cruz',    'Ramón Cruz Estrada'),
    ('Eduardo Barrera Lima',     'Mónica Barrera Téllez'),
    ('Mariana Quintero',         'Felipe Quintero Arce'),
    ('Sergio Alberto Navarro',   'Adriana Navarro Fuentes'),
    ('Lucía Beltrán Arriaga',    'Emilio Beltrán Cano'),
    ('Óscar Daniel Cervantes',   'Teresa Cervantes Lozano'),
    ('Rocío Guadalupe Andrade',  'Javier Andrade Pineda'),
    ('Armando Téllez Rosas',     'Guadalupe Téllez Mora'),
    ('Isabel Cristina Guzmán',   'Rodrigo Guzmán Franco'),
    ('Pablo Emilio Zamora',      'Cecilia Zamora Rangel'),
    ('Nadia Escobar Ponce',      'Ignacio Escobar Ávila'),
    ('Rubén Darío Maldonado',    'Alicia Maldonado Bravo'),
    ('Silvia Nájera Campos',     'Mauricio Nájera Duarte'),
    ('Emiliano Rivas Cuéllar',   'Daniela Rivas Montes')
  ) as t(full_name, emergency)
) n;

-- ---------------------------------------------------------------- leases
-- 30 active leases on the first 30 units. Four of them end within 60 days
-- so the "Por vencer" badge has something to show.

with ordered_units as (
  select u.id, u.base_rent, row_number() over (order by p.name, u.unit_number) as rn
  from public.units u join public.properties p on p.id = u.property_id
)
insert into public.leases (
  unit_id, start_date, end_date, rent_amount, rent_due_day, grace_days,
  late_fee_amount, deposit_amount, status
)
select
  ou.id,
  d.start_date,
  (d.start_date + interval '12 months' - interval '1 day')::date,
  ou.base_rent,
  case when ou.rn % 4 = 0 then 5 else 1 end,
  5,
  500.00,
  ou.base_rent,
  'activo'
from ordered_units ou
cross join lateral (
  select case
    when ou.rn <= 4 then (date_trunc('month', current_date) - interval '11 months' + interval '10 days')::date
    else (date_trunc('month', current_date) - ((ou.rn % 9) + 2) * interval '1 month')::date
  end as start_date
) d
where ou.rn <= 30;

update public.units u set status = 'ocupada'
where exists (select 1 from public.leases l where l.unit_id = u.id and l.status = 'activo');

-- A little texture in the remaining 10 vacant units.
with spare as (
  select u.id, row_number() over (order by u.created_at, u.unit_number) as rn
  from public.units u where u.status = 'vacante'
)
update public.units u set status = case when s.rn <= 2 then 'mantenimiento'::unit_status else 'reservada'::unit_status end
from spare s where u.id = s.id and s.rn <= 4;

-- ---------------------------------------------------------- lease tenants

with l as (
  select id, row_number() over (order by created_at, id) as rn from public.leases
), t as (
  select id, row_number() over (order by created_at, id) as rn from public.tenants
)
insert into public.lease_tenants (lease_id, tenant_id, role)
select l.id, t.id, 'primary' from l join t on t.rn = l.rn;

-- Every fifth lease gets a co-tenant, every seventh a guarantor.
with l as (
  select id, row_number() over (order by created_at, id) as rn from public.leases
), t as (
  select id, row_number() over (order by created_at, id) as rn from public.tenants
)
insert into public.lease_tenants (lease_id, tenant_id, role)
select l.id, t.id, r.role
from l
join lateral (values ('co_tenant'::lease_tenant_role, 5, 1), ('guarantor'::lease_tenant_role, 7, 2)) as r(role, modulo, offs) on l.rn % r.modulo = 0
join t on t.rn = ((l.rn + r.offs - 1) % 30) + 1
on conflict (lease_id, tenant_id) do nothing;

-- ------------------------------------------------------ parking assignment
-- 15 of 25 spaces assigned, always to a lease in the same property.

with ranked_spaces as (
  select ps.id, ps.property_id, row_number() over (partition by ps.property_id order by ps.label) as rn
  from public.parking_spaces ps
), ranked_leases as (
  select l.id as lease_id, u.property_id, row_number() over (partition by u.property_id order by u.unit_number) as rn
  from public.leases l join public.units u on u.id = l.unit_id where l.status = 'activo'
)
update public.parking_spaces ps
set lease_id = rl.lease_id, status = 'asignado'
from ranked_spaces rs
join ranked_leases rl on rl.property_id = rs.property_id and rl.rn = rs.rn
where ps.id = rs.id and rs.rn <= 5;

update public.parking_spaces set status = 'fuera_de_servicio'
where lease_id is null and label in ('E-09', 'E-10');

-- ------------------------------------------------------- utility charges
-- Two billed months behind us, the current month still pendiente.

insert into public.utility_charges (unit_id, lease_id, type, period_month, amount, status, notes)
select
  l.unit_id,
  l.id,
  ut.type,
  (date_trunc('month', current_date) - m.offset_months * interval '1 month')::date,
  ut.amount,
  case when m.offset_months = 0 then 'pendiente'::utility_status else 'facturado'::utility_status end,
  null
from public.leases l
join lateral (
  select row_number() over (order by l2.created_at, l2.id) as rn from public.leases l2 where l2.id = l.id
) r on true
cross join lateral (values (0), (1), (2)) as m(offset_months)
cross join lateral (values
  ('agua'::utility_type, round((180 + (r.rn % 7) * 35)::numeric, 2)),
  ('cuota_mantenimiento'::utility_type, 950.00)
) as ut(type, amount)
where l.status = 'activo'
on conflict (unit_id, type, period_month) do nothing;

-- --------------------------------------------------------------- invoices
-- Months M-2 and M-1 for all 30 leases; month M for 26 of them.

with l as (
  select l.*, row_number() over (order by l.created_at, l.id) as rn from public.leases l where l.status = 'activo'
),
periods as (select * from (values (2), (1), (0)) as p(offset_months)),
target as (
  select l.*, p.offset_months,
         (date_trunc('month', current_date) - p.offset_months * interval '1 month')::date as period_month
  from l cross join periods p
  where not (p.offset_months = 0 and l.rn > 26)   -- 4 leases left for the generator to pick up
),
ins as (
  insert into public.invoices (lease_id, period_month, invoice_number, issue_date, due_date, status, total)
  select
    t.id,
    t.period_month,
    public.next_invoice_number(),
    t.period_month,
    (t.period_month + (least(t.rent_due_day, 28) - 1) * interval '1 day')::date,
    case when t.offset_months = 0 then 'enviado'::invoice_status else 'pagado'::invoice_status end,
    0
  from target t
  order by t.period_month, t.rn
  returning id, lease_id, period_month
)
insert into public.invoice_lines (invoice_id, description, category, quantity, amount)
-- rent
select i.id, 'Renta mensual', 'renta'::line_category, 1::numeric, l.rent_amount
from ins i join public.leases l on l.id = i.lease_id
union all
-- parking
select i.id, 'Estacionamiento ' || ps.label, 'estacionamiento'::line_category, 1::numeric, ps.monthly_fee
from ins i join public.parking_spaces ps on ps.lease_id = i.lease_id
union all
-- utilities already billed
select i.id,
       case uc.type when 'agua' then 'Agua' when 'cuota_mantenimiento' then 'Cuota de mantenimiento' else 'Servicio' end,
       case uc.type when 'cuota_mantenimiento' then 'cuota_mantenimiento'::line_category else 'servicios'::line_category end,
       1::numeric, uc.amount
from ins i
join public.utility_charges uc on uc.lease_id = i.lease_id and uc.period_month = i.period_month and uc.status = 'facturado';

-- Point the consumed charges at the invoice that ate them.
update public.utility_charges uc
set invoice_id = i.id
from public.invoices i
where uc.lease_id = i.lease_id and uc.period_month = i.period_month and uc.status = 'facturado';

-- Totals always come from the lines.
update public.invoices i
set total = coalesce((select sum(il.amount * il.quantity) from public.invoice_lines il where il.invoice_id = i.id), 0);

-- --------------------------------------------------------------- payments
-- M-2: everyone paid. M-1: most paid, a few short. M: about half paid.

with inv as (
  select i.*, row_number() over (order by i.period_month, i.invoice_number) as rn,
         (date_part('month', age(date_trunc('month', current_date), i.period_month)))::int
         + (date_part('year', age(date_trunc('month', current_date), i.period_month)))::int * 12 as months_ago
  from public.invoices i
),
payable as (
  select inv.*,
    case
      when months_ago = 2 then inv.total                                   -- fully paid
      when months_ago = 1 and inv.rn % 10 = 0 then round(inv.total * 0.5, 2)  -- partial
      when months_ago = 1 and inv.rn % 10 = 3 then 0                       -- never paid -> vencido
      when months_ago = 1 then inv.total
      when months_ago = 0 and inv.rn % 2 = 0 then inv.total                -- current month, half paid
      else 0
    end as pay_amount
  from inv
),
pay as (
  insert into public.payments (lease_id, amount, paid_at, method, reference, status, reported_by_tenant, confirmed_at)
  select
    p.lease_id,
    p.pay_amount,
    least(p.due_date + ((p.rn % 4))::int, current_date),
    (array['spei','spei','spei','efectivo','deposito','oxxo'])[(p.rn % 6) + 1]::payment_method,
    'SPEI' || lpad((7000000 + p.rn * 137)::text, 9, '0'),
    'confirmado',
    false,
    now()
  from payable p
  where p.pay_amount > 0
  -- `reference` is derived from the invoice's row number, so it is the
  -- key that ties each payment back to exactly one invoice.
  returning id, amount, reference
)
insert into public.payment_allocations (payment_id, invoice_id, amount)
select pay.id, payable.id, pay.amount
from pay
join payable on 'SPEI' || lpad((7000000 + payable.rn * 137)::text, 9, '0') = pay.reference;

-- Three self-reported payments waiting in the confirmation queue.
insert into public.payments (lease_id, amount, paid_at, method, reference, status, reported_by_tenant, notes)
select l.id, l.rent_amount, current_date - 1, 'spei', 'SPEI' || lpad((9100000 + row_number() over ())::text, 9, '0'),
       'pendiente', true, 'Transferencia realizada desde BBVA.'
from public.leases l
where l.status = 'activo'
order by l.created_at
limit 3;

-- Derive invoice status from what was actually allocated.
update public.invoices i
set status = case
  when i.status = 'cancelado' then i.status
  when b.paid >= i.total then 'pagado'
  when b.paid > 0 then 'pagado_parcial'
  when i.due_date < current_date then 'vencido'
  else 'enviado'
end
from public.invoice_balances b
where b.invoice_id = i.id;

-- ------------------------------------------------------------ work orders
-- 15 orders spread across every status, category and source.

insert into public.work_orders (unit_id, lease_id, reported_by_tenant, source, category, priority, title, description, status, vendor_name, vendor_phone, cost, resolved_at, created_at)
select
  l.unit_id, l.id, lt.tenant_id,
  w.source, w.category, w.priority, w.title, w.description, w.status,
  case when w.status in ('asignada','en_progreso','esperando_refacciones','resuelta','cerrada') then w.vendor end,
  case when w.status in ('asignada','en_progreso','esperando_refacciones','resuelta','cerrada') then '+52 55 4120 ' || lpad((3000 + w.rn * 17)::text, 4, '0') end,
  case when w.status in ('resuelta','cerrada') then w.cost end,
  case when w.status in ('resuelta','cerrada') then now() - (w.rn || ' days')::interval end,
  now() - ((w.rn * 3) || ' days')::interval
from (values
  (1,  'portal'::wo_source,   'plomeria'::wo_category,          'urgente'::wo_priority, 'Fuga de agua en el baño principal', 'El agua escurre por la pared debajo del lavabo desde ayer.',            'nueva'::wo_status,                 'Plomería Express',   1450.00),
  (2,  'whatsapp',            'electricidad',                   'alta',                 'Apagón en la recámara',             'No hay luz en los contactos de la recámara principal.',                 'asignada',                         'Electro Servicios',  890.00),
  (3,  'telefono',            'cerrajeria',                     'media',                'Cerradura atascada',                'La llave entra pero no gira en la puerta de entrada.',                   'en_progreso',                      'Cerrajería 24/7',    650.00),
  (4,  'personal',            'electrodomesticos',              'media',                'Boiler no calienta',                'El agua sale tibia aun al máximo.',                                     'esperando_refacciones',            'Clima y Calor',     2300.00),
  (5,  'portal',              'limpieza',                       'baja',                 'Limpieza de tinaco',                'Solicito limpieza programada del tinaco.',                              'resuelta',                         'Limpieza Integral',  900.00),
  (6,  'portal',              'plomeria',                       'alta',                 'Drenaje tapado en cocina',          'El fregadero no desagua.',                                              'cerrada',                          'Plomería Express',  1100.00),
  (7,  'whatsapp',            'electricidad',                   'urgente',              'Corto circuito en pasillo',         'Saltó el interruptor general dos veces hoy.',                            'en_progreso',                      'Electro Servicios', 1750.00),
  (8,  'telefono',            'otro',                           'baja',                 'Ruido en el elevador',              'Se escucha un rechinido al subir del piso 2 al 3.',                      'nueva',                            'Elevadores Mex',    3200.00),
  (9,  'personal',            'plomeria',                       'media',                'Goteo en regadera',                 'Gotea constantemente aunque esté cerrada.',                              'asignada',                         'Plomería Express',   520.00),
  (10, 'portal',              'electrodomesticos',              'alta',                 'Estufa sin gas',                    'Dos quemadores no encienden.',                                          'resuelta',                         'Gas del Valle',      780.00),
  (11, 'portal',              'cerrajeria',                     'urgente',              'Puerta principal no cierra',        'La chapa quedó floja y la puerta no asegura.',                           'cerrada',                          'Cerrajería 24/7',    980.00),
  (12, 'whatsapp',            'limpieza',                       'baja',                 'Basura acumulada en azotea',        'Hay bolsas acumuladas junto a la salida de azotea.',                     'resuelta',                         'Limpieza Integral',  400.00),
  (13, 'telefono',            'electricidad',                   'media',                'Foco fundido en pasillo común',     'El pasillo del segundo piso quedó a oscuras.',                           'cerrada',                          'Electro Servicios',  180.00),
  (14, 'personal',            'otro',                           'media',                'Revisión de humedad en muro',       'Mancha de humedad creciendo en el muro de la sala.',                     'esperando_refacciones',            'Impermeabiliza MX', 4500.00),
  (15, 'portal',              'plomeria',                       'alta',                 'Presión de agua muy baja',          'Casi no sale agua en la regadera por las mañanas.',                      'nueva',                            'Plomería Express',   700.00)
) as w(rn, source, category, priority, title, description, status, vendor, cost)
join lateral (
  select l.* from public.leases l
  where l.status = 'activo'
  order by l.created_at, l.id
  offset (w.rn - 1) limit 1
) l on true
join lateral (
  select lt.tenant_id from public.lease_tenants lt where lt.lease_id = l.id and lt.role = 'primary' limit 1
) lt on true;

insert into public.work_order_notes (work_order_id, body, is_internal)
select w.id, n.body, n.is_internal
from public.work_orders w
join lateral (values
  ('Proveedor contactado, agenda visita para mañana por la mañana.', true),
  ('Ya contactamos al proveedor. La visita queda agendada para mañana entre 9:00 y 12:00.', false)
) as n(body, is_internal) on true
where w.status <> 'nueva';

commit;
