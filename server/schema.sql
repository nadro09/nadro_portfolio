-- AUDIOLEF platform schema (PostgreSQL)
-- Idempotent: safe to run on every boot.

CREATE TABLE IF NOT EXISTS wilayas (
  id            integer PRIMARY KEY,
  name_ar       text NOT NULL,
  name_fr       text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roles (
  id            serial PRIMARY KEY,
  key           text NOT NULL UNIQUE,
  name_ar       text NOT NULL,
  name_fr       text NOT NULL,
  description_ar text,
  description_fr text,
  is_system     boolean NOT NULL DEFAULT false,
  all_centers   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS permissions (
  id            serial PRIMARY KEY,
  key           text NOT NULL UNIQUE,
  category      text NOT NULL,
  name_ar       text NOT NULL,
  name_fr       text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        integer NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id  integer NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS services (
  id            serial PRIMARY KEY,
  slug          text NOT NULL UNIQUE,
  name_ar       text NOT NULL,
  name_fr       text NOT NULL,
  description_ar text NOT NULL DEFAULT '',
  description_fr text NOT NULL DEFAULT '',
  duration_min  integer,
  duration_max  integer,
  icon          text NOT NULL DEFAULT 'ear',
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS centers (
  id            serial PRIMARY KEY,
  code          text NOT NULL UNIQUE,
  name_ar       text NOT NULL,
  name_fr       text NOT NULL,
  wilaya_id     integer NOT NULL REFERENCES wilayas(id),
  city_ar       text NOT NULL,
  city_fr       text NOT NULL,
  address_ar    text NOT NULL DEFAULT '',
  address_fr    text NOT NULL DEFAULT '',
  latitude      numeric(9,6),
  longitude     numeric(9,6),
  phone_primary text,
  phone_secondary text,
  email         text,
  opening_hours_ar text,
  opening_hours_fr text,
  is_active     boolean NOT NULL DEFAULT true,
  is_demo       boolean NOT NULL DEFAULT false,
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_centers_wilaya ON centers(wilaya_id);
CREATE INDEX IF NOT EXISTS idx_centers_active ON centers(is_active) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS center_services (
  center_id   integer NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  service_id  integer NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (center_id, service_id)
);

CREATE TABLE IF NOT EXISTS employees (
  id            serial PRIMARY KEY,
  full_name     text NOT NULL,
  username      text NOT NULL UNIQUE,
  email         text NOT NULL UNIQUE,
  phone         text,
  password_hash text NOT NULL,
  avatar_path   text,
  center_id     integer REFERENCES centers(id),
  job_title_ar  text,
  job_title_fr  text,
  language_pref text NOT NULL DEFAULT 'ar',
  is_active     boolean NOT NULL DEFAULT true,
  is_demo       boolean NOT NULL DEFAULT false,
  must_change_password boolean NOT NULL DEFAULT false,
  last_login_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employees_center ON employees(center_id);

CREATE TABLE IF NOT EXISTS employee_roles (
  employee_id  integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  role_id      integer NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (employee_id, role_id)
);

CREATE TABLE IF NOT EXISTS customers (
  id            serial PRIMARY KEY,
  full_name     text NOT NULL,
  phone         text NOT NULL,
  email         text,
  wilaya_id     integer REFERENCES wilayas(id),
  city          text,
  notes         text,
  assigned_employee_id integer REFERENCES employees(id),
  is_demo       boolean NOT NULL DEFAULT false,
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customers_wilaya ON customers(wilaya_id);

CREATE TABLE IF NOT EXISTS customer_notes (
  id            serial PRIMARY KEY,
  customer_id   integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  employee_id   integer REFERENCES employees(id),
  body          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_notes_customer ON customer_notes(customer_id);

CREATE TABLE IF NOT EXISTS customer_contacts (
  id            serial PRIMARY KEY,
  customer_id   integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  employee_id   integer REFERENCES employees(id),
  channel       text NOT NULL DEFAULT 'phone',
  summary       text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id            serial PRIMARY KEY,
  reference     text NOT NULL UNIQUE,
  customer_id   integer REFERENCES customers(id),
  customer_name text NOT NULL,
  phone         text NOT NULL,
  wilaya_id     integer REFERENCES wilayas(id),
  city          text,
  center_id     integer REFERENCES centers(id),
  service_id    integer REFERENCES services(id),
  preferred_date date,
  preferred_time text,
  notes         text,
  status        text NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new','in_review','contacted','confirmed','completed','cancelled','no_show')),
  assigned_employee_id integer REFERENCES employees(id),
  confirmed_date date,
  confirmed_time text,
  internal_notes text,
  contact_result text,
  source        text NOT NULL DEFAULT 'website',
  is_demo       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_center ON bookings(center_id);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings(phone);

CREATE TABLE IF NOT EXISTS booking_history (
  id            serial PRIMARY KEY,
  booking_id    integer NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  employee_id   integer REFERENCES employees(id),
  action        text NOT NULL,
  old_value     text,
  new_value     text,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_booking_history_booking ON booking_history(booking_id);

CREATE TABLE IF NOT EXISTS contact_messages (
  id            serial PRIMARY KEY,
  full_name     text NOT NULL,
  phone         text NOT NULL,
  email         text,
  wilaya_id     integer REFERENCES wilayas(id),
  subject       text NOT NULL,
  body          text NOT NULL,
  status        text NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new','in_progress','replied','closed')),
  assigned_employee_id integer REFERENCES employees(id),
  internal_notes text,
  is_demo       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages(status);

CREATE TABLE IF NOT EXISTS contact_message_history (
  id            serial PRIMARY KEY,
  message_id    integer NOT NULL REFERENCES contact_messages(id) ON DELETE CASCADE,
  employee_id   integer REFERENCES employees(id),
  action        text NOT NULL,
  old_value     text,
  new_value     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS internal_conversations (
  id            serial PRIMARY KEY,
  subject       text NOT NULL,
  created_by    integer REFERENCES employees(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id integer NOT NULL REFERENCES internal_conversations(id) ON DELETE CASCADE,
  employee_id     integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  last_read_at    timestamptz,
  PRIMARY KEY (conversation_id, employee_id)
);

CREATE TABLE IF NOT EXISTS internal_messages (
  id            serial PRIMARY KEY,
  conversation_id integer NOT NULL REFERENCES internal_conversations(id) ON DELETE CASCADE,
  sender_id     integer REFERENCES employees(id),
  body          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_internal_messages_conversation ON internal_messages(conversation_id);

CREATE TABLE IF NOT EXISTS attachments (
  id            serial PRIMARY KEY,
  uploader_id   integer REFERENCES employees(id),
  entity_type   text NOT NULL,
  entity_id     integer,
  original_name text NOT NULL,
  stored_name   text NOT NULL,
  mime_type     text NOT NULL,
  size_bytes    integer NOT NULL,
  is_public     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id            serial PRIMARY KEY,
  employee_id   integer NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type          text NOT NULL,
  title_ar      text NOT NULL,
  title_fr      text NOT NULL,
  body_ar       text,
  body_fr       text,
  link          text,
  entity_type   text,
  entity_id     integer,
  is_read       boolean NOT NULL DEFAULT false,
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_employee ON notifications(employee_id, is_read);

CREATE TABLE IF NOT EXISTS website_content (
  id            serial PRIMARY KEY,
  key           text NOT NULL UNIQUE,
  section       text NOT NULL DEFAULT 'general',
  type          text NOT NULL DEFAULT 'text',
  value_ar      text NOT NULL DEFAULT '',
  value_fr      text NOT NULL DEFAULT '',
  draft_ar      text,
  draft_fr      text,
  updated_by    integer REFERENCES employees(id),
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_versions (
  id            serial PRIMARY KEY,
  content_key   text NOT NULL,
  value_ar      text NOT NULL DEFAULT '',
  value_fr      text NOT NULL DEFAULT '',
  published_by  integer REFERENCES employees(id),
  published_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_versions_key ON content_versions(content_key);

CREATE TABLE IF NOT EXISTS faqs (
  id            serial PRIMARY KEY,
  question_ar   text NOT NULL,
  question_fr   text NOT NULL,
  answer_ar     text NOT NULL,
  answer_fr     text NOT NULL,
  sort_order    integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id            serial PRIMARY KEY,
  employee_id   integer REFERENCES employees(id),
  actor_name    text NOT NULL,
  action        text NOT NULL,
  entity_type   text NOT NULL,
  entity_id     text,
  old_values    jsonb,
  new_values    jsonb,
  ip            text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_employee ON audit_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS system_settings (
  key           text PRIMARY KEY,
  value         text NOT NULL DEFAULT '',
  updated_by    integer REFERENCES employees(id),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id            serial PRIMARY KEY,
  username      text,
  ip            text,
  successful    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(ip, created_at DESC);

-- Session store (connect-pg-simple)
CREATE TABLE IF NOT EXISTS "session" (
  "sid"    varchar NOT NULL COLLATE "default",
  "sess"   json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wilayas','roles','services','centers','employees','customers','bookings',
                           'contact_messages','internal_conversations','website_content','faqs','system_settings']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated ON %1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated BEFORE UPDATE ON %1$I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
END;
$$;
