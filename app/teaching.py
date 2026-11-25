"""Course, semester, class and assignment management. Every mutation is transactional."""
import json
import math
import re
import secrets
from datetime import datetime, timezone

from fastapi import HTTPException, Request


SCHEMA = [
    'CREATE TABLE IF NOT EXISTS terms(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,created TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS course_owners(course_id TEXT REFERENCES courses(id),teacher_id TEXT REFERENCES users(id),PRIMARY KEY(course_id,teacher_id))',
    'CREATE TABLE IF NOT EXISTS offerings(id TEXT PRIMARY KEY,course_id TEXT REFERENCES courses(id),term_id TEXT REFERENCES terms(id),archived INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL,UNIQUE(course_id,term_id))',
    'CREATE TABLE IF NOT EXISTS offering_teachers(offering_id TEXT REFERENCES offerings(id),user_id TEXT REFERENCES users(id),PRIMARY KEY(offering_id,user_id))',
    'CREATE TABLE IF NOT EXISTS classes(id TEXT PRIMARY KEY,offering_id TEXT REFERENCES offerings(id),name TEXT NOT NULL,join_code TEXT UNIQUE NOT NULL,created TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS enrollments(class_id TEXT REFERENCES classes(id),user_id TEXT REFERENCES users(id),created TEXT NOT NULL,PRIMARY KEY(class_id,user_id))',
    'CREATE TABLE IF NOT EXISTS experiment_templates(id TEXT PRIMARY KEY,owner TEXT REFERENCES users(id),title TEXT NOT NULL,created TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS experiment_versions(id TEXT PRIMARY KEY,template_id TEXT REFERENCES experiment_templates(id),number INTEGER NOT NULL,title TEXT NOT NULL,package TEXT NOT NULL,created TEXT NOT NULL,UNIQUE(template_id,number))',
    'CREATE TABLE IF NOT EXISTS grouping_schemes(id TEXT PRIMARY KEY,class_id TEXT REFERENCES classes(id),name TEXT NOT NULL,min_size INTEGER NOT NULL,max_size INTEGER NOT NULL,mode TEXT NOT NULL,allow_create INTEGER NOT NULL,deadline TEXT)',
    'CREATE TABLE IF NOT EXISTS teams(id TEXT PRIMARY KEY,scheme_id TEXT REFERENCES grouping_schemes(id),name TEXT NOT NULL,locked INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL,UNIQUE(id,scheme_id),UNIQUE(scheme_id,name))',
    'CREATE TABLE IF NOT EXISTS team_members(team_id TEXT,scheme_id TEXT,user_id TEXT REFERENCES users(id),joined TEXT NOT NULL,PRIMARY KEY(scheme_id,user_id),FOREIGN KEY(team_id,scheme_id) REFERENCES teams(id,scheme_id))',
    'CREATE TABLE IF NOT EXISTS assignments(id TEXT PRIMARY KEY,offering_id TEXT REFERENCES offerings(id),title TEXT NOT NULL,version_id TEXT REFERENCES experiment_versions(id),opens_at TEXT,closes_at TEXT,status TEXT NOT NULL DEFAULT "published",created_by TEXT REFERENCES users(id),created TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS assignment_targets(assignment_id TEXT REFERENCES assignments(id),class_id TEXT REFERENCES classes(id),scheme_id TEXT REFERENCES grouping_schemes(id),PRIMARY KEY(assignment_id,class_id))',
    'CREATE TABLE IF NOT EXISTS teaching_audit(id TEXT PRIMARY KEY,actor TEXT REFERENCES users(id),kind TEXT NOT NULL,context TEXT NOT NULL,data TEXT NOT NULL,created TEXT NOT NULL)',
]


