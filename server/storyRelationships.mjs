import { createHash } from 'node:crypto'

// Parse only an explicit user statement referring to one unambiguous saved
// name. This is not a family tree inferred from age, appearance or co-occurrence.
const kinship = /^(姥姥|外婆|外祖母|姥爷|外公|外祖父|奶奶|祖母|爷爷|祖父|妈妈|母亲|爸爸|父亲|女儿|儿子|姐姐|妹妹|哥哥|弟弟|妻子|丈夫|朋友)$/
export function storyRelationships(people, prior = []) {
  const confirmed = people.filter(p => p.confirmed && !p.mergedInto)
  return confirmed.flatMap(person => {
    const targets = confirmed.filter(p => p.id !== person.id && p.name && person.relationship?.startsWith(p.name + '的'))
    const saved=prior.find(r=>r.subjectId===person.id&&r.evidence===person.relationship&&confirmed.some(p=>p.id===r.objectId&&p.id!==person.id))
    if (!saved&&targets.length !== 1) return []
    // Once resolved, the IDs survive later display-name changes. Editing the
    // relationship statement itself deliberately invalidates its old binding.
    const target = saved?confirmed.find(p=>p.id===saved.objectId):targets[0]
    const label = saved?saved.label:person.relationship.slice(target.name.length + 1).trim()
    if (!kinship.test(label)) return []
    const id = `relation:${createHash('sha256').update(`${person.id}|${target.id}`).digest('hex').slice(0,24)}`
    return [{ id, subjectId: person.id, objectId: target.id, label,
      value: `${person.name || label}是${target.name}的${label}`, source: 'user', status: 'confirmed',
      evidence: person.relationship }]
  })
}
