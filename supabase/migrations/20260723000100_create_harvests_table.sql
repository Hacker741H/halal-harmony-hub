create table if not exists public.harvests (
    id uuid primary key default gen_random_uuid(),

    farm_id uuid not null
        references public.farms(id)
        on delete cascade,

    date_recolte date not null,

    produit text not null,

    quantite_kg numeric(12,2) not null default 0,

    prix_kg numeric(12,2) not null default 0,

    montant_total numeric(14,2)
        generated always as (quantite_kg * prix_kg) stored,

    acheteur text,

    observations text,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now()
);

create index if not exists idx_harvests_farm
on public.harvests(farm_id);

create index if not exists idx_harvests_date
on public.harvests(date_recolte);