def migrate(c, experiment, uid, now, packed):
    for sql in SCHEMA:
        c.execute(sql)
    columns = {r[1] for r in c.execute('PRAGMA table_info(groups)')}
    for name, definition in [('assignment_id', 'TEXT REFERENCES assignments(id)'), ('class_id', 'TEXT REFERENCES classes(id)'), ('team_id', 'TEXT REFERENCES teams(id)'), ('roster_snapshot', 'TEXT')]:
        if name not in columns:
            c.execute(f'ALTER TABLE groups ADD COLUMN {name} {definition}')
    c.execute('CREATE UNIQUE INDEX IF NOT EXISTS group_assignment_team ON groups(assignment_id,team_id) WHERE assignment_id IS NOT NULL')
    version = c.execute('SELECT version FROM meta').fetchone()[0]
    if version > 2:
        raise RuntimeError('Database schema is newer than this application')
    if version == 2:
        return
    c.execute('INSERT OR IGNORE INTO terms VALUES(?,?,?)', ('term-legacy', '2026至2027学年第一学期', now()))
    for course in c.execute('SELECT * FROM courses').fetchall():
        cid = course['id']
        teachers = [r[0] for r in c.execute('SELECT id FROM users WHERE course_id=? AND role="teacher"', (cid,))]
        if not teachers:
            continue
        oid, cls, scheme, tid, vid, aid = (f'{p}-{cid}' for p in ('offering', 'class', 'scheme', 'template', 'version', 'assignment'))
        c.execute('INSERT INTO offerings(id,course_id,term_id,created) VALUES(?,?,?,?)', (oid, cid, 'term-legacy', now()))
        for teacher in teachers:
            c.execute('INSERT OR IGNORE INTO course_owners VALUES(?,?)', (cid, teacher))
            c.execute('INSERT INTO offering_teachers VALUES(?,?)', (oid, teacher))
        c.execute('INSERT INTO classes VALUES(?,?,?,?,?)', (cls, oid, '教学试用班', secrets.token_hex(5).upper(), now()))
        c.execute('INSERT INTO grouping_schemes VALUES(?,?,?,?,?,?,?,?)', (scheme, cls, '原有实验分组', 1, 4, 'self', 1, None))
        package = json.loads(course['experiment'])
        package.setdefault('rule_type', 'resistor-divider')
        c.execute('INSERT INTO experiment_templates VALUES(?,?,?,?)', (tid, teachers[0], package['title'], now()))
        c.execute('INSERT INTO experiment_versions VALUES(?,?,?,?,?,?)', (vid, tid, 1, package['title'], packed(package), now()))
        c.execute('INSERT INTO assignments(id,offering_id,title,version_id,created_by,created) VALUES(?,?,?,?,?,?)', (aid, oid, package['title'], vid, teachers[0], now()))
        c.execute('INSERT INTO assignment_targets VALUES(?,?,?)', (aid, cls, scheme))
        for g in c.execute('SELECT * FROM groups WHERE course_id=?', (cid,)).fetchall():
            team = 'team-' + g['id']
            started = c.execute('SELECT 1 FROM events WHERE group_id=? LIMIT 1', (g['id'],)).fetchone() is not None
            c.execute('INSERT INTO teams VALUES(?,?,?,?,?)', (team, scheme, g['name'], int(started), now()))
            members = []
            for person in c.execute('SELECT id FROM users WHERE group_id=? AND role="student"', (g['id'],)).fetchall():
                members.append(person[0])
                c.execute('INSERT OR IGNORE INTO enrollments VALUES(?,?,?)', (cls, person[0], now()))
                c.execute('INSERT INTO team_members VALUES(?,?,?,?)', (team, scheme, person[0], now()))
            c.execute('UPDATE groups SET assignment_id=?,class_id=?,team_id=?,roster_snapshot=? WHERE id=?', (aid, cls, team, packed(members) if started else None, g['id']))
    c.execute('UPDATE meta SET version=2')


