#!/usr/bin/env python3
"""Finite local PG17 rehearsal. No DSN, credentials, network or production input is accepted."""
from __future__ import annotations
import importlib.util,json,pathlib,re,shutil,socket,subprocess,tempfile
import psycopg
from psycopg import sql
ROOT=pathlib.Path(__file__).resolve().parents[2]
PG=pathlib.Path('/usr/lib/postgresql/17/bin')
spec=importlib.util.spec_from_file_location('fixture',ROOT/'scripts/run-circle-home-e2e.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
checks=[]
def record(name):checks.append(name);print('PASS: '+name,flush=True)
def expected_failure(db,statement,params=None):
 try:db.execute(statement,params)
 except psycopg.Error:return
 raise AssertionError('expected guarded statement to fail')
def extracted_values(source,cte):
 pattern=r'WITH '+re.escape(cte)+r'\(([^)]+)\) AS \((\s*VALUES[\s\S]*?)\), (?:role_oids|observed)'
 match=re.search(pattern,source)
 if not match:raise AssertionError('missing fixed source fixture CTE '+cte)
 return match.group(1),match.group(2)
def main():
 directory=pathlib.Path(tempfile.mkdtemp(prefix='circles-db-remediation-pg17-'));directory.chmod(0o700)
 env=fixture.fixture_environment(directory);port=fixture.reserve_loopback_port();started=False
 def command(args,expect_ok=True):
  result=subprocess.run(args,cwd=ROOT,env=env,stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=90)
  if expect_ok and result.returncode:raise RuntimeError(result.stderr[-1600:])
  if not expect_ok and not result.returncode:raise AssertionError('expected migration refusal')
  return result
 def apply(path,expect_ok=True):
  return command([str(PG/'psql'),'-X','-h','127.0.0.1','-p',str(port),'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-f',str(ROOT/path)],expect_ok)
 try:
  command([str(PG/'initdb'),'-D',str(directory/'data'),'-U','postgres','-A','trust','--no-locale','--encoding=UTF8'])
  command([str(PG/'pg_ctl'),'-D',str(directory/'data'),'-l',str(directory/'pg.log'),'-o',f'-h 127.0.0.1 -p {port} -k {directory}','-w','start']);started=True
  with psycopg.connect(host='127.0.0.1',port=port,dbname='postgres',user='postgres',autocommit=True,connect_timeout=5) as db:
   db.execute('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN')
   migrations=fixture.BASELINE_AND_FEATURE_MIGRATIONS+fixture.ACTIVITY_MIGRATIONS+fixture.MODERATION_MIGRATIONS+fixture.POST_PUBLICATION_MIGRATIONS
   for path in migrations:apply(path)
   record('exact current private baseline and feature migrations replay on PG17')
   # Browser-denial policies were installed by the original private-schema rollout,
   # not the SQL baseline. Recreate their exact restrictive contract in this fixture.
   for table in ['circles','comments','liveViewers','memberships','posts','profiles','reactions','reports','streams','users']:
    if not db.execute('SELECT 1 FROM pg_policy WHERE polrelid=%s::regclass AND polname=%s',(f'circles_app."{table}"','circles_app_deny_anon_authenticated')).fetchone():
     db.execute(sql.SQL('CREATE POLICY circles_app_deny_anon_authenticated ON circles_app.{} AS RESTRICTIVE FOR ALL TO anon,authenticated USING(false) WITH CHECK(false)').format(sql.Identifier(table)))
   db.execute('CREATE ROLE circles_admin_runtime LOGIN NOINHERIT NOBYPASSRLS; CREATE ROLE circles_admin_native_executor NOLOGIN NOINHERIT NOBYPASSRLS; CREATE SCHEMA circles_admin; REVOKE ALL ON SCHEMA circles_admin FROM PUBLIC; CREATE TABLE circles_admin.operators(id integer PRIMARY KEY,status varchar(32),role varchar(32)); CREATE TABLE circles_admin.audit(actor_operator_id integer,actor_role varchar(32)); ALTER TABLE circles_admin.audit ENABLE ROW LEVEL SECURITY; ALTER TABLE circles_admin.audit FORCE ROW LEVEL SECURITY')
   for name in ['touch_updated_at','reject_audit_mutation']:
    db.execute(sql.SQL('CREATE FUNCTION circles_admin.{}() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$BEGIN RETURN NEW; END$$').format(sql.Identifier(name)))
    db.execute(sql.SQL('REVOKE ALL ON FUNCTION circles_admin.{}() FROM PUBLIC').format(sql.Identifier(name)))
   before=db.execute("SELECT proname,prosrc,proacl::text,proowner FROM pg_proc WHERE pronamespace='circles_admin'::regnamespace ORDER BY proname").fetchall()
   apply('operations/migrations/0020_circles_admin_invoker_search_paths.sql')
   after=db.execute("SELECT proname,prosrc,proacl::text,proowner FROM pg_proc WHERE pronamespace='circles_admin'::regnamespace ORDER BY proname").fetchall()
   assert before==after
   assert db.execute("SELECT count(*) FROM pg_proc WHERE pronamespace='circles_admin'::regnamespace AND proconfig=ARRAY['search_path=pg_catalog']").fetchone()[0]==2
   apply('operations/migrations/0020_circles_admin_invoker_search_paths.sql',False)
   record('DB08 changes only exact invoker settings; refuses already-configured state')
   apply('operations/migrations/0017_circles_dedicated_app_login.sql')
   role=db.execute("SELECT rolcanlogin,rolinherit,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname='circles_app_login'").fetchone();assert role==(False,)*7
   assert db.execute("SELECT admin_option,inherit_option,set_option FROM pg_auth_members WHERE member='circles_app_login'::regrole AND roleid='circles_app_runtime'::regrole").fetchone()==(False,False,True)
   db.execute('SET SESSION AUTHORIZATION circles_app_login; SET ROLE circles_app_runtime');assert db.execute('SELECT current_user').fetchone()==('circles_app_runtime',);db.execute('RESET ROLE; RESET SESSION AUTHORIZATION')
   apply('operations/migrations/0017_circles_dedicated_app_login.sql',False)
   record('DB02 disabled least-privileged login, SET-only runtime edge, no implicit reuse')
   source=(ROOT/'operations/migrations/0021_circles_duplicate_policy_consolidation.sql').read_text()
   columns,values=extracted_values(source,'expected_pairs')
   pairs=db.execute('SELECT * FROM ('+values+') AS fixed('+columns+')').fetchall()
   for schema,table,survivor,duplicate,cmd,qual,check in pairs:
    for name in (survivor,duplicate):
     statement=sql.SQL('CREATE POLICY {} ON {}.{} FOR {} TO circles_admin_runtime').format(sql.Identifier(name),sql.Identifier(schema),sql.Identifier(table),sql.SQL({'r':'SELECT','a':'INSERT'}[cmd]))
     if qual is not None:statement+=sql.SQL(' USING ('+qual+')')
     if check is not None:statement+=sql.SQL(' WITH CHECK ('+check+')')
     db.execute(statement)
   columns,values=extracted_values(source,'expected_native_policies')
   native=db.execute('SELECT * FROM ('+values+') AS fixed('+columns+')').fetchall()
   for schema,table,name,permissive,cmd,qual,check in native:
    statement=sql.SQL('CREATE POLICY {} ON {}.{} AS {} FOR {} TO circles_admin_native_executor').format(sql.Identifier(name),sql.Identifier(schema),sql.Identifier(table),sql.SQL('PERMISSIVE' if permissive else 'RESTRICTIVE'),sql.SQL({'r':'SELECT','a':'INSERT','w':'UPDATE','*':'ALL'}[cmd]))
    if qual is not None:statement+=sql.SQL(' USING ('+qual+')')
    if check is not None:statement+=sql.SQL(' WITH CHECK ('+check+')')
    db.execute(statement)
   # The exact wrong predicate must abort without dropping any of the twelve duplicate policies.
   db.execute('ALTER POLICY circles_admin_parity_read_circles ON circles_app.circles USING(false)')
   apply('operations/migrations/0021_circles_duplicate_policy_consolidation.sql',False)
   assert sum(db.execute('SELECT count(*) FROM pg_policy WHERE polname=%s',(p[3],)).fetchone()[0] for p in pairs)==12
   db.execute('ALTER POLICY circles_admin_parity_read_circles ON circles_app.circles USING(true)')
   apply('operations/migrations/0021_circles_duplicate_policy_consolidation.sql');apply('operations/migrations/0021_circles_duplicate_policy_consolidation.sql')
   assert sum(db.execute('SELECT count(*) FROM pg_policy WHERE polname=%s',(p[3],)).fetchone()[0] for p in pairs)==0
   record('DB09 exact twelve-policy consolidation is atomic, rejects mismatch and reruns safely')
   apply('operations/migrations/0022_circles_publish_receipt_primary_key.sql');apply('operations/migrations/0022_circles_publish_receipt_primary_key.sql')
   indexes=db.execute("SELECT conindid FROM pg_constraint WHERE conrelid='circles_publish.\"postPublishReceipts\"'::regclass AND contype IN('u','p')").fetchall();assert len(indexes)==2 and len(set(indexes))==2
   db.execute("INSERT INTO circles_app.users(id,\"openId\") VALUES(1,'synthetic-remediation-owner'),(2,'synthetic-remediation-author')")
   db.execute("INSERT INTO circles_app.circles(id,\"ownerId\",name,description,category) VALUES(11,1,'Fixture A','Synthetic','Art'),(12,1,'Fixture B','Synthetic','Art')")
   db.execute("INSERT INTO circles_app.posts(id,\"authorId\",\"circleId\",text) VALUES(101,2,11,'Synthetic A'),(102,2,12,'Synthetic B')")
   db.execute('INSERT INTO circles_publish."postPublishReceipts"("actorId","operationId","payloadHash","postId") VALUES(2,%s,%s,102) ON CONFLICT("actorId","operationId") DO NOTHING',('synthetic-operation-0001','a'*64))
   db.execute('INSERT INTO circles_publish."postPublishReceipts"("actorId","operationId","payloadHash","postId") VALUES(2,%s,%s,102) ON CONFLICT("actorId","operationId") DO NOTHING',('synthetic-operation-0001','a'*64))
   assert db.execute('SELECT count(*) FROM circles_publish."postPublishReceipts"').fetchone()==(1,)
   db.execute('DELETE FROM circles_app.posts WHERE id=102');assert db.execute('SELECT "postId" FROM circles_publish."postPublishReceipts"').fetchone()==(None,)
   record('DB11 distinct valid PK/UNIQUE indexes retain ON CONFLICT and delete tombstone')
   apply('operations/remediation/db17_relationship_integrity.sql');apply('operations/remediation/db17_relationship_integrity.sql')
   db.execute('SET session_replication_role=replica')
   db.execute('UPDATE circles_app.circles SET "pinnedPostId"=101 WHERE id=12')
   db.execute('SET session_replication_role=origin')
   apply('operations/remediation/db17_complete_pin_contract.sql',False)
   assert db.execute('SELECT "pinnedPostId" FROM circles_app.circles WHERE id=12').fetchone()==(101,)
   assert db.execute("SELECT to_regclass('circles_app.circles_pinned_post_same_circle_db17_idx')").fetchone()==(None,)
   db.execute('UPDATE circles_app.circles SET "pinnedPostId"=NULL WHERE id=12')
   db.execute('CREATE INDEX circles_pinned_post_same_circle_db17_idx ON circles_app.circles(id)')
   apply('operations/remediation/db17_complete_pin_contract.sql',False)
   db.execute('DROP INDEX circles_app.circles_pinned_post_same_circle_db17_idx')
   apply('operations/remediation/db17_complete_pin_contract.sql')
   assert db.execute("SELECT convalidated FROM pg_constraint WHERE conrelid='circles_app.circles'::regclass AND conname='circles_pinned_post_same_circle_db17_fkey'").fetchone()==(True,)
   assert db.execute("SELECT indisvalid AND indisready FROM pg_index WHERE indexrelid='circles_app.circles_pinned_post_same_circle_db17_idx'::regclass").fetchone()==(True,)
   record('DB17 completion certifies historical pins and covering index; refuses bad history without repairs and rejects a wrong named index')
   db.execute('UPDATE circles_app.circles SET "pinnedPostId"=101 WHERE id=11')
   expected_failure(db,'UPDATE circles_app.circles SET "pinnedPostId"=101 WHERE id=12')
   expected_failure(db,'UPDATE circles_app.posts SET "circleId"=12 WHERE id=101')
   db.execute('DELETE FROM circles_app.posts WHERE id=101');assert db.execute('SELECT "pinnedPostId" FROM circles_app.circles WHERE id=11').fetchone()==(None,)
   record('DB17 same-Circle linking rejects cross-parent and reparent updates, preserves clear-on-delete')
   apply('operations/remediation/db16_security_state_retention.sql')
   for i in range(4):
    db.execute("INSERT INTO circles_auth.oauth_pending_states(state_fingerprint,flow_kind,flow_token_fingerprint,redirect_uri,nonce,created_at,expires_at) VALUES(%s,'native',%s,'synthetic://return',%s,now()-interval '2 hours',now()-interval '1 hour')",(format(i+1,'064x'),format(i+21,'064x'),'n'*32))
    db.execute('INSERT INTO circles_app."applicationSessions"("sessionFingerprint","userOpenId","appId","expiresAt") VALUES(%s,%s,%s,now()-interval \'100 days\')',(format(i+41,'064x'),'synthetic-remediation-owner','synthetic-app'))
   dry=db.execute('SELECT state_kind,candidate_count,deleted_count FROM circles_ops.run_security_state_retention()').fetchall();assert len(dry)==2 and all(r[1:]==(4,0) for r in dry)
   assert db.execute('SELECT count(*) FROM circles_auth.oauth_pending_states').fetchone()==(4,)
   deletion=db.execute('SELECT state_kind,candidate_count,deleted_count FROM circles_ops.run_security_state_retention(false,2)').fetchall();assert len(deletion)==2 and all(r[1:]==(2,2) for r in deletion)
   for role in ('anon','authenticated','service_role','circles_app_runtime','circles_admin_runtime','circles_admin_native_executor'):
    assert not db.execute("SELECT has_function_privilege(%s,'circles_ops.run_security_state_retention(boolean,integer)','EXECUTE')",(role,)).fetchone()[0]
   apply('operations/remediation/db16_security_state_retention.sql',False)
   record('DB16 default dry-run does not delete; explicit synthetic cleanup is capped and browser/runtime denied')
   db.execute('DELETE FROM circles_app.users WHERE id=2');assert db.execute('SELECT count(*) FROM circles_publish."postPublishReceipts"').fetchone()==(0,)
   record('DB11 actor deletion retains original receipt cascade semantics')
   # These UUID-era tables are separate synthetic fixtures, not current app users.
   db.execute("CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT NULLIF(current_setting('fixture.actor',true),'')::uuid$$")
   db.execute('CREATE TABLE public.circles(id uuid NOT NULL,owner_id uuid,name text NOT NULL,description text NOT NULL,interest text NOT NULL,is_private boolean NOT NULL,members_count integer NOT NULL,cover_url text,cover_color text NOT NULL,created_at timestamptz NOT NULL,welcome_text text NOT NULL,last_activity_at timestamptz NOT NULL,rules text NOT NULL)')
   db.execute('CREATE TABLE public.profiles(id uuid NOT NULL,handle text NOT NULL,display_name text NOT NULL,avatar_url text,bio text NOT NULL,interests text[] NOT NULL,created_at timestamptz NOT NULL,onboarding_completed_at timestamptz)')
   db.execute('CREATE TABLE public.follows(follower_id uuid NOT NULL,followee_id uuid NOT NULL,created_at timestamptz NOT NULL)')
   names={'circles':'Signed in members can discover circle listings','profiles':'Profiles are visible to signed in members','follows':'Members see follows'}
   for table,policy in names.items():
    db.execute(sql.SQL('ALTER TABLE public.{} ENABLE ROW LEVEL SECURITY; GRANT SELECT ON public.{} TO authenticated; CREATE POLICY {} ON public.{} FOR SELECT TO authenticated USING(true)').format(sql.Identifier(table),sql.Identifier(table),sql.Identifier(policy),sql.Identifier(table)))
   alice='00000000-0000-4000-8000-000000000001';bob='00000000-0000-4000-8000-000000000002'
   for i,owner,private in [(11,alice,True),(12,bob,True),(13,bob,False)]:
    db.execute("INSERT INTO public.circles VALUES(%s,%s,'Synthetic','','Art',%s,1,NULL,'blue',now(),'private synthetic welcome',now(),'private synthetic rules')",(f'00000000-0000-4000-8000-{i:012d}',owner,private))
   for actor in (alice,bob):
    db.execute("INSERT INTO public.profiles VALUES(%s,'synthetic','Synthetic',NULL,'',ARRAY['art'],now(),now())",(actor,))
   db.execute('INSERT INTO public.follows VALUES(%s,%s,now()),(%s,%s,now())',(alice,bob,bob,alice))
   apply('operations/remediation/db01_legacy_public_privacy.sql',False)
   db.execute("SELECT set_config('circles.db01_legacy_public_privacy_contract','DB01_LEGACY_PUBLIC_PRIVACY_APPROVED_V1',false)")
   db.execute((ROOT/'operations/remediation/db01_legacy_public_privacy.sql').read_text())
   db.execute("SELECT set_config('fixture.actor',%s,false)",(alice,));db.execute('SET ROLE authenticated')
   assert db.execute('SELECT count(*) FROM public.circles').fetchone()==(2,)
   assert db.execute('SELECT count(*) FROM public.profiles').fetchone()==(1,)
   assert db.execute('SELECT count(*) FROM public.follows').fetchone()==(1,)
   db.execute('RESET ROLE')
   assert db.execute('SELECT count(*) FROM public.circles').fetchone()==(3,)
   record('DB01 refuses absent approval; actual authenticated RLS narrows private Circle/profile/follow reads without deleting rows')
  return 0
 finally:
  if started:command([str(PG/'pg_ctl'),'-D',str(directory/'data'),'-m','immediate','-w','stop'])
  shutil.rmtree(directory)
  print(json.dumps({'production_access':False,'production_write':False,'fixture':'fresh-loopback-pg17','passed_checks':checks,'disposable_fixture_removed':not directory.exists()}),flush=True)
if __name__=='__main__':raise SystemExit(main())
