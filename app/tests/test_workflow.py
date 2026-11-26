"""Acceptance tests use an isolated SQLite database, never the teaching pilot's records."""
import base64
import json
import os
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch, AsyncMock

_temp = tempfile.TemporaryDirectory()
os.environ['LAB_DATA_DIR'] = _temp.name
os.environ.pop('LAB_AI_KEY', None)
os.environ.pop('LAB_AI_MODEL', None)

from fastapi.testclient import TestClient
import server

def op(**kwargs):
    return {'nonce': uuid.uuid4().hex, **kwargs}

class TeachingWorkflow(unittest.TestCase):
    def setUp(self):
        if server.DB.exists():
            server.DB.unlink()
        server.init_db()
        self.s1 = TestClient(server.app)
        self.s2 = TestClient(server.app)
        self.teacher = TestClient(server.app)
        for client, username in [(self.s1, 'student1'), (self.s2, 'student2'), (self.teacher, 'teacher')]:
            self.assertEqual(client.post('/api/login', json={'username': username, 'password': 'Lab2026!'}).status_code, 200)

    def tearDown(self):
        for c in (self.s1, self.s2, self.teacher):
            c.close()

    def group(self, client=None, index=0):
        return (client or self.s1).get('/api/state').json()['groups'][index]

    def draft(self, raw='供电3.30 V，输出80 mV，黑表笔接TP0', revision=1):
        r=self.s1.post('/api/groups/group-1/extract',json=op(text=raw,revision=revision))
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def confirm(self, draft, **changes):
        payload=op(draft_id=draft['id'],revision=draft['revision'],vin=draft['vin'],vout=draft['vout'],reference=draft['reference'],acknowledged=True)
        payload.update(changes)
        return self.s1.post('/api/groups/group-1/records',json=payload)

    def test_student_teacher_shared_record_and_message(self):
        d=self.draft()
        self.assertIsNone(self.group(self.teacher)['latest'], 'Unconfirmed draft must not be visible as a measurement')
        self.assertEqual(self.confirm(d).status_code,200)
        g=self.group(self.teacher)
        self.assertEqual(g['latest']['data']['fields']['vout']['value_v'],.08)
        self.assertEqual(g['latest']['data']['fields']['vout']['raw'],'80')
        self.assertEqual(g['latest']['data']['fields']['vout']['unit'],'mV')
        self.assertEqual(g['latest']['data']['assessment']['code'],'low')
        self.assertEqual(g['latest']['data']['assessment']['expected_v'],1.65)
        text='请先核对黑表笔接 TP0，再补测 TP1 对 TP0 的供电。'
        r=self.teacher.post('/api/groups/group-1/message',json=op(text=text))
        self.assertEqual(r.status_code,200)
        self.assertEqual(self.group()['events'][-1]['data']['text'],text)
        # Reopening connections preserves records.
        with TestClient(server.app) as reopened:
            reopened.post('/api/login',json={'username':'teacher','password':'Lab2026!'})
            self.assertEqual(len(self.group(reopened)['events']),2)

    def test_group_and_role_authorization(self):
        self.assertEqual(len(self.s1.get('/api/state').json()['groups']),1)
        self.assertEqual(self.s2.post('/api/groups/group-1/extract',json=op(text='输出1.6 V',revision=1)).status_code,404)
        self.assertEqual(self.s1.post('/api/groups/group-1/message',json=op(text='越权指导')).status_code,403)
        self.assertEqual(self.s1.post('/api/assist',json={'question':'查看另一组','group_id':'group-2'}).status_code,404)
        self.assertEqual(TestClient(server.app).get('/api/state').status_code,401)
        self.assertEqual(self.s1.post('/api/groups/group-1/help',json=op(text='帮助'),headers={'Origin':'https://untrusted.example'}).status_code,403)

    def test_retry_idempotency_and_nonce_conflict(self):
        d=self.draft()
        payload=op(draft_id=d['id'],revision=1,vin=d['vin'],vout=d['vout'],reference=d['reference'])
        a=self.s1.post('/api/groups/group-1/records',json=payload)
        b=self.s1.post('/api/groups/group-1/records',json=payload)
        self.assertEqual(a.json(),b.json())
        self.assertEqual(len(self.group()['events']),1)
        payload['reference']='TP1'
        self.assertEqual(self.s1.post('/api/groups/group-1/records',json=payload).status_code,409)
        msg=op(text='核对参考点')
        self.teacher.post('/api/groups/group-1/message',json=msg)
        self.teacher.post('/api/groups/group-1/message',json=msg)
        self.assertEqual(len(self.group()['events']),2)

    def test_revision_invalidates_current_measurement_and_stale_drafts(self):
        self.assertEqual(self.confirm(self.draft()).status_code,200)
        stale=self.draft()
        r=self.s1.post('/api/groups/group-1/revision',json=op(reason='断电后更换 R2',revision=1))
        self.assertEqual(r.status_code,200)
        g=self.group()
        self.assertEqual(g['revision'],2)
        self.assertIsNone(g['latest'])
        self.assertEqual(len([e for e in g['events'] if e['kind']=='measurement']),1)
        self.assertEqual(self.confirm(stale).status_code,409)
        d=self.draft('供电3.30 V，输出1.64 V，黑表笔接TP0',revision=2)
        self.assertEqual(self.confirm(d).status_code,200)
        self.assertEqual(self.group()['latest']['data']['assessment']['code'],'pass')

    def test_submission_review_return_and_resubmission_snapshot(self):
        self.confirm(self.draft())
        r=self.s1.post('/api/groups/group-1/submit',json=op(revision=1,conclusion='输出远低于分压预期，需要补测区分原因。'))
        sid=r.json()['id']
        self.assertEqual(self.group()['status'],'submitted')
        self.assertEqual(self.s1.post('/api/groups/group-1/extract',json=op(revision=1,text='输出1.64V')).status_code,409)
        self.assertEqual(self.teacher.post('/api/groups/group-1/review',json=op(submission_id='stale',decision='return',text='补充供电')).status_code,409)
        self.assertEqual(self.teacher.post('/api/groups/group-1/review',json=op(submission_id=sid,decision='return',text='请补充参考点核对过程。')).status_code,200)
        self.assertEqual(self.group()['status'],'returned')
        self.confirm(self.draft('供电3.30V，输出1.64V，黑表笔接TP0'))
        new=self.s1.post('/api/groups/group-1/submit',json=op(revision=1,conclusion='已重新核对测点并复测，输出符合预期。')).json()['id']
        self.assertNotEqual(sid,new)
        self.assertEqual(self.teacher.post('/api/groups/group-1/review',json=op(submission_id=new,decision='feedback',text='请说明数值与原理的联系。')).status_code,200)
        self.assertEqual(self.group()['status'],'reviewed')

    def test_suspicious_data_never_silently_fixed(self):
        for raw,expected in [('供电3.3V，输出-80mV，黑表笔接TP0',-.08),('供电3.3V，输出1650V，黑表笔接TP0',1650),('供电3.3V，输出OL，黑表笔接TP0',None)]:
            with self.subTest(raw=raw):
                d=self.draft(raw)
                self.assertEqual(d['vout']['value_v'],expected)
                self.assertEqual(self.confirm(d).status_code,200)
                a=self.group()['latest']['data']['assessment']
                self.assertNotEqual(a['code'],'pass')
        d=self.draft('供电3.30V，输出1.64V，黑表笔接TP1')
        self.assertEqual(d['reference'],'TP1')
        self.assertEqual(self.confirm(d,acknowledged=False).status_code,422)
        self.assertEqual(self.confirm(d).status_code,200)
        self.assertEqual(self.group()['latest']['data']['assessment']['code'],'verify')

    def test_observation_and_manual_correction_provenance(self):
        note=self.draft('我检查了电阻色环，但还不确定接线是否正确。')
        self.assertEqual(note['kind'],'observation')
        self.assertEqual(self.confirm(note).status_code,200)
        self.assertIsNone(self.group()['latest'])
        d=self.draft('供电3.30V，输出80mV，黑表笔接TP0')
        self.assertEqual(self.confirm(d,vout={'raw':'1.64','unit':'V'}).status_code,200)
        e=self.group()['latest']['data']
        self.assertEqual(e['extracted']['vout']['raw'],'80')
        self.assertEqual(e['fields']['vout']['raw'],'1.64')
        self.assertTrue(e['manually_corrected'])

    def test_photo_access_is_group_scoped(self):
        png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
        r=self.s1.post('/api/groups/group-1/photo',json=op(revision=1,content=png,caption='接线'))
        self.assertEqual(r.status_code,200)
        filename=self.group()['events'][-1]['data']['file']
        self.assertEqual(self.teacher.get('/api/photos/'+filename).status_code,200)
        self.assertEqual(self.s2.get('/api/photos/'+filename).status_code,404)

    def test_rules_fallback_and_model_failure_keep_records(self):
        self.confirm(self.draft())
        r=self.s1.post('/api/assist',json={'question':'下一步检查什么？'}).json()
        self.assertEqual(r['mode'],'rules')
        self.assertIn('不能确定',r['text'])
        self.assertEqual(r['evidence'][0]['id'],self.group()['latest']['id'])
        with patch.dict(os.environ,{'LAB_AI_KEY':'test-key','LAB_AI_MODEL':'test-model'}),patch.object(server.httpx.AsyncClient,'post',side_effect=server.httpx.ConnectError('offline')):
            r=self.s1.post('/api/assist',json={'question':'帮我解释'}).json()
        self.assertEqual(r['mode'],'rules')
        self.assertIn('暂不可用',r['notice'])
        self.assertEqual(len(self.group()['events']),1)

    def test_completed_change_cannot_record_under_old_revision(self):
        d=self.draft('断电后更换了R2，供电3.30V，输出1.64V，黑表笔接TP0')
        self.assertTrue(d['requires_revision'])
        self.assertEqual(self.confirm(d).status_code,422)
        self.assertIsNone(self.group()['latest'])

    def test_model_adapter_receives_scoped_evidence_and_returns_draft(self):
        self.confirm(self.draft())
        endpoint='https://dashscope.aliyuncs.com/compatible-mode/v1'
        with server.db(write=True) as c:
            c.execute("UPDATE events SET data=json_set(data, '$.participants', json(?)) WHERE id=?",
                      (json.dumps(['internal-student-id']), self.group()['latest']['id']))
        response=server.httpx.Response(200,json={'choices':[{'message':{'content':'请先补测 TP1 对 TP0 的电压。'}}]},request=server.httpx.Request('POST',endpoint+'/chat/completions'))
        with patch.dict(os.environ,{'LAB_AI_KEY':'test-secret','LAB_AI_MODEL':'qwen-plus','LAB_AI_BASE_URL':endpoint}),patch.object(server.httpx.AsyncClient,'post',new_callable=AsyncMock,return_value=response) as post:
            result=self.s1.post('/api/assist',json={'question':'下一步检查什么？'}).json()
        self.assertEqual(result['mode'],'model')
        self.assertNotIn('test-secret',str(result))
        self.assertEqual(post.call_args.args[0],endpoint+'/chat/completions')
        payload=post.call_args.kwargs['json']
        self.assertEqual(payload['model'],'qwen-plus')
        prompt=payload['messages'][1]['content']
        self.assertIn('group-1',prompt)
        self.assertNotIn('group-2',prompt)
        self.assertNotIn('internal-student-id',prompt)
        latest=json.loads(prompt)['evidence']['groups'][0]['latest']
        self.assertNotIn('author',latest)
        self.assertNotIn('actor',latest)
        self.assertEqual(latest['data']['assessment'],self.group()['latest']['data']['assessment'])
        self.assertEqual(len(self.group()['events']),1,'Model draft must not send a message or mutate measurements')

