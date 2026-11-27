import base64
import concurrent.futures
import io
import json
import secrets
import sqlite3
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from zipfile import ZipFile

from fastapi.testclient import TestClient
import test_workflow as legacy

server, op = legacy.server, legacy.op


class TeachingManagement(unittest.TestCase):
    def setUp(self):
        if server.DB.exists():
            server.DB.unlink()
        server.init_db()
        self.clients = []
        self.t = self.login('teacher')
        self.s1 = self.login('student1')
        self.s2 = self.login('student2')

    def tearDown(self):
        for client in self.clients:
            client.close()

    def login(self, name, password='Lab2026!'):
        c = TestClient(server.app)
        self.clients.append(c)
        self.assertEqual(c.post('/api/login', json={'username': name, 'password': password}).status_code, 200)
        return c

    def change(self, action, client=None, **data):
        r = (client or self.t).post('/api/teaching/' + action, json=op(**data))
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def catalog(self, client=None):
        r = (client or self.t).get('/api/catalog')
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def setup_task(self, **settings):
        course = self.change('course', title='课程' + secrets.token_hex(3))['id']
        term = self.change('term', name='测试学期')['id']
        offering = self.change('offering', course_id=course, term_id=term)['id']
        cls = self.change('class', offering_id=offering, name='测试教学班')['id']
        self.change('roster', class_id=cls, usernames=['student1', 'student2'])
        package = {**server.EXPERIMENT, 'rule_type': settings.pop('rule_type', 'resistor-divider')}
        template = self.change('template', **package)
        payload = dict(offering_id=offering, class_ids=[cls], version_id=template['version_id'], min_size=1, max_size=2)
        payload.update(settings)
        assignment = self.change('publish', **payload)['id']
        target = next(a for a in self.catalog()['assignments'] if a['id'] == assignment)['targets'][0]
        return dict(course=course, term=term, offering=offering, cls=cls, template=template, assignment=assignment, scheme=target['scheme_id'], payload=payload)

    def run_for(self, task, client=None):
        r = (client or self.s1).get('/api/state', params={'assignment_id': task['assignment']})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()['groups'][0]

    def record(self, task, client=None, raw='供电3.30V，输出1.64V，黑表笔接TP0'):
        client = client or self.s1
        g = self.run_for(task, client)
        d = client.post('/api/groups/' + g['id'] + '/extract', json=op(text=raw, revision=g['revision']))
        self.assertEqual(d.status_code, 200, d.text)
        d = d.json()
        r = client.post('/api/groups/' + g['id'] + '/records', json=op(draft_id=d['id'], revision=g['revision'], vin=d['vin'], vout=d['vout'], reference=d['reference'], acknowledged=True))
        self.assertEqual(r.status_code, 200, r.text)
        return self.run_for(task, client)

    def test_multi_course_term_clone_and_isolation(self):
        a, b = self.setup_task(), self.setup_task()
        team_a = self.change('team-create', self.s1, scheme_id=a['scheme'])['id']
        self.change('team-create', self.s1, scheme_id=b['scheme'])
        ga, gb = self.run_for(a), self.run_for(b)
        self.assertNotEqual(ga['id'], gb['id'])
        self.record(a)
        self.assertIsNone(self.run_for(b)['latest'])
        self.assertEqual(len(self.catalog(self.s1)['offerings']), 3)
        clone = self.change('clone', offering_id=a['offering'], term_name='下一学期')['id']
        o = next(o for o in self.catalog()['offerings'] if o['id'] == clone)
        self.assertEqual(len(o['classes']), 1)
        self.assertEqual(o['classes'][0]['students'], [])
        self.assertRegex(o['classes'][0]['join_code'], r'^[0-9]{6}$')
        empty = self.t.get('/api/state', params={'offering_id': clone}).json()
        self.assertIsNone(empty['assignment'])
        self.assertEqual(empty['groups'], [])
        self.assertEqual(empty['course']['experiment']['title'], '尚未发布实验')
        self.assertFalse(any(x['offering_id'] == clone for x in self.catalog()['assignments']))
        self.assertFalse(any(x['id'] == clone for x in self.catalog(self.s1)['offerings']))

    def test_single_and_multi_person_teams_and_duplicates(self):
        a = self.setup_task()
        team = self.change('team-create', self.s1, scheme_id=a['scheme'], name='独立实验组')['id']
        self.assertEqual(self.run_for(a)['members'], ['林同学'])
        r = self.s1.post('/api/teaching/team-create', json=op(scheme_id=a['scheme']))
        self.assertEqual(r.status_code, 409)
        self.change('team-join', self.s2, team_id=team)
        self.assertEqual(self.run_for(a, self.s2)['id'], self.run_for(a)['id'])
        self.assertEqual(len(self.run_for(a)['members']), 2)
        self.change('team-leave', self.s2, team_id=team)
        self.assertEqual(self.s2.get('/api/state', params={'assignment_id': a['assignment']}).json()['groups'], [])

    def test_same_name_students_can_create_separate_default_teams(self):
        a = self.setup_task()
        with server.db(True) as c:
            c.execute('UPDATE users SET name="同名学生" WHERE id IN ("student1","student2")')
        t1 = self.change('team-create', self.s1, scheme_id=a['scheme'])['id']
        t2 = self.change('team-create', self.s2, scheme_id=a['scheme'])['id']
        self.assertNotEqual(t1, t2)
        self.assertNotEqual(self.run_for(a)['name'], self.run_for(a, self.s2)['name'])

    def test_last_seat_concurrency(self):
        a = self.setup_task()
        team = self.change('team-create', self.s1, scheme_id=a['scheme'])['id']
        r = self.s1.post('/api/register', json={'username': 'student3', 'name': '第三名学生', 'password': 'Test2026!', 'role': 'teacher'})
        self.assertEqual(r.status_code, 200)
        s3 = self.login('student3', 'Test2026!')
        self.assertEqual(s3.get('/api/catalog').json()['user']['role'], 'student')
        self.change('roster', class_id=a['cls'], usernames=['student3'])
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            futures = [pool.submit(c.post, '/api/teaching/team-join', json=op(team_id=team)) for c in (self.s2, s3)]
            statuses = sorted(f.result().status_code for f in futures)
        self.assertEqual(statuses, [200, 409])
        self.assertEqual(len(self.run_for(a)['members']), 2)

    def test_lock_and_teacher_adjustment_preserve_authors(self):
        a = self.setup_task()
        team = self.change('team-create', self.s1, scheme_id=a['scheme'])['id']
        g = self.record(a)
        self.assertEqual(g['events'][0]['data']['participants'], ['student1'])
        self.assertEqual(self.s2.post('/api/teaching/team-join', json=op(team_id=team)).status_code, 409)
        self.assertEqual(self.s1.post('/api/teaching/team-leave', json=op(team_id=team)).status_code, 409)
        self.assertEqual(self.t.post('/api/teaching/member', json=op(team_id=team, username='student2')).status_code, 422)
        self.change('member', team_id=team, username='student2', reason='教师确认补入同伴')
        g = self.record(a, self.s2)
        self.assertEqual(g['events'][0]['author'], '林同学')
        self.assertEqual(g['events'][0]['data']['participants'], ['student1'])
        self.assertEqual(set(g['events'][-1]['data']['participants']), {'student1', 'student2'})
        self.assertEqual(json.loads(g['roster_snapshot']), ['student1'])
        for person in ('student1', 'student2'):
            self.change('remove-student', class_id=a['cls'], user_id=person, reason='核对后调整本班名单')
        history = self.t.get('/api/state', params={'assignment_id': a['assignment']}).json()['groups']
        self.assertEqual(len(history), 1, 'Teacher must retain access to recorded groups after all members leave')
        self.assertEqual(history[0]['members'], [])
        self.assertEqual(len(history[0]['events']), 2)

    def test_fixed_groups_different_experiment_runs(self):
        a = self.setup_task()
        team = self.change('team-create', self.s1, scheme_id=a['scheme'])['id']
        aid = self.change('publish', **{**a['payload'], 'scheme_ids': {a['cls']: a['scheme']}, 'title': '第二次实验'})['id']
        b = {**a, 'assignment': aid}
        ga, gb = self.run_for(a), self.run_for(b)
        self.assertEqual(ga['team_id'], gb['team_id'])
        self.assertNotEqual(ga['id'], gb['id'])
        self.record(a)
        self.s1.post('/api/groups/' + ga['id'] + '/revision', json=op(revision=1, reason='修改第一次实验的连接'))
        self.assertEqual(self.run_for(a)['revision'], 2)
        self.assertEqual(self.run_for(b)['revision'], 1)
        self.assertEqual(self.run_for(b)['events'], [])

    def test_editing_handout_does_not_create_versions_or_change_published_rules(self):
        a = self.setup_task()
        self.change('team-create', self.s1, scheme_id=a['scheme'])
        original_id = a['template']['id']
        update = self.change('template-update', template_id=original_id, **{**server.EXPERIMENT, 'rule_type': 'resistor-divider',
                                                                           'principle': '用串联分压关系预测输出。', 'preparation': '记录电阻标称值。'})
        self.assertEqual(update, a['template'])
        changed_rule = self.t.post('/api/teaching/template-update', json=op(template_id=original_id, **{**server.EXPERIMENT, 'r1_ohm': 20000}))
        self.assertEqual(changed_rule.status_code, 409)
        second = self.change('template', **{**server.EXPERIMENT, 'r1_ohm': 20000})
        second_publication = {k: v for k, v in a['payload'].items() if k != 'version_id'}
        aid = self.change('publish', **second_publication, template_id=second['id'])['id']
        b = {**a, 'assignment': aid}
        target = next(x for x in self.catalog()['assignments'] if x['id'] == aid)['targets'][0]
        self.change('team-create', self.s1, scheme_id=target['scheme_id'])
        ga, gb = self.record(a), self.record(b)
        self.assertEqual(ga['latest']['data']['assessment']['expected_v'], 1.65)
        self.assertEqual(gb['latest']['data']['assessment']['expected_v'], 1.1)
        self.assertEqual(ga['latest']['data']['experiment_version_id'], a['template']['version_id'])
        catalog = self.s1.get('/api/catalog').json()
        packages = {item['id']: item['experiment'] for item in catalog['assignments']}
        self.assertEqual(packages[a['assignment']]['principle'], '用串联分压关系预测输出。')
        self.assertEqual(packages[a['assignment']]['preparation'], '记录电阻标称值。')
        with server.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM experiment_versions WHERE template_id=?', (original_id,)).fetchone()[0], 1)

    def test_document_handout_upload_replacement_and_permission(self):
        a = self.setup_task()
        pdf = b'%PDF-1.4\n%%EOF\n'
        def upload(name, blob):
            return {'filename': name, 'content': base64.b64encode(blob).decode()}
        creation = {'title': ' ', 'rule_type': 'observation', 'document': upload('课堂讲义.pdf', pdf)}
        self.assertEqual(self.s1.post('/api/teaching/template', json=op(**creation)).status_code, 403)
        handout = self.change('template', **creation)
        teacher_path = '/api/teaching/handouts/'+handout['id']+'/file'
        self.assertEqual(self.t.get(teacher_path).content, pdf)
        self.assertEqual(self.s1.get(teacher_path).status_code, 404)
        assignment = self.change('publish', offering_id=a['offering'], class_ids=[a['cls']], template_id=handout['id'])['id']
        path = '/api/teaching/assignments/'+assignment+'/handout'
        student_response = self.s1.get(path)
        self.assertEqual(student_response.headers['content-type'], 'application/pdf')
        self.assertIn('attachment', student_response.headers['content-disposition'])
        self.assertEqual(student_response.content, pdf)
        self.s2.post('/api/register', json={'username':'doc-outsider','name':'外班学生','password':'Test2026!'})
        outsider = self.login('doc-outsider','Test2026!')
        self.assertEqual(outsider.get(path).status_code, 404)
        info = next(item for item in self.catalog(self.s1)['assignments'] if item['id'] == assignment)
        self.assertEqual(info['document']['filename'], '课堂讲义.pdf')
        self.assertNotIn('content', info['document'])
        word = io.BytesIO()
        with ZipFile(word, 'w') as archive:
            archive.writestr('[Content_Types].xml', '<Types/>')
            archive.writestr('word/document.xml', '<document/>')
        changed = self.change('template-update', template_id=handout['id'], title='课堂讲义', rule_type='observation',
                              document=upload('更正讲义.docx', word.getvalue()))
        self.assertEqual(changed, handout)
        self.assertEqual(self.s1.get(path).content, word.getvalue())
        invalid = self.t.post('/api/teaching/template-update', json=op(template_id=handout['id'], title='课堂讲义',
                                     rule_type='observation',document=upload('伪装文件.docx', pdf)))
        self.assertEqual(invalid.status_code, 422)
        self.assertEqual(self.s1.get(path).content, word.getvalue())

    def test_dates_archiving_and_unselected_class(self):
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        a = self.setup_task(opens_at=future)
        self.change('team-create', self.s1, scheme_id=a['scheme'])
        g = self.run_for(a)
        endpoint = '/api/groups/' + g['id'] + '/extract'
        self.assertEqual(self.s1.post(endpoint, json=op(revision=1, text='供电3.3V')).status_code, 409)
        self.change('schedule', assignment_id=a['assignment'], opens_at=None, closes_at=None)
        self.record(a)
        self.change('archive', offering_id=a['offering'], archived=True)
        self.assertEqual(self.s1.post(endpoint, json=op(revision=1, text='供电3.3V')).status_code, 409)
        self.assertEqual(self.t.post('/api/teaching/class', json=op(offering_id=a['offering'], name='不得新建')).status_code, 409)
        self.change('archive', offering_id=a['offering'], archived=False)
        self.assertEqual(self.run_for(a)['latest']['data']['assessment']['code'], 'pass')

    def test_observation_experiment_and_submission(self):
        a = self.setup_task(rule_type='observation')
        self.change('team-create', self.s1, scheme_id=a['scheme'])
        g = self.record(a, raw='我观察到仪器显示输出1.64V，仍需检查参考点。')
        self.assertIsNone(g['latest'])
        self.assertEqual(g['events'][0]['kind'], 'observation')
        r = self.s1.post('/api/groups/' + g['id'] + '/submit', json=op(revision=1, conclusion='记录观察，等待教师核对。'))
        self.assertEqual(r.status_code, 200, r.text)

    def test_formal_report_private_reflections_return_grades_and_exports(self):
        task = self.setup_task(rule_type='observation')
        team = self.change('team-create', self.s1, scheme_id=task['scheme'])['id']
        self.change('team-join', self.s2, team_id=team)
        group = self.record(task, raw='正接时观察到发光，电源与限流电阻保持一致。')
        gid = group['id']
        route = '/api/groups/' + gid + '/report'
        sections = {'method': '对照两种接法。', 'analysis': '核对相同供电条件。', 'conclusion': '记录了正接时的发光。'}
        s1_reflection, s2_reflection = '我负责记录条件。', '我先预测，再核对现象。'
        save1 = self.s1.post(route+'/draft', json=op(revision=1, draft_edit=0, sections=sections))
        self.assertEqual(save1.json()['edit'], 1)
        overwrite = self.s2.post(route+'/draft', json=op(revision=1, draft_edit=0, sections=sections))
        self.assertEqual(overwrite.status_code, 409)
        draft = self.s2.get(route).json()
        self.assertEqual(draft['sections']['method'], sections['method'])
        self.assertEqual(draft['reflection_progress'], {'completed': 0, 'required': 2})
        incomplete = self.s1.post(route+'/submit', json=op(revision=1, draft_edit=1, sections=sections,
                                                          reflection_edit=0, reflection=s1_reflection))
        self.assertEqual(incomplete.status_code, 422)
        self.assertEqual(self.s1.get(route).json()['reflection'], '', 'Failed submission rolls back private text and draft')
        self.assertEqual(self.s2.post(route+'/reflection', json=op(revision=1, reflection_edit=0, reflection=s2_reflection)).status_code, 200)
        self.assertNotIn(s2_reflection, self.s1.get(route).text)
        first_payload = op(revision=1, draft_edit=1, sections=sections, reflection_edit=0, reflection=s1_reflection)
        first = self.s1.post(route+'/submit', json=first_payload)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(self.s1.post(route+'/submit', json=first_payload).json(),first.json())
        first_id = first.json()['id']
        self.assertNotIn(s2_reflection, self.s1.get(route).text)
        self.assertNotIn(s2_reflection, self.s1.get('/api/state', params={'assignment_id': task['assignment']}).text)
        self.assertIn(s2_reflection, self.t.get(route).text)
        review = '/api/groups/' + gid + '/review'
        rejected = self.t.post(review, json=op(submission_id=first_id, decision='feedback', text='需要完善。'))
        self.assertEqual(rejected.status_code, 422)
        self.assertEqual(self.t.post(review, json=op(submission_id=first_id, decision='return', text='补充反接证据。')).status_code, 200)
        self.assertEqual(self.s1.get(route+'.pdf', params={'submission_id':first_id,'reviewed':'1'}).status_code, 409)
        self.record(task, raw='反接时没有观察到发光，供电条件相同。')
        updated = {**sections, 'conclusion':'比较正接与反接，发光情况不同。'}
        second = self.s1.post(route+'/submit', json=op(revision=1, draft_edit=2, sections=updated))
        self.assertEqual(second.status_code, 200, second.text)
        second_id = second.json()['id']
        grades = {'process':23,'evidence':28,'analysis':28,'presentation':13}
        too_high = self.t.post(review,json=op(submission_id=second_id,decision='feedback',text='已核对。',scores={**grades,'process':26}))
        self.assertEqual(too_high.status_code, 422)
        self.assertEqual(self.t.post(review,json=op(submission_id=second_id,decision='feedback',text='已核对。',scores=grades)).status_code, 200)
        prior = self.s1.get(route, params={'submission_id':first_id}).json()['submission']
        self.assertEqual(prior['sections']['conclusion'], sections['conclusion'])
        self.assertEqual(prior['evaluation']['text'], '补充反接证据。')
        latest = self.s1.get(route).json()['submission']
        self.assertEqual(latest['evaluation']['total'],92)
        self.assertEqual(latest['reflections'],[{'name':'林同学','text':s1_reflection}])
        for query in ({'submission_id':second_id}, {'submission_id':second_id,'reviewed':'1'}):
            response = self.s1.get(route+'.pdf',params=query)
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.content.startswith(b'%PDF-'))
        self.assertEqual(TestClient(server.app).get(route+'.pdf').status_code, 401)

    def test_invitation_permissions_and_atomic_publication(self):
        a = self.setup_task()
        newcomer = TestClient(server.app)
        self.clients.append(newcomer)
        newcomer.post('/api/register', json={'username': 'newcomer', 'name': '新学生', 'password': 'Test2026!'})
        newcomer.post('/api/login', json={'username': 'newcomer', 'password': 'Test2026!'})
        self.assertEqual(newcomer.get('/api/state', params={'assignment_id': a['assignment']}).status_code, 404)
        cls = next(o for o in self.catalog()['offerings'] if o['id'] == a['offering'])['classes'][0]
        self.change('enroll', newcomer, join_code=cls['join_code'])
        self.assertEqual(len(self.catalog(newcomer)['assignments']), 1)
        self.assertEqual(newcomer.post('/api/teaching/course', json=op(title='越权')).status_code, 403)
        with server.db() as c:
            before = c.execute('SELECT count(*) FROM grouping_schemes').fetchone()[0]
        r = self.t.post('/api/teaching/publish', json=op(**{**a['payload'], 'class_ids': [a['cls'], 'not-a-class']}))
        self.assertEqual(r.status_code, 404)
        with server.db() as c:
            self.assertEqual(c.execute('SELECT count(*) FROM grouping_schemes').fetchone()[0], before)

    def test_numeric_invites_migrate_without_reenrolling_students(self):
        class_id = 'class-circuits-2026'
        with server.db(True) as c:
            c.execute('UPDATE classes SET join_code=? WHERE id=?', ('ABCD012345', class_id))
            members = c.execute('SELECT * FROM enrollments ORDER BY class_id,user_id').fetchall()
        with patch('teaching.secrets.randbelow', return_value=12345):
            server.init_db()
        server.init_db()
        with server.db() as c:
            self.assertEqual(c.execute('SELECT join_code FROM classes WHERE id=?', (class_id,)).fetchone()[0], '012345')
            self.assertEqual(c.execute('SELECT * FROM enrollments ORDER BY class_id,user_id').fetchall(), members)
        with patch('teaching.secrets.randbelow', side_effect=[12345, 234567]):
            new_id = self.change('class', offering_id='offering-circuits-2026', name='另一个教学班')['id']
        classes = self.catalog()['offerings'][0]['classes']
        self.assertEqual(next(c['join_code'] for c in classes if c['id'] == new_id), '234567')
        route = '/api/teaching/enroll'
        self.assertEqual(self.s1.post(route, json=op(join_code='ABCD012345')).status_code, 422)
        self.assertEqual(self.change('enroll', self.s1, join_code='012345')['id'], class_id)
        with patch.object(server.TEACHING, 'join_failures', {}), patch.object(server.TEACHING, 'join_reset_at', 0):
            for _ in range(8):
                self.assertEqual(self.s1.post(route, json=op(join_code='000000')).status_code, 404)
            limited = self.s1.post(route, json=op(join_code='000000'))
            self.assertEqual(limited.status_code, 429)
            self.assertGreater(int(limited.headers['Retry-After']), 0)
            self.assertEqual(self.change('enroll', self.s2, join_code='012345')['id'], class_id)

    def test_automatic_assignment_and_cross_teacher_denial(self):
        a = self.setup_task(mode='assigned')
        self.assertEqual(self.s1.post('/api/teaching/team-create', json=op(scheme_id=a['scheme'])).status_code, 403)
        self.change('auto-assign', scheme_id=a['scheme'])
        self.assertEqual(len(self.run_for(a)['members']), 2)
        with server.db(True) as c:
            salt = secrets.token_hex(16)
            c.execute('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)', ('other-teacher', 'other-teacher', '其他教师', 'teacher', salt, server.hash_password('Lab2026!', salt), '', None))
        other = self.login('other-teacher')
        self.assertEqual(other.get('/api/state', params={'assignment_id': a['assignment']}).status_code, 404)
        self.assertEqual(other.post('/api/assist', json={'question': '读取另一课程', 'group_id': self.run_for(a)['id']}).status_code, 404)
        self.assertEqual(other.get('/api/catalog').json()['offerings'], [])

    def test_migration_is_idempotent_and_preserves_record(self):
        self.s1.post('/api/groups/group-1/help', json=op(text='原有求助'))
        with server.db() as c:
            original = tuple(c.execute('SELECT id,actor,revision,data,created FROM events').fetchone())
        server.init_db()
        server.init_db()
        with server.db() as c:
            self.assertEqual(c.execute('SELECT version FROM meta').fetchone()[0], 2)
            self.assertEqual(tuple(c.execute('SELECT id,actor,revision,data,created FROM events').fetchone()), original)
            self.assertEqual(c.execute('SELECT count(*) FROM assignment_targets').fetchone()[0], 1)
            self.assertEqual(c.execute('PRAGMA integrity_check').fetchone()[0], 'ok')

    def test_actual_v1_database_migration_preserves_evidence(self):
        server.DB.unlink()
        raw = json.dumps({'raw': '迁移前的真实观察记录', 'extracted': {'kind': 'observation'}}, ensure_ascii=False)
        with sqlite3.connect(server.DB) as c:
            c.executescript('''
            CREATE TABLE meta(version INTEGER NOT NULL);
            INSERT INTO meta VALUES(1);
            CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,salt TEXT NOT NULL,password TEXT NOT NULL,course_id TEXT NOT NULL,group_id TEXT);
            CREATE TABLE courses(id TEXT PRIMARY KEY,title TEXT NOT NULL,experiment TEXT NOT NULL);
            CREATE TABLE groups(id TEXT PRIMARY KEY,course_id TEXT,name TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'working',help INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE events(id TEXT PRIMARY KEY,group_id TEXT,actor TEXT,revision INTEGER NOT NULL,kind TEXT NOT NULL,data TEXT NOT NULL,created TEXT NOT NULL);
            ''')
            c.execute('INSERT INTO courses VALUES(?,?,?)', ('circuits-2026', '原课程名称', server.packed(server.EXPERIMENT)))
            c.execute('INSERT INTO groups(id,course_id,name,revision) VALUES(?,?,?,?)', ('group-1', 'circuits-2026', '原小组', 3))
            for username, role, group in [('teacher', 'teacher', None), ('student1', 'student', 'group-1')]:
                salt = 'old-salt-' + username
                c.execute('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)', (username, username, '原姓名' + username, role, salt, server.hash_password('Lab2026!', salt), 'circuits-2026', group))
            c.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?)', ('old-evidence-id', 'group-1', 'student1', 3, 'observation', raw, '2026-10-01T09:10:11+00:00'))
        server.init_db()
        server.init_db()
        s = self.login('student1')
        g = s.get('/api/state').json()['groups'][0]
        self.assertEqual(g['id'], 'group-1')
        self.assertEqual(g['revision'], 3)
        self.assertEqual(g['name'], '原小组')
        self.assertEqual(g['events'][0]['id'], 'old-evidence-id')
        self.assertEqual(g['events'][0]['author'], '原姓名student1')
        self.assertEqual(g['events'][0]['created'], '2026-10-01T09:10:11+00:00')
        with server.db() as c:
            self.assertEqual(c.execute('SELECT data FROM events WHERE id="old-evidence-id"').fetchone()[0], raw)
            self.assertEqual(c.execute('SELECT locked FROM teams WHERE id="team-group-1"').fetchone()[0], 1)
            self.assertEqual(c.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
