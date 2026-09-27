// Review-only grouping. Unlike connected components, every merge checks all
// cross-group similarities and forbids two observations from the same photo.
// It never changes a user-confirmed face or assigns a real-world name.
export function candidateGroups(faces){
  const dot=(a,b)=>a.embedding.length===b.embedding.length?a.embedding.reduce((s,v,i)=>s+v*b.embedding[i],0):-1
  const positions=new Map(faces.map((f,i)=>[f.id,i])),matrix=new Float32Array(faces.length*faces.length)
  for(let a=0;a<faces.length;a++)for(let b=0;b<a;b++)matrix[a*faces.length+b]=matrix[b*faces.length+a]=dot(faces[a],faces[b])
  const groups=faces.map(f=>({faces:[f],ids:new Set([f.assetId]),model:f.model}))
  while(true){
    let best=null
    for(let a=0;a<groups.length;a++)for(let b=0;b<a;b++){
      const x=groups[a],y=groups[b]
      if(x.model!==y.model||[...x.ids].some(id=>y.ids.has(id)))continue
      let sum=0,min=1,count=0
      for(const f of x.faces)for(const g of y.faces){const score=matrix[positions.get(f.id)*faces.length+positions.get(g.id)];sum+=score;min=Math.min(min,score);count++}
      const mean=sum/count
      if(mean>=.60&&min>=.42&&(!best||mean>best.score))best={a,b,score:mean}
    }
    if(!best)break
    const [x]=groups.splice(best.a,1),y=groups[best.b]
    y.faces.push(...x.faces);for(const id of x.ids)y.ids.add(id)
  }
  return groups.map(g=>g.faces).sort((a,b)=>b.length-a.length||a[0].id.localeCompare(b[0].id))
}
