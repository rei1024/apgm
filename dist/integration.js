var ee=Object.defineProperty;var ne=(e,t)=>{for(var r in t)ee(e,r,{get:t[r],enumerable:!0})};var u={};ne(u,{Parser:()=>g,all:()=>dr,choice:()=>ae,default:()=>hr,eof:()=>mr,fail:()=>ie,lazy:()=>ue,location:()=>Dt,match:()=>se,ok:()=>nt,text:()=>oe});var g=class{constructor(t){this.action=t}parse(t){let r={index:0,line:1,column:1},n=new it({input:t,location:r}),i=this.skip(mr).action(n);return i.type==="ActionOK"?{type:"ParseOK",value:i.value}:{type:"ParseFail",location:i.furthest,expected:i.expected}}tryParse(t){let r=this.parse(t);if(r.type==="ParseOK")return r.value;let{expected:n,location:i}=r,{line:o,column:a}=i,p=`parse error at line ${o} column ${a}: expected ${n.join(", ")}`;throw new Error(p)}and(t){return new g(r=>{let n=this.action(r);if(n.type==="ActionFail")return n;r=r.moveTo(n.location);let i=r.merge(n,t.action(r));if(i.type==="ActionOK"){let o=[n.value,i.value];return r.merge(i,r.ok(i.location.index,o))}return i})}skip(t){return this.and(t).map(([r])=>r)}next(t){return this.and(t).map(([,r])=>r)}or(t){return new g(r=>{let n=this.action(r);return n.type==="ActionOK"?n:r.merge(n,t.action(r))})}chain(t){return new g(r=>{let n=this.action(r);if(n.type==="ActionFail")return n;let i=t(n.value);return r=r.moveTo(n.location),r.merge(n,i.action(r))})}map(t){return this.chain(r=>nt(t(r)))}thru(t){return t(this)}desc(t){return new g(r=>{let n=this.action(r);return n.type==="ActionOK"?n:{type:"ActionFail",furthest:n.furthest,expected:t}})}wrap(t,r){return t.next(this).skip(r)}trim(t){return this.wrap(t,t)}repeat(t=0,r=1/0){if(!lr(t,r))throw new Error(`repeat: bad range (${t} to ${r})`);return t===0?this.repeat(1,r).or(nt([])):new g(n=>{let i=[],o=this.action(n);if(o.type==="ActionFail")return o;for(;o.type==="ActionOK"&&i.length<r;){if(i.push(o.value),o.location.index===n.location.index)throw new Error("infinite loop detected; don't call .repeat() with parsers that can accept zero characters");n=n.moveTo(o.location),o=n.merge(o,this.action(n))}return o.type==="ActionFail"&&i.length<t?o:n.merge(o,n.ok(n.location.index,i))})}sepBy(t,r=0,n=1/0){if(!lr(r,n))throw new Error(`sepBy: bad range (${r} to ${n})`);return r===0?this.sepBy(t,1,n).or(nt([])):n===1?this.map(i=>[i]):this.chain(i=>t.next(this).repeat(r-1,n-1).map(o=>[i,...o]))}node(t){return dr(Dt,this,Dt).map(([r,n,i])=>({type:"ParseNode",name:t,value:n,start:r,end:i}))}};function lr(e,t){return e<=t&&e>=0&&t>=0&&Number.isInteger(e)&&e!==1/0&&(Number.isInteger(t)||t===1/0)}var Dt=new g(e=>e.ok(e.location.index,e.location));function nt(e){return new g(t=>t.ok(t.location.index,e))}function ie(e){return new g(t=>t.fail(t.location.index,e))}var mr=new g(e=>e.location.index<e.input.length?e.fail(e.location.index,["<EOF>"]):e.ok(e.location.index,"<EOF>"));function oe(e){return new g(t=>{let r=t.location.index,n=r+e.length;return t.input.slice(r,n)===e?t.ok(n,e):t.fail(r,[e])})}function se(e){for(let r of e.flags)switch(r){case"i":case"s":case"m":case"u":continue;default:throw new Error("only the regexp flags 'imsu' are supported")}let t=new RegExp(e.source,e.flags+"y");return new g(r=>{let n=r.location.index;t.lastIndex=n;let i=r.input.match(t);if(i){let o=n+i[0].length,a=r.input.slice(n,o);return r.ok(o,a)}return r.fail(n,[String(e)])})}function dr(...e){return e.reduce((t,r)=>t.chain(n=>r.map(i=>[...n,i])),nt([]))}function ae(...e){return e.reduce((t,r)=>t.or(r))}function ue(e){let t=new g(r=>(t.action=e().action,t.action(r)));return t}function ce(e,t){return[...new Set([...e,...t])]}var it=class{constructor(t){this.input=t.input,this.location=t.location}moveTo(t){return new it({input:this.input,location:t})}_internal_move(t){if(t===this.location.index)return this.location;let r=this.location.index,n=t,i=this.input.slice(r,n),{line:o,column:a}=this.location;for(let p of i)p===`
`?(o++,a=1):a++;return{index:t,line:o,column:a}}ok(t,r){return{type:"ActionOK",value:r,location:this._internal_move(t),furthest:{index:-1,line:-1,column:-1},expected:[]}}fail(t,r){return{type:"ActionFail",furthest:this._internal_move(t),expected:r}}merge(t,r){if(r.furthest.index>t.furthest.index)return r;let n=r.furthest.index===t.furthest.index?ce(t.expected,r.expected):t.expected;return r.type==="ActionOK"?{type:"ActionOK",location:r.location,value:r.value,furthest:t.furthest,expected:n}:{type:"ActionFail",furthest:t.furthest,expected:n}}};var hr=null;var l=class{pretty(){return"unimplemented"}extractUnaryRegisterNumbers(){return[]}extractBinaryRegisterNumbers(){return[]}extractLegacyTRegisterNumbers(){return[]}doesReturnValue(){return!1}isSameComponent(t){return!0}};var dt=0,ht=1,xt=2,_t="A1",Ot="B0",Ct="B1",xr="ADD";function pe(e){switch(e){case dt:return _t;case ht:return Ot;case xt:return Ct}}function fe(e){switch(e){case _t:return dt;case Ot:return ht;case Ct:return xt}}var _=class extends l{constructor(t){super(),this.op=t}pretty(){return`${xr} ${pe(this.op)}`}static parse(t){let r=t.trim().split(/\s+/u);if(r.length!==2)return;let[n,i]=r;if(n===xr&&(i===_t||i===Ot||i===Ct))return new _(fe(i))}doesReturnValue(){switch(this.op){case dt:return!1;case ht:return!0;case xt:return!0}}isSameComponent(t){return t instanceof _}};var J=0,Q=1,ot=2,st=3,j=4,X=5,at=6,gt="INC",Zt="TDEC",At="READ",bt="SET",zt="B2DX",Ut="B2DY",kt="B2D",le="DEC",gr="SQX",Ar="SQY",br="SQ";function Er(e){switch(e){case gt:return J;case Zt:return Q;case At:return ot;case bt:return st}}function me(e){switch(e){case J:return gt;case Q:return Zt;case ot:return At;case st:return bt}}function yr(e){switch(e){case zt:return j;case Ut:return X;case kt:return at}}function de(e){switch(e){case j:return zt;case X:return Ut;case at:return kt}}var A=class extends l{constructor(t,r){super(),this.op=t,this.axis=r}pretty(){return`${me(this.op)} ${de(this.axis)}`}static parse(t){let r=t.trim().split(/\s+/u);if(r.length!==2)return;let[n,i]=r;if(!(n===void 0||i===void 0)){if(n===gt||n===Zt){if(i===zt||i===Ut)return new A(Er(n),yr(i))}else if((n===At||n===bt)&&i===kt)return new A(Er(n),yr(i));switch(n){case gt:switch(i){case gr:return new A(J,j);case Ar:return new A(J,X);default:return}case le:switch(i){case gr:return new A(Q,j);case Ar:return new A(Q,X);default:return}case At:switch(i){case br:return new A(ot,at);default:return}case bt:switch(i){case br:return new A(st,at);default:return}}}}doesReturnValue(){switch(this.op){case J:return!1;case Q:return!0;case ot:return!0;case st:return!1}}isSameComponent(t){return t instanceof A?this.axis===j&&t.axis===X?!1:!(this.axis===X&&t.axis===j):!1}};var Et=0,yt=1,St=2,wt=3,Ft="INC",Wt="TDEC",Vt="READ",Yt="SET",Sr="B";function he(e){switch(e){case Et:return Ft;case yt:return Wt;case St:return Vt;case wt:return Yt}}function xe(e){switch(e){case Ft:return Et;case Wt:return yt;case Vt:return St;case Yt:return wt}}var R=class extends l{constructor(t,r){super(),this.op=t,this.regNumber=r,this.registerCache=void 0}extractBinaryRegisterNumbers(){return[this.regNumber]}pretty(){return`${he(this.op)} ${Sr}${this.regNumber}`}static parse(t){let r=t.trim().split(/\s+/u);if(r.length!==2)return;let[n,i]=r;if(!(n===void 0||i===void 0)&&(n===Ft||n===Wt||n===Vt||n===Yt)&&i.startsWith(Sr)){let o=i.slice(1);if(/^[0-9]+$/u.test(o))return new R(xe(n),parseInt(o,10))}}doesReturnValue(){switch(this.op){case Et:return!1;case yt:return!0;case St:return!0;case wt:return!1}}isSameComponent(t){return t instanceof R?this.regNumber===t.regNumber:!1}};var wr="HALT_OUT",b=class extends l{constructor(){super()}pretty(){return wr}static parse(t){let r=t.trim().split(/\s+/u);if(r.length!==1)return;let[n]=r;if(n===wr)return new b}doesReturnValue(){return!1}isSameComponent(t){return t instanceof b}};var Ht=0,jt=1,Xt="0",qt="1",Pr="MUL";function ge(e){switch(e){case Xt:return Ht;case qt:return jt}}function Ae(e){switch(e){case Ht:return Xt;case jt:return qt}}var U=class extends l{constructor(t){super(),this.op=t}pretty(){return`${Pr} ${Ae(this.op)}`}static parse(t){let r=t.trim().split(/\s+/u);if(r.length!==2)return;let[n,i]=r;if(n===Pr&&(i===Xt||i===qt))return new U(ge(i))}doesReturnValue(){return!0}isSameComponent(t){return t instanceof U}};var S=class extends l{constructor(){super()}pretty(){return"NOP"}static parse(t){let r=t.trim().split(/\s+/u);if(r.length!==1)return;let[n]=r;if(n==="NOP")return new S}doesReturnValue(){return!0}isSameComponent(t){return t instanceof S}};var Gr="OUTPUT",k=class extends l{constructor(t){super(),this.digit=t}pretty(){return`${Gr} ${this.digit}`}static parse(t){let r=t.trim().split(/\s+/u);if(r.length!==2)return;let[n,i]=r;if(n===Gr&&i!==void 0)return new k(i)}doesReturnValue(){return!1}isSameComponent(t){return t instanceof k}};var Pt=0,Gt=1,Nt=2,Kt="A1",Jt="B0",Qt="B1",Nr="SUB";function be(e){switch(e){case Pt:return Kt;case Gt:return Jt;case Nt:return Qt}}function Ee(e){switch(e){case Kt:return Pt;case Jt:return Gt;case Qt:return Nt}}var F=class extends l{constructor(t){super(),this.op=t}pretty(){return`${Nr} ${be(this.op)}`}static parse(t){let r=t.trim().split(/\s+/u);if(r.length!==2)return;let[n,i]=r;if(n===Nr&&(i===Kt||i===Jt||i===Qt))return new F(Ee(i))}doesReturnValue(){switch(this.op){case Pt:return!1;case Gt:return!0;case Nt:return!0}}isSameComponent(t){return t instanceof F}};var Mt=0,Bt=1,tr="INC",rr="TDEC",Mr="U",ye="R";function Se(e){switch(e){case Mt:return tr;case Bt:return rr}}function we(e){switch(e){case tr:return Mt;case rr:return Bt}}var T=class extends l{constructor(t,r){super(),this.op=t,this.regNumber=r,this.registerCache=void 0}extractUnaryRegisterNumbers(){return[this.regNumber]}pretty(){return`${Se(this.op)} ${Mr}${this.regNumber}`}static parse(t){let r=t.trim().split(/\s+/u);if(r.length!==2)return;let[n,i]=r;if(!(n===void 0||i===void 0)&&(n===tr||n===rr)&&(i.startsWith(Mr)||i.startsWith(ye))){let o=i.slice(1);if(/^[0-9]+$/u.test(o))return new T(we(n),parseInt(o,10))}}doesReturnValue(){switch(this.op){case Mt:return!1;case Bt:return!0}}isSameComponent(t){return t instanceof T?this.regNumber===t.regNumber:!1}};var Lt=0,Rt=1,Tt=2,$t=3,vt=4,er="INC",nr="DEC",ir="READ",or="SET",sr="RESET";function Pe(e){switch(e){case Lt:return er;case Rt:return nr;case Tt:return ir;case $t:return or;case vt:return sr}}function Ge(e){switch(e){case er:return Lt;case nr:return Rt;case ir:return Tt;case or:return $t;case sr:return vt}}var W=class extends l{constructor(t,r){super(),this.op=t,this.regNumber=r}extractLegacyTRegisterNumbers(){return[this.regNumber]}pretty(){return`${Pe(this.op)} T${this.regNumber}`}static parse(t){let r=t.trim().split(/\s+/u);if(r.length!==2)return;let[n,i]=r;if(!(n===void 0||i===void 0)&&(n===er||n===nr||n===ir||n===or||n===sr)&&i.startsWith("T")){let o=i.slice(1);if(/^[0-9]+$/u.test(o))return new W(Ge(n),parseInt(o,10))}}doesReturnValue(){switch(this.op){case Lt:return!0;case Rt:return!0;case Tt:return!0;case $t:return!1;case vt:return!1}}isSameComponent(t){return t instanceof W?this.regNumber===t.regNumber:!1}};function ut(e){let t=[R.parse,T.parse,A.parse,S.parse,_.parse,U.parse,F.parse,k.parse,b.parse,W.parse];for(let r of t){let n=r(e);if(n!==void 0)return n}}var Be=u.match(/[0-9]+/).desc(["number"]).map(e=>({raw:e,value:parseInt(e,10)})),Le=u.match(/0x[a-fA-F0-9]+/).desc(["hexadecimal number"]).map(e=>({raw:e,value:parseInt(e,16)})),Br=Le.or(Be).desc(["number"]);var h=class{constructor(){}},f=class extends Error{constructor(r,n,i){super(r,i);this.apgmSpan=n}};function x(e){return e!==void 0?` at line ${e.line} column ${e.column}`:""}var G=class extends h{constructor(r,n,i){super();this.name=r;this.args=n;this.span=i}transform(r){return r(new G(this.name,this.args.map(n=>n.transform(r)),this.span))}pretty(){return`${this.name}(${this.args.map(r=>r.pretty()).join(", ")})`}};var N=class extends h{constructor(r,n,i,o,a){super();this.modifier=r;this.cond=n;this.thenBody=i;this.elseBody=o;this.span=a}transform(r){return r(new N(this.modifier,this.cond.transform(r),this.thenBody.transform(r),this.elseBody!==void 0?this.elseBody.transform(r):void 0,this.span))}pretty(){let r=`if_${this.modifier==="Z"?"z":"nz"}`,n=this.cond.pretty(),i=this.elseBody===void 0?"":` else ${this.elseBody.pretty()}`;return`${r} (${n}) ${this.thenBody.pretty()}`+i}};var M=class extends h{constructor(r){super();this.body=r}transform(r){return r(new M(this.body.transform(r)))}pretty(){return`loop ${this.body.pretty()}`}};var pt=class{constructor(t,r,n,i){this.name=t;this.args=r;this.body=n;this.span=i}pretty(){return`macro ${this.name}(${this.args.map(t=>t.pretty()).join(", ")}) ${this.body.pretty()}`}};var ft=class{constructor(t,r,n){this.macros=t;this.headers=r;this.seqExpr=n}pretty(){return[this.macros.map(t=>t.pretty()).join(`
`),this.headers.map(t=>t.toString()).join(`
`),this.seqExpr.prettyInner()].join(`
`)}};var lt=class{constructor(t,r){this.name=t;this.content=r}toString(){let t=this.content.startsWith(" ")?"":" ";return`#${this.name}${t}${this.content}`}};var O=class extends h{constructor(r,n,i){super();this.value=r;this.span=n;this.raw=i}transform(r){return r(this)}pretty(){return this.value.toString()}};var V=class extends h{constructor(r,n){super();this.value=r;this.span=n}transform(r){return r(this)}pretty(){return'"'+this.value+'"'}};var $=class extends h{constructor(r){super();this.exprs=r}transform(r){return r(new $(this.exprs.map(n=>n.transform(r))))}pretty(){return`{${this.prettyInner()}}`}prettyInner(){return this.exprs.map(r=>r instanceof N||r instanceof M||r instanceof B?r.pretty():r.pretty()+";").join(`
`)}};var C=class extends h{constructor(r,n){super();this.name=r;this.span=n}transform(r){return r(this)}pretty(){return this.name}};var B=class extends h{constructor(r,n,i){super();this.modifier=r;this.cond=n;this.body=i}transform(r){return r(new B(this.modifier,this.cond.transform(r),this.body.transform(r)))}pretty(){return`while_${this.modifier==="Z"?"z":"nz"}(${this.cond.pretty()}) ${this.body.pretty()}`}};function Re(e,t){let r=t.split(/\n|\r\n/),n=r[e.location.line-2],i=r[e.location.line-1],o=r[e.location.line],a=" ".repeat(Math.max(0,e.location.column-1))+"^",p=[...n===void 0?[]:[n],i],c=[...o===void 0?[]:[o]],P="| ",D=[...p.map(et=>P+et)," ".repeat(P.length)+a,...c.map(et=>P+et)];return[`parse error at line ${e.location.line} column ${e.location.column}:`,`  expected ${e.expected.join(", ")}`,"",...D].join(`
`)}function Lr(e,t){let r=e.parse(t);if(r.type==="ParseOK")return r.value;throw new f(Re(r,t),{start:r.location,end:r.location})}var Te=u.match(/\/\*(\*(?!\/)|[^*])*\*\//s).desc([]),d=u.match(/\s*/).desc(["space"]).sepBy(Te).map(()=>{}),$e=u.match(/\s+/).desc(["space"]),ve=/[a-zA-Z_][a-zA-Z_0-9]*/u,Tr=u.match(ve).desc(["identifier"]);function tt(e,t){return{start:e,end:{index:e.index+t.length-1,line:e.line,column:e.column+t.length}}}var Ie=Tr.wrap(d,d),De=d.chain(()=>u.location.chain(e=>Tr.skip(d).map(t=>[t,tt(e,t)]))),_e=/[a-zA-Z_][a-zA-Z_0-9]*!/u,$r=u.match(_e).wrap(d,d).desc(["macro name"]);function v(e){return u.text(e).wrap(d,d)}function Rr(e){return u.location.chain(r=>u.text(e).map(n=>[n,tt(r,e)])).wrap(d,d)}var Oe=v(",").desc(["`,`"]),vr=v("(").desc(["`(`"]),Ir=v(")").desc(["`)`"]),Ce=v(";").desc(["`;`"]),Ze=v("{").desc(["`{`"]),ze=v("}").desc(["`}`"]),Dr=De.map(([e,t])=>new C(e,t));function _r(e){return u.lazy(()=>e()).sepBy(Oe).wrap(vr,Ir)}function Ue(){return d.next(u.location).chain(e=>u.choice($r,Ie).chain(t=>_r(()=>Y()).map(r=>new G(t,r,tt(e,t)))))}var ke=u.location.chain(e=>Br.map(t=>new O(t.value,tt(e,t.raw),t.raw))).wrap(d,d),Fe=d.next(u.location).chain(e=>u.text('"').next(u.match(/[^"]*/)).skip(u.text('"')).skip(d).desc(["string"]).map(t=>({value:t,span:tt(e,`"${t}"`)}))),We=Fe.map(e=>new V(e.value,e.span));function Or(){return u.lazy(()=>Qe()).repeat()}function Ve(){return Or().wrap(Ze,ze).map(e=>new $(e))}var Ye=u.choice(v("while_z"),v("while_nz")).map(e=>e==="while_z"?"Z":"NZ"),Cr=u.lazy(()=>Y()).wrap(vr,Ir);function Zr(){return Ye.chain(e=>Cr.chain(t=>u.lazy(()=>Y()).map(r=>new B(e,t,r))))}function zr(){return v("loop").next(u.lazy(()=>Y())).map(e=>new M(e))}var He=u.choice(Rr("if_z"),Rr("if_nz")).map(e=>e[0]==="if_z"?["Z",e[1]]:["NZ",e[1]]);function Ur(){return He.chain(e=>Cr.chain(t=>u.lazy(()=>Y()).chain(r=>u.choice(v("else").next(u.lazy(()=>Y())),u.ok(void 0)).map(n=>new N(e[0],t,r,n,e[1])))))}function ar(){let e="macro";return d.chain(r=>u.location.chain(n=>u.text(e).next($e).map(i=>tt(n,e)))).and($r).chain(([r,n])=>_r(()=>Dr).map(i=>({span:r,name:n,args:i})))}function je(){return ar().chain(({span:e,name:t,args:r})=>u.lazy(()=>Y()).map(n=>new pt(t,r,n,e)))}var Xe=u.match(/.*/),qe=u.text("#").next(u.match(/REGISTERS|COMPONENTS/)).desc(["#REGISTERS","#COMPONENTS"]).chain(e=>Xe.map(t=>new lt(e,t))),Ke=qe.wrap(d,d).repeat();function Je(){return je().repeat().chain(e=>Ke.chain(t=>Or().wrap(d,d).map(r=>new ft(e,t,new $(r)))))}function kr(e){return Lr(Je(),e)}function Y(){return u.choice(zr(),Zr(),Ur(),Ue(),Ve(),Dr,ke,We)}function Qe(){return u.choice(zr(),Zr(),Ur(),Y().skip(Ce))}var E=class{constructor(){}};var y=class extends E{constructor(r){super();this.actions=r}transform(r){return r(this)}};var m=class extends E{constructor(r){super();this.exprs=r}transform(r){return r(new m(this.exprs.map(n=>n.transform(r))))}};function q(e){return e instanceof m&&e.exprs.every(t=>q(t))}function rt(e){if(e instanceof y)return e;if(e instanceof m&&e.exprs.length===1){let t=e.exprs[0];return rt(t)}}var I=class extends E{constructor(r,n,i){super();this.cond=r;this.thenBody=n;this.elseBody=i}transform(r){return r(new I(this.cond.transform(r),this.thenBody.transform(r),this.elseBody.transform(r)))}};var Z=class extends E{constructor(r){super();this.body=r;this.kind="loop"}transform(r){return r(new Z(this.body.transform(r)))}};var z=class extends E{constructor(r,n,i){super();this.modifier=r;this.cond=n;this.body=i}transform(r){return r(new z(this.modifier,this.cond.transform(r),this.body.transform(r)))}};var H=class extends E{constructor(r,n){super();this.level=r;this.span=n;this.kind="break"}transform(r){return r(this)}};var s=class{static incU(t){return s.nonReturn(`INC U${t}`)}static incUMulti(...t){return new y([...t.map(r=>`INC U${r}`),"NOP"])}static tdecU(t){return s.single(`TDEC U${t}`)}static addA1(){return s.nonReturn("ADD A1")}static addB0(){return s.single("ADD B0")}static addB1(){return s.single("ADD B1")}static incB2DX(){return s.nonReturn("INC B2DX")}static tdecB2DX(){return s.single("TDEC B2DX")}static incB2DY(){return s.nonReturn("INC B2DY")}static tdecB2DY(){return s.single("TDEC B2DY")}static readB2D(){return s.single("READ B2D")}static setB2D(){return s.nonReturn("SET B2D")}static incB(t){return s.nonReturn(`INC B${t}`)}static tdecB(t){return s.single(`TDEC B${t}`)}static readB(t){return s.single(`READ B${t}`)}static setB(t){return s.nonReturn(`SET B${t}`)}static haltOUT(){return s.single("HALT_OUT")}static mul0(){return s.single("MUL 0")}static mul1(){return s.single("MUL 1")}static nop(){return s.single("NOP")}static output(t){return s.nonReturn(`OUTPUT ${t}`)}static subA1(){return s.nonReturn("SUB A1")}static subB0(){return s.single("SUB B0")}static subB1(){return s.single("SUB B1")}static nonReturn(t){return new y([t,"NOP"])}static single(t){return new y([t])}};function tn(e,t){if(e.args.length!==0)throw new f(`"${e.name}" expects empty argments${x(e.span?.start)}`,e.span);return t}function Fr(e,t){if(e.args.length!==1)throw new f(`number of arguments is not 1: "${e.name}"${x(e.span?.start)}`,e.span);let r=e.args[0];if(!(r instanceof O))throw new f(`argument is not a number: "${e.name}"${x(e.span?.start)}`,e.span);return t(r.value)}function rn(e,t){if(e.args.length!==1)throw new f(`number of arguments is not 1: "${e.name}"${x(e.span?.start)}`,e.span);let r=e.args[0];if(!(r instanceof V))throw new f(`argument is not a string: "${e.name}"${x(e.span?.start)}`,e.span);return t(r.value)}var Wr=new Map([["nop",s.nop()],["inc_b2dx",s.incB2DX()],["inc_b2dy",s.incB2DY()],["tdec_b2dx",s.tdecB2DX()],["tdec_b2dy",s.tdecB2DY()],["read_b2d",s.readB2D()],["set_b2d",s.setB2D()],["add_a1",s.addA1()],["add_b0",s.addB0()],["add_b1",s.addB1()],["sub_a1",s.subA1()],["sub_b0",s.subB0()],["sub_b1",s.subB1()],["mul_0",s.mul0()],["mul_1",s.mul1()],["halt_out",s.haltOUT()]]),Vr=new Map([["inc_u",s.incU],["tdec_u",s.tdecU],["inc_b",s.incB],["tdec_b",s.tdecB],["read_b",s.readB],["set_b",s.setB]]),Yr=new Map([["output",s.output]]);function en(e){let t=Wr.get(e.name);if(t!==void 0)return tn(e,t);let r=Vr.get(e.name);if(r!==void 0)return Fr(e,r);let n=Yr.get(e.name);if(n!==void 0)return rn(e,n);switch(e.name){case"break":return e.args.length===0?new H(void 0,e.span):Fr(e,i=>new H(i,e.span));case"repeat":{if(e.args.length!==2)throw new f(`"repeat" takes two arguments${x(e.span?.start)}`,e.span);let i=e.args[0];if(!(i instanceof O))throw new f(`first argument of "repeat" must be a number${x(e.span?.start)}`,e.span);let o=e.args[1];if(o===void 0)throw new Error("internal error");let a=It(o);return new m(Array(i.value).fill(0).map(()=>a))}}throw new f(`Unknown ${e.name.endsWith("!")?"macro":"function"}: "${e.name}"${x(e.span?.start)}`,e.span)}function It(e){let t=It;if(e instanceof G)return en(e);if(e instanceof N)return e.modifier==="Z"?new I(t(e.cond),t(e.thenBody),e.elseBody===void 0?new m([]):t(e.elseBody)):new I(t(e.cond),e.elseBody===void 0?new m([]):t(e.elseBody),t(e.thenBody));if(e instanceof M)return new Z(t(e.body));if(e instanceof O)throw new f(`number is not allowed: ${e.raw??e.value}${x(e.span?.start)}`,e.span);if(e instanceof $)return new m(e.exprs.map(r=>t(r)));if(e instanceof V)throw new f(`string is not allowed: ${e.pretty()}${x(e.span?.start)}`,e.span);if(e instanceof C)throw new f(`macro variable is not allowed: variable "${e.name}"${x(e.span?.start)}`,e.span);if(e instanceof B)return new z(e.modifier,t(e.cond),t(e.body));throw Error("internal error")}function nn(e){let t="",r=!1,n=0;for(;n<e.length;){let i=e[n],o=e[n+1];i==="/"&&o==="*"?(n+=2,r=!0):i==="*"&&o==="/"?(r=!1,n+=2):(r||(t+=i),n++)}return t}function on(e){let t=[],r=/(macro\s+([a-zA-Z_][a-zA-Z_0-9]*?!)\s*\(.*?\))/gs,n=nn(e).matchAll(r);for(let i of n){let o=ar().parse(i[0]);o.type==="ParseOK"&&t.push({name:o.value.name,args:o.value.args.map(a=>a.name)})}return t}function Hr(e){return e.transform(sn)}function sn(e){return e instanceof m?an(e):e}function jr(e,t){let r=Xr(ur(e),ur(t));return r===void 0?void 0:new y(r.map(n=>n.pretty()))}function Xr(e,t){if(e.length===0)return t.slice();if(t.length===0)return e.slice();if(e.some(c=>c instanceof b)||t.some(c=>c instanceof b))return;let r=e.filter(c=>!(c instanceof S)),n=t.filter(c=>!(c instanceof S)),i=r.every(c=>!c.doesReturnValue()),o=n.every(c=>!c.doesReturnValue());if(!i&&!o||!r.every(c=>n.every(P=>!c.isSameComponent(P))))return;let p=r.concat(n);return i&&o&&p.push(new S),p}function ur(e){return e.actions.flatMap(t=>{let r=ut(t);return r!==void 0?[r]:[]})}function an(e){let t=[],r=[],n=()=>{r.length!==0&&(t.push(new y(r.map(i=>i.pretty()))),r=[])};for(let i of e.exprs)if(i instanceof y){let o=ur(i),a=Xr(r,o);a===void 0?(n(),r=o):r=a}else n(),t.push(i);return n(),new m(t)}var w=class{constructor(t,r,n){this.input=t;this.output=r;this.inputZNZ=n}},L=class{constructor(t){this.inner=t;if(this.inner.actions.length===0)throw Error("action must be nonempty")}toLineString(){let t=this.inner.prevOutput,r=t;return(t==="*"||t==="Z")&&(r=" "+t),`${this.inner.currentState}; ${r}; ${this.inner.nextState}; ${this.inner.actions.join(", ")}`}},cr=class{constructor(t={}){this.id=0;this.#t=[];this.prefix=t.prefix??"STATE_",this.optimize=!(t.noOptimize??!1)}#t;getFreshName(){return this.id++,`${this.prefix}${this.id}`}emitTransition(t,r,n="*"){return new L({currentState:t,prevOutput:n,nextState:r,actions:["NOP"]})}transpile(t){let r="INITIAL",n=this.getFreshName()+"_INITIAL",i=this.emitTransition(r,n,"ZZ"),o=this.prefix+"END",a=this.transpileExpr(new w(n,o,"*"),t),p=new L({currentState:o,prevOutput:"*",nextState:o,actions:["HALT_OUT"]});return[i,...a,p].map(c=>c.toLineString())}transpileExpr(t,r){if(r instanceof y)return[this.#e(t,r)];if(r instanceof m)return this.#i(t,r);if(r instanceof I)return this.#o(t,r);if(r instanceof Z)return this.#s(t,r);if(r instanceof z)return this.#u(t,r);if(r instanceof H)return this.#c(t,r);throw Error("unknown expr")}#e(t,r){return new L({currentState:t.input,prevOutput:t.inputZNZ,nextState:t.output,actions:r.actions})}#i(t,r){if(q(r))return[this.emitTransition(t.input,t.output,t.inputZNZ)];if(r.exprs.length===1){let a=r.exprs[0];if(a===void 0)throw new Error("internal error");return this.transpileExpr(t,a)}let n=[],i=t.input,o=r.exprs.length-1;for(let[a,p]of r.exprs.entries())if(a===0){let c=this.getFreshName();n=n.concat(this.transpileExpr(new w(i,c,t.inputZNZ),p)),i=c}else if(a===o)n=n.concat(this.transpileExpr(new w(i,t.output,"*"),p));else{let c=this.getFreshName();n=n.concat(this.transpileExpr(new w(i,c,"*"),p)),i=c}return n}#o(t,r){if(this.optimize&&q(r.thenBody)&&q(r.elseBody))return this.transpileExpr(t,r.cond);let n=this.getFreshName(),i=this.transpileExpr(new w(t.input,n,t.inputZNZ),r.cond),[o,...a]=this.transpileExpr(new w(n,t.output,"Z"),r.thenBody),[p,...c]=this.transpileExpr(new w(n,t.output,"NZ"),r.elseBody);return[...i,o,p,...a,...c]}#s(t,r){let{startState:n,fromZOrNZ:i}=this.#r(t);this.#t.push(t.output);let o=this.transpileExpr(new w(n,n,"*"),r.body);return this.#t.pop(),[...i,...o]}#n(t,r,n,i){let{startState:o,fromZOrNZ:a}=this.#r(t),p=this.getFreshName(),c=this.#e(new w(o,p,"*"),r),P=new L({currentState:p,prevOutput:"Z",nextState:i==="Z"?p:t.output,actions:i==="Z"?n.actions:["NOP"]}),D=new L({currentState:p,prevOutput:"NZ",nextState:i==="Z"?t.output:p,actions:i==="Z"?["NOP"]:n.actions});return[...a,c,P,D]}#a(t,r,n){let{startState:i,fromZOrNZ:o}=this.#r(t),a=this.getFreshName(),p=this.transpileExpr(new w(i,a,"*"),r),c=new L({currentState:a,prevOutput:"Z",nextState:n==="Z"?i:t.output,actions:["NOP"]}),P=new L({currentState:a,prevOutput:"NZ",nextState:n==="Z"?t.output:i,actions:["NOP"]});return[...o,...p,c,P]}#u(t,r){let n=this.optimize;if(n&&q(r.body)){let K=rt(r.cond);return K!==void 0?this.#n(t,K,K,r.modifier):this.#a(t,r.cond,r.modifier)}let i=rt(r.body),o=rt(r.cond);if(n&&o!==void 0&&i!==void 0){let K=jr(i,o);if(K!==void 0)return this.#n(t,o,K,r.modifier)}let{startState:a,fromZOrNZ:p}=this.#r(t),c=this.getFreshName(),P=this.transpileExpr(new w(a,c,"*"),r.cond),D=this.getFreshName()+"_WHILE_BODY",et=new L({currentState:c,prevOutput:"Z",nextState:r.modifier==="Z"?D:t.output,actions:["NOP"]}),te=new L({currentState:c,prevOutput:"NZ",nextState:r.modifier==="Z"?t.output:D,actions:["NOP"]});this.#t.push(t.output);let re=this.transpileExpr(new w(D,a,"*"),r.body);return this.#t.pop(),[...p,...P,et,te,...re]}#r(t){let r=t.inputZNZ==="*"?t.input:this.getFreshName(),n=t.inputZNZ==="*"?[]:[this.emitTransition(t.input,r,t.inputZNZ)];return{startState:r,fromZOrNZ:n}}#c(t,r){let n=r.level??1;if(n<1)throw new f("break level is less than 1",r.span);let i=this.#t[this.#t.length-n];if(i===void 0)throw n===1?new f("break outside while or loop",r.span):new f("break level is greater than number of nests of while or loop",r.span);return[this.emitTransition(t.input,i,t.inputZNZ)]}};function pr(e,t={}){return new cr(t).transpile(e)}function qr(e){let t=new Set,r=[];for(let n of e)t.has(n)?r.push(n):t.add(n);return r}function Kr(e){return`${e} argument${e===1?"":"s"}`}function un(){throw new Error("internal error")}function cn(e,t){let r=t.args;if(r.length!==e.args.length)throw new f(`argument length mismatch: "${e.name}" expect ${Kr(e.args.length)} but given ${Kr(r.length)}${x(t.span?.start)}`,t.span);let n=new Map(e.args.map((i,o)=>[i.name,r[o]??un()]));return e.body.transform(i=>{if(i instanceof C){let o=n.get(i.name);if(o===void 0)throw new f(`scope error: Unknown variable "${i.name}"${x(i.span?.start)}`,i.span);return o}else return i})}var fr=class{constructor(t){this.count=0;this.maxCount=1e5;if(this.main=t,this.macroMap=new Map(t.macros.map(r=>[r.name,r])),this.macroMap.size<t.macros.length){let n=qr(t.macros.map(a=>a.name))[0],i=t.macros.slice().reverse().find(a=>a.name===n)?.span,o=i?.start;throw new f(`There is a macro with the same name: "${n}"`+x(o),i)}}expand(){return this.expandExpr(this.main.seqExpr)}expandExpr(t){if(this.maxCount<this.count)throw Error("too many macro expansion");return this.count++,t.transform(r=>this.expandOnce(r))}expandOnce(t){return t instanceof G?this.expandFuncAPGMExpr(t):t}expandFuncAPGMExpr(t){let r=this.macroMap.get(t.name);if(r!==void 0){let n=cn(r,t);return this.expandExpr(n)}else return t}};function Jr(e){return new fr(e).expand()}function Qr(e){return e.transform(pn)}function pn(e){return e instanceof m?fn(e):e}function fn(e){let t=[];for(let r of e.exprs)r instanceof m?t=t.concat(r.exprs):t.push(r);return new m(t)}function mt(e,t,r=void 0){let n=e(t);return r!==void 0&&console.log(r,JSON.stringify(n,null,"  ")),n}function ln(e,{log:t,noOptimize:r}){if(r===!0)return e;let n=mt(Qr,e,t?"optimized apgl seq":void 0);return mt(Hr,n,t?"optimized apgl action":void 0)}function Wu(e,t={},r=!1){let n=mt(kr,e,r?"apgm":void 0),i=mt(Jr,n,r?"apgm expaned":void 0),o=mt(It,i,r?"apgl":void 0),a=ln(o,{log:r,noOptimize:t.noOptimize}),p=pr(a,t),c=["# State    Input    Next state    Actions","# ---------------------------------------"];return n.headers.map(D=>D.toString()).concat(c,p)}export{on as completionParser,Wr as emptyArgFuncs,Wu as integration,Vr as numArgFuncs,Yr as strArgFuncs};
