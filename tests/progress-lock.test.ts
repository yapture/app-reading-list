import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {parseWholeNumberInput} from '../src/App';

const text=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('App.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let editor:ts.JsxSelfClosingElement|undefined;
const walk=(node:ts.Node)=>{
 if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(ast)==='input'
  &&node.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(ast)==='value'&&p.initializer?.getText(ast)==='{editPage}'))editor=node;
 ts.forEachChild(node,walk);
};walk(ast);if(!editor)throw Error('Progress editor missing');
const editorCode=ts.transpileModule('return ('+editor.getText(ast)+');',{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,jsxFactory:'captureElement'}}).outputText;
const app=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='App') as ts.FunctionDeclaration;
const handler=app.body!.statements.filter(ts.isVariableStatement).flatMap(n=>[...n.declarationList.declarations]).find(n=>n.name.getText(ast)==='updatePages')!;
const handlerCode=ts.transpileModule('const '+handler.getText(ast)+'; return updatePages;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const book={id:'book',title:'Fixture book',totalPages:100,currentPage:0,status:'to-read'};
function inputProps(saving:boolean,conflict:boolean,draft:string,onChange:(text:string)=>void,onSave:(...args:any[])=>void){
 const ports={saving,conflict,editPage:draft,book,setEditPage:onChange,updatePages:onSave,parseWholeNumberInput,S:{input:{}},captureElement:(_tag:string,props:any)=>props};
 return new Function(...Object.keys(ports),editorCode)(...Object.values(ports));
}
function page(){
 let draft='20',editing:string|null=book.id,saving=false,finish!:(saved:boolean)=>void;
 const writes:any[][]=[],messages:string[]=[],pendingFocus={current:null};
 const ports={books:[book],filter:'all',visible:[book],neighbourId:()=>null,pendingFocus,useCallback:(fn:unknown)=>fn,
  setEditingId:(id:string|null)=>{editing=id;},announce:(message:string)=>messages.push(message),
  persist:(next:any[])=>{saving=true;writes.push(next);return new Promise<boolean>(resolve=>{finish=saved=>{saving=false;resolve(saved);};});}};
 const update=new Function(...Object.keys(ports),handlerCode)(...Object.values(ports));
 return {update,writes,messages,editing:()=>editing,draft:()=>draft,finish:(saved:boolean)=>finish(saved),
  input:()=>inputProps(saving,false,draft,text=>{draft=text;},update),
  // Disabled browser inputs do not dispatch user change events. The actual
  // JSX disabled binding decides whether this event port may run.
  type:(next:string)=>{const input=inputProps(saving,false,draft,text=>{draft=text;},update);if(!input.disabled)input.onChange({target:{value:next}});}};
}

for(const[saving,conflict]of [[false,false],[true,false],[false,true],[true,true]])test(`progress editor saving=${saving} conflict=${conflict}`,()=>{
 expect(Boolean(inputProps(saving,conflict,'20',()=>{},()=>{}).disabled)).toBe(saving||conflict);
});
test('pending page save cannot accept a newer edit that its completion would hide',async()=>{
 const p=page(),pending=p.update(book.id,20,true);
 try{
  p.type('42');p.finish(true);await pending;expect(p.draft()).toBe('20');
  expect(p.writes).toHaveLength(1);expect(p.writes[0][0].currentPage).toBe(20);
  expect(p.editing()).toBe(null);expect(p.messages).toEqual(['Fixture book: 20 of 100 pages read']);
 }finally{p.finish(false);await pending;}
});
test('refused page save retains the editor and submitted value without announcing success',async()=>{
 const p=page(),pending=p.update(book.id,20,true);
 try{p.finish(false);await pending;expect(p.editing()).toBe(book.id);expect(p.draft()).toBe('20');expect(p.messages).toEqual([]);}
 finally{p.finish(false);await pending;}
});
test('idle page editor still accepts input and saves its parsed value on blur',()=>{
 let draft='20';const calls:any[][]=[];
 inputProps(false,false,draft,value=>{draft=value;},(...args)=>calls.push(args)).onChange({target:{value:'42'}});
 const props=inputProps(false,false,draft,value=>{draft=value;},(...args)=>calls.push(args));
 props.onBlur();expect(draft).toBe('42');expect(calls).toEqual([[book.id,42]]);expect(Boolean(props.disabled)).toBe(false);
});
