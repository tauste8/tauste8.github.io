-- AUTORECA IA — esquema inicial
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ───────────── Usuarios, sesiones y auditoría ─────────────
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'worker')),
  active BOOLEAN NOT NULL DEFAULT true,
  failed_logins INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                -- sha256 del token (el token nunca se guarda en claro)
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details JSONB,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log(created_at DESC);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE part_synonyms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term TEXT NOT NULL UNIQUE,
  part_code TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────── Archivos ─────────────
CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INT NOT NULL,
  storage_name TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────── CRM ─────────────
CREATE TABLE suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  type TEXT NOT NULL CHECK (type IN ('distribuidor', 'fabricante', 'concesionario', 'cat', 'desguace', 'otro')),
  location TEXT,
  catalog_info TEXT,
  commercial_terms TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  tax_id TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────── Vehículos ─────────────
CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plate TEXT UNIQUE,
  vin TEXT UNIQUE,
  make TEXT,
  model TEXT,
  generation TEXT,
  year INT,
  version TEXT,
  engine TEXT,
  engine_code TEXT,
  displacement_cc INT,
  power_kw INT,
  fuel TEXT,
  transmission TEXT,
  identification_source TEXT,
  identification_level TEXT NOT NULL DEFAULT 'parcial' CHECK (identification_level IN ('confirmada', 'parcial')),
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────── Integraciones / fuentes de datos ─────────────
CREATE TABLE data_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_key TEXT NOT NULL,
  name TEXT NOT NULL,
  data_kind TEXT NOT NULL CHECK (data_kind IN ('vehicle', 'oem', 'iam', 'offers_new', 'offers_used')),
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  verified_source BOOLEAN NOT NULL DEFAULT false,  -- la fuente garantiza datos técnicos verificados
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  credentials_enc TEXT,
  status TEXT NOT NULL DEFAULT 'sin_datos',
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE connector_logs (
  id BIGSERIAL PRIMARY KEY,
  source_id UUID REFERENCES data_sources(id) ON DELETE CASCADE,
  connector_key TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  message TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX connector_logs_idx ON connector_logs(connector_key, created_at DESC);

CREATE TABLE imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES data_sources(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mode TEXT NOT NULL,
  rows_total INT NOT NULL DEFAULT 0,
  rows_ok INT NOT NULL DEFAULT 0,
  rows_error INT NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────── Catálogo OEM ─────────────
CREATE TABLE oem_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oem_ref TEXT NOT NULL,              -- normalizada (solo A-Z0-9)
  oem_ref_display TEXT NOT NULL,
  vehicle_make TEXT NOT NULL,
  part_code TEXT,
  description TEXT NOT NULL,
  superseded_by TEXT,                 -- referencia normalizada que la sustituye
  specs JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_id UUID REFERENCES data_sources(id) ON DELETE CASCADE,
  source_label TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX oem_ref_src_uq ON oem_references(oem_ref, vehicle_make, COALESCE(source_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX oem_ref_part_idx ON oem_references(part_code);

CREATE TABLE oem_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oem_reference_id UUID NOT NULL REFERENCES oem_references(id) ON DELETE CASCADE,
  make TEXT NOT NULL,
  model TEXT,
  generation TEXT,
  year_from INT,
  year_to INT,
  engine_codes TEXT[] NOT NULL DEFAULT '{}',
  fuel TEXT,
  power_kw_from INT,
  power_kw_to INT,
  transmission TEXT,
  position TEXT,
  notes TEXT
);
CREATE INDEX oem_app_ref_idx ON oem_applications(oem_reference_id);
CREATE INDEX oem_app_make_idx ON oem_applications(lower(make));

-- ───────────── Equivalencias IAM ─────────────
CREATE TABLE cross_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oem_ref TEXT NOT NULL,
  iam_brand TEXT NOT NULL,
  iam_ref TEXT NOT NULL,              -- normalizada
  iam_ref_display TEXT NOT NULL,
  description TEXT,
  specs JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_id UUID REFERENCES data_sources(id) ON DELETE CASCADE,
  source_label TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX xref_uq ON cross_references(oem_ref, upper(iam_brand), iam_ref, COALESCE(source_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX xref_iam_idx ON cross_references(iam_ref);

-- ───────────── Ofertas de proveedores (nuevo) y centros CAT / desguaces (usado) ─────────────
CREATE TABLE offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  condition TEXT NOT NULL CHECK (condition IN ('nuevo', 'usado')),
  brand TEXT,
  ref TEXT,                           -- normalizada
  ref_display TEXT,
  oem_ref TEXT,                       -- normalizada
  part_code TEXT,
  description TEXT NOT NULL,
  price NUMERIC(12, 2),
  currency TEXT NOT NULL DEFAULT 'EUR',
  stock INT,
  availability TEXT,
  location TEXT,
  image_url TEXT,
  external_url TEXT,
  external_id TEXT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_year INT,
  vehicle_engine_code TEXT,
  vehicle_vin TEXT,
  specs JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_updated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX offers_ref_idx ON offers(ref);
CREATE INDEX offers_oem_idx ON offers(oem_ref);
CREATE INDEX offers_part_idx ON offers(part_code, condition);

-- ───────────── Inventario propio ─────────────
CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT UNIQUE,
  description TEXT NOT NULL,
  part_code TEXT,
  brand TEXT,
  oem_ref TEXT,
  oem_ref_display TEXT,
  iam_ref TEXT,
  iam_ref_display TEXT,
  condition TEXT NOT NULL CHECK (condition IN ('nuevo', 'usado')),
  purchase_price NUMERIC(12, 2),
  sale_price NUMERIC(12, 2),
  quantity INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  location TEXT,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_year INT,
  vehicle_engine_code TEXT,
  specs JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX inv_oem_idx ON inventory_items(oem_ref);
CREATE INDEX inv_iam_idx ON inventory_items(iam_ref);

CREATE TABLE inventory_photos (
  item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, file_id)
);

-- ───────────── Búsquedas ─────────────
CREATE TABLE searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  query_vehicle TEXT,
  query_part TEXT,
  query_ref TEXT,
  part_code TEXT,
  status TEXT NOT NULL,
  count_oem INT NOT NULL DEFAULT 0,
  count_iam INT NOT NULL DEFAULT 0,
  count_cat INT NOT NULL DEFAULT 0,
  duration_ms INT NOT NULL DEFAULT 0,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX searches_created_idx ON searches(created_at DESC);
CREATE INDEX searches_vehicle_idx ON searches(vehicle_id);

CREATE TABLE saved_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  search_id UUID REFERENCES searches(id) ON DELETE SET NULL,
  item JSONB NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────── Presupuestos y pedidos ─────────────
CREATE SEQUENCE quote_number_seq;
CREATE SEQUENCE order_number_seq;

CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number TEXT NOT NULL UNIQUE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador', 'enviado', 'aceptado', 'rechazado', 'convertido')),
  vat_rate NUMERIC(5, 2) NOT NULL DEFAULT 21,
  global_discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 0,
  valid_until DATE,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE quote_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  brand TEXT,
  ref TEXT,
  oem_ref TEXT,
  condition TEXT,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  source_label TEXT,
  cost_price NUMERIC(12, 2),
  margin_pct NUMERIC(6, 2),
  unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
  discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 0
);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number TEXT NOT NULL UNIQUE,
  quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'solicitado_proveedor', 'recibido', 'entregado', 'cancelado')),
  vat_rate NUMERIC(5, 2) NOT NULL DEFAULT 21,
  global_discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  brand TEXT,
  ref TEXT,
  oem_ref TEXT,
  condition TEXT,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  source_label TEXT,
  cost_price NUMERIC(12, 2),
  margin_pct NUMERIC(6, 2),
  unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
  discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 0
);
