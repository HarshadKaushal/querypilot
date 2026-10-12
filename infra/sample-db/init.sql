-- Local sample business database. This stands in for a customer's PostgreSQL.
-- It is not the application database. Passwords here are for local development only.

CREATE TABLE customers (
  id integer PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  region text NOT NULL,
  created_at date NOT NULL
);

CREATE TABLE products (
  id integer PRIMARY KEY,
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL,
  unit_price numeric(12, 2) NOT NULL
);

CREATE TABLE orders (
  id integer PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers (id),
  ordered_on date NOT NULL,
  status text NOT NULL
);

CREATE TABLE order_items (
  id integer PRIMARY KEY,
  order_id integer NOT NULL REFERENCES orders (id),
  product_id integer NOT NULL REFERENCES products (id),
  quantity integer NOT NULL,
  unit_price numeric(12, 2) NOT NULL
);

CREATE TABLE payments (
  id integer PRIMARY KEY,
  order_id integer NOT NULL REFERENCES orders (id),
  paid_on date NOT NULL,
  method text NOT NULL,
  amount numeric(12, 2) NOT NULL
);

INSERT INTO customers (id, name, email, region, created_at) VALUES
  (1, 'Northwind Grocers', 'ap@northwind.example', 'North', '2024-11-02'),
  (2, 'Harbor Books', 'finance@harborbooks.example', 'East', '2025-01-18'),
  (3, 'Cedar Clinic', 'ops@cedarclinic.example', 'West', '2025-02-03'),
  (4, 'Lumen Apparel', 'billing@lumenapparel.example', 'South', '2025-03-11'),
  (5, 'Fieldstone Cafe', 'owner@fieldstone.example', 'North', '2025-06-21');

INSERT INTO products (id, sku, name, category, unit_price) VALUES
  (1, 'COF-1KG', 'House coffee beans', 'Grocery', 18.00),
  (2, 'TEA-TIN', 'Breakfast tea tin', 'Grocery', 9.50),
  (3, 'NBK-A5', 'A5 notebook', 'Stationery', 6.00),
  (4, 'PN-SET', 'Pen set', 'Stationery', 12.00),
  (5, 'MUG-12', 'Ceramic mug', 'Home', 14.00);

INSERT INTO orders (id, customer_id, ordered_on, status) VALUES
  (1, 1, '2025-07-02', 'fulfilled'),
  (2, 2, '2025-07-15', 'fulfilled'),
  (3, 1, '2025-08-04', 'fulfilled'),
  (4, 3, '2025-08-19', 'fulfilled'),
  (5, 4, '2025-09-01', 'fulfilled'),
  (6, 5, '2025-09-12', 'cancelled'),
  (7, 2, '2025-09-20', 'fulfilled'),
  (8, 1, '2025-10-01', 'open');

INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES
  (1, 1, 1, 20, 18.00),
  (2, 1, 2, 10, 9.50),
  (3, 2, 3, 40, 6.00),
  (4, 2, 4, 15, 12.00),
  (5, 3, 1, 12, 18.00),
  (6, 4, 5, 30, 14.00),
  (7, 5, 3, 25, 6.00),
  (8, 5, 4, 25, 12.00),
  (9, 6, 2, 8, 9.50),
  (10, 7, 3, 10, 6.00),
  (11, 7, 5, 6, 14.00),
  (12, 8, 1, 8, 18.00);

INSERT INTO payments (id, order_id, paid_on, method, amount) VALUES
  (1, 1, '2025-07-03', 'card', 455.00),
  (2, 2, '2025-07-16', 'transfer', 420.00),
  (3, 3, '2025-08-05', 'card', 216.00),
  (4, 4, '2025-08-20', 'card', 420.00),
  (5, 5, '2025-09-02', 'transfer', 450.00),
  (6, 7, '2025-09-21', 'card', 144.00);

CREATE ROLE sample_ro LOGIN PASSWORD 'sample_ro_password';
GRANT CONNECT ON DATABASE sample TO sample_ro;
GRANT USAGE ON SCHEMA public TO sample_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO sample_ro;