class Teaching:
    def __init__(self, service):
        self.s = service

    def teacher(self, who):
        if who['role'] != 'teacher':
            raise HTTPException(403, '仅教师可以执行此操作')

    def offering(self, c, who, oid, write=False):
        row = c.execute('SELECT o.*,c.title,t.name AS term FROM offerings o JOIN courses c ON c.id=o.course_id JOIN terms t ON t.id=o.term_id WHERE o.id=?', (oid,)).fetchone()
        permitted = c.execute('SELECT 1 FROM offering_teachers WHERE offering_id=? AND user_id=?', (oid, who['id'])).fetchone() if who['role'] == 'teacher' else c.execute('SELECT 1 FROM classes c JOIN enrollments e ON e.class_id=c.id WHERE c.offering_id=? AND e.user_id=?', (oid, who['id'])).fetchone()
        if not row or not permitted:
            raise HTTPException(404, '未找到可访问的开课课程')
        if write:
            self.teacher(who)
            if row['archived']:
                raise HTTPException(409, '该学期开课已归档，请先恢复后修改')
        return dict(row)

    def classroom(self, c, who, cid, write=False):
        row = c.execute('SELECT * FROM classes WHERE id=?', (cid,)).fetchone()
        if not row:
            raise HTTPException(404, '未找到教学班')
        offering = self.offering(c, who, row['offering_id'], write)
        if who['role'] == 'student' and not c.execute('SELECT 1 FROM enrollments WHERE class_id=? AND user_id=?', (cid, who['id'])).fetchone():
            raise HTTPException(404, '未加入该教学班')
        return dict(row), offering

    def scheme(self, c, who, sid, write=False):
        row = c.execute('SELECT * FROM grouping_schemes WHERE id=?', (sid,)).fetchone()
        if not row:
            raise HTTPException(404, '未找到分组方案')
        self.classroom(c, who, row['class_id'], write)
        return dict(row)

    def team(self, c, who, tid, write=False):
        row = c.execute('SELECT * FROM teams WHERE id=?', (tid,)).fetchone()
        if not row:
            raise HTTPException(404, '未找到小组')
        return dict(row), self.scheme(c, who, row['scheme_id'], write)

    def assignment(self, c, who, aid):
        row = c.execute('SELECT a.*,v.package FROM assignments a JOIN experiment_versions v ON v.id=a.version_id WHERE a.id=?', (aid,)).fetchone()
        if not row:
            raise HTTPException(404, '未找到实验任务')
        self.offering(c, who, row['offering_id'])
        if who['role'] == 'student' and not c.execute('SELECT 1 FROM assignment_targets t JOIN enrollments e ON e.class_id=t.class_id WHERE t.assignment_id=? AND e.user_id=?', (aid, who['id'])).fetchone():
            raise HTTPException(404, '该任务未向所在班级发布')
        return dict(row)

    def group(self, c, who, gid):
        row = c.execute('SELECT * FROM groups WHERE id=?', (gid,)).fetchone()
        if not row:
            raise HTTPException(404, '未找到可访问的小组')
        g = dict(row)
        if not g['assignment_id']:
            # Legacy isolated fixtures remain readable; all new runs use explicit membership.
            if g['course_id'] != who['course_id'] or (who['role'] == 'student' and who['group_id'] != gid):
                raise HTTPException(404, '未找到可访问的小组')
            g['experiment'] = json.loads(c.execute('SELECT experiment FROM courses WHERE id=?', (g['course_id'],)).fetchone()[0])
            return g
        assignment = self.assignment(c, who, g['assignment_id'])
        self.classroom(c, who, g['class_id'])
        if who['role'] == 'student' and not c.execute('SELECT 1 FROM team_members WHERE team_id=? AND user_id=?', (g['team_id'], who['id'])).fetchone():
            raise HTTPException(404, '未找到可访问的小组')
        offering = self.offering(c, who, assignment['offering_id'])
        g.update(experiment=json.loads(assignment['package']), experiment_version_id=assignment['version_id'], assignment_title=assignment['title'], opens_at=assignment['opens_at'], closes_at=assignment['closes_at'], assignment_status=assignment['status'], archived=offering['archived'])
        scheme = c.execute('SELECT s.* FROM teams t JOIN grouping_schemes s ON s.id=t.scheme_id WHERE t.id=?', (g['team_id'],)).fetchone()
        g['min_size'] = scheme['min_size']
        g['member_count'] = c.execute('SELECT count(*) FROM team_members WHERE team_id=?', (g['team_id'],)).fetchone()[0]
        return g

    def members(self, c, g):
        if not g.get('team_id'):
            return [dict(r) for r in c.execute('SELECT id,name,username FROM users WHERE group_id=?', (g['id'],))]
        return [dict(r) for r in c.execute('SELECT u.id,u.name,u.username FROM team_members m JOIN users u ON u.id=m.user_id WHERE m.team_id=? ORDER BY m.joined,u.id', (g['team_id'],))]

    def check_run(self, g):
        if not g.get('assignment_id'):
            return
        if g['archived'] or g['assignment_status'] != 'published':
            raise HTTPException(409, '该实验已结束或课程已归档，当前仅可查看历史记录')
        timestamp = datetime.now(timezone.utc)
        if g['opens_at'] and timestamp < datetime.fromisoformat(g['opens_at']):
            raise HTTPException(409, '实验尚未开放，可以先完成选组')
        if g['closes_at'] and timestamp > datetime.fromisoformat(g['closes_at']):
            raise HTTPException(409, '实验已过截止时间，请联系教师调整时间')
        if g['member_count'] < g['min_size']:
            raise HTTPException(409, f"小组至少需要 {g['min_size']} 人，请先完成组队")

    def ensure_runs(self, c, team_id):
        team = c.execute('SELECT t.*,s.class_id FROM teams t JOIN grouping_schemes s ON s.id=t.scheme_id WHERE t.id=?', (team_id,)).fetchone()
        for a in c.execute('SELECT a.id,o.course_id FROM assignment_targets t JOIN assignments a ON a.id=t.assignment_id JOIN offerings o ON o.id=a.offering_id WHERE t.scheme_id=?', (team['scheme_id'],)).fetchall():
            if not c.execute('SELECT 1 FROM groups WHERE assignment_id=? AND team_id=?', (a['id'], team_id)).fetchone():
                c.execute('INSERT INTO groups(id,course_id,name,assignment_id,class_id,team_id) VALUES(?,?,?,?,?,?)', (self.s['uid'](), a['course_id'], team['name'], a['id'], team['class_id'], team_id))

    def scope(self, c, who, aid=None, class_id=None, offering_id=None):
        selected_offering = self.offering(c, who, offering_id) if offering_id else None
        if not aid:
            if who['role'] == 'teacher':
                row = c.execute('SELECT a.id FROM assignments a JOIN offering_teachers t ON t.offering_id=a.offering_id WHERE t.user_id=? AND (? IS NULL OR a.offering_id=?) ORDER BY a.created,a.id LIMIT 1', (who['id'], offering_id, offering_id)).fetchone()
            else:
                row = c.execute('SELECT a.id FROM assignments a JOIN assignment_targets t ON t.assignment_id=a.id JOIN enrollments e ON e.class_id=t.class_id WHERE e.user_id=? AND (? IS NULL OR a.offering_id=?) ORDER BY a.created,a.id LIMIT 1', (who['id'], offering_id, offering_id)).fetchone()
            aid = row[0] if row else None
        if not aid:
            if selected_offering:
                empty = {'id': 'no-assignment', 'version': '', 'title': '尚未发布实验', 'rule_type': 'observation', 'objective': '请先从实验内容库向本班发布实验任务。', 'steps': [], 'points': {}, 'formula': '', 'safety': ''}
                return {'id': selected_offering['course_id'], 'title': selected_offering['title'], 'term': selected_offering['term'], 'offering_id': offering_id, 'archived': selected_offering['archived'], 'experiment': empty}, [], None
            # Backward-compatible isolated deployment checks for pre-migration fixtures.
            course = c.execute('SELECT * FROM courses WHERE id=?', (who['course_id'],)).fetchone()
            if course and c.execute('SELECT 1 FROM groups WHERE course_id=? AND assignment_id IS NULL', (who['course_id'],)).fetchone():
                ids = [r[0] for r in c.execute('SELECT id FROM groups WHERE course_id=? AND assignment_id IS NULL ORDER BY name', (who['course_id'],))] if who['role'] == 'teacher' else [who['group_id']]
                return dict(course), ids, None
            return {'id': '', 'title': '请选择实验任务', 'experiment': self.s['EXPERIMENT']}, [], None
        a = self.assignment(c, who, aid)
        if offering_id and a['offering_id'] != offering_id:
            raise HTTPException(404, '任务不属于所选开课课程')
        o = self.offering(c, who, a['offering_id'])
        if class_id:
            self.classroom(c, who, class_id)
            if not c.execute('SELECT 1 FROM assignment_targets WHERE assignment_id=? AND class_id=?', (aid, class_id)).fetchone():
                raise HTTPException(404, '该实验未向此教学班发布')
        sql = 'SELECT g.id FROM groups g WHERE g.assignment_id=?'
        params = [aid]
        if class_id:
            sql += ' AND g.class_id=?'
            params.append(class_id)
        if who['role'] == 'student':
            sql += ' AND EXISTS(SELECT 1 FROM team_members m JOIN enrollments e ON e.user_id=m.user_id AND e.class_id=g.class_id WHERE m.team_id=g.team_id AND m.user_id=?)'
            params.append(who['id'])
        else:
            sql += ' AND (EXISTS(SELECT 1 FROM team_members m WHERE m.team_id=g.team_id) OR EXISTS(SELECT 1 FROM events e WHERE e.group_id=g.id))'
        ids = [r[0] for r in c.execute(sql + ' ORDER BY g.name,g.id', params)]
        return {'id': o['course_id'], 'title': o['title'], 'term': o['term'], 'offering_id': o['id'], 'archived': o['archived'], 'experiment': a['package']}, ids, {k: a[k] for k in a if k != 'package'}

    def catalog(self, c, who):
        if who['role'] == 'teacher':
            rows = c.execute('SELECT DISTINCT o.id FROM offerings o JOIN offering_teachers t ON t.offering_id=o.id WHERE t.user_id=? ORDER BY o.created DESC', (who['id'],)).fetchall()
        else:
            rows = c.execute('SELECT DISTINCT o.id FROM offerings o JOIN classes c ON c.offering_id=o.id JOIN enrollments e ON e.class_id=c.id WHERE e.user_id=? ORDER BY o.created DESC', (who['id'],)).fetchall()
        offerings = []
        assignments = []
        for r in rows:
            o = self.offering(c, who, r[0])
            classrooms = []
            for cls in c.execute('SELECT * FROM classes WHERE offering_id=? ORDER BY created,id', (o['id'],)).fetchall():
                if who['role'] == 'student' and not c.execute('SELECT 1 FROM enrollments WHERE class_id=? AND user_id=?', (cls['id'], who['id'])).fetchone():
                    continue
                item = dict(cls)
                item['students'] = [dict(p) for p in c.execute('SELECT u.id,u.username,u.name FROM enrollments e JOIN users u ON u.id=e.user_id WHERE e.class_id=? ORDER BY u.username', (cls['id'],))] if who['role'] == 'teacher' else []
                if who['role'] != 'teacher':
                    item.pop('join_code')
                item['schemes'] = []
                for scheme in c.execute('SELECT * FROM grouping_schemes WHERE class_id=?', (cls['id'],)).fetchall():
                    s = dict(scheme)
                    s['teams'] = []
                    for team in c.execute('SELECT * FROM teams WHERE scheme_id=? ORDER BY created,id', (s['id'],)).fetchall():
                        t = dict(team)
                        t['members'] = [dict(p) for p in c.execute('SELECT u.id,u.name,u.username FROM team_members m JOIN users u ON u.id=m.user_id WHERE m.team_id=? ORDER BY m.joined,u.id', (t['id'],))]
                        t['mine'] = any(p['id'] == who['id'] for p in t['members'])
                        s['teams'].append(t)
                    item['schemes'].append(s)
                classrooms.append(item)
            o['classes'] = classrooms
            o['teachers'] = [dict(p) for p in c.execute('SELECT u.id,u.name,u.username FROM offering_teachers t JOIN users u ON u.id=t.user_id WHERE t.offering_id=?', (o['id'],))] if who['role'] == 'teacher' else []
            offerings.append(o)
            for assignment in c.execute('SELECT a.*,v.package FROM assignments a JOIN experiment_versions v ON v.id=a.version_id WHERE a.offering_id=? ORDER BY a.created DESC,a.id', (o['id'],)).fetchall():
                targets = [dict(t) for t in c.execute('SELECT t.*,c.name AS class_name FROM assignment_targets t JOIN classes c ON c.id=t.class_id WHERE t.assignment_id=?', (assignment['id'],)) if any(cls['id'] == t['class_id'] for cls in classrooms)]
                if not targets:
                    continue
                a = dict(assignment)
                a['experiment'] = json.loads(a.pop('package'))
                a['targets'] = targets
                a['my_runs'] = [r[0] for r in c.execute('SELECT g.id FROM groups g JOIN team_members m ON m.team_id=g.team_id JOIN enrollments e ON e.class_id=g.class_id AND e.user_id=m.user_id WHERE g.assignment_id=? AND m.user_id=?', (a['id'], who['id']))]
                assignments.append(a)
        templates = []
        courses = []
        if who['role'] == 'teacher':
            courses = [dict(r) for r in c.execute('SELECT c.id,c.title FROM courses c JOIN course_owners o ON o.course_id=c.id WHERE o.teacher_id=? ORDER BY c.title', (who['id'],))]
            for row in c.execute('SELECT * FROM experiment_templates WHERE owner=? ORDER BY created DESC', (who['id'],)):
                t = dict(row)
                t['versions'] = []
                for v in c.execute('SELECT * FROM experiment_versions WHERE template_id=? ORDER BY number DESC', (t['id'],)):
                    item = dict(v)
                    item['package'] = json.loads(item['package'])
                    t['versions'].append(item)
                templates.append(t)
        return {'offerings': offerings, 'assignments': assignments, 'templates': templates, 'courses': courses, 'terms': [dict(r) for r in c.execute('SELECT * FROM terms ORDER BY created DESC,id')], 'user': self.s['public_user'](who)}

    def audit(self, c, who, kind, context, data):
        c.execute('INSERT INTO teaching_audit VALUES(?,?,?,?,?,?)', (self.s['uid'](), who['id'], kind, context, self.s['packed'](data), self.s['now']()))

    def date(self, value):
        if value is None or value == '':
            return None
        try:
            parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if parsed.tzinfo is None:
                raise ValueError()
            return parsed.astimezone(timezone.utc).isoformat()
        except (TypeError, ValueError, AttributeError):
            raise HTTPException(422, '时间格式无效，请使用包含时区的日期时间')

    def text(self, data, key, length=200, required=True):
        return self.s['text_field'](data, key, length, required)

    def number(self, data, key, default, low, high, integer=False):
        value = data.get(key, default)
        if isinstance(value, bool):
            raise HTTPException(422, f'{key} 格式无效')
        try:
            n = float(value)
            if not math.isfinite(n) or not low <= n <= high or (integer and int(n) != n):
                raise ValueError()
            return int(n) if integer else n
        except (TypeError, ValueError, OverflowError):
            raise HTTPException(422, f'{key} 超出允许范围')

    def package(self, data, number):
        kind = data.get('rule_type', 'resistor-divider')
        if kind not in ('resistor-divider', 'observation'):
            raise HTTPException(422, '请选择已支持的实验类型')
        steps = data.get('steps', [])
        if not isinstance(steps, list) or not 1 <= len(steps) <= 30 or any(not isinstance(x, str) or not x.strip() or len(x) > 400 for x in steps):
            raise HTTPException(422, '请填写一至三十个实验步骤，每步不超过400字')
        p = {'id': kind, 'version': str(number), 'rule_type': kind, 'title': self.text(data, 'title', 120), 'subject': self.text(data, 'subject', 80), 'objective': self.text(data, 'objective', 3000), 'steps': [x.strip() for x in steps], 'materials': self.text(data, 'materials', 3000, False), 'safety': self.text(data, 'safety', 3000, False), 'report_instructions': self.text(data, 'report_instructions', 3000, False)}
        if kind == 'resistor-divider':
            p.update(r1_ohm=self.number(data, 'r1_ohm', 10000, 1, 1e9), r2_ohm=self.number(data, 'r2_ohm', 10000, 1, 1e9), supply_min_v=self.number(data, 'supply_min_v', 3.2, 0, 5), supply_max_v=self.number(data, 'supply_max_v', 3.4, 0, 5), tolerance_v=self.number(data, 'tolerance_v', .05, .000001, 5), points={'TP0': '参考地', 'TP1': '供电', 'TP2': '分压输出'}, formula='Vout = Vin × R2 / (R1 + R2)')
            if p['supply_min_v'] >= p['supply_max_v']:
                raise HTTPException(422, '供电下限必须小于上限')
        else:
            p.update(points={}, formula='通用观察实验：记录现象与证据，暂不执行数值自动判定。')
        return p

    def selection(self, c, who, scheme):
        cls, offering = self.classroom(c, who, scheme['class_id'])
        if offering['archived']:
            raise HTTPException(409, '该开课已归档')
        if who['role'] == 'student':
            if scheme['mode'] != 'self':
                raise HTTPException(403, '该任务由教师安排分组')
            if scheme['deadline'] and datetime.now(timezone.utc) > datetime.fromisoformat(scheme['deadline']):
                raise HTTPException(409, '已过选组截止时间，请联系教师')

    def execute(self, c, who, action, d):
        uid, now, packed = self.s['uid'], self.s['now'], self.s['packed']
        teacher_actions = {'term', 'course', 'offering', 'archive', 'clone', 'class', 'roster', 'remove-student', 'template', 'template-version', 'template-copy', 'publish', 'schedule', 'auto-assign', 'member', 'collaborator', 'scheme-deadline'}
        if action in teacher_actions:
            self.teacher(who)
        if action == 'term':
            name = self.text(d, 'name', 80)
            existing = c.execute('SELECT id FROM terms WHERE name=?', (name,)).fetchone()
            tid = existing[0] if existing else uid()
            if not existing:
                c.execute('INSERT INTO terms VALUES(?,?,?)', (tid, name, now()))
            return {'id': tid}
        if action == 'course':
            cid = uid()
            c.execute('INSERT INTO courses VALUES(?,?,?)', (cid, self.text(d, 'title', 120), packed(self.s['EXPERIMENT'])))
            c.execute('INSERT INTO course_owners VALUES(?,?)', (cid, who['id']))
            return {'id': cid}
        if action in ('offering', 'clone'):
            d = dict(d)
            if not d.get('term_id'):
                d['term_id'] = self.execute(c, who, 'term', {'name': self.text(d, 'term_name', 80)})['id']
            if action == 'clone':
                old = self.offering(c, who, d.get('offering_id'))
                cid = old['course_id']
            else:
                cid = d.get('course_id')
            if not c.execute('SELECT 1 FROM course_owners WHERE course_id=? AND teacher_id=?', (cid, who['id'])).fetchone():
                raise HTTPException(404, '未找到可管理的课程')
            if not c.execute('SELECT 1 FROM terms WHERE id=?', (d.get('term_id'),)).fetchone():
                raise HTTPException(422, '请选择学期')
            if c.execute('SELECT 1 FROM offerings WHERE course_id=? AND term_id=?', (cid, d['term_id'])).fetchone():
                raise HTTPException(409, '该课程在此学期已经开设')
            oid = uid()
            c.execute('INSERT INTO offerings(id,course_id,term_id,created) VALUES(?,?,?,?)', (oid, cid, d['term_id'], now()))
            c.execute('INSERT INTO offering_teachers VALUES(?,?)', (oid, who['id']))
            if action == 'clone':
                for cls in c.execute('SELECT name FROM classes WHERE offering_id=?', (old['id'],)).fetchall():
                    c.execute('INSERT INTO classes VALUES(?,?,?,?,?)', (uid(), oid, cls[0], secrets.token_hex(5).upper(), now()))
            return {'id': oid}
        if action == 'archive':
            o = self.offering(c, who, d.get('offering_id'))
            self.teacher(who)
            archived = int(d.get('archived') is True)
            c.execute('UPDATE offerings SET archived=? WHERE id=?', (archived, o['id']))
            self.audit(c, who, action, o['id'], {'archived': archived})
            return {'id': o['id']}
        if action == 'collaborator':
            o = self.offering(c, who, d.get('offering_id'), True)
            if not c.execute('SELECT 1 FROM course_owners WHERE course_id=? AND teacher_id=?', (o['course_id'], who['id'])).fetchone():
                raise HTTPException(403, '仅课程负责人可添加协作教师')
            p = c.execute('SELECT id FROM users WHERE username=? AND role="teacher"', (self.text(d, 'username', 80),)).fetchone()
            if not p:
                raise HTTPException(422, '未找到教师账号')
            c.execute('INSERT OR IGNORE INTO offering_teachers VALUES(?,?)', (o['id'], p[0]))
            self.audit(c, who, action, o['id'], {'teacher_id': p[0]})
            return {'id': o['id']}
        if action == 'class':
            o = self.offering(c, who, d.get('offering_id'), True)
            cid = uid()
            c.execute('INSERT INTO classes VALUES(?,?,?,?,?)', (cid, o['id'], self.text(d, 'name', 100), secrets.token_hex(5).upper(), now()))
            return {'id': cid}
        if action == 'roster':
            cls, o = self.classroom(c, who, d.get('class_id'), True)
            names = d.get('usernames')
            if not isinstance(names, list) or not 1 <= len(names) <= 300 or any(not isinstance(n, str) or len(n) > 80 for n in names):
                raise HTTPException(422, '一次可添加一至三百个学生账号')
            people = []
            for name in dict.fromkeys(names):
                p = c.execute('SELECT id FROM users WHERE username=? AND role="student"', (name.strip(),)).fetchone()
                if not p:
                    raise HTTPException(422, f'学生账号 {name[:80]} 尚未注册，请先注册或使用班级邀请码加入')
                if c.execute('SELECT 1 FROM enrollments e JOIN classes x ON x.id=e.class_id WHERE x.offering_id=? AND e.user_id=? AND x.id<>?', (o['id'], p[0], cls['id'])).fetchone():
                    raise HTTPException(409, f'学生 {name} 已在这次开课的其他教学班')
                people.append(p[0])
            for person in people:
                c.execute('INSERT OR IGNORE INTO enrollments VALUES(?,?,?)', (cls['id'], person, now()))
            self.audit(c, who, action, cls['id'], {'students': people})
            return {'added': len(people)}
        if action == 'enroll':
            if who['role'] != 'student':
                raise HTTPException(403, '仅学生可以加入教学班')
            cls = c.execute('SELECT c.*,o.archived FROM classes c JOIN offerings o ON o.id=c.offering_id WHERE c.join_code=?', (self.text(d, 'join_code', 30).upper(),)).fetchone()
            if not cls or cls['archived']:
                raise HTTPException(404, '邀请码无效或开课已归档')
            if c.execute('SELECT 1 FROM enrollments e JOIN classes x ON x.id=e.class_id WHERE x.offering_id=? AND e.user_id=? AND x.id<>?', (cls['offering_id'], who['id'], cls['id'])).fetchone():
                raise HTTPException(409, '已加入这次开课的其他教学班')
            c.execute('INSERT OR IGNORE INTO enrollments VALUES(?,?,?)', (cls['id'], who['id'], now()))
            return {'id': cls['id'], 'offering_id': cls['offering_id']}
        if action == 'remove-student':
            cls, _ = self.classroom(c, who, d.get('class_id'), True)
            person = self.text(d, 'user_id', 100)
            teams = c.execute('SELECT t.* FROM teams t JOIN team_members m ON m.team_id=t.id JOIN grouping_schemes s ON s.id=t.scheme_id WHERE s.class_id=? AND m.user_id=?', (cls['id'], person)).fetchall()
            if any(t['locked'] for t in teams):
                self.text(d, 'reason', 1000)
            for t in teams:
                c.execute('DELETE FROM team_members WHERE team_id=? AND user_id=?', (t['id'], person))
            c.execute('DELETE FROM enrollments WHERE class_id=? AND user_id=?', (cls['id'], person))
            self.audit(c, who, action, cls['id'], {'user_id': person, 'reason': d.get('reason', '')})
            return {'saved': True}
        if action in ('template', 'template-version', 'template-copy'):
            if action == 'template':
                tid, number = uid(), 1
            else:
                template = c.execute('SELECT * FROM experiment_templates WHERE id=? AND owner=?', (d.get('template_id'), who['id'])).fetchone()
                if not template:
                    raise HTTPException(404, '未找到可编辑的实验内容')
                previous = c.execute('SELECT * FROM experiment_versions WHERE template_id=? ORDER BY number DESC LIMIT 1', (template['id'],)).fetchone()
                tid, number = (uid(), 1) if action == 'template-copy' else (template['id'], previous['number'] + 1)
                if action == 'template-copy':
                    d = {**json.loads(previous['package']), 'title': self.text(d, 'title', 120)}
            package = self.package(d, number)
            if action != 'template-version':
                c.execute('INSERT INTO experiment_templates VALUES(?,?,?,?)', (tid, who['id'], package['title'], now()))
            else:
                c.execute('UPDATE experiment_templates SET title=? WHERE id=?', (package['title'], tid))
            vid = uid()
            c.execute('INSERT INTO experiment_versions VALUES(?,?,?,?,?,?)', (vid, tid, number, package['title'], packed(package), now()))
            return {'id': tid, 'version_id': vid}
        if action == 'publish':
            o = self.offering(c, who, d.get('offering_id'), True)
            version = c.execute('SELECT v.* FROM experiment_versions v JOIN experiment_templates t ON t.id=v.template_id WHERE v.id=? AND t.owner=?', (d.get('version_id'), who['id'])).fetchone()
            if not version:
                raise HTTPException(404, '未找到可发布的实验版本')
            ids = d.get('class_ids')
            if not isinstance(ids, list) or not 1 <= len(ids) <= 50 or any(not isinstance(x, str) for x in ids):
                raise HTTPException(422, '请选择一至五十个教学班')
            ids = list(dict.fromkeys(ids))
            start, end, deadline = self.date(d.get('opens_at')), self.date(d.get('closes_at')), self.date(d.get('selection_deadline'))
            if start and end and start >= end:
                raise HTTPException(422, '实验截止时间必须晚于开放时间')
            if end and deadline and deadline > end:
                raise HTTPException(422, '选组截止不能晚于实验截止')
            minimum = self.number(d, 'min_size', 1, 1, 30, True)
            maximum = self.number(d, 'max_size', 4, minimum, 30, True)
            mode = d.get('mode', 'self')
            if mode not in ('self', 'assigned'):
                raise HTTPException(422, '分组方式无效')
            targets = []
            for cid in ids:
                cls, _ = self.classroom(c, who, cid, True)
                if cls['offering_id'] != o['id']:
                    raise HTTPException(422, '目标教学班必须属于当前开课课程')
                reuse = d.get('scheme_ids', {}).get(cid) if isinstance(d.get('scheme_ids', {}), dict) else None
                if reuse:
                    scheme = self.scheme(c, who, reuse, True)
                    if scheme['class_id'] != cid:
                        raise HTTPException(422, '复用分组必须属于目标教学班')
                    sid = reuse
                else:
                    sid = uid()
                    c.execute('INSERT INTO grouping_schemes VALUES(?,?,?,?,?,?,?,?)', (sid, cid, version['title'] + '分组', minimum, maximum, mode, int(d.get('allow_create', True) is True and mode == 'self'), deadline or end))
                targets.append((cid, sid))
            aid = uid()
            title = self.text(d, 'title', 120, False) or version['title']
            c.execute('INSERT INTO assignments(id,offering_id,title,version_id,opens_at,closes_at,created_by,created) VALUES(?,?,?,?,?,?,?,?)', (aid, o['id'], title, version['id'], start, end, who['id'], now()))
            for cid, sid in targets:
                c.execute('INSERT INTO assignment_targets VALUES(?,?,?)', (aid, cid, sid))
                for t in c.execute('SELECT id FROM teams WHERE scheme_id=?', (sid,)).fetchall():
                    self.ensure_runs(c, t[0])
            self.audit(c, who, action, aid, {'version_id': version['id'], 'targets': targets})
            return {'id': aid}
        if action == 'schedule':
            a = self.assignment(c, who, d.get('assignment_id'))
            self.offering(c, who, a['offering_id'], True)
            start, end = self.date(d.get('opens_at')), self.date(d.get('closes_at'))
            if start and end and start >= end:
                raise HTTPException(422, '截止时间必须晚于开放时间')
            status = d.get('status', a['status'])
            if status not in ('published', 'closed'):
                raise HTTPException(422, '任务状态无效')
            c.execute('UPDATE assignments SET opens_at=?,closes_at=?,status=? WHERE id=?', (start, end, status, a['id']))
            self.audit(c, who, action, a['id'], {'opens_at': start, 'closes_at': end, 'status': status})
            return {'id': a['id']}
        if action == 'team-create':
            scheme = self.scheme(c, who, d.get('scheme_id'), who['role'] == 'teacher')
            self.selection(c, who, scheme)
            if who['role'] == 'student':
                if not scheme['allow_create']:
                    raise HTTPException(403, '该任务未开放学生建组')
                if c.execute('SELECT 1 FROM team_members WHERE scheme_id=? AND user_id=?', (scheme['id'], who['id'])).fetchone():
                    raise HTTPException(409, '已经加入该任务的小组，请先退出原组')
            name = self.text(d, 'name', 80, False) or (who['name'][:35] + '的小组 ' + uid()[:6])
            if c.execute('SELECT 1 FROM teams WHERE scheme_id=? AND name=?', (scheme['id'], name)).fetchone():
                raise HTTPException(409, '此分组方案中已有同名小组')
            tid = uid()
            c.execute('INSERT INTO teams VALUES(?,?,?,?,?)', (tid, scheme['id'], name, 0, now()))
            if who['role'] == 'student':
                c.execute('INSERT INTO team_members VALUES(?,?,?,?)', (tid, scheme['id'], who['id'], now()))
            self.ensure_runs(c, tid)
            return {'id': tid}
        if action == 'scheme-deadline':
            scheme = self.scheme(c, who, d.get('scheme_id'), True)
            deadline = self.date(d.get('deadline'))
            c.execute('UPDATE grouping_schemes SET deadline=? WHERE id=?', (deadline, scheme['id']))
            self.audit(c, who, action, scheme['id'], {'previous_deadline': scheme['deadline'], 'deadline': deadline})
            return {'id': scheme['id']}
        if action in ('team-join', 'team-leave', 'member'):
            team, scheme = self.team(c, who, d.get('team_id'), action == 'member')
            if action == 'member':
                p = c.execute('SELECT id FROM users WHERE username=? AND role="student"', (self.text(d, 'username', 80),)).fetchone()
                if not p or not c.execute('SELECT 1 FROM enrollments WHERE class_id=? AND user_id=?', (scheme['class_id'], p[0])).fetchone():
                    raise HTTPException(422, '请选择本教学班已加入的学生')
                person = p[0]
            else:
                if who['role'] != 'student':
                    raise HTTPException(403, '请使用教师成员调整功能')
                self.selection(c, who, scheme)
                person = who['id']
            existing = c.execute('SELECT t.* FROM team_members m JOIN teams t ON t.id=m.team_id WHERE m.scheme_id=? AND m.user_id=?', (scheme['id'], person)).fetchone()
            remove = action == 'team-leave' or (action == 'member' and d.get('remove') is True)
            if remove and (not existing or existing['id'] != team['id']):
                raise HTTPException(409, '该学生不在此组')
            changing = remove or not existing or existing['id'] != team['id']
            if changing and (team['locked'] or (existing and existing['locked'])):
                if action != 'member':
                    raise HTTPException(409, '已开始实验，成员已锁定，请联系教师调整')
                self.text(d, 'reason', 1000)
            if not remove:
                if existing and existing['id'] != team['id'] and action != 'member':
                    raise HTTPException(409, '已加入另一个小组，请先退出原组')
                count = c.execute('SELECT count(*) FROM team_members WHERE team_id=?', (team['id'],)).fetchone()[0]
                if changing and count >= scheme['max_size']:
                    raise HTTPException(409, '小组人数已满')
            if changing:
                c.execute('DELETE FROM team_members WHERE scheme_id=? AND user_id=?', (scheme['id'], person))
                if not remove:
                    c.execute('INSERT INTO team_members VALUES(?,?,?,?)', (team['id'], scheme['id'], person, now()))
                self.audit(c, who, action, team['id'], {'user_id': person, 'previous_team': existing['id'] if existing else None, 'remove': remove, 'reason': d.get('reason', '')})
            self.ensure_runs(c, team['id'])
            return {'id': team['id']}
        if action == 'auto-assign':
            scheme = self.scheme(c, who, d.get('scheme_id'), True)
            people = [r[0] for r in c.execute('SELECT e.user_id FROM enrollments e WHERE e.class_id=? AND NOT EXISTS(SELECT 1 FROM team_members m WHERE m.scheme_id=? AND m.user_id=e.user_id) ORDER BY e.user_id', (scheme['class_id'], scheme['id']))]
            secrets.SystemRandom().shuffle(people)
            count = math.ceil(len(people) / scheme['max_size']) if people else 0
            if count and len(people) < count * scheme['min_size']:
                raise HTTPException(422, '未分组人数无法满足当前人数上下限，请调整规则或手动安排')
            groups = []
            for i in range(count):
                tid = uid()
                c.execute('INSERT INTO teams VALUES(?,?,?,?,?)', (tid, scheme['id'], '自动组 ' + tid[:6], 0, now()))
                for person in people[i::count]:
                    c.execute('INSERT INTO team_members VALUES(?,?,?,?)', (tid, scheme['id'], person, now()))
                self.ensure_runs(c, tid)
                groups.append(tid)
            self.audit(c, who, action, scheme['id'], {'teams': groups, 'students': people})
            return {'teams': len(groups), 'students': len(people)}
        raise HTTPException(404, '未找到此教学管理操作')


