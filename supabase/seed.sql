-- Rentio — demo data (El Paso, Texas).
-- Safe to re-run: it clears the demo tables first.
--
-- Deliberately leaves 4 active leases WITHOUT an invoice for the current
-- month, and their utility charges `pendiente`, so "Generate this month's
-- receipts" has real work to do on a fresh demo. It also leaves one health
-- and safety work order past its 7-day statutory window and one terminated
-- lease with the deposit clock running, so both compliance warnings are
-- visible without anyone having to set them up.

begin;

truncate table
  public.activity_log, public.documents, public.work_order_photos,
  public.work_order_notes, public.work_orders, public.utility_charges,
  public.payment_allocations, public.payments, public.invoice_lines,
  public.invoices, public.lease_notices, public.unit_turnover_checklist,
  public.lease_tenants, public.parking_spaces,
  public.leases, public.units, public.tenants, public.properties
  restart identity cascade;

alter sequence public.invoice_number_seq restart with 1;
alter sequence public.work_order_folio_seq restart with 1;

update public.settings set
  company_name   = 'Sun City Property Management',
  invoice_prefix = 'REC',
  default_late_fee_percent = 10.00,
  default_grace_days = 2,
  nsf_fee = 35.00,
  street = '4141 Pinnacle St',
  address_line_2 = 'Suite 210',
  city = 'El Paso',
  state = 'TX',
  postal_code = '79902',
  phone = '(915) 555-1200',
  email = 'office@suncitypm.com',
  -- Only the methods this landlord actually accepts. The portal renders
  -- exactly these rows and no empty ones.
  zelle_handle = 'payments@suncitypm.com',
  check_payable_to = 'Sun City Property Management LLC',
  check_mailing_address = E'Sun City Property Management LLC\n4141 Pinnacle St, Suite 210\nEl Paso, TX 79902',
  dropoff_address = E'4141 Pinnacle St, Suite 210\nEl Paso, TX 79902',
  office_hours = 'Mon–Fri 9:00 AM – 5:00 PM',
  payment_notes = 'Include your unit number on the memo line so we can match your payment.';

-- ------------------------------------------------------------ properties
-- Westside, Northeast and the Lower Valley. `units_in_structure` is set by
-- hand because it drives the §92.019 late fee cap: the fourplex takes the
-- 12% presumption, the two apartment buildings 10%.

insert into public.properties (name, street, address_line_2, city, state, postal_code, units_in_structure, notes) values
  ('Mesa Hills Apartments',  '5820 Mesa Hills Dr', 'Bldg A', 'El Paso', 'TX', '79912', 14, 'Westside. Renovated 2021. Gated parking, laundry on site.'),
  ('Dyer Street Commons',    '9315 Dyer St',       NULL,     'El Paso', 'TX', '79924', 14, 'Northeast, near Fort Bliss. Covered parking, on-site manager Mon–Fri.'),
  ('Ysleta Court',           '8402 Alameda Ave',   'Bldg C', 'El Paso', 'TX', '79907',  4, 'Lower Valley. Single fourplex — takes the 12% late fee cap.');

-- ----------------------------------------------------------------- units
-- 40 units: 14 / 14 / 12. Rent lands between $650 and $1,600, which is
-- where El Paso actually is. Demo numbers that look wrong undermine a demo.

insert into public.units (property_id, unit_number, floor, bedrooms, bathrooms, sqm, base_rent, status)
select
  p.id,
  (((i - 1) / 4 + 1) * 100 + ((i - 1) % 4 + 1))::text,
  (i - 1) / 4 + 1,
  b.bedrooms,
  case when b.bedrooms = 1 then 1.0 when b.bedrooms = 2 then 1.5 else 2.0 end,
  round((520 + b.bedrooms * 240 + (i % 4) * 35)::numeric, 2),
  round((650 + (b.bedrooms - 1) * 300 + cfg.premium + (i % 5) * 40)::numeric, 2),
  'vacante'
from (values
  ('Mesa Hills Apartments', 14, 180),
  ('Dyer Street Commons',   14,  60),
  ('Ysleta Court',          12,   0)
) as cfg(pname, n, premium)
join public.properties p on p.name = cfg.pname
cross join lateral generate_series(1, cfg.n) as i
cross join lateral (select (i % 3) + 1 as bedrooms) b;

-- -------------------------------------------------------- parking spaces
-- 25 spaces: 10 / 9 / 6.

