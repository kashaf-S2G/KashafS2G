CREATE TABLE public.deleted_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  item_type text NOT NULL,
  block_key text NOT NULL,
  label text NOT NULL DEFAULT '',
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, item_type, block_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deleted_items TO authenticated;
GRANT ALL ON public.deleted_items TO service_role;
ALTER TABLE public.deleted_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage their deleted items" ON public.deleted_items
  FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE INDEX deleted_items_owner_type_idx ON public.deleted_items(owner_id, item_type);