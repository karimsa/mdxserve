# Creating diagrams

Edit this section, add an empty paragraph, and type `/mermaid` to create a diagram. Enable diagram conversion in Settings → Diagrams or with `mdxserve setup` first.

Describe a relationship such as “Customers place orders; each order contains line items”, or drop an exported image into the dialog. Review assumptions before inserting the result, then save the section.

```mermaid
erDiagram
    customer ||..o{ orders : has
    products ||..o{ orders : contains

    customer {
        int id PK
        string first_name
        string last_name
        date dob
        datetime db_timestamps
    }

    orders {
        int id PK
        int product_id FK
        int quantity
    }

    products {
        int id PK
        string name
    }
```

```mermaid
erDiagram
    Customers ||--o{ orders : place
    orders ||--|{ "line items" : contains
```
