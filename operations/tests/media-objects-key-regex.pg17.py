#!/usr/bin/env python3
"""Finite local-only proof; never accepts a source/restore URL or real credentials."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import random
import re
import shutil
import socket
import subprocess
import tempfile

import psycopg

OLD = r'^[A-Za-z0-9][A-Za-z0-9_./-]{0,511}$'
NEW = r'^[A-Za-z0-9][A-Za-z0-9_./-]{0,255}[A-Za-z0-9_./-]{0,255}[A-Za-z0-9_./-]{0,1}$'
DOTS = r'\.\.'
SQL_PATH = Path(__file__).resolve().parents[1] / 'remediation/media_objects_key_regex_compat.sql'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sql', type=Path, default=SQL_PATH)
    args = parser.parse_args()
    if os.geteuid() == 0:
        raise SystemExit('Run the disposable fixture as a non-root operating-system user')
    binary = Path('/usr/lib/postgresql/17/bin')
    for name in ('initdb', 'pg_ctl'):
        if not (binary / name).is_file():
            raise SystemExit('Required PostgreSQL17 fixture tooling is unavailable')
    version = subprocess.check_output([str(binary / 'initdb'), '--version'], text=True)
    if ' 17.' not in version:
        raise SystemExit('Only PostgreSQL17 is accepted')
    sql = args.sql.read_text()
    assert OLD in sql and NEW in sql
    root = Path(tempfile.mkdtemp(prefix='cmkey-'))
    os.chmod(root, 0o700)
    data, sockets = root / 'data', root / 'socket'
    sockets.mkdir(mode=0o700)
    with socket.socket() as temporary_socket:
        temporary_socket.bind(('127.0.0.1', 0))
        port = temporary_socket.getsockname()[1]
    env = {'PATH': str(binary) + ':/usr/bin:/bin', 'HOME': str(root), 'LANG': 'C.UTF-8'}
    started = False
    connection = None
    report = {}
    try:
        subprocess.run([str(binary / 'initdb'), '-D', str(data), '-U', 'postgres', '--encoding=UTF8', '--locale=C.UTF-8', '--auth-local=trust', '--auth-host=reject'], env=env, check=True, capture_output=True, text=True, timeout=40)
        subprocess.run([str(binary / 'pg_ctl'), '-D', str(data), '-l', str(root / 'postgres.log'), '-o', f"-h '' -k {sockets} -p {port}", '-w', 'start'], env=env, check=True, capture_output=True, text=True, timeout=30)
        started = True
        connection = psycopg.connect(host=str(sockets), port=port, user='postgres', dbname='postgres', autocommit=True)
        assert connection.execute('SELECT current_user,current_database(),inet_server_addr()').fetchone() == ('postgres', 'postgres', None)
        connection.execute('CREATE TABLE public.fixture_sentinel(id integer PRIMARY KEY); INSERT INTO public.fixture_sentinel VALUES(1)')

        def setup(key_type='character varying(512)', validated=True):
            connection.execute('DROP SCHEMA IF EXISTS circles_publish CASCADE; CREATE SCHEMA circles_publish')
            connection.execute(f'''CREATE TABLE circles_publish."mediaObjects"(
                key {key_type} NOT NULL PRIMARY KEY,
                bytes bytea NOT NULL,
                "createdAt" timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT media_objects_size_check CHECK(octet_length(bytes)>=1 AND octet_length(bytes)<=20971600)
            ); ALTER TABLE circles_publish."mediaObjects" ENABLE ROW LEVEL SECURITY;
            ALTER TABLE circles_publish."mediaObjects" FORCE ROW LEVEL SECURITY;''')
            validity = '' if validated else ' NOT VALID'
            connection.execute(f'''ALTER TABLE circles_publish."mediaObjects" ADD CONSTRAINT media_objects_key_check CHECK(key::text ~ '{OLD}'::text AND key::text !~ '{DOTS}'::text){validity}''')

        def apply():
            with connection.transaction():
                connection.execute(sql, prepare=False)

        def refuse():
            try:
                apply()
            except psycopg.Error as error:
                assert error.sqlstate == 'P0001', f'Unexpected refusal category {error.sqlstate}'
            else:
                raise AssertionError('Unreviewed/partial state was admitted')

        setup()
        try:
            connection.execute('SELECT %s::text ~ %s::text', ('a', OLD))
        except psycopg.Error as error:
            assert error.sqlstate == '2201B'
            report['original_regex_failure'] = error.sqlstate
        else:
            raise AssertionError('The original invalid bound was not reproduced')

        scenarios = [
            ('missing_check', 'ALTER TABLE circles_publish."mediaObjects" DROP CONSTRAINT media_objects_key_check'),
            ('changed_check', 'ALTER TABLE circles_publish."mediaObjects" DROP CONSTRAINT media_objects_key_check; ALTER TABLE circles_publish."mediaObjects" ADD CONSTRAINT media_objects_key_check CHECK(key<>\'\')'),
            ('partial_name', 'ALTER TABLE circles_publish."mediaObjects" ADD CONSTRAINT media_objects_key_compat_pending CHECK(true)'),
            ('rls_disabled', 'ALTER TABLE circles_publish."mediaObjects" DISABLE ROW LEVEL SECURITY'),
            ('force_rls_disabled', 'ALTER TABLE circles_publish."mediaObjects" NO FORCE ROW LEVEL SECURITY'),
            ('unknown_column', 'ALTER TABLE circles_publish."mediaObjects" ADD COLUMN unknown_extra text'),
        ]
        for name, alteration in scenarios:
            setup()
            connection.execute(alteration)
            refuse()
        setup(key_type='character varying(511)')
        refuse()
        setup(validated=False)
        refuse()

        setup()
        before_table = connection.execute('''SELECT oid,relowner,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='circles_publish."mediaObjects"'::regclass''').fetchone()
        before_key = connection.execute('''SELECT oid,pg_get_constraintdef(oid,true) FROM pg_constraint WHERE conrelid='circles_publish."mediaObjects"'::regclass AND contype='p' ''').fetchone()
        before_size = connection.execute('''SELECT oid,pg_get_constraintdef(oid,true) FROM pg_constraint WHERE conrelid='circles_publish."mediaObjects"'::regclass AND conname='media_objects_size_check' ''').fetchone()
        apply()
        actual = connection.execute('''SELECT convalidated,pg_get_constraintdef(oid,true) FROM pg_constraint WHERE conrelid='circles_publish."mediaObjects"'::regclass AND conname='media_objects_key_check' ''').fetchone()
        assert actual[0] and NEW in actual[1] and OLD not in actual[1]
        assert connection.execute('''SELECT oid,relowner,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='circles_publish."mediaObjects"'::regclass''').fetchone() == before_table
        assert connection.execute('''SELECT oid,pg_get_constraintdef(oid,true) FROM pg_constraint WHERE conrelid='circles_publish."mediaObjects"'::regclass AND contype='p' ''').fetchone() == before_key
        assert connection.execute('''SELECT oid,pg_get_constraintdef(oid,true) FROM pg_constraint WHERE conrelid='circles_publish."mediaObjects"'::regclass AND conname='media_objects_size_check' ''').fetchone() == before_size

        cases = ['', 'a', 'Z0', '.a', '/a', 'a..b', 'a/b_c-d.e', 'a b', 'a:b', 'é', 'a\n']
        cases.extend('a' + 'b' * length for length in [0, 1, 254, 255, 256, 510, 511, 512])
        rng = random.Random(20261028)
        for number in range(128):
            alphabet = 'abcXYZ019_./-' if number % 2 == 0 else 'abcXYZ019_./- :é'
            cases.append(''.join(rng.choice(alphabet) for _ in range(rng.randrange(0, 530))))
        for value in cases:
            expected = bool(re.fullmatch(OLD, value)) and '..' not in value
            actual_match = connection.execute('SELECT %s::text ~ %s::text AND %s::text !~ %s::text', (value, NEW, value, DOTS)).fetchone()[0]
            assert actual_match == expected, f'Regex-language mismatch at synthetic length {len(value)}'
        for value in ['a', 'Z0', 'a/b_c-d.e', 'a' + 'b' * 510, 'a' + 'b' * 511]:
            connection.execute('INSERT INTO circles_publish."mediaObjects"(key,bytes) VALUES(%s,%s)', (value, b'x'))
        before_rows = connection.execute('SELECT count(*) FROM circles_publish."mediaObjects"').fetchone()[0]
        refuse()
        assert connection.execute('SELECT count(*) FROM circles_publish."mediaObjects"').fetchone()[0] == before_rows
        assert connection.execute('SELECT count(*) FROM public.fixture_sentinel').fetchone()[0] == 1
        report.update({'postgres_major': 17, 'native_language_cases': len(cases), 'guard_refusal_cases': len(scenarios) + 3, 'nonempty_media_rows': before_rows, 'key_check_name_preserved': True, 'table_owner_oid_rls_and_primary_key_preserved': True, 'size_check_preserved': True, 'production_contacted': False})
    finally:
        if connection:
            connection.close()
        if started:
            subprocess.run([str(binary / 'pg_ctl'), '-D', str(data), '-m', 'fast', '-w', 'stop'], env=env, check=True, capture_output=True, text=True, timeout=30)
        shutil.rmtree(root)
    report['fixture_removed'] = not root.exists()
    assert report['fixture_removed']
    print(json.dumps(report, sort_keys=True))


if __name__ == '__main__':
    main()
