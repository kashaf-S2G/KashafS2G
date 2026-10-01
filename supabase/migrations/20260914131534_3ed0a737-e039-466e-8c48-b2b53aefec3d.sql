
-- قراءة سر من الخزانة: كود الخادم الموثوق فقط
CREATE OR REPLACE FUNCTION public.vault_get_secret(_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault
AS $$
DECLARE v text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT decrypted_secret INTO v FROM vault.decrypted_secrets WHERE name = _name LIMIT 1;
  RETURN v;
END;
$$;

-- حفظ/تحديث سر في الخزانة: كود الخادم الموثوق فقط
CREATE OR REPLACE FUNCTION public.vault_set_secret(_name text, _value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault
AS $$
DECLARE existing_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _value IS NULL OR length(btrim(_value)) = 0 THEN
    RAISE EXCEPTION 'EMPTY_SECRET';
  END IF;
  SELECT id INTO existing_id FROM vault.secrets WHERE name = _name LIMIT 1;
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret(_value, _name, 'kashaf external secret');
  ELSE
    PERFORM vault.update_secret(existing_id, _value, _name, 'kashaf external secret');
  END IF;
END;
$$;

-- هل السر موجود في الخزانة؟ بدون إرجاع قيمته
CREATE OR REPLACE FUNCTION public.vault_has_secret(_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN EXISTS (SELECT 1 FROM vault.secrets WHERE name = _name);
END;
$$;

REVOKE ALL ON FUNCTION public.vault_get_secret(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vault_set_secret(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vault_has_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vault_get_secret(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.vault_set_secret(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.vault_has_secret(text) TO service_role;