insert into public.parking_spaces (property_id, label, type, monthly_fee, status)
select
  p.id,
  'P-' || lpad(i::text, 2, '0'),
  case when i % 3 = 0 then 'descubierto' else 'techado' end,
  case when i % 3 = 0 then 25.00 else 45.00 end,
  'disponible'
from (values ('Mesa Hills Apartments', 10), ('Dyer Street Commons', 9), ('Ysleta Court', 6)) as cfg(pname, n)
join public.properties p on p.name = cfg.pname
cross join lateral generate_series(1, cfg.n) as i;

-- --------------------------------------------------------------- tenants
-- A realistic El Paso mix: roughly four in five Hispanic surnames, the rest
-- not, with (915) numbers throughout.

insert into public.tenants (full_name, email, phone, emergency_contact_name, emergency_contact_phone)
select
  n.full_name,
  lower(
    translate(split_part(n.full_name, ' ', 1), 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN') || '.' ||
    translate(split_part(n.full_name, ' ', 2), 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN')
  ) || '@example.com',
  '(915) ' || lpad((200 + n.i * 7)::text, 3, '0') || '-' || lpad((1000 + n.i * 53)::text, 4, '0'),
  n.emergency,
  '(915) ' || lpad((300 + n.i * 11)::text, 3, '0') || '-' || lpad((2000 + n.i * 61)::text, 4, '0')
from (
  select row_number() over () as i, full_name, emergency from (values
    ('María Fernanda Ríos',      'Jorge Ríos Medina'),
    ('Daniel Whitaker',          'Susan Whitaker'),
    ('Ana Sofía Hernández',      'Miguel Hernández Cruz'),
    ('Luis Enrique Ramírez',     'Patricia Ramírez Ortiz'),
    ('Gabriela Mendoza',         'Raúl Mendoza Lara'),
    ('Ricardo Alonso Vargas',    'Claudia Vargas Nieto'),
    ('Alejandra Castillo',       'Héctor Castillo Ruiz'),
    ('Marcus Thompson',          'Denise Thompson'),
    ('Paola Jiménez Soto',       'Andrés Jiménez Rocha'),
    ('Roberto Núñez Salas',      'Elena Núñez Vega'),
    ('Diana Laura Ortega',       'Sergio Ortega Campos'),
    ('Miguel Ángel Domínguez',   'Rosa Domínguez Islas'),
    ('Katherine O''Brien',       'Patrick O''Brien'),
    ('José Antonio Reyes',       'Silvia Reyes Cabrera'),
    ('Verónica Salazar',         'Arturo Salazar Peña'),
    ('Héctor Iván Morales',      'Beatriz Morales Luna'),
    ('Claudia Patricia Cruz',    'Ramón Cruz Estrada'),
    ('Eduardo Barrera Lima',     'Mónica Barrera Téllez'),
    ('Brandon Nguyen',           'Linda Nguyen'),
    ('Sergio Alberto Navarro',   'Adriana Navarro Fuentes'),
    ('Lucía Beltrán Arriaga',    'Emilio Beltrán Cano'),
    ('Óscar Daniel Cervantes',   'Teresa Cervantes Lozano'),
    ('Rocío Guadalupe Andrade',  'Javier Andrade Pineda'),
    ('Armando Téllez Rosas',     'Guadalupe Téllez Mora'),
    ('Rachel Goldstein',         'David Goldstein'),
    ('Pablo Emilio Zamora',      'Cecilia Zamora Rangel'),
    ('Nadia Escobar Ponce',      'Ignacio Escobar Ávila'),
    ('Rubén Darío Maldonado',    'Alicia Maldonado Bravo'),
    ('Tyler Brooks',             'Megan Brooks'),
    ('Emiliano Rivas Cuéllar',   'Daniela Rivas Montes')
  ) as t(full_name, emergency)
) n;

-- ---------------------------------------------------------------- leases
-- 30 active leases on the first 30 units, plus one terminated lease whose
-- deposit clock is running. Four end within 60 days so the "Por vencer"
-- badge has something to show.
--
-- Every lease is on the Texas default: a percentage late fee at 10% and the
-- statutory minimum 2-day grace period. Deposits are one month's rent.

with ordered_units as (
  select u.id, u.base_rent, row_number() over (order by p.name, u.unit_number) as rn
  from public.units u join public.properties p on p.id = u.property_id
)
insert into public.leases (
  unit_id, start_date, end_date, rent_amount, rent_due_day, grace_days,
  late_fee_type, late_fee_percent, late_fee_amount, deposit_amount, status
)
select
  ou.id,
  d.start_date,
  (d.start_date + interval '12 months' - interval '1 day')::date,
  ou.base_rent,
  case when ou.rn % 4 = 0 then 5 else 1 end,
  2,
  'percent',
  10.00,
  0,
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

-- ---------------------------------------------- move-in / turnover lists
-- §92.156 — rekey within 7 days of possession. Every lease that has been
-- running for months is fully turned over; the two brand-new move-ins added
-- at the bottom of this file are the ones still in progress.

insert into public.unit_turnover_checklist (unit_id, lease_id, item, item_key, position, completed, completed_at)
select
  l.unit_id, l.id, c.item, c.item_key, c.position,
  true,
  l.start_date + interval '2 days'
from public.leases l
cross join (values
  ('Rekey locks (required within 7 days)',          'rekey_locks',               0),
  ('Test smoke alarms',                             'test_smoke_alarms',         1),
  ('Verify deadbolt and keyless bolting device',    'verify_deadbolt_keyless',   2),
  ('Verify window latches',                         'verify_window_latches',     3),
  ('Document unit condition with photos',           'document_condition_photos', 4),
  ('Collect renters insurance certificate',         'collect_renters_insurance', 5)
) as c(item, item_key, position)
on conflict (lease_id, item_key) do nothing;

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
where lease_id is null and label in ('P-09', 'P-10');

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
  ('agua'::utility_type, round((28 + (r.rn % 7) * 4)::numeric, 2)),
  ('cuota_mantenimiento'::utility_type, 35.00)
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
select i.id, 'Monthly rent', 'renta'::line_category, 1::numeric, l.rent_amount
from ins i join public.leases l on l.id = i.lease_id
union all
-- parking
select i.id, 'Parking ' || ps.label, 'estacionamiento'::line_category, 1::numeric, ps.monthly_fee
from ins i join public.parking_spaces ps on ps.lease_id = i.lease_id
union all
-- utilities already billed
select i.id,
       case uc.type when 'agua' then 'Water' when 'cuota_mantenimiento' then 'Common area fee' else 'Utility' end,
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
-- Spread across ACH, Zelle, check and money order, with a reference that
-- reads the way that method's reference actually reads.

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
    end as pay_amount,
    (array['ach','ach','zelle','check','money_order'])[(inv.rn % 5) + 1]::payment_method as pay_method,
    -- Derived from the invoice's row number, so it stays the key that ties
    -- each payment back to exactly one invoice.
    case (inv.rn % 5) + 1
      when 1 then 'ACH-' || lpad((7000000 + inv.rn * 137)::text, 9, '0')
      when 2 then 'ACH-' || lpad((7000000 + inv.rn * 137)::text, 9, '0')
      when 3 then 'Zelle ' || lpad((7000000 + inv.rn * 137)::text, 9, '0')
      when 4 then 'Check #' || lpad((7000000 + inv.rn * 137)::text, 9, '0')
      else 'MO ' || lpad((7000000 + inv.rn * 137)::text, 9, '0')
    end as pay_reference
  from inv
),
pay as (
  insert into public.payments (lease_id, amount, paid_at, method, reference, status, reported_by_tenant, confirmed_at)
  select
    p.lease_id,
    p.pay_amount,
    least(p.due_date + ((p.rn % 4))::int, current_date),
    p.pay_method,
    p.pay_reference,
    'confirmado',
    false,
    now()
  from payable p
  where p.pay_amount > 0
  returning id, amount, reference
)
insert into public.payment_allocations (payment_id, invoice_id, amount)
select pay.id, payable.id, pay.amount
from pay
join payable on payable.pay_reference = pay.reference;

-- Three self-reported payments waiting in the confirmation queue.
insert into public.payments (lease_id, amount, paid_at, method, reference, status, reported_by_tenant, notes)
select l.id, l.rent_amount, current_date - 1, 'zelle',
       'Zelle ' || lpad((9100000 + row_number() over ())::text, 9, '0'),
       'pendiente', true, 'Sent from my Chase account this morning.'
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
-- 15 orders across every status, category and source. Three are flagged as
-- health and safety; the first of those is deliberately past its 7-day
-- statutory window so the dashboard warning is visible in the demo.

insert into public.work_orders (unit_id, lease_id, reported_by_tenant, source, category, priority, title, description, status, affects_health_safety, written_notice_at, vendor_name, vendor_phone, cost, resolved_at, created_at)
select
  l.unit_id, l.id, lt.tenant_id,
  w.source, w.category, w.priority, w.title, w.description, w.status,
  w.health_safety,
  -- A portal submission IS the tenant's written notice under §92.052.
  case when w.source = 'portal' then now() - ((w.notice_days_ago) || ' days')::interval end,
  case when w.status in ('asignada','en_progreso','esperando_refacciones','resuelta','cerrada') then w.vendor end,
  case when w.status in ('asignada','en_progreso','esperando_refacciones','resuelta','cerrada') then '(915) 555-' || lpad((3000 + w.rn * 17)::text, 4, '0') end,
  case when w.status in ('resuelta','cerrada') then w.cost end,
  case when w.status in ('resuelta','cerrada') then now() - (w.rn || ' days')::interval end,
  now() - ((w.notice_days_ago) || ' days')::interval
from (values
  -- rn, source, category, priority, title, description, status, health_safety, notice_days_ago, vendor, cost
  (1,  'portal'::wo_source, 'plomeria'::wo_category,   'urgente'::wo_priority, 'No hot water in the unit',            'The water heater stopped working four days ago. Only cold water.', 'en_progreso'::wo_status,          true,  11, 'Franklin Plumbing',   485.00),
  (2,  'portal',            'electricidad',            'urgente',              'Sparking outlet in the kitchen',      'The outlet by the sink sparked when I plugged in the kettle.',      'asignada',                        true,   4, 'Rio Grande Electric', 310.00),
  (3,  'portal',            'otro',                    'alta',                 'Air conditioning out — 104F outside', 'The AC has not cooled since Saturday. It is unbearable inside.',     'nueva',                           true,   2, 'Desert Air HVAC',     640.00),
  (4,  'whatsapp',          'electricidad',            'alta',                 'Bedroom outlets dead',                'No power to any outlet in the main bedroom.',                       'asignada',                        false,  6, 'Rio Grande Electric', 190.00),
  (5,  'telefono',          'cerrajeria',              'media',                'Front door lock sticking',            'The key goes in but will not turn.',                                'en_progreso',                     false,  9, 'Sun City Lock',       145.00),
  (6,  'personal',          'electrodomesticos',       'media',                'Dishwasher not draining',             'Standing water in the bottom after every cycle.',                    'esperando_refacciones',           false, 12, 'Appliance Pros',      220.00),
  (7,  'portal',            'limpieza',                'baja',                 'Common laundry room needs cleaning',  'Lint and detergent spills have built up.',                          'resuelta',                        false, 15, 'Clean Sweep EP',       95.00),
  (8,  'portal',            'plomeria',                'alta',                 'Kitchen sink backing up',             'Water comes back up when the disposal runs.',                        'cerrada',                         false, 18, 'Franklin Plumbing',   265.00),
  (9,  'whatsapp',          'electricidad',            'urgente',              'Breaker tripping repeatedly',         'The main breaker has tripped twice today.',                         'en_progreso',                     false,  3, 'Rio Grande Electric', 380.00),
  (10, 'telefono',          'otro',                    'baja',                 'Gate remote not working',             'The parking gate remote stopped responding.',                        'nueva',                           false,  5, 'Access Controls TX',  120.00),
  (11, 'personal',          'plomeria',                'media',                'Dripping shower head',                'Drips constantly even when fully closed.',                          'asignada',                        false, 21, 'Franklin Plumbing',    85.00),
  (12, 'portal',            'electrodomesticos',       'alta',                 'Stove burners will not light',        'Two of the four burners do not ignite.',                            'resuelta',                        false, 24, 'Appliance Pros',      175.00),
  (13, 'portal',            'cerrajeria',              'urgente',              'Front door will not latch',           'The deadbolt is loose and the door does not secure.',                'cerrada',                         false, 27, 'Sun City Lock',       210.00),
  (14, 'telefono',          'limpieza',                'baja',                 'Trash piling up by the dumpster',     'Bags left outside the enclosure again.',                            'resuelta',                        false, 30, 'Clean Sweep EP',       60.00),
  (15, 'personal',          'otro',                    'media',                'Damp patch spreading on wall',        'A damp stain on the living room wall is getting bigger.',            'esperando_refacciones',           false, 33, 'El Paso Restoration', 950.00)
) as w(rn, source, category, priority, title, description, status, health_safety, notice_days_ago, vendor, cost)
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
  ('Vendor contacted, visit scheduled for tomorrow morning.', true),
  ('We have reached the vendor. The visit is scheduled for tomorrow between 9:00 and 12:00.', false)
) as n(body, is_internal) on true
where w.status <> 'nueva';

