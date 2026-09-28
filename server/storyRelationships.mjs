import { createHash } from 'node:crypto'

// Parse only an explicit user statement referring to one unambiguous saved
// name. This is not a family tree inferred from age, appearance or co-occurrence.
const kinship = /^(姥姥|外婆|外祖母|姥爷|外公|外祖父|奶奶|祖母|爷爷|祖父|妈妈|母亲|爸爸|父亲|女儿|儿子|姐姐|妹妹|哥哥|弟弟|妻子|丈夫|朋友)$/

export function knownKinshipWords(people=[],relationships=[]){
  const byId=new Map(people.map(p=>[p.id,p])),words=new Set()
  for(const r of relationships){
    if(!byId.has(r.subjectId)||!byId.has(r.objectId))continue
    const aliases=/^(姥姥|外婆|外祖母)$/.test(r.label)?['姥姥','外婆','外祖母','祖孙']
      :/^(奶奶|祖母)$/.test(r.label)?['奶奶','祖母','祖孙']
      :/^(姥爷|外公|外祖父)$/.test(r.label)?['姥爷','外公','外祖父','祖孙']
      :/^(爷爷|祖父)$/.test(r.label)?['爷爷','祖父','祖孙']
      :/^(妈妈|母亲)$/.test(r.label)?['妈妈','母亲','亲子']
      :/^(爸爸|父亲)$/.test(r.label)?['爸爸','父亲','亲子']
      :/^(女儿|儿子)$/.test(r.label)?[r.label,'亲子']:[]
    aliases.forEach(word=>words.add(word))
    if(/^(女儿|儿子)$/.test(r.label)){
      const parent=byId.get(r.objectId)
      if(/^(爸爸|父亲)$/.test(parent.name))words.add(r.label==='女儿'?'父女':'父子')
      if(/^(妈妈|母亲)$/.test(parent.name))words.add(r.label==='女儿'?'母女':'母子')
    }
  }
  return words
}
export function storyRelationships(people, prior = []) {
  const confirmed = people.filter(p => p.confirmed && !p.mergedInto)
  const selves=confirmed.filter(p=>/^(我|本人|自己)$/.test(p.relationship?.trim()||''))
  return confirmed.flatMap(person => {
    const relative=kinship.test(person.relationship?.trim()||'')
    // The UI explicitly asks "与你的关系". Resolve its bare labels only when
    // one confirmed identity is marked as the user, never from appearance.
    if(relative&&(selves.length!==1||selves[0].id===person.id))return []
    const targets = confirmed.filter(p => p.id !== person.id && p.name && person.relationship?.startsWith(p.name + '的'))
    const saved=prior.find(r=>r.subjectId===person.id&&r.evidence===person.relationship&&confirmed.some(p=>p.id===r.objectId&&p.id!==person.id))
    if (!relative&&!saved&&targets.length !== 1) return []
    // Once resolved, the IDs survive later display-name changes. Editing the
    // relationship statement itself deliberately invalidates its old binding.
    const target = relative?selves[0]:saved?confirmed.find(p=>p.id===saved.objectId):targets[0]
    const label = relative?person.relationship.trim():saved?saved.label:person.relationship.slice(target.name.length + 1).trim()
    if (!kinship.test(label)) return []
    const id = `relation:${createHash('sha256').update(`${person.id}|${target.id}`).digest('hex').slice(0,24)}`
    return [{ id, subjectId: person.id, objectId: target.id, label,
      value: `${person.name || label}是${target.name}的${label}`, source: 'user', status: 'confirmed',
      evidence: person.relationship }]
  })
}
