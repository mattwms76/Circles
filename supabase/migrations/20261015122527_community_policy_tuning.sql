-- Preserve host-only writes while avoiding duplicate SELECT policy evaluation.
drop policy "Hosts configure prompts" on public.circle_prompts;
create policy "Hosts add prompts" on public.circle_prompts for insert to authenticated with check(private.circle_host(circle_id));
create policy "Hosts update prompts" on public.circle_prompts for update to authenticated using(private.circle_host(circle_id)) with check(private.circle_host(circle_id));
create policy "Hosts remove prompts" on public.circle_prompts for delete to authenticated using(private.circle_host(circle_id));
