import {warsawDayBounds} from './platform-history-time.js';
export function collectedHistoryQuery(storeId,{from='',to='',platform='',q='',page=1,size=15}={}){
 if(!storeId)throw new Error('Store required');
 if((from&&!/^\d{4}-\d{2}-\d{2}$/.test(from))||(to&&!/^\d{4}-\d{2}-\d{2}$/.test(to)))throw new RangeError('Invalid date');
 const {start,end}=warsawDayBounds(from,to);
 const where=['pm.store_id=?','o.store_id=?','pm.collected_at IS NOT NULL'],args=[storeId,storeId];
 if(start){where.push('pm.collected_at>=?');args.push(start)}
 if(end){where.push('pm.collected_at<?');args.push(end)}
 if(platform){where.push('pm.platform=?');args.push(platform)}
 if(q){where.push('(pm.external_order_id LIKE ? OR pm.order_id LIKE ?)');args.push('%'+q+'%','%'+q+'%')}
 const clause=where.join(' AND ');
 const fromSql=' FROM order_platform_metadata pm JOIN orders o ON o.id=pm.order_id WHERE '+clause;
 const countSql='SELECT COUNT(*) AS n'+fromSql;
 const listSql='SELECT pm.order_id,pm.platform,pm.external_order_id,pm.collected_at,pm.collected_by,o.created_at,o.kitchen_completed_at,o.note,(SELECT COALESCE(SUM(quantity),0) FROM order_items WHERE order_id=o.id) AS portions'+fromSql+' ORDER BY pm.collected_at DESC,pm.order_id DESC LIMIT ? OFFSET ?';
 return {countSql,listSql,args,listArgs:[...args,size,(page-1)*size]};
}
export const collectedHistoryDetailSql='SELECT o.id,o.note,o.created_at,o.kitchen_completed_at,pm.platform,pm.external_order_id,pm.collected_at,pm.collected_by FROM orders o JOIN order_platform_metadata pm ON pm.order_id=o.id AND pm.store_id=o.store_id WHERE o.id=? AND o.store_id=? AND pm.collected_at IS NOT NULL';
