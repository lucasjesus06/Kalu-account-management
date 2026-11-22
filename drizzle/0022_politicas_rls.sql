do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;--> statement-breakpoint
create schema if not exists app;--> statement-breakpoint
grant usage on schema app to authenticated;--> statement-breakpoint
grant usage on schema public to authenticated;--> statement-breakpoint
grant select, insert, update, delete on all tables in schema public to authenticated;--> statement-breakpoint
create function app.member_id() returns uuid language sql stable as $$
  select nullif(current_setting('app.member_id', true), '')::uuid
$$;--> statement-breakpoint
create function app.is_member(target uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from household_memberships where household_id = target and member_id = app.member_id())
$$;--> statement-breakpoint
create function app.is_admin(target uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from household_memberships where household_id = target and member_id = app.member_id() and role = 'admin')
$$;--> statement-breakpoint
create function app.shares_household_with(other uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from household_memberships mine
    join household_memberships theirs on theirs.household_id = mine.household_id
    where mine.member_id = app.member_id() and theirs.member_id = other
  )
$$;--> statement-breakpoint
create function app.owns_connection(target uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from integration_connections where id = target and member_id = app.member_id())
$$;--> statement-breakpoint
create function app.owns_account(target uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from financial_accounts a
    join integration_connections c on c.id = a.connection_id
    where a.id = target and c.member_id = app.member_id()
  )
$$;--> statement-breakpoint
create function app.sees_account(target uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select app.owns_account(target) or exists (
    select 1
    from household_shared_accounts s
    join household_memberships m on m.household_id = s.household_id
    where s.account_id = target and m.member_id = app.member_id()
  )
$$;--> statement-breakpoint
create function app.connection_has_visible_account(target uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from financial_accounts where connection_id = target and app.sees_account(id))
$$;--> statement-breakpoint
create policy households_select on households for select to authenticated using (app.is_member(id));--> statement-breakpoint
create policy households_update on households for update to authenticated using (app.is_admin(id)) with check (app.is_admin(id));--> statement-breakpoint
create policy households_delete on households for delete to authenticated using (app.is_admin(id));--> statement-breakpoint
create policy household_members_select on household_members for select to authenticated using (id = app.member_id() or app.shares_household_with(id));--> statement-breakpoint
create policy household_members_update on household_members for update to authenticated using (id = app.member_id()) with check (id = app.member_id());--> statement-breakpoint
create policy household_memberships_select on household_memberships for select to authenticated using (member_id = app.member_id() or app.is_member(household_id));--> statement-breakpoint
create policy household_memberships_update on household_memberships for update to authenticated using (app.is_admin(household_id)) with check (app.is_member(household_id));--> statement-breakpoint
create policy household_memberships_delete on household_memberships for delete to authenticated using (member_id = app.member_id() or app.is_admin(household_id));--> statement-breakpoint
create policy pluggy_credentials_own on pluggy_credentials for all to authenticated using (member_id = app.member_id()) with check (member_id = app.member_id());--> statement-breakpoint
create policy integration_connections_select on integration_connections for select to authenticated using (member_id = app.member_id() or app.connection_has_visible_account(id));--> statement-breakpoint
create policy integration_connections_insert on integration_connections for insert to authenticated with check (member_id = app.member_id());--> statement-breakpoint
create policy integration_connections_update on integration_connections for update to authenticated using (member_id = app.member_id()) with check (member_id = app.member_id());--> statement-breakpoint
create policy integration_connections_delete on integration_connections for delete to authenticated using (member_id = app.member_id());--> statement-breakpoint
create policy financial_accounts_select on financial_accounts for select to authenticated using (app.sees_account(id));--> statement-breakpoint
create policy financial_accounts_write on financial_accounts for all to authenticated using (app.owns_connection(connection_id)) with check (app.owns_connection(connection_id));--> statement-breakpoint
create policy credit_card_bills_select on credit_card_bills for select to authenticated using (app.sees_account(account_id));--> statement-breakpoint
create policy credit_card_bills_write on credit_card_bills for all to authenticated using (app.owns_account(account_id)) with check (app.owns_account(account_id));--> statement-breakpoint
create policy transactions_select on transactions for select to authenticated using (app.sees_account(account_id));--> statement-breakpoint
create policy transactions_update on transactions for update to authenticated using (app.sees_account(account_id)) with check (app.sees_account(account_id));--> statement-breakpoint
create policy transactions_insert on transactions for insert to authenticated with check (app.owns_account(account_id));--> statement-breakpoint
create policy transactions_delete on transactions for delete to authenticated using (app.owns_account(account_id));--> statement-breakpoint
create policy categories_select on categories for select to authenticated using (true);--> statement-breakpoint
create policy category_rules_own on category_rules for all to authenticated
  using (owner_member_id = app.member_id() or (household_id is not null and app.is_member(household_id)))
  with check (owner_member_id = app.member_id() or (household_id is not null and app.is_member(household_id)));--> statement-breakpoint
create policy expense_nature_rules_member on expense_nature_rules for all to authenticated using (app.is_member(household_id)) with check (app.is_member(household_id));--> statement-breakpoint
create policy sync_runs_select on sync_runs for select to authenticated using (app.owns_connection(connection_id));--> statement-breakpoint
create policy budget_goals_member on budget_goals for all to authenticated using (app.is_member(household_id)) with check (app.is_member(household_id));--> statement-breakpoint
create policy budget_alerts_select on budget_alerts for select to authenticated
  using (exists (select 1 from budget_goals g where g.id = goal_id and app.is_member(g.household_id)));--> statement-breakpoint
create policy change_log_select on change_log for select to authenticated using (app.is_member(household_id));--> statement-breakpoint
create policy change_log_insert on change_log for insert to authenticated with check (app.is_member(household_id) and (member_id is null or member_id = app.member_id()));--> statement-breakpoint
create policy push_subscriptions_own on push_subscriptions for all to authenticated using (member_id = app.member_id()) with check (member_id = app.member_id());--> statement-breakpoint
create policy household_shared_accounts_select on household_shared_accounts for select to authenticated using (app.is_member(household_id));--> statement-breakpoint
create policy household_shared_accounts_insert on household_shared_accounts for insert to authenticated
  with check (app.is_member(household_id) and app.owns_account(account_id) and shared_by_member_id = app.member_id());--> statement-breakpoint
create policy household_shared_accounts_delete on household_shared_accounts for delete to authenticated using (app.owns_account(account_id) or app.is_admin(household_id));--> statement-breakpoint
create policy household_invites_select on household_invites for select to authenticated using (app.is_member(household_id));--> statement-breakpoint
create policy household_invites_insert on household_invites for insert to authenticated with check (app.is_admin(household_id) and created_by_member_id = app.member_id());--> statement-breakpoint
create policy household_invites_update on household_invites for update to authenticated using (app.is_admin(household_id)) with check (app.is_admin(household_id));
