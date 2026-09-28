import {test} from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {understandStory} from '../../server/storyUnderstandingPlan.mjs'
import {stepfunConfig} from '../../server/stepfun.mjs'

const input={people:[{id:'child',name:'团团',relationship:'女儿'},{id:'grandma',name:'外婆',relationship:'团团的外婆'}],relationships:[],confirmed:[],photos:[
  {id:'sand',observed:'孩子在沙地使用小铲子',personIds:['child'],date:'2026-02-01'},
  {id:'drawing',observed:'孩子用画笔在纸上画画',personIds:['child'],date:'2026-03-01'},
],events:[],previous:[]}

test('library generation performs a separate evidence review before publishing',async()=>{
 const calls=[]
 const server=http.createServer(async(req,res)=>{
   let raw='';for await(const chunk of req)raw+=chunk
   const request=JSON.parse(raw),data=JSON.parse(request.messages[1].content);calls.push(data)
   const story={key:'hands',title:data.candidates?'手里的小动作':'外婆在沙滩陪伴',format:'details',angle:'观察手中的工具',assetIds:['sand','drawing'],direction:'大画面进入，细节停留，最后留白',sequence:[{text:'使用小铲子',assetIds:['sand']}],evidence:[{text:'用不同工具做事情',assetIds:['sand','drawing']}]}
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({stories:[story]})}}]}))
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
   const stories=await understandStory({apiKey:'test',model:'test',baseUrl:`http://127.0.0.1:${server.address().port}`},'library',input)
   assert.equal(calls.length,2);assert.ok(calls[1].candidates)
   assert.deepEqual(calls[1].photos,input.photos,'review receives original per-photo presence evidence')
   assert.equal(stories[0].title,'手里的小动作');assert.equal(stories[0].personIds.includes('grandma'),false)
 }finally{await new Promise(resolve=>server.close(resolve))}
})

test('LIVE: runtime skill returns evidence-bound creative stories',{skip:process.env.LIVE!=='1'},async()=>{
 process.loadEnvFile?.('.env')
 const stories=await understandStory(stepfunConfig(),'library',input)
 assert.ok(stories.length>=1);assert.ok(stories.every(s=>s.assetIds.every(id=>['sand','drawing'].includes(id))&&s.evidence.length&&s.sequence.length))
})
