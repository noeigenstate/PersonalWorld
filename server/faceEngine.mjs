import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

export function createFaceEngine({models = process.env.FACE_MODELS_DIR || fileURLToPath(new URL('./data/identity-models/',import.meta.url)),python = process.env.FACE_PYTHON || 'python'}={}) {
  let child, sequence=0, chain=Promise.resolve(), idle
  const pending=new Map()
  const stop=()=>{clearTimeout(idle);child?.kill();child=undefined}
  const fail=message=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error(message))}pending.clear()}
  function request(body) {
    clearTimeout(idle)
    if(!child){
      if(!existsSync(join(models,'face_recognition_sface_2021dec.onnx')) || !existsSync(join(models,'face_detection_yunet_2023mar.onnx'))) return Promise.reject(new Error('本地人物模型尚未安装'))
      child=spawn(python,['-u',fileURLToPath(new URL('./identity/worker.py',import.meta.url)),models],{windowsHide:true,stdio:['pipe','pipe','pipe']})
      const active=child
      active.stderr.on('data',()=>{})
      active.on('error',()=>{fail('本地人物引擎未能启动');if(child===active)child=undefined})
      active.on('exit',()=>{if(child===active){child=undefined;fail('本地人物引擎已退出，可以重试')}})
      createInterface({input:active.stdout}).on('line',line=>{
        let result;try{result=JSON.parse(line)}catch{return}
        const task=pending.get(result.id);if(!task)return
        pending.delete(result.id);clearTimeout(task.timer)
        result.error ? task.reject(new Error(result.error)) : task.resolve(result.result)
        idle=setTimeout(stop,120000);idle.unref()
      })
    }
    return new Promise((resolve,reject)=>{
      const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('本地人物分析超时'));stop()},60000)
      pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({...body,id})+'\n')
    })
  }
  const serial=body=>{const result=chain.then(()=>request(body));chain=result.catch(()=>{});return result}
  return {status:()=>serial({action:'status'}),detect:path=>serial({action:'detect',path}),close:()=>{stop();fail('人物引擎已关闭')}}
}
