"""Process reports, private reflections, and report-specific assessment."""
import json
from urllib.parse import quote

from fastapi import HTTPException, Request, Response

RUBRIC = (
    ('process', '实验过程', 25),
    ('evidence', '数据与证据', 30),
    ('analysis', '分析与结论', 30),
    ('presentation', '报告表达', 15),
)
FIELDS = ('objective', 'method', 'analysis', 'conclusion')
EVIDENCE_KINDS = {'measurement', 'observation', 'photo', 'revision'}


def migrate(c):
    c.execute('''CREATE TABLE IF NOT EXISTS report_drafts(
        group_id TEXT PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
        edit INTEGER NOT NULL, sections TEXT NOT NULL)''')
    c.execute('''CREATE TABLE IF NOT EXISTS report_reflections(
        group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        edit INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY(group_id,user_id))''')
    c.execute('''CREATE TABLE IF NOT EXISTS process_reports(
        submission_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
        group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        snapshot TEXT NOT NULL, reflections TEXT NOT NULL)''')
    c.execute('CREATE INDEX IF NOT EXISTS process_reports_group ON process_reports(group_id)')


def formal_report(c, submission_id):
    return c.execute('SELECT 1 FROM process_reports WHERE submission_id=?', (submission_id,)).fetchone() is not None


def scores_for_review(data):
    raw = data.get('scores')
    if not isinstance(raw, dict) or set(raw) != {key for key, _, _ in RUBRIC}:
        raise HTTPException(422, '请填写每项评分。')
    result = []
    for key, label, maximum in RUBRIC:
        value = raw[key]
        if type(value) is not int or not 0 <= value <= maximum:
            raise HTTPException(422, f'{label}须填写 0 至 {maximum} 的整数。')
        result.append({'key': key, 'label': label, 'maximum': maximum, 'score': value})
    return {'scores': result, 'total': sum(item['score'] for item in result), 'maximum': 100}


