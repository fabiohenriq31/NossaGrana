-- Finance tables are accessible through Fastify/Prisma only.
-- No RLS policies are installed. The Prisma database role retains its privileges.
-- Supabase's public REST roles receive no direct privileges on these tables.
DO $$
DECLARE role_name text; table_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   FOREACH table_name IN ARRAY ARRAY['User','Household','Bank','Account','CreditCard','Invoice','InvoicePayment','Transaction','Transfer','Category','Subcategory','InstallmentPurchase','Installment','RecurringTransaction','Attachment','Tag','ExternalImport'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',table_name,role_name);
   END LOOP;
  END IF;
 END LOOP;
END $$;
