"""Live course/group acceptance using isolated accounts and courses; removes its own data."""
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

prefix = 'qa-' + server.uid()[:16]
password = secrets.token_urlsafe(24)
actors, courses, offerings, templates, terms, clients = [], [], [], [], [], []
passed = []

def check(value, label):
    if not value:
        raise AssertionError(label)
    passed.append(label)

def client():
    c = httpx.Client(base_url=args.base_url, headers={'Origin': args.base_url.rstrip('/')}, timeout=30)
    clients.append(c)
    return c

def post(c, path, **data):
    r = c.post(path, json={'nonce': server.uid(), **data})
    r.raise_for_status()
    return r.json()

def change(action, **data):
    return post(teacher, '/api/teaching/' + action, **data)

def catalog(c):
    r = c.get('/api/catalog')
    r.raise_for_status()
    return r.json()

def state(c, aid):
    r = c.get('/api/state', params={'assignment_id': aid})
    r.raise_for_status()
    return r.json()

def record(c, aid, text):
    g = state(c, aid)['groups'][0]
    d = post(c, '/api/groups/' + g['id'] + '/extract', text=text, revision=g['revision'])
    check(d['revision'] == g['revision'], 'draft scoped to experiment revision')
    payload = {'nonce': server.uid(), 'draft_id': d['id'], 'revision': g['revision'], 'vin': d['vin'], 'vout': d['vout'], 'reference': d['reference'], 'acknowledged': True}
    a = c.post('/api/groups/' + g['id'] + '/records', json=payload)
    a.raise_for_status()
    b = c.post('/api/groups/' + g['id'] + '/records', json=payload)
    check(a.json() == b.json(), 'measurement retry idempotency')
    return state(c, aid)['groups'][0]

try:
    with server.db(True) as db:
        for suffix in ('teacher', 'outside'):
            person = prefix + '-' + suffix
            actors.append(person)
            salt = secrets.token_hex(16)
            db.execute('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)', (person, person, '部署验收教师', 'teacher', salt, server.hash_password(password, salt), '', None))
    teacher, outside, s1, s2 = [client() for _ in range(4)]
    for c, name in [(teacher, actors[0]), (outside, actors[1])]:
        post(c, '/api/login', username=name, password=password)
    for i, c in enumerate((s1, s2), 1):
        name = prefix + '-s' + str(i)
        post(c, '/api/register', username=name, name='部署验收学生' + str(i), password=password)
        login = post(c, '/api/login', username=name, password=password)
        actors.append(login['id'])
        check(login['role'] == 'student', 'student registration role')
    term = change('term', name=prefix + '第一学期')['id'];terms.append(term)
    cid = change('course', title=prefix + '电路课程')['id'];courses.append(cid)
    oid = change('offering', course_id=cid, term_id=term)['id'];offerings.append(oid)
    cls = change('class', offering_id=oid, name='验收教学班')['id']
    cls2 = change('class', offering_id=oid, name='第二教学班')['id']
    room = next(o for o in catalog(teacher)['offerings'] if o['id'] == oid)['classes'][0]
    check(s1.get('/api/state', params={'offering_id': oid}).status_code == 404, 'course enrollment required')
    post(s1, '/api/teaching/enroll', join_code=room['join_code'])
    change('roster', class_id=cls, usernames=[prefix + '-s2'])
    check(len(catalog(s1)['offerings']) == 1, 'student sees enrolled courses only')
    template = change('template', **{**server.EXPERIMENT, 'title': prefix + '分压', 'rule_type': 'resistor-divider'})
    templates.append(template['id'])
    aid = change('publish', offering_id=oid, class_ids=[cls, cls2], version_id=template['version_id'], min_size=1, max_size=2)['id']
    assignment = next(a for a in catalog(teacher)['assignments'] if a['id'] == aid)
    scheme = next(t['scheme_id'] for t in assignment['targets'] if t['class_id'] == cls)
    check(state(s1, aid)['groups'] == [], 'published task awaits grouping')
    team = post(s1, '/api/teaching/team-create', scheme_id=scheme, name='验收小组')['id']
    check(len(state(s1, aid)['groups'][0]['members']) == 1, 'single person group')
    post(s2, '/api/teaching/team-join', team_id=team)
    check(len(state(s2, aid)['groups'][0]['members']) == 2, 'multi person group shared workspace')
    check(outside.get('/api/state', params={'assignment_id': aid}).status_code == 404, 'unassigned teacher denied')
    g = record(s1, aid, '供电3.30V，输出80mV，黑表笔接TP0')
    check(g['latest']['data']['assessment']['expected_v'] == 1.65, 'divider expected voltage')
    check(g['latest']['data']['fields']['vout']['value_v'] == .08, 'mV conversion')
    check(state(s2, aid)['groups'][0]['latest']['id'] == g['latest']['id'], 'teammate sees shared measurement')
    check(s1.post('/api/teaching/team-leave', json={'nonce': server.uid(), 'team_id': team}).status_code == 409, 'started group locked')
    post(teacher, '/api/groups/' + g['id'] + '/message', text='验收指导：核对参考点并补测。')
    check(state(s1, aid)['groups'][0]['events'][-1]['kind'] == 'message', 'teacher message reaches group')
    v2 = change('template-version', template_id=template['id'], **{**server.EXPERIMENT, 'title': prefix + '分压新版', 'r1_ohm': 20000, 'rule_type': 'resistor-divider'})
    aid2 = change('publish', offering_id=oid, class_ids=[cls], version_id=v2['version_id'], scheme_ids={cls: scheme})['id']
    g2 = record(s2, aid2, '供电3.30V，输出1.10V，黑表笔接TP0')
    check(g2['id'] != g['id'] and g2['team_id'] == g['team_id'], 'same team has independent experiment runs')
    check(g2['latest']['data']['assessment']['expected_v'] == 1.1, 'new task uses new template parameters')
    check(state(s1, aid)['groups'][0]['latest']['data']['assessment']['expected_v'] == 1.65, 'published template snapshot retained')
    post(s1, '/api/groups/' + g['id'] + '/revision', revision=1, reason='验收修改实物')
    check(state(s1, aid)['groups'][0]['latest'] is None, 'new physical revision needs retest')
    check(state(s2, aid2)['groups'][0]['revision'] == 1, 'other experiment revision unchanged')
    submission = post(s2, '/api/groups/' + g2['id'] + '/submit', revision=1, conclusion='R1为R2两倍，输出约为供电三分之一。')
    post(teacher, '/api/groups/' + g2['id'] + '/review', submission_id=submission['id'], decision='return', text='补充说明参考点。')
    check(state(s1, aid2)['groups'][0]['status'] == 'returned', 'teacher returns shared conclusion')
    submission = post(s1, '/api/groups/' + g2['id'] + '/submit', revision=1, conclusion='以TP0为参考点，输出1.10V，与实测供电三分之一一致。')
    post(teacher, '/api/groups/' + g2['id'] + '/review', submission_id=submission['id'], decision='feedback', text='验收已复核。')
    check(state(s2, aid2)['groups'][0]['status'] == 'reviewed', 'shared conclusion feedback')
    term2 = change('term', name=prefix + '下一学期')['id'];terms.append(term2)
    clone = change('clone', offering_id=oid, term_id=term2)['id'];offerings.append(clone)
    new = next(o for o in catalog(teacher)['offerings'] if o['id'] == clone)
    check(len(new['classes']) == 2 and all(not c['students'] for c in new['classes']), 'new semester copies structure without student data')
    check(not any(a['offering_id'] == clone for a in catalog(teacher)['assignments']), 'new semester has independent publications')
    change('archive', offering_id=oid, archived=True)
    check(s1.post('/api/groups/' + g['id'] + '/extract', json={'nonce': server.uid(), 'revision': 2, 'text': '供电3.3V'}).status_code == 409, 'archived course is read only')
    check(state(s2, aid2)['groups'][0]['status'] == 'reviewed', 'archived history remains readable')