class MeasurementSemantics(unittest.TestCase):
    def test_inclusive_boundary_and_supply_range(self):
        for vin,out,code in [('3.30','1.600','pass'),('3.30','1.700','pass'),('3.30','1.5999','low'),('3.30','1.7001','high'),('3.20','1.6','pass'),('3.40','1.7','pass'),('3.1999','1.6','supply')]:
            with self.subTest(vin=vin,out=out):
                fields={'vin':server.quantity(vin,'V'),'vout':server.quantity(out,'V'),'reference':'TP0'}
                self.assertEqual(server.assess(fields)['code'],code)

    def test_conversion_missing_and_multiple_values(self):
        d=server.parse_reading('供电3300毫伏，输出1640mV，参考地TP0')
        self.assertEqual(d['vin']['value_v'],3.3)
        self.assertEqual(d['vout']['value_v'],1.64)
        self.assertEqual(d['reference'],'TP0')
        self.assertTrue(server.parse_reading('供电3.3，输出1.64 V')['ambiguities'])
        self.assertTrue(server.parse_reading('供电3.3V，输出1.6V，输出1.7V')['ambiguities'])
        self.assertEqual(server.parse_reading('输出1.6V')['reference'],'unknown')

if __name__=='__main__':
    unittest.main(verbosity=2)
