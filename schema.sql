-- =====================================================================
--  RKK Inventory App — SQLite schema (3NF)
--  Engine: sql.js (WASM) via @octokit/rest, mirroring raghavakk-campaign-app/lib/db.ts
--  Storage: single `inventory.sqlite` blob in private repo ragskk/raghavakk-inventory-data
--  Idempotent: all DDL is CREATE … IF NOT EXISTS — safe on every open
--  Foreign keys: enable at connection time → PRAGMA foreign_keys = ON;
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- 0. meta
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1');

-- ---------------------------------------------------------------------
-- 1. users
--     Allow-listed accounts that can edit. Mirrors campaign-app pattern.
--     `role` controls write access. Galleries/dealers do NOT log in here;
--     their access is via signed share-links instead.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('artist','studio_admin','registrar')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  active     INTEGER NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------
-- 2. series  (parent of every artwork)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS series (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  code                TEXT UNIQUE NOT NULL,      -- 2–4 letters: IB, ANF, etc. Used in inventory_number.
  slug                TEXT UNIQUE NOT NULL,      -- impossible-bouquet
  name                TEXT NOT NULL,             -- The Impossible Bouquet
  iteration           TEXT,                      -- "2.0", "2.1" — null if N/A
  short_description   TEXT,
  full_description    TEXT,
  cover_image_id      INTEGER,                   -- FK → artwork_images(id); deferred
  website_visible     INTEGER NOT NULL DEFAULT 0,
  display_order       INTEGER,
  next_seq            INTEGER NOT NULL DEFAULT 1,-- atomic counter for inventory_number generation
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_series_display ON series(display_order);

-- ---------------------------------------------------------------------
-- 3. mediums  (controlled vocabulary)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mediums (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT UNIQUE NOT NULL,              -- "Oil on canvas", "Bronze, edition", etc.
  slug        TEXT UNIQUE NOT NULL,
  category    TEXT NOT NULL CHECK (category IN
                ('painting','sculpture','drawing','print','photograph',
                 'mixed','digital','installation','other'))
);

-- ---------------------------------------------------------------------
-- 4. editions  (concept-level row for editioned works — uniques skip this)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS editions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id           INTEGER NOT NULL REFERENCES series(id),
  title               TEXT NOT NULL,
  year_start          INTEGER NOT NULL,
  year_end            INTEGER,
  medium_id           INTEGER REFERENCES mediums(id),
  edition_size        INTEGER NOT NULL CHECK (edition_size >= 1),
  ap_size             INTEGER NOT NULL DEFAULT 0 CHECK (ap_size >= 0),
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_editions_series ON editions(series_id);

-- ---------------------------------------------------------------------
-- 5. artworks  (one row per physical object)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artworks (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_number    TEXT UNIQUE NOT NULL,      -- RKK-IB-014 | RKK-IB-014/E03 | RKK-IB-014/AP1
  series_id           INTEGER NOT NULL REFERENCES series(id),
  edition_id          INTEGER REFERENCES editions(id),  -- NULL for uniques
  edition_number      INTEGER,                   -- 1..edition_size; NULL for uniques + APs
  artist_proof        INTEGER NOT NULL DEFAULT 0,
  ap_number           INTEGER,                   -- 1..ap_size; NULL unless artist_proof = 1

  title               TEXT NOT NULL,
  slug                TEXT UNIQUE NOT NULL,      -- used in URLs

  year_start          INTEGER NOT NULL,
  year_end            INTEGER,
  medium_id           INTEGER REFERENCES mediums(id),
  materials           TEXT,                      -- free-text addendum to medium

  height_in           REAL NOT NULL,             -- inches (canonical unit)
  width_in            REAL NOT NULL,
  depth_in            REAL,
  framed_height_in    REAL,
  framed_width_in     REAL,
  framed_depth_in     REAL,
  weight_kg           REAL,                      -- kept metric; global shipping defaults to kg

  short_description   TEXT,                      -- public-facing one-liner
  full_description    TEXT,                      -- public-facing long form
  artist_note         TEXT,                      -- public-facing artist's statement
  internal_note       TEXT,                      -- registrar-only; NEVER appears in shares/PDFs

  -- pricing — USD and INR stored separately, no FX
  price_usd_cents     INTEGER,                   -- 12500 = $125.00; NULL = no asking price
  price_inr_paise     INTEGER,                   -- 1250000 = ₹12,500.00; NULL = no asking price
  price_visible_public INTEGER NOT NULL DEFAULT 0,
  price_visible_dealer INTEGER NOT NULL DEFAULT 1,

  -- current status (history lives in *_history tables below)
  availability_status TEXT NOT NULL DEFAULT 'available' CHECK (availability_status IN
                       ('available','on_hold','reserved','sold','not_for_sale','withdrawn')),
  condition_status    TEXT NOT NULL DEFAULT 'good' CHECK (condition_status IN
                       ('pristine','good','fair','needs_attention','damaged','lost','destroyed')),

  -- visibility on the public website (this app is also CMS for raghavakkstudio.com)
  website_visible     INTEGER NOT NULL DEFAULT 0,
  featured            INTEGER NOT NULL DEFAULT 0,
  display_order       INTEGER,
  seo_title           TEXT,
  seo_description     TEXT,

  primary_image_id    INTEGER,                   -- FK → artwork_images(id); deferred

  is_archived         INTEGER NOT NULL DEFAULT 0,
  archived_at         TEXT,
  archived_reason     TEXT,

  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),

  CHECK ((edition_id IS NULL) OR (edition_number IS NOT NULL) OR (artist_proof = 1)),
  CHECK ((artist_proof = 0) OR (ap_number IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_artworks_series        ON artworks(series_id);
CREATE INDEX IF NOT EXISTS idx_artworks_edition       ON artworks(edition_id);
CREATE INDEX IF NOT EXISTS idx_artworks_availability  ON artworks(availability_status);
CREATE INDEX IF NOT EXISTS idx_artworks_website       ON artworks(website_visible, display_order);
CREATE INDEX IF NOT EXISTS idx_artworks_archived      ON artworks(is_archived);

-- ---------------------------------------------------------------------
-- 6. artwork_images
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artwork_images (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  artwork_id    INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  image_type    TEXT NOT NULL CHECK (image_type IN
                 ('main','detail','process','studio','installation','mockup')),
  -- blob lives in raghavakk-inventory-data repo at images/<artwork_id>/<variant>.jpg
  -- variant = 'hero' (2000px) | 'thumb' (400px) | 'label' (1200px)
  -- this row is metadata; bytes are served by /api/work-image/[id]/[variant]
  source_url    TEXT,                            -- original (Drive lh3 fallback), null after backfill
  caption       TEXT,
  alt_text      TEXT,
  credit        TEXT,                            -- "Photo: Tushar Sabharwal"
  display_order INTEGER NOT NULL DEFAULT 0,
  visibility    TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN
                 ('internal','dealer_share','public_website')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_images_artwork ON artwork_images(artwork_id, display_order);
CREATE INDEX IF NOT EXISTS idx_images_visibility ON artwork_images(visibility);

-- ---------------------------------------------------------------------
-- 7. tags  (cross-cutting themes / motifs — orthogonal to series)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT UNIQUE NOT NULL,
  name         TEXT UNIQUE NOT NULL,
  description  TEXT,
  display_order INTEGER
);

CREATE TABLE IF NOT EXISTS artwork_tags (
  artwork_id INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (artwork_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_artwork_tags_tag ON artwork_tags(tag_id);

-- ---------------------------------------------------------------------
-- 8. locations
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS locations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,                   -- "Studio NY", "Studio Bangalore", "Aicon Gallery"
  type          TEXT NOT NULL CHECK (type IN
                 ('studio','storage','gallery','collector','exhibition','shipper','transit','other')),
  address       TEXT,
  city          TEXT,
  country       TEXT,
  contact_id    INTEGER REFERENCES contacts(id), -- forward FK; resolves once contacts table exists at insert time
  notes         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_locations_type ON locations(type);

-- ---------------------------------------------------------------------
-- 9. location_history  (per-artwork audit log of physical location changes)
--     Current location = the most recent row where to_date IS NULL.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS location_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  artwork_id     INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  location_id    INTEGER NOT NULL REFERENCES locations(id),
  specific_place TEXT,                            -- rack, shelf, crate, room, wall
  from_date      TEXT NOT NULL,
  to_date        TEXT,                            -- NULL = still there
  reason         TEXT NOT NULL CHECK (reason IN
                  ('storage','consignment','exhibition','loan','sale','shipping','return','intake')),
  recorded_by    INTEGER REFERENCES users(id),
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_loc_history_artwork ON location_history(artwork_id, from_date DESC);
CREATE INDEX IF NOT EXISTS idx_loc_history_current ON location_history(artwork_id) WHERE to_date IS NULL;

-- ---------------------------------------------------------------------
-- 10. condition_reports  (per-artwork audit log)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS condition_reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  artwork_id   INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  reported_at  TEXT NOT NULL DEFAULT (datetime('now')),
  status       TEXT NOT NULL CHECK (status IN
                ('pristine','good','fair','needs_attention','damaged','lost','destroyed')),
  description  TEXT NOT NULL,
  action_taken TEXT,                              -- "Cleaned + revarnished", "Sent to conservator"
  reported_by  INTEGER REFERENCES users(id),
  document_id  INTEGER REFERENCES documents(id), -- attached condition_report PDF if any
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_condition_artwork ON condition_reports(artwork_id, reported_at DESC);

-- ---------------------------------------------------------------------
-- 11. price_history  (audit log of asking prices; sale_price lives on sales)
--      Both USD and INR captured per row — track currency pair drift over time.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_history (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  artwork_id         INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  effective_at       TEXT NOT NULL DEFAULT (datetime('now')),
  price_usd_cents    INTEGER,
  price_inr_paise    INTEGER,
  set_by             INTEGER REFERENCES users(id),
  reason             TEXT,                       -- "Initial pricing", "Adjusted for fair", "Post-sale"
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_price_artwork ON price_history(artwork_id, effective_at DESC);

-- ---------------------------------------------------------------------
-- 12. contacts  (galleries, dealers, collectors, agents, institutions, press)
--     Single contacts table avoids duplicating Gallery-X across sales/sales_rights/locations.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contacts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT NOT NULL CHECK (type IN
                ('collector','gallery','dealer','agent','institution','press','other')),
  name         TEXT NOT NULL,                    -- person OR org name
  org_name     TEXT,                             -- if person belongs to org
  email        TEXT,
  phone        TEXT,
  address      TEXT,
  city         TEXT,
  country      TEXT,
  notes        TEXT,                             -- registrar-only
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_type ON contacts(type);
CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts(name);

-- ---------------------------------------------------------------------
-- 13. sales_rights  (consignment / who can sell this work)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_rights (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  artwork_id          INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  seller_contact_id   INTEGER NOT NULL REFERENCES contacts(id),
  exclusive           INTEGER NOT NULL DEFAULT 0,
  territory           TEXT,                       -- "Worldwide", "India only", "North America"
  commission_percent  REAL NOT NULL CHECK (commission_percent BETWEEN 0 AND 100),
  start_date          TEXT NOT NULL,
  end_date            TEXT,                       -- NULL = open-ended
  agreement_doc_id    INTEGER REFERENCES documents(id),
  notes               TEXT,
  active              INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rights_artwork ON sales_rights(artwork_id, active);
CREATE INDEX IF NOT EXISTS idx_rights_seller  ON sales_rights(seller_contact_id);

-- ---------------------------------------------------------------------
-- 14. sales  (one row per completed sale)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  artwork_id          INTEGER NOT NULL REFERENCES artworks(id),
  buyer_contact_id    INTEGER REFERENCES contacts(id),   -- NULL = anonymous
  seller_contact_id   INTEGER REFERENCES contacts(id),   -- gallery/dealer if not direct studio sale
  sale_price_usd_cents INTEGER,
  sale_price_inr_paise INTEGER,
  sale_date           TEXT NOT NULL,
  commission_percent  REAL,                       -- frozen at sale time from sales_rights
  invoice_doc_id      INTEGER REFERENCES documents(id),
  coa_doc_id          INTEGER REFERENCES documents(id),
  payment_status      TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN
                       ('unpaid','partial','paid','refunded')),
  delivery_status     TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN
                       ('pending','in_transit','delivered','returned')),
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sales_artwork ON sales(artwork_id);
CREATE INDEX IF NOT EXISTS idx_sales_date    ON sales(sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_buyer   ON sales(buyer_contact_id);

-- ---------------------------------------------------------------------
-- 15. documents  (COA, invoice, condition report, appraisal, insurance, shipping, agreement)
--      File bytes stored in raghavakk-inventory-data at documents/<doc_id>.pdf
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  artwork_id    INTEGER REFERENCES artworks(id) ON DELETE SET NULL,
  document_type TEXT NOT NULL CHECK (document_type IN
                 ('coa','invoice','condition_report','appraisal','insurance','shipping','agreement','other')),
  title         TEXT NOT NULL,
  file_path     TEXT,                              -- documents/<doc_id>.pdf in data repo
  source_url    TEXT,                              -- external URL if not blobbed yet
  issued_date   TEXT,
  visibility    TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN
                 ('internal','dealer_share','public_website')),
  notes         TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_docs_artwork ON documents(artwork_id);
CREATE INDEX IF NOT EXISTS idx_docs_type    ON documents(document_type);

-- ---------------------------------------------------------------------
-- 16. exhibitions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exhibitions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  venue        TEXT NOT NULL,
  city         TEXT,
  country      TEXT,
  start_date   TEXT,
  end_date     TEXT,
  website_url  TEXT,
  curator      TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_exhibitions_date ON exhibitions(start_date DESC);

-- junction: m:n between artworks and exhibitions
CREATE TABLE IF NOT EXISTS artwork_exhibitions (
  artwork_id      INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  exhibition_id   INTEGER NOT NULL REFERENCES exhibitions(id) ON DELETE CASCADE,
  display_title   TEXT,                             -- if shown under a different title at this exhibition
  notes           TEXT,
  PRIMARY KEY (artwork_id, exhibition_id)
);
CREATE INDEX IF NOT EXISTS idx_artex_exhibition ON artwork_exhibitions(exhibition_id);

-- ---------------------------------------------------------------------
-- 17. provenance  (ownership chain — separate from sales so it can predate the studio)
--      Sales rows generate provenance entries; manual ones cover prior history.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provenance (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  artwork_id      INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  owner_contact_id INTEGER REFERENCES contacts(id),  -- NULL for "Private collection, [city]"
  display_owner   TEXT,                              -- e.g. "Private collection, Mumbai"
  acquired_from   TEXT,                              -- gallery / auction / studio
  acquired_at     TEXT,                              -- ISO date or year
  released_at     TEXT,                              -- when this owner stopped owning it
  citation        TEXT,                              -- catalogue/publication reference
  sale_id         INTEGER REFERENCES sales(id),      -- if this entry was generated from a sale
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_provenance_artwork ON provenance(artwork_id, acquired_at);

-- ---------------------------------------------------------------------
-- 18. mockups  (interior-room visualizations for dealer shares)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mockups (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  artwork_id        INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  source_image_id   INTEGER REFERENCES artwork_images(id),
  mockup_path       TEXT NOT NULL,                  -- mockups/<id>.jpg in data repo
  interior_type     TEXT,                            -- "Living room", "Office", "Gallery white wall"
  room_description  TEXT,
  scale_notes       TEXT,
  visibility        TEXT NOT NULL DEFAULT 'dealer_share' CHECK (visibility IN
                     ('internal','dealer_share','public_website')),
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mockups_artwork ON mockups(artwork_id);

-- ---------------------------------------------------------------------
-- 19. share_links  (signed per-work and per-selection URLs sent to dealers)
--      Per Raghava's spec: "all three depending on context" — link / portal / PDF.
--      This table covers the link mode. PDF dossiers are generated on demand
--      from the same data + sometimes pinned to a share_link.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS share_links (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  token           TEXT UNIQUE NOT NULL,             -- url-safe random, 32+ chars
  label           TEXT NOT NULL,                    -- "For Aicon Mumbai, June 2026"
  recipient_name  TEXT,
  recipient_email TEXT,
  expires_at      TEXT,                             -- NULL = no expiry
  password_hash   TEXT,                             -- optional passcode
  show_prices     INTEGER NOT NULL DEFAULT 1,
  show_internal_notes INTEGER NOT NULL DEFAULT 0,   -- always 0 in v1
  revoked_at      TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token);

CREATE TABLE IF NOT EXISTS share_link_artworks (
  share_link_id INTEGER NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
  artwork_id    INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (share_link_id, artwork_id)
);

CREATE TABLE IF NOT EXISTS share_link_opens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  share_link_id INTEGER NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
  opened_at     TEXT NOT NULL DEFAULT (datetime('now')),
  ip_hash       TEXT,                                -- never store raw IP
  user_agent    TEXT
);
CREATE INDEX IF NOT EXISTS idx_share_opens_link ON share_link_opens(share_link_id, opened_at DESC);

-- =====================================================================
--  end of schema  v1
-- =====================================================================