finally:
    for c in clients:
        c.close()
    with server.db(True) as c:
        for actor in actors:
            for table, column in [('sessions', 'user_id'), ('operations', 'actor'), ('teaching_audit', 'actor')]:
                c.execute(f'DELETE FROM {table} WHERE {column}=?', (actor,))
        for oid in offerings:
            aids = [r[0] for r in c.execute('SELECT id FROM assignments WHERE offering_id=?', (oid,))]
            classes = [r[0] for r in c.execute('SELECT id FROM classes WHERE offering_id=?', (oid,))]
            for aid in aids:
                for gid in [r[0] for r in c.execute('SELECT id FROM groups WHERE assignment_id=?', (aid,))]:
                    c.execute('DELETE FROM drafts WHERE group_id=?', (gid,))
                    c.execute('DELETE FROM events WHERE group_id=?', (gid,))
                c.execute('DELETE FROM groups WHERE assignment_id=?', (aid,))
                c.execute('DELETE FROM assignment_targets WHERE assignment_id=?', (aid,))
                c.execute('DELETE FROM assignments WHERE id=?', (aid,))
            for cls in classes:
                for sid in [r[0] for r in c.execute('SELECT id FROM grouping_schemes WHERE class_id=?', (cls,))]:
                    c.execute('DELETE FROM team_members WHERE scheme_id=?', (sid,))
                    c.execute('DELETE FROM teams WHERE scheme_id=?', (sid,))
                c.execute('DELETE FROM grouping_schemes WHERE class_id=?', (cls,))
                c.execute('DELETE FROM enrollments WHERE class_id=?', (cls,))
                c.execute('DELETE FROM classes WHERE id=?', (cls,))
            c.execute('DELETE FROM offering_teachers WHERE offering_id=?', (oid,))
            c.execute('DELETE FROM offerings WHERE id=?', (oid,))
        for cid in courses:
            c.execute('DELETE FROM course_owners WHERE course_id=?', (cid,))
            c.execute('DELETE FROM courses WHERE id=?', (cid,))
        for tid in templates:
            c.execute('DELETE FROM experiment_versions WHERE template_id=?', (tid,))
            c.execute('DELETE FROM experiment_templates WHERE id=?', (tid,))
        for term in terms:
            c.execute('DELETE FROM terms WHERE id=?', (term,))
        for actor in actors:
            c.execute('DELETE FROM users WHERE id=?', (actor,))

print(f'PASS: {len(passed)} live teaching checks; isolated accounts, courses and records removed')
