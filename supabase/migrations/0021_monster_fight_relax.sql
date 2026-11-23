-- Ragnarok-style battle: attacks needed are far fewer than the old tap-based fight.
do $$
declare d text;
begin
  select pg_get_functiondef('public.defeat_monster'::regproc) into d;
  d := replace(d, 'p_taps < m.hp or p_duration_s < m.hp * 0.2', 'p_taps < greatest(1, m.hp / 4) or p_duration_s < greatest(3, m.hp * 0.1)');
  execute d;
end $$;
