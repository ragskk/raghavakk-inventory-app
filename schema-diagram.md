# RKK Inventory — ER diagram

19 tables, 3NF. Companion to `schema.sql`.

```mermaid
erDiagram
    users {
        int id PK
        text email UK
        text role
    }

    series ||--o{ editions : "groups"
    series ||--o{ artworks : "contains"
    series {
        int id PK
        text code UK
        text slug UK
        text name
        text iteration
        int next_seq
    }

    mediums ||--o{ editions : "categorizes"
    mediums ||--o{ artworks : "categorizes"
    mediums {
        int id PK
        text slug UK
        text category
    }

    editions ||--o{ artworks : "spawns copies"
    editions {
        int id PK
        int series_id FK
        int edition_size
        int ap_size
    }

    artworks ||--o{ artwork_images : "has"
    artworks ||--o{ artwork_tags : "tagged"
    artworks ||--o{ location_history : "moved"
    artworks ||--o{ condition_reports : "inspected"
    artworks ||--o{ price_history : "priced"
    artworks ||--o{ sales_rights : "consigned"
    artworks ||--o{ sales : "sold"
    artworks ||--o{ documents : "documented"
    artworks ||--o{ artwork_exhibitions : "exhibited"
    artworks ||--o{ provenance : "owned"
    artworks ||--o{ mockups : "visualized"
    artworks {
        int id PK
        text inventory_number UK
        int series_id FK
        int edition_id FK
        int edition_number
        int artist_proof
        int ap_number
        text title
        int year_start
        real height_in
        real width_in
        int price_usd_cents
        int price_inr_paise
        text availability_status
        text condition_status
        int website_visible
        int is_archived
    }

    artwork_images {
        int id PK
        int artwork_id FK
        text image_type
        text visibility
    }

    tags ||--o{ artwork_tags : "applied"
    artwork_tags {
        int artwork_id PK,FK
        int tag_id PK,FK
    }

    locations ||--o{ location_history : "houses"
    locations {
        int id PK
        text name
        text type
        int contact_id FK
    }

    location_history {
        int id PK
        int artwork_id FK
        int location_id FK
        text from_date
        text to_date
        text reason
    }

    condition_reports {
        int id PK
        int artwork_id FK
        text reported_at
        text status
        int document_id FK
    }

    price_history {
        int id PK
        int artwork_id FK
        text effective_at
        int price_usd_cents
        int price_inr_paise
    }

    contacts ||--o{ locations : "owns"
    contacts ||--o{ sales_rights : "sells_via"
    contacts ||--o{ sales : "buys_or_sells"
    contacts ||--o{ provenance : "owned_by"
    contacts {
        int id PK
        text type
        text name
    }

    sales_rights {
        int id PK
        int artwork_id FK
        int seller_contact_id FK
        real commission_percent
        int agreement_doc_id FK
    }

    sales ||--o{ provenance : "generates"
    sales {
        int id PK
        int artwork_id FK
        int buyer_contact_id FK
        int seller_contact_id FK
        int sale_price_usd_cents
        int sale_price_inr_paise
        text payment_status
        int invoice_doc_id FK
        int coa_doc_id FK
    }

    documents {
        int id PK
        int artwork_id FK
        text document_type
        text visibility
    }

    exhibitions ||--o{ artwork_exhibitions : "includes"
    exhibitions {
        int id PK
        text title
        text venue
    }

    artwork_exhibitions {
        int artwork_id PK,FK
        int exhibition_id PK,FK
    }

    provenance {
        int id PK
        int artwork_id FK
        int owner_contact_id FK
        text display_owner
        int sale_id FK
    }

    mockups {
        int id PK
        int artwork_id FK
        int source_image_id FK
        text visibility
    }

    share_links ||--o{ share_link_artworks : "curates"
    share_links ||--o{ share_link_opens : "tracked"
    share_links {
        int id PK
        text token UK
        text expires_at
        int show_prices
    }

    share_link_artworks {
        int share_link_id PK,FK
        int artwork_id PK,FK
    }

    share_link_opens {
        int id PK
        int share_link_id FK
        text opened_at
    }
```

## Reading the diagram

- Series is the root organizing axis. Every artwork belongs to exactly one series.
- Editions sit between series and artworks. Uniques skip editions (`edition_id` NULL on artwork).
- One row in `artworks` = one physical object. Edition of 10 → 10 rows.
- Tags are orthogonal to series — for cross-cutting themes (mythology, pluralism, AI, etc.).
- Location, condition, and price are all tracked as history tables. "Current" is computed (latest row, or scalar columns on `artworks` cached).
- Contacts is the single source of truth for people/orgs — galleries, dealers, collectors, agents, institutions.
- Share links are the dealer-facing surface. Per-work or per-selection. Signed token, optional password, opt-in price visibility, optional expiry.
- Documents are blob references with type taxonomy. File bytes live in the data repo alongside the SQLite file.
