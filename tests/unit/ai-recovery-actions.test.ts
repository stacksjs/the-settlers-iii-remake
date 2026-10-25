import { expect, test } from 'bun:test'
import { audit, createSession, describeMap, diagnose, economicAI, observe, PUBLISHED_RULES, restore, ROMAN_ENGINEERING as rules, save, stepAI } from '../../resources/game/engine'
import { RIVAL_MILITARY } from '../../resources/game/controller'
async function captured() {
  const bytes=await Bun.file(new URL('../fixtures/ai-duplicate-demolition.json',import.meta.url)).arrayBuffer()
  expect(Bun.SHA256.hash(bytes,'hex')).toBe('0084ea74c1fe13fcbbab475e7863555a86d313c78358783ddd69cf8839f4e2cf')
  return restore(JSON.parse(new TextDecoder().decode(bytes)),PUBLISHED_RULES)
}
test('the captured fishing and material diagnoses remain visible but produce one demolition',async()=>{
 const s=await captured(),before=s.checksum(),o=observe(s,2)
 expect(diagnose(o).filter(d=>d.building===1156).map(d=>d.kind).sort()).toEqual(['exhausted','materials'])
 const orders=economicAI(2,{military:RIVAL_MILITARY}).decide(o)
 expect(orders.filter(c=>c.type==='demolish'&&c.building===1156)).toHaveLength(1)
 expect(s.checksum()).toBe(before)
})
test('ordinary recovery executes once, balances goods and matches after restore',async()=>{
 const s=await captured(),copy=restore(JSON.parse(JSON.stringify(save(s))),PUBLISHED_RULES),before=structuredClone(s.state.ledger[2]!.created)
 const sequence={next:1+Math.max(-1,...s.state.results.filter(r=>r.player===2).map(r=>r.seq),...s.state.pending.filter(r=>r.player===2).map(r=>r.seq))}
 for(const session of [s,copy]){
  stepAI(session,economicAI(2,{military:RIVAL_MILITARY}),{...sequence});session.advance(1)
  const results=session.state.results.filter(r=>r.player===2&&r.tick===9360)
  expect(results.filter(r=>!r.ok)).toEqual([])
  expect(results.filter(r=>r.type==='demolish')).toHaveLength(1)
  expect(session.view(2).buildings.some(b=>b.id===1156)).toBe(false)
  expect(session.state.ledger[2]!.created).toEqual(before)
  expect(audit(session.context)).toEqual([])
 }
 expect(copy.checksum()).toBe(s.checksum())
})
test('separate exhausted workplaces retain separate demolition recoveries',()=>{
 const s=createSession({rules,map:describeMap(rules,{width:96,height:96,seed:5,base:'grass',features:[]}),seed:5,players:[{name:'Rome',civilization:'roman',start:{x:40,y:40},scenario:{buildings:[{type:'castle',x:40,y:40},{type:'fisher',x:31,y:44},{type:'fisher',x:53,y:47}],settlers:Array.from({length:16},(_,i)=>({profession:'carrier',x:36+i%8,y:50+Math.floor(i/8)}))}}],piles:[{good:'fishingrod',amount:2,x:39,y:53}]})
 expect(s.skipped).toEqual({});s.advance(600)
 const o=observe(s,1),diagnosis=diagnose(o),fisheries=o.view.buildings.filter(b=>b.type==='fisher')
 expect(fisheries).toHaveLength(2)
 expect(diagnosis.filter(d=>d.kind==='exhausted'&&fisheries.some(b=>b.id===d.building))).toHaveLength(2)
 const orders=economicAI(1).decide(o).filter(c=>c.type==='demolish')
 expect(orders.map(c=>c.building).sort()).toEqual(fisheries.map(b=>b.id).sort())
})
