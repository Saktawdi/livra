import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { defaultSettings, type AgentEvent, type Conversation, type Artifact } from '@livra/shared';
import { BrowserStore } from '../apps/web/src/local/store.ts';
import { createLocalCommands, workspace } from '../apps/web/src/local/commands.ts';
import { localCommand, localRun } from '../apps/web/src/local/client.ts';

test('browser storage keeps credentials, groups, media and histories after reopening; invalid imports write nothing', async () => {
  const factory = new IDBFactory();
  let store = await BrowserStore.open(factory, 'persistence');
  const settings = structuredClone(defaultSettings);
  settings.providers = [{id:'own', name:'Own', kind:'chat', protocol:'openai',baseUrl:'https://models.example/v1',apiKey:'local-secret',models:['test']}];
  store.saveSettings(workspace, settings);
  let {app} = createLocalCommands(store);
  const command = (path:string, body?:unknown, method = 'POST') => app.execute(path,{method,body:JSON.stringify(body)});
  const c = await command('/conversations',{personaId:settings.personas[0].id});
  const org = await command('/conversation-organization',{type:'create-group',name:'研究',color:'#7cc7f7'},'PATCH');
  await command('/conversations/'+c.id,{groupId:org.groups[0].id, color:'#7cc7f7', pinned:true},'PATCH');
  const theme = await command('/tools/execute',{name:'create_marp_theme',args:{name:'ocean',css:'/* @theme ocean */\nsection {background:#123abc;color:white}'} });
  const slides = await command('/tools/execute',{name:'create_slides',args:{title:'离线作品',markdown:'# Hello',themeId:theme.artifactId}});
  const exported = await app.execute('/export');
  assert.ok(!JSON.stringify(exported).includes('local-secret'));
  assert.equal(store.artifacts(workspace).length,2);
  const invalid = structuredClone(exported);
  invalid.settings.personas[0].name = 'Should not persist';
  invalid.memories.push({id:crypto.randomUUID(),personaId:settings.personas[0].id,content:'x',created:Date.now()});
  invalid.artifacts.push({id:'invalid'});
  await assert.rejects(command('/import',invalid));
  assert.equal(store.settings(workspace).personas[0].name,settings.personas[0].name);
  assert.equal(store.memories(workspace).length,0);
  await store.flush();
  store.close();
  store = await BrowserStore.open(factory,'persistence');
  ({app}=createLocalCommands(store));
  assert.equal(store.settings(workspace).providers[0].apiKey,'local-secret');
  assert.equal(store.conversation(workspace,c.id)?.groupId,org.groups[0].id);
  assert.equal(store.conversation(workspace,c.id)?.color,'#7cc7f7');
  assert.equal(store.conversation(workspace,c.id)?.pinned,true);
  assert.match(store.get<Artifact>(workspace,'artifact',slides.artifactId)!.data.html,/#123abc/);
  const rollbackSettings = store.settings(workspace);
  await assert.rejects(store.batch(()=> {
    store.delete(workspace,'conversation',c.id);
    store.saveSettings(workspace,{...rollbackSettings,defaultModel:'bad'});
    throw Error('rollback');
  }));
  assert.ok(store.conversation(workspace,c.id));
  assert.equal(store.settings(workspace).defaultModel,rollbackSettings.defaultModel);
  await store.flush();
  store.close();
});

test('browser models, Agent approvals, speech and media contact providers directly with no local API requests', async t => {
  Object.defineProperty(globalThis,'indexedDB',{value:new IDBFactory(),configurable:true});
  const observed:{url:string;headers:Headers;body:any}[]=[];
  let round=0;
  t.mock.method(globalThis,'fetch',async (input:URL|string,init:RequestInit = {}) => {
    const url=String(input), headers=new Headers(init.headers), body=init.body?JSON.parse(String(init.body)):undefined;
    observed.push({url,headers,body});
    assert.ok(url.startsWith('https://provider.example/v1/'),url);
    assert.equal(init.credentials,'omit');
    assert.equal(headers.get('authorization'),'Bearer browser-secret');
    if(url.endsWith('/models')) return Response.json({data:[{id:'model-a'},{id:'model-b'}]});
    if(url.endsWith('/tts')) return new Response('ID3-audio',{headers:{'content-type':'audio/mpeg'}});
    if(url.endsWith('/images/generations')) return Response.json({data:[{b64_json:Buffer.from('png-data').toString('base64')}]});
    assert.ok(url.endsWith('/chat/completions'));
    const delta=round++===0 ? {tool_calls:[{index:0,id:'remember-call',type:'function',function:{name:'remember',arguments:JSON.stringify({content:'喜欢星空'})}}]} : {content:'已记住。'};
    return new Response('data: '+JSON.stringify({choices:[{delta}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  });
  const settings=structuredClone(defaultSettings);
  settings.providers=[
    {id:'chat',name:'Direct',kind:'chat',protocol:'openai',baseUrl:'https://provider.example/v1',apiKey:'browser-secret',models:['model-a']},
    {id:'speech',name:'Fish',kind:'speech',protocol:'fish',baseUrl:'https://provider.example/v1',apiKey:'browser-secret',models:['s2.1-pro']},
    {id:'image',name:'Image',kind:'image',protocol:'openai',baseUrl:'https://provider.example/v1',apiKey:'browser-secret',models:['image']},
  ];
  settings.speechEngine='custom';settings.speechProvider='speech';settings.speechModel='s2.1-pro';
  settings.imageProvider='image';settings.imageModel='image';
  const post=<T=any>(path:string,body:unknown)=>localCommand<T>(path,{method:'POST',body:JSON.stringify(body)});
  await localCommand('/settings',{method:'PUT',body:JSON.stringify(settings)});
  const {apiKey,...visibleProvider}=settings.providers[0];
  assert.ok(apiKey);
  assert.deepEqual(await post('/providers/models',{provider:visibleProvider}),{models:['model-a','model-b']});
  const c=await post<Conversation>('/conversations',{personaId:settings.personas[0].id});
  const events:AgentEvent[]=[];
  let approval:Promise<unknown>|undefined;
  await localRun({conversationId:c.id,providerId:'chat',model:'model-a',content:'记住我喜欢星空'},new AbortController().signal,event=>{
    events.push(event);
    if(event.type==='approval') approval=post(`/runs/${event.runId}/approvals/${event.id}`,{allow:true});
  });
  await approval;
  assert.ok(events.some(e=>e.type==='approval'));
  assert.ok(events.some(e=>e.type==='done'));
  const saved=await localCommand<Conversation>('/conversations/'+c.id);
  assert.equal(saved.messages.at(-1)?.content,'已记住。');
  assert.equal((await localCommand<any[]>('/memories'))[0].content,'喜欢星空');
  const audio=await post<Blob>('/speech',{input:'你好',voice:'reference-id'});
  assert.equal(audio.type,'audio/mpeg');
  assert.equal(await audio.text(),'ID3-audio');
  assert.equal(observed.find(r=>r.url.endsWith('/tts'))?.headers.get('model'),'s2.1-pro');
  const image=await post('/tools/execute',{name:'generate_image',args:{prompt:'星空'}});
  const artifacts=await localCommand<Artifact[]>('/artifacts');
  assert.ok(artifacts.find(a=>a.id===image.artifactId)?.data.images[0].startsWith('data:image/png;base64,'));
  assert.ok(observed.every(r=>!r.url.includes('/api/')));
});

