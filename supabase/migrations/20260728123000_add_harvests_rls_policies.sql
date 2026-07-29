-- Allow the same operational roles that manage farms to manage harvests.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.harvests TO authenticated;

ALTER TABLE public.harvests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "harvests_read" ON public.harvests
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "harvests_write" ON public.harvests
  FOR ALL TO authenticated
  USING (
    public.has_any_role(
      auth.uid(),
      ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[]
    )
  )
  WITH CHECK (
    public.has_any_role(
      auth.uid(),
      ARRAY['super_admin', 'admin', 'gestionnaire']::public.app_role[]
    )
  );
