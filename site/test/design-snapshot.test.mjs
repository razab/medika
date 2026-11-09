import test from 'node:test';
import assert from 'node:assert/strict';
import {designSnapshot} from '../lib/design-snapshot.mjs';
test('Дизайн: копия сохраняет видимые данные, убирает рабочие ID и не меняет источник',()=>{
  const now=new Date('2026-11-09T18:00:00Z'),date='2026-11-09',state={people:[{id:'clinical-person-id',name:'Тест А',carePhase:'acute',notes:'Не копировать заметки профиля'}],prescriptions:[{id:'clinical-rx-id',version:7,personId:'clinical-person-id',name:'ТестСпрей',dose:'2',unit:'впрыскивание',confirmed:true,startDate:date,carePhase:'acute',sourceText:'Тестовое назначение'}],events:[],activities:[{id:'clinical-record-id',personId:'clinical-person-id',kind:'temperature',celsius:37.7,occurredAt:'2026-11-09T17:00:00Z'}]};
  const schedule={items:[{key:'clinical-key',rxId:'clinical-rx-id',personId:'clinical-person-id',name:'ТестСпрей',dose:'2',unit:'впрыскивание',anchor:'dinner',label:'Ужин',displayTime:'19:00'}],prn:[]},before=JSON.stringify({state,schedule}),snapshot=designSnapshot(state,schedule,{date,now,copiedAt:now}),text=JSON.stringify(snapshot);
  assert.doesNotMatch(text,/clinical-|rxVersion|eventVersion|Не копировать/);assert.equal(snapshot.model.cards[0].id,'demo-person-1');assert.equal(snapshot.model.cards[0].current.rows[0].key,'demo-dose-1');assert.equal(snapshot.model.cards[0].current.rows[0].dose,'2 пшика');assert.equal(snapshot.model.history[0].personId,'demo-person-1');assert.equal(snapshot.model.history[0].name,'37,7 °C');assert.equal(JSON.stringify({state,schedule}),before);
  snapshot.model.cards[0].current.rows[0].taken=true;assert.equal(state.events.length,0);assert.equal(schedule.items[0].event,undefined);
});
