-- PostgreSQL commits enum additions separately before they can be used by
-- the Commerce POS catalogue migration that follows.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'caissier';
