// Management UI logic checks. These do not replace a real browser layout inspection.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root={innerHTML:'',addEventListener(){},querySelectorAll(){return []}};
const toast={textContent:'',classList:{add(){},remove(){}}},storage=new Map();
const context=vm.createContext({console,TextEncoder,crypto:{getRandomValues:b=>require('node:crypto').webcrypto.getRandomValues(b)},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},document:{querySelector:s=>s==='#app'?root:s==='#toast'?toast:null,addEventListener(){},activeElement:{matches:()=>false}},window:{addEventListener(){}},setTimeout(){},clearTimeout(){},setInterval(){},fetch:async()=>({ok:false,status:401,json:async()=>({detail:'请先登录'})})});
vm.runInContext(fs.readFileSync('static/teaching.js','utf8'),context);
vm.runInContext(fs.readFileSync('static/app.js','utf8'),context);
const run=s=>vm.runInContext(s,context);
const p={id:'resistor-divider',version:'1',rule_type:'resistor-divider',title:'分压实验',subject:'电子电路',objective:'理解分压关系',steps:['预测','测量'],safety:'改线前断电',points:{TP0:'参考地',TP1:'供电',TP2:'输出'},r1_ohm:10000,r2_ohm:10000,supply_min_v:3.2,supply_max_v:3.4,tolerance_v:.05};
const member={id:'student1',name:'林同学',username:'student1'};
const team={id:'team1',scheme_id:'scheme1',name:'自主小组',locked:0,members:[member],mine:false};
const scheme={id:'scheme1',class_id:'class1',name:'实验分组',min_size:1,max_size:4,mode:'self',allow_create:1,deadline:null,teams:[team]};
const cls={id:'class1',name:'教学班',join_code:'CLASS123',students:[member],schemes:[scheme]};
const offering={id:'offering1',course_id:'course1',title:'电路基础<script>unsafe</script>',term:'2026秋季',archived:0,classes:[cls],teachers:[{id:'teacher',name:'周老师',username:'teacher'}]};
const task={id:'assignment1',offering_id:'offering1',title:'分压实验任务',status:'published',opens_at:null,closes_at:null,version_id:'version1',experiment:p,targets:[{class_id:'class1',class_name:'教学班',scheme_id:'scheme1'}],my_runs:[]};
const catalog={user:{id:'teacher',role:'teacher',name:'周老师'},offerings:[offering],courses:[{id:'course1',title:offering.title}],terms:[{id:'term1',name:'2026秋季'}],templates:[{id:'template1',title:p.title,versions:[{id:'version1',number:1,title:p.title,package:p}]}],assignments:[task]};
const group={id:'run1',name:'自主小组',team_id:'team1',assignment_id:'assignment1',revision:1,status:'working',help:0,member_count:1,min_size:1,members:['林同学'],events:[],latest:null,opens_at:null,closes_at:null,assignment_status:'published',archived:0};
const data={user:catalog.user,course:{id:'course1',title:offering.title,experiment:p},assignment:task,groups:[group],model_configured:false};
async function main(){
  await new Promise(setImmediate);
  run('S.data='+JSON.stringify(data)+';T.catalog='+JSON.stringify(catalog)+';T.offeringId="offering1";T.assignmentId="assignment1";S.gid="run1"');
  for(const view of ['courses','content','classes','tasks','overview','group','reports','assist']){
    run(`S.view='${view}';render()`);
    assert.ok(root.innerHTML.includes('验知有道'),view);
    assert.ok(!root.innerHTML.includes('<script>unsafe'),view);
    assert.ok(!root.innerHTML.includes('undefined'),view);
  }
  for(const dialog of ['course','offering','class','template','publish','collaborator']){
    await run(`teachingAction('manage:${dialog}')`);run('render()');assert.ok(root.innerHTML.includes('role="dialog"'),dialog);
  }
  for(const command of ['clone-offering:offering1','archive-offering:offering1','add-roster:class1','remove-student:class1:student1','edit-template:template1','copy-template:template1','schedule:assignment1','teacher-team:scheme1','edit-members:team1','auto-assign:scheme1','scheme-deadline:scheme1']){
    await run(`teachingAction('${command}')`);run('render()');assert.ok(!root.innerHTML.includes('undefined'),command);
  }
  await run("teachingAction('manage:publish')");
  run('T.form.class_ids=["class1"];S.busy=true');
  let requests=[];
  context.fetch=async(path,opts)=>{requests.push([path,opts]);return {ok:true,status:200,json:async()=>path==='/api/catalog'?catalog:path.startsWith('/api/state')?data:{id:'assignment1'}}};
  await run('teachingSave()');
  assert.equal(requests.length,0,'Preview must not publish');
  run('render()');assert.ok(root.innerHTML.includes('确认发布'));
  await run('teachingSave()');
  assert.equal(requests.filter(([path])=>path==='/api/teaching/publish').length,1);
  const payload=JSON.parse(requests.find(([path])=>path==='/api/teaching/publish')[1].body);
  assert.deepEqual(payload.class_ids,['class1']);assert.equal(payload.version_id,'version1');
  run('S.busy=false;S.view="classes";render()');
  const changedCatalog=JSON.parse(JSON.stringify(catalog));
  changedCatalog.offerings[0].classes[0].students.push({id:'student2',username:'student2',name:'刚加入班级的学生'});
  context.fetch=async path=>({ok:true,status:200,json:async()=>path==='/api/catalog'?changedCatalog:data});
  await run('refresh(false)');
  assert.ok(root.innerHTML.includes('刚加入班级的学生'),'Roster-only updates must refresh management pages');
  run('S.busy=false;S.modal=null;S.data.user.role="student";T.catalog.user.role="student";T.catalog.user.id="student1";T.catalog.assignments[0].my_runs=[]');
  for(const view of ['courses','tasks','teams','lab','records','submit','mine']){
    run(`S.view='${view}';render()`);assert.ok(root.innerHTML.includes('x-phone'),view);assert.ok(!root.innerHTML.includes('undefined'),view);
    const nav=root.innerHTML.match(/<nav class="x-phonenav"[^>]*>(.*?)<\/nav>/)?.[1];
    assert.ok(nav,`Bottom navigation is missing on ${view}`);
    const tabs=[...nav.matchAll(/<button([^>]*)>.*?<\/svg>([^<]+)<\/button>/g)];
    assert.deepEqual(tabs.map(tab=>tab[2]),['实验','记录','我的'],view);
    const activeLabel={records:'记录',mine:'我的'}[view]||'实验';
    assert.deepEqual(tabs.filter(tab=>tab[1].includes('aria-current="page"')).map(tab=>tab[2]),[activeLabel],view);
  }
  assert.ok(root.innerHTML.includes('<h1>我的</h1>'));
  assert.ok(root.innerHTML.includes('自主小组'));
  assert.ok(root.innerHTML.includes('全部课程'));
  assert.ok(root.innerHTML.includes('x-phonenav'));
  assert.ok(!root.innerHTML.includes('<script>unsafe'),'Profile course title must be escaped');
  await run("action('view:submit')");run('render()');
  assert.ok(root.innerHTML.includes('data-action="submit"'));
  await run("action('view:mine')");run('render()');
  assert.ok(root.innerHTML.includes('<h1>我的</h1>'),'Bottom tab must route to the personal page');
  run('S.data.groups=[];render()');
  assert.ok(root.innerHTML.includes('完成分组后'));
  assert.ok(!root.innerHTML.includes('undefined'));
  await run("action('view:records')");run('render()');
  assert.ok(root.innerHTML.includes('查看我的课程'),'No-group navigation must have a usable empty state');
  await run("action('view:lab')");run('render()');
  assert.match(root.innerHTML,/data-action="view:teams"[^>]*>前往选组/);
  run('S.data.groups='+JSON.stringify([group]));
  await run("action('view:tasks')");run('render()');
  assert.ok(root.innerHTML.includes('分压实验任务'));
  await run("action('view:mine')");run('render()');
  const experimentTab=root.innerHTML.match(/<nav class="x-phonenav"[^>]*><button[^>]* data-action="([^"]+)"/);
  assert.ok(experimentTab);
  await run(`action(${JSON.stringify(experimentTab[1])})`);run('render()');
  assert.equal(run('S.view'),'tasks','The experiment tab must return to the task list after visiting My account');
  run('S.view="teams";T.catalog.offerings[0].classes[0].schemes[0].teams[0].mine=true;render()');
  assert.ok(root.innerHTML.includes('进入实验'));assert.ok(root.innerHTML.includes('退出小组'));
  run('S.modal=null;S.view="lab";S.data.course.experiment.rule_type="observation";render()');
  assert.ok(root.innerHTML.includes('实验观察与证据'));
  assert.ok(!root.innerHTML.includes('供电 3.30 V'),'General observation experiments must not inherit divider measurement examples');
  run('current().members.push("陈同学<乙>");S.raw="尚未提交的实验观察";render()');
  const groupCard=root.innerHTML.match(/<section class="[^"]*student-experiment-group[^"]*">([\s\S]*?)<\/section>/)?.[1];
  assert.ok(groupCard,'The experiment page must show the current group');
  assert.match(groupCard,/自主小组/);
  assert.match(groupCard,/2 人/);
  assert.match(groupCard,/林同学、陈同学&lt;乙&gt;/);
  assert.match(groupCard,/data-action="view:teams"[^>]*>查看分组/);
  await run("action('view:teams')");run('render()');
  assert.match(root.innerHTML,/data-action="view:lab"[^>]*>进入实验/);
  await run("action('view:lab')");run('render()');
  assert.ok(root.innerHTML.includes('尚未提交的实验观察'),'Checking the current group must preserve unsent experiment text');
  run('S.data=null;T.authMode="register";render()');assert.ok(root.innerHTML.includes('register-form'));
  assert.ok(!root.innerHTML.includes('x-phonenav'));
  console.log('PASS: course/class/template/task pages, 17 dialogs, publication preview/confirmation, student grouping/registration, observation workspace, escaping');
}
main().catch(e=>{console.error(e);process.exitCode=1});
