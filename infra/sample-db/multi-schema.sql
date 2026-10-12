-- More schemas for the sample database, so a schema refresh reads more than public.
-- Runs after init.sql on a fresh volume. To add it to an existing volume:
--   docker compose exec -T sample-db psql -v ON_ERROR_STOP=1 -U sample_admin -d sample < infra/sample-db/multi-schema.sql

CREATE SCHEMA inventory;

CREATE TABLE inventory.warehouses (
  id integer PRIMARY KEY,
  name text NOT NULL,
  region text NOT NULL
);

CREATE TABLE inventory.stock_levels (
  warehouse_id integer NOT NULL REFERENCES inventory.warehouses (id),
  product_id integer NOT NULL REFERENCES public.products (id),
  on_hand integer NOT NULL,
  PRIMARY KEY (warehouse_id, product_id)
);

INSERT INTO inventory.warehouses (id, name, region) VALUES
  (1, 'North depot', 'North'),
  (2, 'South depot', 'South');

INSERT INTO inventory.stock_levels (warehouse_id, product_id, on_hand) VALUES
  (1, 1, 120),
  (1, 2, 80),
  (1, 3, 300),
  (2, 4, 150),
  (2, 5, 40);

CREATE SCHEMA support;

-- contact_phone is personal data, so a schema refresh starts it hidden.
CREATE TABLE support.tickets (
  id integer PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES public.customers (id),
  opened_on date NOT NULL,
  status text NOT NULL,
  contact_phone text
);

INSERT INTO support.tickets (id, customer_id, opened_on, status, contact_phone) VALUES
  (1, 1, '2025-08-06', 'closed', '+1-555-0101'),
  (2, 3, '2025-09-03', 'open', '+1-555-0103'),
  (3, 2, '2025-09-22', 'closed', NULL);

-- sample_ro gets no access here, so a refresh must never list this schema.
CREATE SCHEMA finance;

CREATE TABLE finance.payroll (
  employee text NOT NULL,
  salary numeric(12, 2) NOT NULL
);

INSERT INTO finance.payroll (employee, salary) VALUES ('A. Example', 52000.00);

GRANT USAGE ON SCHEMA inventory, support TO sample_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA inventory, support TO sample_ro;
