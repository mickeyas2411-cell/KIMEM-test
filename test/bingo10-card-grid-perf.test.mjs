// Offline regression checks for the actual Bingo 10 lobby grid implementation.
// Never visits production or modifies wallet, database or game state.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,runInNewContext} from 'node:vm';

const html=readFileSync(new URL('../KIMEM_BINGO_Game_Lobby.html',import.meta.url),'utf8');
const begin=html.indexOf('// Bingo 10 grid performance:');
const end=html.indexOf('let kimemCardRequest=null;',begin);
assert.ok(begin>0&&end>begin,'the isolated grid performance implementation is present');
const gridScript=html.slice(begin,end);
new Script(gridScript,{filename:'Bingo10-grid-extracted.js'});

function fixture(){
 const elements=new Map();
 const counters={created:0,listenerCount:0,htmlWrites:0,styleWrites:0,gridRebuilds:0};
 class Element {
  constructor(){this.children=[];this.id='';this.disabled=false;this.scrollTop=0;this.attributes={};this.listeners={};this._html='';this._className='';}
  set innerHTML(x){counters.htmlWrites++;this._html=x;}
  get innerHTML(){return this._html;}
  set className(x){counters.styleWrites++;this._className=x;}
  get className(){return this._className;}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(k,cb){counters.listenerCount++;this.listeners[k]=cb;}
  appendChild(child){
   if(child.fragment){for(const el of child.children)this.appendChild(el);return child;}
   this.children.push(child);
   if(child.id)elements.set(child.id,child);
   return child;
  }
  replaceChildren(...items){
   counters.gridRebuilds++;
   for(const child of this.children)if(child.id)elements.delete(child.id);
   this.children=[];
   for(const item of items)this.appendChild(item);
  }
 }
 const matrix=new Element();
 matrix.id='card-matrix';elements.set(matrix.id,matrix);
 const document={
  createElement:()=>{counters.created++;return new Element();},
  createDocumentFragment:()=>({fragment:true,children:[],appendChild(item){this.children.push(item);}}),
  getElementById:id=>elements.get(id)||null
 };
 const selectedCards=[],qimemOtherPlayerLocks=new Set();
 let taps=[];
 const context={document,selectedCards,qimemOtherPlayerLocks,qimemLocksReady:true,searchQuery:'',
  $:document.getElementById,toggleCard:id=>taps.push(id),Set,Number,String};
 runInNewContext(gridScript,context);
 return {matrix,context,selectedCards,qimemOtherPlayerLocks,counters,getCard:id=>elements.get('card-btn-'+id),taps};
}
test('initial 3000 cards preserve normal UI, click behavior, IDs and scroll position',()=>{
 const f=fixture();
 f.matrix.scrollTop=333;
 f.context.renderCardGrid();
 assert.equal(f.matrix.children.length,3000);
 assert.equal(f.matrix.scrollTop,333);
 assert.equal(f.counters.created,3000);
 assert.equal(f.counters.listenerCount,3000);
 assert.equal(f.getCard(1).innerHTML,'1');
 assert.equal(f.getCard(3000).innerHTML,'3000');
 f.getCard(27).listeners.click();
 assert.deepEqual(f.taps,[27]);
 assert.equal(f.getCard(27).attributes['aria-pressed'],'false');
});
test('server-confirmed purchase and cancellation repaint ONLY changed card and keep same DOM nodes',()=>{
 const f=fixture();
 f.context.renderCardGrid();
 const original=f.getCard(325),unrelated=f.getCard(326);
 const firstWrites=f.counters.htmlWrites,firstRebuilds=f.counters.gridRebuilds;
 f.selectedCards.push(325);f.qimemOtherPlayerLocks.add(325);
 f.context.renderCardGrid();
 assert.equal(f.counters.htmlWrites-firstWrites,1);
 assert.equal(f.counters.gridRebuilds,firstRebuilds);
 assert.equal(f.getCard(325),original);
 assert.equal(f.getCard(326),unrelated);
 assert.match(original.className,/\bselected\b/);
 assert.ok(original.innerHTML.includes('🔒'));
 assert.equal(original.attributes['aria-pressed'],'true');
 const afterSelect=f.counters.htmlWrites;
 f.selectedCards.splice(0);f.qimemOtherPlayerLocks.delete(325);
 f.context.renderCardGrid();
 assert.equal(f.counters.htmlWrites-afterSelect,1);
 assert.ok(!original.className.includes('selected'));
 assert.equal(original.disabled,false);
 assert.equal(original.innerHTML,'325');
 assert.equal(f.counters.listenerCount,3000);
});
test('other player locks stay gold/disabled; private owned card remains selected; unchanged snapshot causes zero writes',()=>{
 const f=fixture();f.context.renderCardGrid();
 f.qimemOtherPlayerLocks.add(12);f.qimemOtherPlayerLocks.add(19);
 f.selectedCards.push(19);
 const before=f.counters.htmlWrites;
 f.context.renderCardGrid();
 assert.equal(f.counters.htmlWrites-before,2);
 assert.match(f.getCard(12).className,/\bother-locked\b/);
 assert.equal(f.getCard(12).disabled,true);
 assert.equal(f.getCard(12).attributes['aria-label'],'Card 12 locked by another player');
 assert.match(f.getCard(19).className,/\bselected\b/);
 assert.equal(f.getCard(19).disabled,false);
 const unchanged=f.counters.htmlWrites;
 f.context.renderCardGrid();
 assert.equal(f.counters.htmlWrites-unchanged,0);
 f.qimemOtherPlayerLocks.delete(12);
 f.context.renderCardGrid();
 assert.equal(f.counters.htmlWrites-unchanged,1);
 assert.equal(f.getCard(12).disabled,false);
 assert.equal(f.getCard(12).innerHTML,'12');
});
test('search only repaints old and new highlighted cards without losing scroll or click bindings',()=>{
 const f=fixture();f.context.renderCardGrid();
 const oldRef=f.getCard(3000);const before=f.counters.htmlWrites;
 f.context.searchQuery='3000';f.context.renderCardGrid();
 assert.equal(f.counters.htmlWrites-before,1);
 assert.match(oldRef.className,/\bsoft-match\b/);
 const beforeSecond=f.counters.htmlWrites;
 f.context.searchQuery='75';f.context.renderCardGrid();
 assert.equal(f.counters.htmlWrites-beforeSecond,2);
 assert.ok(!oldRef.className.includes('soft-match'));
 assert.match(f.getCard(75).className,/\bsoft-match\b/);
 const beforeClear=f.counters.htmlWrites;
 f.context.searchQuery='';f.context.renderCardGrid();
 assert.equal(f.counters.htmlWrites-beforeClear,1);
 assert.equal(f.counters.listenerCount,3000);
});
test('sold-out lock snapshot updates 3000 existing cards, then releases without recreating grid',()=>{
 const f=fixture();f.context.renderCardGrid();
 const refs=[f.getCard(1),f.getCard(1500),f.getCard(3000)];
 const initialRebuilds=f.counters.gridRebuilds;
 for(let id=1;id<=3000;id++)f.qimemOtherPlayerLocks.add(id);
 f.context.renderCardGrid();
 assert.equal(f.counters.gridRebuilds,initialRebuilds);
 assert.equal(f.counters.created,3000);
 assert.ok(f.matrix.children.every(x=>x.disabled===true));
 assert.equal(f.getCard(1),refs[0]);
 assert.equal(f.getCard(1500),refs[1]);
 assert.equal(f.getCard(3000),refs[2]);
 const before=f.counters.htmlWrites;
 f.context.renderCardGrid();
 assert.equal(f.counters.htmlWrites-before,0);
 f.qimemOtherPlayerLocks.clear();f.context.renderCardGrid();
 assert.ok(f.matrix.children.every(x=>x.disabled===false));
 assert.equal(f.counters.gridRebuilds,initialRebuilds);
});
test('fresh round and lock sync preserve authoritative server-only ownership and private lock panel',()=>{
 assert.match(html,/qimem-bingo10-card-result/);
 assert.match(html,/kimemCardRequest=null;/);
 assert.match(html,/function kimemRefreshGlobalCardLocks/);
 assert.match(html,/source!==['"]verified_paid_cards['"]/);
 assert.match(html,/if\(changed\)updateUI\(\)/);
 const start=html.indexOf('function renderLockedCards()');
 const end=html.indexOf('function renderBingoPreview()',start);
 const ownedOnly=html.slice(start,end);
 assert.ok(start>0&&end>start);
 assert.match(ownedOnly,/for\(const id of selectedCards\)/);
 assert.doesNotMatch(ownedOnly,/qimemOtherPlayerLocks|q-lock-other|OTHER LOCKED/);
});