class Reports:
    def __init__(self, service):
        self.s = service

    def sections(self, payload, required=False):
        source = payload.get('sections')
        if not isinstance(source, dict):
            raise HTTPException(422, '请填写小组报告正文。')
        result = {key: self.s['text_field'](source, key, 3000, required=False) for key in FIELDS}
        if required and (not result['method'] or not result['conclusion']):
            raise HTTPException(422, '请填写实验方法与条件，以及实验结论。')
        return result

    def save_draft(self, c, g, payload, required=False):
        sections = self.sections(payload, required)
        row = c.execute('SELECT * FROM report_drafts WHERE group_id=?', (g['id'],)).fetchone()
        current_edit = row['edit'] if row else 0
        if type(payload.get('draft_edit')) is not int or payload['draft_edit'] != current_edit:
            raise HTTPException(409, '组员已更新报告草稿。请用“读取最新草稿”核对后再保存。')
        if not sections['objective'] and required:
            sections['objective'] = g['experiment'].get('objective', '')
        c.execute('''INSERT INTO report_drafts VALUES(?,?,?) ON CONFLICT(group_id) DO UPDATE
                     SET edit=excluded.edit,sections=excluded.sections''',
                  (g['id'], current_edit + 1, self.s['packed'](sections)))
        return sections

    def save_reflection(self, c, g, who, payload):
        text = self.s['text_field'](payload, 'reflection', 4000, required=False)
        row = c.execute('SELECT edit FROM report_reflections WHERE group_id=? AND user_id=?', (g['id'], who['id'])).fetchone()
        edit = row['edit'] if row else 0
        if type(payload.get('reflection_edit')) is not int or payload['reflection_edit'] != edit:
            raise HTTPException(409, '你的个人反思已在其他页面更新，请读取最新草稿。')
        c.execute('''INSERT INTO report_reflections VALUES(?,?,?,?) ON CONFLICT(group_id,user_id) DO UPDATE
                     SET edit=excluded.edit,text=excluded.text''', (g['id'], who['id'], edit + 1, text))

    def submit(self, c, who, g, payload):
        group = self.s['group_data'](c, who, g['id'])
        events = [event for event in group['events'] if event['kind'] in EVIDENCE_KINDS]
        current = [event for event in events if event['revision'] == g['revision'] and event['kind'] != 'revision']
        if not current or (g['experiment'].get('rule_type') != 'observation' and not group['latest']):
            raise HTTPException(422, '请先保存当前修订的有效实验记录；电阻分压实验需要确认测量。')
        sections = self.save_draft(c, g, payload, required=True)
        if 'reflection' in payload:
            self.save_reflection(c, g, who, payload)
        members = self.s['TEACHING'].members(c, g)
        written = {row['user_id']: row['text'] for row in c.execute('SELECT user_id,text FROM report_reflections WHERE group_id=?', (g['id'],)) if row['text']}
        if any(person['id'] not in written for person in members):
            raise HTTPException(422, '请每位组员保存个人反思后，再提交小组报告。')
        reflections = [{'user_id': person['id'], 'name': person['name'], 'text': written[person['id']]} for person in members]
        if g['assignment_id']:
            classroom, offering = self.s['TEACHING'].classroom(c, who, g['class_id'])
            course, term, classroom_name = offering['title'], offering['term'], classroom['name']
        else:
            course = c.execute('SELECT title FROM courses WHERE id=?', (g['course_id'],)).fetchone()['title']
            term, classroom_name = '', ''
        taken_at = self.s['now']()
        snapshot = {'title': g.get('assignment_title') or g['experiment']['title'], 'course': course,
                    'term': term, 'classroom': classroom_name, 'team': g['name'],
                    'members': [person['name'] for person in members], 'revision': g['revision'],
                    'submitted_at': taken_at, 'sections': sections,
                    'evidence_ids': [event['id'] for event in events]}
        c.execute('UPDATE groups SET status=? WHERE id=?', ('submitted', g['id']))
        event = self.s['add_event'](c, who, g, 'submission', {'conclusion': sections['conclusion'],
                                  'evidence': snapshot['evidence_ids'], 'measurement_id': (group['latest'] or {}).get('id'),
                                  'formal_report': True})
        c.execute('INSERT INTO process_reports VALUES(?,?,?,?)',
                  (event['id'], g['id'], self.s['packed'](snapshot), self.s['packed'](reflections)))
        return event

    def report_history(self, c, gid):
        return [dict(row) for row in c.execute('''SELECT e.id,e.created,e.revision,
                EXISTS(SELECT 1 FROM process_reports p WHERE p.submission_id=e.id) AS formal
                FROM events e WHERE e.group_id=? AND e.kind='submission' ORDER BY e.rowid''', (gid,))]

    def snapshot(self, c, g, who, submission_id=None):
        history = self.report_history(c, g['id'])
        selected = next((entry for entry in history if entry['id'] == submission_id), None) if submission_id else (history[-1] if history else None)
        if submission_id and selected is None:
            raise HTTPException(404, '未找到此小组的报告提交。')
        if not selected:
            return history, None
        saved = c.execute('SELECT snapshot,reflections FROM process_reports WHERE submission_id=?', (selected['id'],)).fetchone()
        review = c.execute('''SELECT e.created,e.data,u.name FROM events e JOIN users u ON u.id=e.actor
                              WHERE e.group_id=? AND e.kind='review' AND json_extract(e.data,'$.submission_id')=?
                              ORDER BY e.rowid DESC LIMIT 1''', (g['id'], selected['id'])).fetchone()
        evaluation = {**json.loads(review['data']), 'author': review['name'], 'created': review['created']} if review else None
        public = {**selected, 'evaluation': evaluation}
        if saved:
            reflections = json.loads(saved['reflections'])
            public.update(json.loads(saved['snapshot']))
            public['reflections'] = [{'name': r['name'], 'text': r['text']} for r in reflections
                                     if who['role'] == 'teacher' or r['user_id'] == who['id']]
            public['members'] = [r['name'] for r in reflections]
        else:
            data = json.loads(c.execute('SELECT data FROM events WHERE id=?', (selected['id'],)).fetchone()['data'])
            public['sections'] = {'conclusion': data['conclusion']}
            public['evidence_ids'] = data['evidence']
        return history, public

    def get(self, c, g, who, submission_id):
        history, submitted = self.snapshot(c, g, who, submission_id)
        result = {'group_id': g['id'], 'status': g['status'], 'revision': g['revision'],
                  'history': history, 'submission': submitted,
                  'rubric': [{'key': key, 'label': label, 'maximum': maximum} for key, label, maximum in RUBRIC]}
        if who['role'] == 'student':
            row = c.execute('SELECT edit,sections FROM report_drafts WHERE group_id=?', (g['id'],)).fetchone()
            reflection = c.execute('SELECT edit,text FROM report_reflections WHERE group_id=? AND user_id=?',
                                   (g['id'], who['id'])).fetchone()
            if row:
                sections = json.loads(row['sections'])
            else:
                sections = {key: '' for key in FIELDS}
                sections['objective'] = g['experiment'].get('objective', '')
                if submitted:
                    sections.update(submitted['sections'])
            members = self.s['TEACHING'].members(c, g)
            written = {r[0] for r in c.execute("SELECT user_id FROM report_reflections WHERE group_id=? AND text<>''", (g['id'],))}
            result.update(sections=sections, draft_edit=row['edit'] if row else 0,
                          reflection=reflection['text'] if reflection else '', reflection_edit=reflection['edit'] if reflection else 0,
                          reflection_progress={'completed': len(written & {m['id'] for m in members}), 'required': len(members)})
        return result


