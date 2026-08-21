-- Perf fix (section 46) : update_wallet_balance() sommait TOUTE la table
-- finance_operations a chaque appel -- le WHERE ne filtrait que sur le
-- statut, le filtrage par wallet reposait entierement sur le CASE (ELSE 0),
-- invisible pour le planificateur. Les index
-- finance_operations_reporting_wallet_date_idx et
-- ..._reporting_destination_wallet_date_idx existent deja mais n'etaient
-- jamais utilises faute de predicat explicite. Aucun changement de resultat :
-- meme calcul, juste executable par index plutot que par scan complet.
CREATE OR REPLACE FUNCTION public.update_wallet_balance(p_wallet_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  opening_balance numeric(14, 2);
  journal_balance numeric(14, 2);
BEGIN
  SELECT COALESCE(initial_balance, 0)
  INTO opening_balance
  FROM public.wallets
  WHERE id = p_wallet_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(
    CASE
      WHEN wallet_id = p_wallet_id AND type IN ('REVENUE', 'DEPOSIT', 'RECETTE', 'VERSEMENT') THEN amount
      WHEN wallet_id = p_wallet_id AND type IN ('EXPENSE', 'TRANSFER', 'DEPENSE', 'TRANSFERT') THEN -amount
      WHEN destination_wallet_id = p_wallet_id AND type IN ('TRANSFER', 'TRANSFERT') THEN amount
      ELSE 0
    END
  ), 0)
  INTO journal_balance
  FROM public.finance_operations
  WHERE (wallet_id = p_wallet_id OR destination_wallet_id = p_wallet_id)
    AND COALESCE(status, 'VALIDE') <> 'CANCELLED';

  UPDATE public.wallets
  SET balance = opening_balance + journal_balance,
      updated_at = now()
  WHERE id = p_wallet_id;
END;
$function$;