-- --------------------------------------------- a deposit clock, running
-- One terminated lease that has surrendered AND given a forwarding address,
-- so the "Deposits due" card and the compliance report both have a row.
-- Unit 31 by the same ordering the active leases used, so it does not
-- collide with them.

with target_unit as (
  select u.id, u.base_rent
  from public.units u join public.properties p on p.id = u.property_id
  where u.status = 'vacante'
  order by p.name, u.unit_number
  limit 1
),
ended as (
  insert into public.leases (
    unit_id, start_date, end_date, rent_amount, rent_due_day, grace_days,
    late_fee_type, late_fee_percent, late_fee_amount, deposit_amount, status,
    surrender_date, move_out_date, move_out_notes,
    forwarding_address, forwarding_address_received_at
  )
  select
    tu.id,
    (current_date - interval '14 months')::date,
    (current_date - interval '2 months')::date,
    tu.base_rent,
    1,
    2,
    'percent',
    10.00,
    0,
    tu.base_rent,
    'terminado',
    (current_date - interval '24 days')::date,
    (current_date - interval '24 days')::date,
    'Unit left clean. Carpet in the second bedroom is stained; keys and both remotes returned.',
    E'1200 Montana Ave, Apt 4\nEl Paso, TX 79902',
    (current_date - interval '18 days')::date
  from target_unit tu
  returning id
)
insert into public.lease_tenants (lease_id, tenant_id, role)
select ended.id, t.id, 'primary'
from ended
join lateral (
  select id from public.tenants order by created_at desc limit 1
) t on true;

