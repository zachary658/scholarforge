import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Activity } from './Icons.jsx';

export default function NotificationCenter(){
  const navigate=useNavigate(); const [open,setOpen]=useState(false); const [items,setItems]=useState([]); const [unread,setUnread]=useState(0);
  const load=()=>api.listNotifications().then(d=>{setItems(d.notifications||[]);setUnread(d.unread||0);}).catch(()=>{});
  useEffect(()=>{load();},[]);
  return <div className="relative"><button className="relative rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-ink" title="通知" aria-label={`通知${unread?`，${unread}条未读`:''}`} onClick={()=>{setOpen(!open);if(!open)load();}}><Activity className="h-[18px] w-[18px]"/>{unread>0&&<span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] leading-4 text-white">{unread>99?'99+':unread}</span>}</button>{open&&<div className="absolute bottom-10 right-0 z-50 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"><div className="border-b px-4 py-3 text-sm font-semibold">站内通知</div><div className="max-h-80 overflow-y-auto">{items.length===0?<div className="p-6 text-center text-xs text-slate-400">暂无通知</div>:items.map(n=><button key={n.id} className={`block w-full border-b px-4 py-3 text-left hover:bg-slate-50 ${n.read_at?'':'bg-accent-50/40'}`} onClick={async()=>{if(!n.read_at)await api.readNotification(n.id).catch(()=>{});setOpen(false);if(n.link)navigate(n.link);}}><div className="text-sm font-medium text-ink">{n.title}</div><p className="mt-1 line-clamp-2 text-xs text-slate-500">{n.content}</p></button>)}</div></div>}</div>;
}
