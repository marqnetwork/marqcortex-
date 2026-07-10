import{l as s,A as k,Z as u}from"./App-BmT7op3A.js";import{j as e}from"./index-D5RZXZ7S.js";import{u as y,B as f}from"./TeamDashboardRoute-CKNoFyJD.js";import{M as g}from"./runtime-Ba116Ljz.js";import{S as b}from"./sparkles-CLeTlXKs.js";/**
 * @license lucide-react v0.487.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const j=[["path",{d:"M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z",key:"96xj49"}]],B=s("flame",j);/**
 * @license lucide-react v0.487.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const v=[["path",{d:"m3 17 2 2 4-4",key:"1jhpwq"}],["path",{d:"m3 7 2 2 4-4",key:"1obspn"}],["path",{d:"M13 6h8",key:"15sg57"}],["path",{d:"M13 12h8",key:"h98zly"}],["path",{d:"M13 18h8",key:"oe0vm4"}]],F=s("list-checks",v);/**
 * @license lucide-react v0.487.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const N=[["path",{d:"M21 10.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.5",key:"1uzm8b"}],["path",{d:"m9 11 3 3L22 4",key:"1pflzl"}]],L=s("square-check-big",N);/**
 * @license lucide-react v0.487.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $=[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}]],G=s("square",$);/**
 * @license lucide-react v0.487.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const C=[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["polyline",{points:"16 11 18 13 22 9",key:"1pwet4"}]],H=s("user-check",C),w={sparkles:b,zap:u,message:g,bot:f,arrow:k};function _({label:r,sectionId:o,sectionLabel:n,quickPrompt:i,sectionContent:c,leadContext:a,variant:h="pill",icon:x="sparkles",colors:t=["#8B5CF6","#3B82F6"],className:l=""}){const{openChat:m}=y(),p=w[x],d=()=>{m({sectionId:o,sectionLabel:n,sectionContent:c,lead:a,quickPrompt:i})};return h==="pill"?e.jsxs("button",{onClick:d,className:`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all hover:opacity-90 active:scale-[0.97] ${l}`,style:{background:`linear-gradient(135deg, ${t[0]}18, ${t[1]}18)`,border:`1px solid ${t[0]}35`,color:t[0]},children:[e.jsx(p,{className:"size-3"}),e.jsxs("span",{children:["Generate: ",r]}),e.jsxs("span",{className:"text-[9px] font-black opacity-60 ml-0.5",style:{color:t[1]},children:["— ",n]})]}):h==="compact"?e.jsxs("button",{onClick:d,className:`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all hover:opacity-90 active:scale-[0.97] ${l}`,style:{background:`${t[0]}15`,border:`1px solid ${t[0]}25`,color:t[0]},children:[e.jsx(p,{className:"size-2.5"}),"AI"]}):e.jsxs("button",{onClick:d,className:`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:bg-white/5 text-gray-400 hover:text-white border border-transparent hover:border-white/10 ${l}`,children:[e.jsx(p,{className:"size-3"}),r]})}function R({sectionId:r,sectionLabel:o,sectionContent:n,leadContext:i,actions:c}){return e.jsx("div",{className:"flex flex-wrap items-center gap-2",children:c.map(a=>e.jsx(_,{label:a.label,sectionId:r,sectionLabel:o,sectionContent:n,leadContext:i,quickPrompt:a.prompt,icon:a.icon??"sparkles",variant:"pill"},a.label))})}export{R as A,B as F,_ as I,F as L,L as S,H as U,G as a};
