// Runtime rendering checks, without a browser or an external DOM dependency.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const storage=new Map(),root={innerHTML:'',addEventListener(){},insertAdjacentHTML(_,value){this.innerHTML+=value},querySelectorAll(){return []}};
// Intranet HTTP deliberately has neither crypto.subtle nor crypto.randomUUID.
const webcrypto=require('node:crypto').webcrypto;
const context=vm.createContext({console,TextEncoder,crypto:{getRandomValues:b=>webcrypto.getRandomValues(b)},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},document:{querySelector:s=>s==='#app'?root:null,addEventListener(){},activeElement:{matches:()=>false}},window:{addEventListener(){}},fetch:async()=>({ok:false,status:401,json:async()=>({detail:'请先登录'})}),setTimeout(){},clearTimeout(){},setInterval(){}});
vm.runInContext(fs.readFileSync('static/app.js','utf8'),context);
const run=code=>vm.runInContext(code,context);
assert.match(run('operationId()'),/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const fields={vin:{raw:'3.30',unit:'V',value_v:3.3},vout:{raw:'80',unit:'mV',value_v:.08},reference:'TP0'};
const parsed={kind:'measurement',...fields,ambiguities:[]};
const event={id:'a'.repeat(32),group_id:'group-1',revision:1,kind:'measurement',author:'林同学',created:'2026-11-25T06:00:00Z',data:{raw:'供电3.30V，输出80mV，黑表笔接TP0<script>alert(1)</script>',fields,extracted:parsed,assessment:{code:'low',label:'输出低于预期',expected_v:1.65,deviation_v:-1.57,warnings:[]}}};
const group={id:'group-1',name:'01 组',revision:1,status:'working',help:1,members:['林同学'],events:[event],latest:event};
const data={user:{id:'student1',role:'student',name:'林同学'},model_configured:false,groups:[group],course:{title:'电子电路基础',experiment:{version:'0.1',title:'电阻分压实验',objective:'验证分压',points:{TP0:'参考地',TP1:'供电',TP2:'输出'},formula:'Vout = Vin/2',steps:['预测','测量'],safety:'先断电再改线'}}};
run('S.data='+JSON.stringify(data)+';S.gid="group-1"');
for(const view of ['lab','records','submit']){run(`S.view='${view}';render()`);assert.ok(root.innerHTML.includes('知实验'));assert.ok(!root.innerHTML.includes('undefined'));assert.ok(!root.innerHTML.includes('<script>alert'))}
run('S.draft='+JSON.stringify({id:'draft1',raw:'供电3.30V，输出80mV',revision:1,source:'规则提取',...parsed})+';S.view="lab";render()');
assert.ok(root.innerHTML.includes('尚未计入测量'));
assert.ok(root.innerHTML.includes('value="80"'));
run('S.data.user.role="teacher";S.draft=null');
for(const view of ['overview','group','assist','reports','experiment']){run(`S.view='${view}';render()`);assert.ok(root.innerHTML.includes('知实验'));assert.ok(!root.innerHTML.includes('undefined'));assert.ok(!root.innerHTML.includes('<script>alert'))}
for(const modal of ['instructions','revision','help','photo']){run(`S.modal='${modal}';render()`);assert.ok(root.innerHTML.includes('role="dialog"'))}
run('S.modal=null;S.data.groups[0].revision=2;S.data.groups[0].latest=null;S.view="group";render()');
assert.ok(root.innerHTML.includes('改线后需重新测量供电和输出'));
async function interactionChecks(){
  await new Promise(setImmediate); // Let initial authentication probe finish.
  run('S.data='+JSON.stringify(data)+';S.gid="group-1";S.modal=null;S.view="lab";S.busy=false;render()');
  const updated=JSON.parse(JSON.stringify(data));
  updated.groups[0].events.push({id:'b'.repeat(32),revision:1,kind:'message',author:'周老师',created:'2026-11-25T07:00:00Z',data:{text:'教师新指导：先核对参考点。'}});
  const toast={textContent:'',classList:{add(){},remove(){}}};
  const input={value:'尚在输入的实验发现'};
  context.document.querySelector=s=>s==='#app'?root:s==='#toast'?toast:s==='#raw'?input:null;
  context.fetch=async()=>({ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(updated))});
  context.document.activeElement={matches:()=>true};
  await run('refresh(false)');
  assert.equal(run('S.renderPending'),true);
  assert.ok(!root.innerHTML.includes('教师新指导'));
  context.document.activeElement={matches:()=>false};
  await run('refresh(false)');
  assert.ok(root.innerHTML.includes('教师新指导'));
  assert.ok(root.innerHTML.includes('尚在输入的实验发现'));
  let calls=[];
  context.fetch=async(path,options)=>{
    calls.push(JSON.parse(options.body));
    if(calls.length===1)throw new Error('response lost');
    return {ok:true,status:200,json:async()=>({saved:true})};
  };
  await assert.rejects(run("api('/groups/group-1/message',command({text:'测试重试'}))"));
  await run("api('/groups/group-1/message',command({text:'测试重试'}))");
  assert.equal(calls[0].nonce,calls[1].nonce,'Lost response retries must reuse operation id');
  context.crypto=webcrypto;
  assert.equal(await run("operationFingerprint('record')"),require('node:crypto').createHash('sha256').update('record').digest('hex'));
  context.document.querySelector=s=>s==='#app'?root:s==='#toast'?toast:s==='#message'?{value:'已发送的旧文字'}:null;
  context.fetch=async path=>({ok:true,status:200,json:async()=>path.endsWith('/state')?updated:{saved:true}});
  await run("S.busy=true;S.message='已发送的旧文字';action('send-message')");
  assert.equal(run('S.message'),'','Refresh must not restore a successfully sent message into the composer');
  console.log('PASS: 8 screens, 4 dialogs, escaping, units, revision state, typing-safe polling, HTTP/HTTPS retry id, sent-message clearing');
}
interactionChecks().catch(e=>{console.error(e);process.exitCode=1});
