import registry from './landmarkSites.json'
export function landmarkRecord(id:string){
  if(/^osm:way:1084641014(?::|$)/.test(id))return {model:'gongshu-umbrella',name:'运河体育公园曲棍球场'}
  if(/^osm:way:1084641019(?::|$)/.test(id))return {model:'gongshu-jade',name:'运河体育公园体育馆'}
  return registry.buildings.find(b=>id===b.id||id.startsWith(b.id+':'))
}