def install(app, service):
    reports = Reports(service)

    @app.get('/api/groups/{gid}/report')
    def read(gid: str, request: Request):
        with service['db']() as c:
            who = service['user'](request, c)
            group = service['group_for'](c, who, gid)
            return reports.get(c, group, who, request.query_params.get('submission_id'))

    @app.post('/api/groups/{gid}/report/{action}')
    async def write(gid: str, action: str, request: Request):
        if action not in ('draft', 'reflection', 'submit'):
            raise HTTPException(404)
        payload = await request.json()
        if not isinstance(payload, dict):
            raise HTTPException(422, '请核对报告内容。')
        with service['db'](True) as c:
            who = service['user'](request, c)
            group = service['group_for'](c, who, gid, 'student')
            def apply():
                service['writable'](group, payload)
                if action == 'submit':
                    return reports.submit(c, who, group, payload)
                if action == 'draft':
                    return {'saved': True, 'sections': reports.save_draft(c, group, payload), 'edit': payload['draft_edit'] + 1}
                reports.save_reflection(c, group, who, payload)
                return {'saved': True, 'edit': payload['reflection_edit'] + 1}
            return service['once'](c, who, payload, 'report:' + action + ':' + gid, apply)

    @app.get('/api/groups/{gid}/report.pdf')
    def download(gid: str, request: Request):
        include_review = request.query_params.get('reviewed') == '1'
        with service['db']() as c:
            who = service['user'](request, c)
            group = service['group_data'](c, who, gid)
            _, report = reports.snapshot(c, group, who, request.query_params.get('submission_id'))
        if not report or not report['formal']:
            raise HTTPException(404, '提交实验过程报告后可导出 PDF。')
        evaluation = report['evaluation']
        if include_review and (not evaluation or evaluation['decision'] != 'feedback' or 'total' not in evaluation):
            raise HTTPException(409, '教师发布评分后可导出带评阅的报告。')
        evidence = set(report['evidence_ids'])
        events = [event for event in group['events'] if event['id'] in evidence]
        from report_pdf import build_pdf
        try:
            data = build_pdf(report, events, service['DATA'] / 'photos', include_review)
        except (ImportError, OSError):
            raise HTTPException(503, '报告暂时无法导出，请联系维护人员。')
        name = quote(('实验过程报告_教师评阅版_' if include_review else '实验过程报告_') + report['id'][:8] + '.pdf')
        return Response(data, media_type='application/pdf', headers={'Content-Disposition': "attachment; filename*=UTF-8''" + name})

    return reports