def install(app, service):
    teaching = Teaching(service)

    @app.get('/api/catalog')
    def catalog(request: Request):
        with service['db']() as c:
            return teaching.catalog(c, service['user'](request, c))

    @app.post('/api/teaching/{action}')
    async def change(action: str, request: Request):
        data = await request.json()
        if not isinstance(data, dict):
            raise HTTPException(422, '请求内容无效')
        for key in ('course_id', 'term_id', 'offering_id', 'class_id', 'template_id', 'version_id', 'assignment_id', 'scheme_id', 'team_id', 'user_id'):
            if key in data and data[key] is not None and (not isinstance(data[key], str) or len(data[key]) > 160):
                raise HTTPException(422, '资源编号格式无效')
        if 'scheme_ids' in data and (not isinstance(data['scheme_ids'], dict) or any(not isinstance(k, str) or not isinstance(v, str) or len(k) > 160 or len(v) > 160 for k, v in data['scheme_ids'].items())):
            raise HTTPException(422, '分组方案格式无效')
        with service['db'](True) as c:
            who = service['user'](request, c)
            return service['once'](c, who, data, 'teaching:' + action, lambda: teaching.execute(c, who, action, data))

    @app.post('/api/register')
    async def register(request: Request):
        data = await request.json()
        username = teaching.text(data, 'username', 40)
        name = teaching.text(data, 'name', 50)
        password = teaching.text(data, 'password', 128)
        if not re.fullmatch(r'[A-Za-z0-9_.-]{3,40}', username) or len(password) < 8:
            raise HTTPException(422, '账号需为3至40位字母、数字或下划线等字符，密码至少8位')
        with service['db'](True) as c:
            if c.execute('SELECT 1 FROM users WHERE username=?', (username,)).fetchone():
                raise HTTPException(409, '账号已存在，请直接登录')
            salt = secrets.token_hex(16)
            c.execute('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)', (service['uid'](), username, name, 'student', salt, service['hash_password'](password, salt), '', None))
        return {'saved': True}

    return teaching
