create table public.stocks (
    id uuid primary key default gen_random_uuid(),

    nom text not null,
    reference text,

    categorie text,

    quantite numeric not null default 0,

    unite text not null default 'Pièce',

    prix_achat numeric default 0,

    prix_vente numeric,

    stock_minimum numeric default 0,

    fournisseur text,

    emplacement text,

    description text,

    date_entree date default current_date,

    date_expiration date,

    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index stocks_nom_idx
on public.stocks(nom);

create index stocks_categorie_idx
on public.stocks(categorie);

create index stocks_reference_idx
on public.stocks(reference);

create or replace function public.update_stock_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger trg_update_stock_updated_at
before update
on public.stocks
for each row
execute function public.update_stock_updated_at();