-- ------------------------------------------------- two fresh move-ins
-- Added last, after the invoice run, because a tenant who took possession
-- this week genuinely has no invoice history yet. Their turnover checklists
-- are still in progress: one inside its 7-day rekey window, one already
-- past it, so both the amber and the red state of §92.156 are on screen.

with vacant as (
  select u.id, u.base_rent, row_number() over (order by p.name, u.unit_number) as rn
  from public.units u join public.properties p on p.id = u.property_id
  where u.status = 'vacante'
),
free_tenants as (
  select tn.id, row_number() over (order by tn.created_at, tn.id) as rn
  from public.tenants tn
  where not exists (select 1 from public.lease_tenants lt where lt.tenant_id = tn.id)
),
moved_in as (
  insert into public.leases (
    unit_id, start_date, end_date, rent_amount, rent_due_day, grace_days,
    late_fee_type, late_fee_percent, late_fee_amount, deposit_amount, status
  )
  select
    v.id,
    (current_date - d.days_ago)::date,
    (current_date - d.days_ago + interval '12 months' - interval '1 day')::date,
    v.base_rent, 1, 2, 'percent', 10.00, 0, v.base_rent, 'activo'
  from vacant v
  join (values (1, 4), (2, 9)) as d(rn, days_ago) on d.rn = v.rn
  returning id, unit_id, start_date
),
numbered_moves as (
  select m.*, row_number() over (order by m.start_date desc) as rn from moved_in m
),
tenanted as (
  insert into public.lease_tenants (lease_id, tenant_id, role)
  select nm.id, ft.id, 'primary'
  from numbered_moves nm join free_tenants ft on ft.rn = nm.rn
  returning lease_id
)
insert into public.unit_turnover_checklist (unit_id, lease_id, item, item_key, position, completed, completed_at)
select
  m.unit_id, m.id, c.item, c.item_key, c.position,
  -- The four-day-old move-in has made a start; the nine-day-old one has not,
  -- and its rekey is therefore two days past the statutory deadline.
  done.completed,
  case when done.completed then now() - interval '1 day' end
from numbered_moves m
cross join (values
  ('Rekey locks (required within 7 days)',          'rekey_locks',               0),
  ('Test smoke alarms',                             'test_smoke_alarms',         1),
  ('Verify deadbolt and keyless bolting device',    'verify_deadbolt_keyless',   2),
  ('Verify window latches',                         'verify_window_latches',     3),
  ('Document unit condition with photos',           'document_condition_photos', 4),
  ('Collect renters insurance certificate',         'collect_renters_insurance', 5)
) as c(item, item_key, position)
cross join lateral (
  select case
    when m.start_date > current_date - 7 then c.item_key in ('test_smoke_alarms', 'document_condition_photos')
    else false
  end as completed
) done;

update public.units u set status = 'ocupada'
where exists (select 1 from public.leases l where l.unit_id = u.id and l.status = 'activo');

commit;
