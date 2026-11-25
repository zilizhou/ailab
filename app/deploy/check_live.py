"""Check a running deployment using a temporary, isolated course, then remove only that course.

Run on the server: .venv/bin/python current/deploy/check_live.py --base-url URL --data-dir PATH
"""
import argparse
import os
import secrets
import sys
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--base-url', required=True)
parser.add_argument('--data-dir', required=True)
args = parser.parse_args()
os.environ['LAB_DATA_DIR'] = args.data_dir
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
import httpx

prefix = 'deploy-check-' + server.uid()
course_id, group_id, other_group = prefix + '-course', prefix + '-group', prefix + '-other'
actors = [prefix + '-' + role for role in ('student', 'teacher', 'other')]
password = secrets.token_urlsafe(24)
checks = []

def verify(value, label):
    if not value:
        raise AssertionError(label)
    checks.append(label)

def post(client, path, **data):
    result = client.post(path, json={'nonce': server.uid(), **data})
    result.raise_for_status()
    return result.json()

def state(client):
    result = client.get('/api/state')
    result.raise_for_status()
    return result.json()['groups'][0]

def measurement(student, text, revision):
    draft = post(student, f'/api/groups/{group_id}/extract', text=text, revision=revision)
    payload = dict(nonce=server.uid(), revision=revision, draft_id=draft['id'], vin=draft['vin'], vout=draft['vout'], reference=draft['reference'])
    return draft, payload

try:
    with server.db(True) as c:
        c.execute('INSERT INTO courses VALUES(?,?,?)', (course_id, 'Temporary deployment verification', server.packed(server.EXPERIMENT)))
        for gid in (group_id, other_group):
            c.execute('INSERT INTO groups(id,course_id,name) VALUES(?,?,?)', (gid, course_id, gid))
        for actor, role, gid in [(actors[0], 'student', group_id), (actors[1], 'teacher', None), (actors[2], 'student', other_group)]:
            salt = secrets.token_hex(16)
            c.execute('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)', (actor, actor, '部署验证', role, salt, server.hash_password(password, salt), course_id, gid))

    clients = [httpx.Client(base_url=args.base_url, headers={'Origin': args.base_url.rstrip('/')}, timeout=30) for _ in actors]
    student, teacher, other = clients
    try:
        verify(student.get('/api/health').json() == {'status': 'ok'}, 'health endpoint and database')
        verify(student.get('/').status_code == 200 and student.get('/static/app.js').status_code == 200, 'page and assets')
        verify(student.get('/api/state').status_code == 401, 'anonymous access denied')
        for client, actor in zip(clients, actors):
            login = client.post('/api/login', json={'username': actor, 'password': password})
            verify(login.status_code == 200, 'authenticated ' + actor.rsplit('-', 1)[-1])
        draft, payload = measurement(student, '供电3.30 V，输出80 mV，黑表笔接TP0', 1)
        verify(all(g['latest'] is None for g in teacher.get('/api/state').json()['groups']), 'draft excluded from confirmed measurements')
        saved = student.post(f'/api/groups/{group_id}/records', json=payload)
        verify(saved.status_code == 200, 'confirm measurement')
        repeat = student.post(f'/api/groups/{group_id}/records', json=payload)
        verify(repeat.json() == saved.json(), 'retry idempotency')
        group = next(g for g in teacher.get('/api/state').json()['groups'] if g['id'] == group_id)
        verify(group['latest']['data']['fields']['vout']['value_v'] == .08 and group['latest']['data']['assessment']['expected_v'] == 1.65, 'shared readings and deterministic calculation')
        verify(group['latest']['data']['fields']['vout']['raw'] == '80' and group['latest']['data']['fields']['vout']['unit'] == 'mV', 'original value and unit preserved')
        verify(other.post(f'/api/groups/{group_id}/help', json={'nonce': server.uid(), 'text': 'forbidden'}).status_code == 404, 'group authorization')
        verify(student.post(f'/api/groups/{group_id}/message', json={'nonce': server.uid(), 'text': 'forbidden'}).status_code == 403, 'teacher action authorization')
        text = '请先核对黑表笔接 TP0，再补测供电。'
        post(teacher, f'/api/groups/{group_id}/message', text=text)
        verify(state(student)['events'][-1]['data']['text'] == text, 'teacher guidance delivered to student data')
        stale, stale_payload = measurement(student, '供电3.3V，输出80mV，黑表笔接TP0', 1)
        post(student, f'/api/groups/{group_id}/revision', revision=1, reason='部署验证：断电后核对连接')
        verify(state(student)['latest'] is None, 'revision invalidates old current reading')
        verify(student.post(f'/api/groups/{group_id}/records', json=stale_payload).status_code == 409, 'stale draft rejected')
        draft, payload = measurement(student, '供电3.30V，输出1.64V，黑表笔接TP0', 2)
        verify(student.post(f'/api/groups/{group_id}/records', json=payload).status_code == 200 and state(student)['latest']['data']['assessment']['code'] == 'pass', 'retest in new revision')
        submission = post(student, f'/api/groups/{group_id}/submit', revision=2, conclusion='部署验证：等值电阻分压，实测输出与供电一半的偏差为-0.01 V。')
        post(teacher, f'/api/groups/{group_id}/review', submission_id=submission['id'], decision='return', text='部署验证：补充参考点说明。')
        verify(state(student)['status'] == 'returned', 'teacher return for completion')
        submission = post(student, f'/api/groups/{group_id}/submit', revision=2, conclusion='部署验证：以TP0为参考地测量，输出1.64 V，偏差-0.01 V，符合数值判据。')
        post(teacher, f'/api/groups/{group_id}/review', submission_id=submission['id'], decision='feedback', text='部署验证：已核对。')
        verify(state(student)['status'] == 'reviewed', 'resubmission and teacher feedback')
    finally:
        for client in clients:
            client.close()
finally:
    # Never delete normal pilot users, groups, or records.
    with server.db(True) as c:
        for actor in actors:
            c.execute('DELETE FROM sessions WHERE user_id=?', (actor,))
            c.execute('DELETE FROM operations WHERE actor=?', (actor,))
        for gid in (group_id, other_group):
            c.execute('DELETE FROM drafts WHERE group_id=?', (gid,))
            c.execute('DELETE FROM events WHERE group_id=?', (gid,))
        for actor in actors:
            c.execute('DELETE FROM users WHERE id=?', (actor,))
        for gid in (group_id, other_group):
            c.execute('DELETE FROM groups WHERE id=?', (gid,))
        c.execute('DELETE FROM courses WHERE id=?', (course_id,))

print(f'PASS: {len(checks)} live deployment checks; temporary course and records removed')
